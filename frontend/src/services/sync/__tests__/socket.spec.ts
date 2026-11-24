import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ServerMessage } from '@/types/api'

import { createLiveSocket, parseServerMessage, socketUrl, type LiveSocket } from '../socket'

const GROUP = '0190a8c4-0000-7000-8000-0000000000a1'
const LIST = '0190a8c4-0000-7000-8000-0000000000b1'
const ANNA = '0190a8c4-0000-7000-8000-00000000000a'

const READY: ServerMessage = { type: 'ready' }
const PONG: ServerMessage = { type: 'pong' }
const LIST_DELETED: ServerMessage = {
  type: 'listDeleted',
  payload: { groupId: GROUP, listId: LIST, actorId: ANNA },
}

const READY_STATE_OPEN = 1
const READY_STATE_CLOSED = 3

/** A WebSocket the test controls: the `server*` methods play the server. */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []

  readyState: 0 | 1 | 2 | 3 = 0
  sent: string[] = []
  closedWith: { code?: number; reason?: string } | null = null

  constructor(readonly url: string) {
    super()
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code, reason }
    this.readyState = READY_STATE_CLOSED
  }

  serverOpen() {
    this.readyState = READY_STATE_OPEN
    this.dispatchEvent(new Event('open'))
  }

  serverSend(message: ServerMessage | string) {
    const data = typeof message === 'string' ? message : JSON.stringify(message)
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  /** Like a browser: an error event first, then the close event. */
  serverClose(code = 1006, reason = '') {
    this.readyState = READY_STATE_CLOSED
    this.dispatchEvent(new Event('error'))
    this.dispatchEvent(new CloseEvent('close', { code, reason }))
  }

  /** Connected and told `ready` by the server. */
  ready() {
    this.serverOpen()
    this.serverSend(READY)
  }
}

// Sockets that tests started; stopped afterwards so no window listeners leak.
const started: LiveSocket[] = []

function newSocket(random: () => number = () => 0): LiveSocket {
  const socket = createLiveSocket({
    url: 'ws://test/api/v1/ws',
    WebSocket: FakeWebSocket,
    random,
  })
  started.push(socket)
  return socket
}

/** The socket most recently opened by the code under test. */
function latest(): FakeWebSocket {
  const instance = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!instance) throw new Error('no socket was opened')
  return instance
}

function openedCount(): number {
  return FakeWebSocket.instances.length
}

// jsdom's navigator.onLine is always true and its tab always visible; the
// spies play the browser.
function setNavigatorOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
})

