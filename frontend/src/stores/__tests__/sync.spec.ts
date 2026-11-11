import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'

import { authService, type AuthService } from '@/services/api/auth'
import { setUnauthenticatedHandler } from '@/services/api/client'
import type { LiveSocket, ServerMessageHandler, SyncStatus } from '@/services/sync/socket'
import type { ServerMessage, ServerMessageType } from '@/types/api'

import { defineSyncStore } from '../sync'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'

type AnyHandler = (message: ServerMessage) => void

/** A socket that never connects; the helpers play what the real one reports. */
class FakeLiveSocket implements LiveSocket {
  status: SyncStatus = 'idle'
  start = vi.fn()
  stop = vi.fn()

  private statusListeners: ((status: SyncStatus) => void)[] = []
  private failureListeners: ((consecutive: number) => void)[] = []
  private handlers = new Map<ServerMessageType, AnyHandler[]>()

  on<T extends ServerMessageType>(type: T, handler: ServerMessageHandler<T>) {
    const list = this.handlers.get(type) ?? []
    // Same pairing as in the real socket: only messages of `type` arrive here.
    list.push(handler as AnyHandler)
    this.handlers.set(type, list)
    return () => {}
  }

  onStatusChange(listener: (status: SyncStatus) => void) {
    this.statusListeners.push(listener)
    return () => {}
  }

  onAttemptFailed(listener: (consecutive: number) => void) {
    this.failureListeners.push(listener)
    return () => {}
  }

  setStatus(status: SyncStatus) {
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }

  failAttempt(consecutive: number) {
    this.failureListeners.forEach((listener) => listener(consecutive))
  }

  receive(message: ServerMessage) {
    this.handlers.get(message.type)?.forEach((handler) => handler(message))
  }
}

/** The signed-in user as a ref, so tests can sign in and out. */
function setup(
  userId: string | null = null,
  session: Pick<AuthService, 'getMe'> = { getMe: vi.fn(() => Promise.reject(new Error('unused'))) },
) {
  const socket = new FakeLiveSocket()
  const user = ref(userId)
  const store = defineSyncStore(socket, session, () => user.value)()
  return { store, socket, user }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setUnauthenticatedHandler(null)
})

describe('sync store: following the user', () => {
  it('starts the socket when a user signs in', async () => {
    const { socket, user } = setup()
    expect(socket.start).not.toHaveBeenCalled()

    user.value = ANNA
    await nextTick()

    expect(socket.start).toHaveBeenCalledTimes(1)
  })

  it('starts the socket at once for a user who is already signed in', () => {
    const { socket } = setup(ANNA)

    expect(socket.start).toHaveBeenCalledTimes(1)
  })

  it('stops the socket on logout', async () => {
    const { socket, user } = setup(ANNA)
    socket.stop.mockClear()

    user.value = null
    await nextTick()

    expect(socket.stop).toHaveBeenCalledTimes(1)
    expect(socket.start).toHaveBeenCalledTimes(1)
  })

  it('restarts the socket when the user changes', async () => {
    const { socket, user } = setup(ANNA)
    socket.stop.mockClear()
    socket.start.mockClear()

    user.value = BEN
    await nextTick()

    expect(socket.stop).toHaveBeenCalledTimes(1)
    expect(socket.start).toHaveBeenCalledTimes(1)
    expect(socket.stop.mock.invocationCallOrder[0]).toBeLessThan(
      socket.start.mock.invocationCallOrder[0] ?? 0,
    )
  })
})

describe('sync store: state', () => {
  it('mirrors the socket status', () => {
    const { store, socket } = setup()
    expect(store.status).toBe('idle')
    expect(store.connected).toBe(false)

    socket.setStatus('connecting')
    expect(store.status).toBe('connecting')

    socket.setStatus('connected')
    expect(store.status).toBe('connected')
    expect(store.connected).toBe(true)

    socket.setStatus('offline')
    expect(store.status).toBe('offline')
    expect(store.connected).toBe(false)
  })

  it('sets lastReadyAt on ready', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-01T10:00:00Z'))
    const { store, socket } = setup()
    expect(store.lastReadyAt).toBeNull()

    socket.receive({ type: 'ready' })

    expect(store.lastReadyAt).toBe(Date.parse('2026-05-01T10:00:00Z'))
  })

  it('forgets lastReadyAt when the user changes', async () => {
    const { store, socket, user } = setup(ANNA)
    socket.receive({ type: 'ready' })

    user.value = null
    await nextTick()

    expect(store.lastReadyAt).toBeNull()
  })
})

describe('sync store: session check', () => {
  it('checks the session after every third failed attempt in a row', () => {
    const session = { getMe: vi.fn(() => Promise.reject(new Error('offline'))) }
    const { socket } = setup(ANNA, session)

    socket.failAttempt(1)
    socket.failAttempt(2)
    expect(session.getMe).not.toHaveBeenCalled()

    socket.failAttempt(3)
    expect(session.getMe).toHaveBeenCalledTimes(1)

    socket.failAttempt(4)
    socket.failAttempt(5)
    expect(session.getMe).toHaveBeenCalledTimes(1)

    socket.failAttempt(6)
    expect(session.getMe).toHaveBeenCalledTimes(2)
  })

  it('ignores a failed session check', async () => {
    const session = { getMe: vi.fn(() => Promise.reject(new Error('offline'))) }
    const { socket } = setup(ANNA, session)

    socket.failAttempt(3)
    await Promise.resolve()

    // No unhandled rejection (vitest would fail the run), and the socket keeps running.
    expect(socket.stop).toHaveBeenCalledTimes(1)
  })

  it('a 401 from the session check reaches the unauthenticated handler', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })),
      ),
    )
    const onUnauthenticated = vi.fn()
    setUnauthenticatedHandler(onUnauthenticated)
    const { socket } = setup(ANNA, authService)

    socket.failAttempt(3)

    await vi.waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenCalledWith('/api/v1/me', undefined)
  })
})