afterEach(() => {
  for (const socket of started.splice(0)) {
    socket.stop()
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('socketUrl', () => {
  it('uses wss on https', () => {
    expect(socketUrl({ protocol: 'https:', host: 'tuolino.example' })).toBe(
      'wss://tuolino.example/api/v1/ws',
    )
  })

  it('uses ws on http', () => {
    expect(socketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/v1/ws',
    )
  })
})

describe('parseServerMessage', () => {
  it('returns a known message', () => {
    expect(parseServerMessage(JSON.stringify(LIST_DELETED))).toEqual(LIST_DELETED)
  })

  it('ignores malformed JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseServerMessage('{"type":')).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('ignores unknown types', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseServerMessage('{"type":"somethingNew"}')).toBeNull()
    expect(parseServerMessage('{"type":"toString"}')).toBeNull()
    expect(parseServerMessage('{"type":7}')).toBeNull()
    expect(parseServerMessage('{}')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores non-object and non-string data', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseServerMessage('42')).toBeNull()
    expect(parseServerMessage('null')).toBeNull()
    expect(parseServerMessage(new ArrayBuffer(8))).toBeNull()
    expect(parseServerMessage(READY)).toBeNull()
    expect(parseServerMessage(undefined)).toBeNull()
  })
})

describe('live socket: connecting', () => {
  it('opens one socket on start, even when started twice', () => {
    const socket = newSocket()

    socket.start()
    socket.start()

    expect(openedCount()).toBe(1)
    expect(latest().url).toBe('ws://test/api/v1/ws')
  })

  it('is connecting until ready, then connected', () => {
    const socket = newSocket()
    const seen: string[] = []
    socket.onStatusChange((status) => seen.push(status))
    expect(socket.status).toBe('idle')

    socket.start()
    latest().serverOpen()
    expect(socket.status).toBe('connecting')

    latest().serverSend(READY)
    expect(socket.status).toBe('connected')
    expect(seen).toEqual(['connecting', 'connected'])
  })
})

describe('live socket: handlers', () => {
  it('calls only the handlers of the message type', () => {
    const socket = newSocket()
    const onReady = vi.fn()
    const onListDeleted = vi.fn()
    socket.on('ready', onReady)
    socket.on('listDeleted', onListDeleted)
    socket.start()

    latest().ready()
    latest().serverSend(LIST_DELETED)

    expect(onReady).toHaveBeenCalledExactlyOnceWith(READY)
    expect(onListDeleted).toHaveBeenCalledExactlyOnceWith(LIST_DELETED)
  })

  it('stops calling a handler after unsubscribe', () => {
    const socket = newSocket()
    const handler = vi.fn()
    const unsubscribe = socket.on('pong', handler)
    socket.start()
    latest().ready()

    latest().serverSend(PONG)
    unsubscribe()
    latest().serverSend(PONG)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('keeps handlers across reconnects', () => {
    const socket = newSocket()
    const onReady = vi.fn()
    socket.on('ready', onReady)
    socket.start()
    latest().ready()

    latest().serverClose()
    vi.advanceTimersByTime(1_000)
    latest().ready()

    socket.stop()
    socket.start()
    latest().ready()

    expect(onReady).toHaveBeenCalledTimes(3)
  })

  it('a throwing handler does not stop the others', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const socket = newSocket()
    const second = vi.fn()
    socket.on('ready', () => {
      throw new Error('boom')
    })
    socket.on('ready', second)
    socket.start()

    latest().ready()

    expect(second).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
    expect(socket.status).toBe('connected')
  })
})

describe('live socket: reconnecting', () => {
  it('retries after 1, 2, 4, 8, 16, 30, 30 seconds', () => {
    const socket = newSocket()
    socket.start()

    for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
      const before = openedCount()
      latest().serverClose()

      vi.advanceTimersByTime(seconds * 1_000 - 1)
      expect(openedCount()).toBe(before)
      vi.advanceTimersByTime(1)
      expect(openedCount()).toBe(before + 1)
    }
  })

  it('jitter shortens the delay by at most half', () => {
    const socket = newSocket(() => 1)
    socket.start()
    latest().serverClose()

    vi.advanceTimersByTime(499)
    expect(openedCount()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(openedCount()).toBe(2)
  })

  it('resets the backoff after ready', () => {
    const socket = newSocket()
    socket.start()
    latest().serverClose()
    vi.advanceTimersByTime(1_000)
    latest().serverClose()
    vi.advanceTimersByTime(2_000)
    latest().ready()

    latest().serverClose()
    vi.advanceTimersByTime(999)
    expect(openedCount()).toBe(3)
    vi.advanceTimersByTime(1)
    expect(openedCount()).toBe(4)
  })

  it('reconnects after close 1001', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const socket = newSocket()
    socket.start()
    latest().ready()

    latest().serverClose(1001, 'connection lifetime reached')
    vi.advanceTimersByTime(1_000)

    expect(openedCount()).toBe(2)
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs unexpected close codes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const socket = newSocket()
    socket.start()

    latest().serverClose(1006)
    expect(warn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    latest().serverClose(1008, 'invalid message')
    expect(warn).toHaveBeenCalledExactlyOnceWith('WebSocket closed', 1008, 'invalid message')
    vi.advanceTimersByTime(2_000)
    expect(openedCount()).toBe(3)
  })
})

describe('live socket: status', () => {
  it('counts failed attempts only before ready', () => {
    const socket = newSocket()
    const failed = vi.fn()
    socket.onAttemptFailed(failed)
    socket.start()

    latest().serverClose()
    vi.advanceTimersByTime(1_000)
    latest().serverClose()
    vi.advanceTimersByTime(2_000)
    latest().ready()
    latest().serverClose()
    expect(failed.mock.calls).toEqual([[1], [2]])

    vi.advanceTimersByTime(1_000)
    latest().serverClose()
    expect(failed.mock.calls).toEqual([[1], [2], [1]])
  })

  it('is offline after a failed attempt and connecting after losing a ready connection', () => {
    const socket = newSocket()
    socket.start()
    latest().ready()

    latest().serverClose(1001)
    expect(socket.status).toBe('connecting')

    vi.advanceTimersByTime(1_000)
    latest().serverClose()
    expect(socket.status).toBe('offline')

    vi.advanceTimersByTime(2_000)
    latest().ready()
    expect(socket.status).toBe('connected')
  })
})

describe('live socket: ping', () => {
  it('sends ping every 25 seconds', () => {
    const socket = newSocket()
    socket.start()
    latest().ready()

    vi.advanceTimersByTime(24_999)
    expect(latest().sent).toEqual([])

    for (let pings = 1; pings <= 3; pings++) {
      vi.advanceTimersByTime(pings === 1 ? 1 : 25_000)
      expect(latest().sent).toEqual(Array(pings).fill('{"type":"ping"}'))
      latest().serverSend(PONG)
    }
  })

  it('abandons the socket when no message arrives within 10 seconds of a ping', () => {
    const socket = newSocket()
    socket.start()
    const first = latest()
    first.ready()

    vi.advanceTimersByTime(25_000 + 9_999)
    expect(first.closedWith).toBeNull()
    vi.advanceTimersByTime(1)

    expect(first.closedWith).not.toBeNull()
    expect(socket.status).toBe('connecting')
    vi.advanceTimersByTime(1_000)
    expect(openedCount()).toBe(2)
  })

  it('any message counts as pong', () => {
    const socket = newSocket()
    socket.start()
    latest().ready()

    vi.advanceTimersByTime(25_000)
    latest().serverSend(LIST_DELETED)
    vi.advanceTimersByTime(10_000)

    expect(latest().closedWith).toBeNull()
    expect(openedCount()).toBe(1)
  })

  it('abandons an attempt without ready after 10 seconds', () => {
    const socket = newSocket()
    const failed = vi.fn()
    socket.onAttemptFailed(failed)
    socket.start()
    const first = latest()
    first.serverOpen()

    vi.advanceTimersByTime(10_000)

    expect(first.closedWith).not.toBeNull()
    expect(failed).toHaveBeenCalledExactlyOnceWith(1)
    expect(socket.status).toBe('offline')
    vi.advanceTimersByTime(1_000)
    expect(openedCount()).toBe(2)
  })
})

describe('live socket: browser events', () => {
  it('does not retry while the browser is offline', () => {
    const socket = newSocket()
    socket.start()
    latest().serverClose()

    setNavigatorOnline(false)
    window.dispatchEvent(new Event('offline'))
    vi.advanceTimersByTime(60_000)

    expect(openedCount()).toBe(1)
    expect(socket.status).toBe('offline')
  })

  it('connects at once on online', () => {
    const socket = newSocket()
    socket.start()
    latest().serverClose()
    setNavigatorOnline(false)
    window.dispatchEvent(new Event('offline'))

    setNavigatorOnline(true)
    window.dispatchEvent(new Event('online'))

    expect(openedCount()).toBe(2)
  })

  it('connects at once when the tab becomes visible', () => {
    const socket = newSocket()
    socket.start()
    latest().serverClose()

    setVisibility('hidden')
    expect(openedCount()).toBe(1)

    setVisibility('visible')
    expect(openedCount()).toBe(2)
    // The waiting retry is gone: no third socket when its time would have come.
    vi.advanceTimersByTime(1_000)
    expect(openedCount()).toBe(2)
  })

  it('pings at once when a connected tab becomes visible', () => {
    const socket = newSocket()
    socket.start()
    latest().ready()

    setVisibility('hidden')
    expect(latest().sent).toEqual([])

    setVisibility('visible')
    expect(latest().sent).toEqual(['{"type":"ping"}'])
  })
})

describe('live socket: stop', () => {
  it('stop closes with 1000 and never reconnects', () => {
    const socket = newSocket()
    socket.start()
    const ws = latest()
    ws.ready()

    socket.stop()

    expect(ws.closedWith).toEqual({ code: 1000, reason: 'client stopped' })
    expect(socket.status).toBe('idle')
    vi.advanceTimersByTime(60_000)
    expect(openedCount()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop cancels a waiting retry', () => {
    const socket = newSocket()
    socket.start()
    latest().serverClose()

    socket.stop()
    vi.advanceTimersByTime(60_000)

    expect(openedCount()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores events of a stopped socket', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const socket = newSocket()
    socket.start()
    const old = latest()
    old.ready()
    socket.stop()
    socket.start()

    old.serverClose(1011, 'internal error')
    vi.advanceTimersByTime(1_000)

    expect(warn).not.toHaveBeenCalled()
    expect(openedCount()).toBe(2)
    expect(socket.status).toBe('connecting')
  })

  it('removes its listeners on stop', () => {
    const removeFromWindow = vi.spyOn(window, 'removeEventListener')
    const removeFromDocument = vi.spyOn(document, 'removeEventListener')
    const socket = newSocket()
    socket.start()

    socket.stop()

    const names = (spy: typeof removeFromWindow) => spy.mock.calls.map(([name]) => name)
    expect(names(removeFromWindow)).toEqual(expect.arrayContaining(['online', 'offline']))
    expect(names(removeFromDocument)).toContain('visibilitychange')
  })
})
