import { API_BASE } from '@/services/api/client'
import type { ClientMessage, ServerMessage, ServerMessageOf, ServerMessageType } from '@/types/api'

export type Unsubscribe = () => void

export type ServerMessageHandler<T extends ServerMessageType> = (
  message: ServerMessageOf<T>,
) => void

/** What stores need to react to server events; they get it as a factory parameter. */
export interface ServerEvents {
  /** Calls `handler` for every message of this type, also after reconnects. */
  on<T extends ServerMessageType>(type: T, handler: ServerMessageHandler<T>): Unsubscribe
}

/**
 * idle: stopped (nobody signed in). connecting: first connect, or the first
 * retry after a working connection was lost. connected: the server sent
 * `ready`. offline: the browser is offline or an attempt failed since the
 * last `ready`.
 */
export type SyncStatus = 'idle' | 'connecting' | 'connected' | 'offline'

export interface LiveSocket extends ServerEvents {
  /** Opens the connection and keeps it open until stop(). Does nothing if already started. */
  start(): void
  /** Closes the connection and never reconnects, until start() is called again. */
  stop(): void
  readonly status: SyncStatus
  onStatusChange(listener: (status: SyncStatus) => void): Unsubscribe
  /** Called after each failed attempt; `consecutive` counts since the last `ready`. */
  onAttemptFailed(listener: (consecutive: number) => void): Unsubscribe
}

/** The part of the browser WebSocket this uses; tests pass a fake. */
export type WebSocketLike = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'addEventListener'>

export interface LiveSocketOptions {
  url: string
  /** Defaults to the browser's WebSocket. */
  WebSocket?: new (url: string) => WebSocketLike
  /** Source of the jitter, 0 to 1. Defaults to Math.random. */
  random?: () => number
}

// The server closes a connection after 60 s without a message, so the client
// pings well before that. A missing answer means the connection is dead even
// if the browser has not noticed yet.
const PING_INTERVAL_MS = 25_000
const PONG_TIMEOUT_MS = 10_000
// An attempt that neither fails nor reaches `ready` (e.g. a proxy that hangs).
const READY_TIMEOUT_MS = 10_000

// Delay before attempt n: BASE * 2^n up to MAX, then shortened by up to
// JITTER so that many clients do not reconnect at the same moment.
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const RECONNECT_JITTER = 0.5

const READY_STATE_OPEN = 1
const CLOSE_NORMAL = 1000
const CLOSE_GOING_AWAY = 1001
// The code the browser reports when no close frame arrived (network lost).
const CLOSE_ABNORMAL = 1006
// Closes that are routine (server restart, hourly lifetime, network loss) and
// need no log line; every other code means the server objected to something.
const QUIET_CLOSE_CODES: ReadonlySet<number> = new Set([CLOSE_GOING_AWAY, CLOSE_ABNORMAL])

// `satisfies Record<ServerMessageType, true>` makes this fail to compile as
// soon as the schema gets a message type that is not listed here.
const SERVER_MESSAGE_TYPES = {
  ready: true,
  pong: true,
  itemChanged: true,
  itemDeleted: true,
  itemsDeleted: true,
  listChanged: true,
  listDeleted: true,
  groupChanged: true,
  groupRemoved: true,
  error: true,
} as const satisfies Record<ServerMessageType, true>

// A Set instead of `value in SERVER_MESSAGE_TYPES`: "toString" is not a message type.
const KNOWN_TYPES: ReadonlySet<unknown> = new Set(Object.keys(SERVER_MESSAGE_TYPES))

function isServerMessageType(value: unknown): value is ServerMessageType {
  return KNOWN_TYPES.has(value)
}

/** The WebSocket URL for the page at `location`: wss on https, ws otherwise. */
export function socketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}${API_BASE}/ws`
}

/**
 * Reads one message from the server. Returns null (and keeps the connection)
 * if it is malformed, or if its type is unknown, e.g. sent by a newer
 * backend. The payload is not validated: it comes from our own backend and
 * matches the contract in api/openapi.yaml.
 */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') {
    console.warn('ignored a WebSocket message that is not text')
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    console.warn('ignored a WebSocket message that is not JSON')
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    console.warn('ignored a WebSocket message that is not an object')
    return null
  }
  if (!('type' in parsed) || !isServerMessageType(parsed.type)) {
    return null
  }
  return parsed as ServerMessage
}

type AnyHandler = (message: ServerMessage) => void

export function createLiveSocket(options: LiveSocketOptions): LiveSocket {
  const random = options.random ?? Math.random

  let started = false
  let current: WebSocketLike | null = null
  // True from the server's `ready` until the connection is lost.
  let ready = false
  // Index into the backoff; reset by `ready`, kept while offline.
  let attempt = 0
  // Attempts that ended before `ready`, since the last `ready`.
  let failedAttempts = 0
  let status: SyncStatus = 'idle'

  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null

  // TypeScript cannot relate the key of this map to its handlers' parameter
  // (a correlated union); `on` checks the pairing, so the map stays loose.
  const handlers = new Map<ServerMessageType, Set<AnyHandler>>()
  const statusListeners = new Set<(status: SyncStatus) => void>()
  const failureListeners = new Set<(consecutive: number) => void>()

  function addTo<L>(listeners: Set<L>, listener: L): Unsubscribe {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  // One listener that throws must not stop the others or the socket itself.
  function notify<A>(listeners: Set<(arg: A) => void>, arg: A) {
    for (const listener of [...listeners]) {
      try {
        listener(arg)
      } catch (err) {
        console.error('live socket listener failed', err)
      }
    }
  }

  function computeStatus(): SyncStatus {
    if (!started) return 'idle'
    // A working connection beats navigator.onLine, which is known to be
    // wrong at times; if it is dead, the ping notices.
    if (ready) return 'connected'
    if (navigator.onLine === false || failedAttempts > 0) return 'offline'
    return 'connecting'
  }

  function updateStatus() {
    const next = computeStatus()
    if (next !== status) {
      status = next
      notify(statusListeners, next)
    }
  }

  function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
    if (timer !== null) clearTimeout(timer)
  }

  function clearConnectionTimers() {
    clearTimer(readyTimer)
    readyTimer = null
    if (pingTimer !== null) clearInterval(pingTimer)
    pingTimer = null
    clearTimer(pongTimer)
    pongTimer = null
  }

  function clearRetryTimer() {
    clearTimer(retryTimer)
    retryTimer = null
  }

  function connect() {
    if (!started || current !== null) return
    // No attempts while offline; the `online` event starts one.
    if (navigator.onLine === false) return
    clearRetryTimer()

    const Impl = options.WebSocket ?? globalThis.WebSocket
    const ws = new Impl(options.url)
    current = ws
    readyTimer = setTimeout(abandon, READY_TIMEOUT_MS)

    // Events of a socket that is no longer `current` (stopped or abandoned)
    // are ignored: it must not touch the state of its successor.
    ws.addEventListener('open', () => {
      if (current !== ws) return
      pingTimer = setInterval(sendPing, PING_INTERVAL_MS)
    })
    ws.addEventListener('message', (event) => {
      if (current !== ws) return
      // Any message proves the connection works, not only `pong`.
      clearTimer(pongTimer)
      pongTimer = null
      const message = parseServerMessage(event.data)
      if (message) handleMessage(message)
    })
    // No 'error' listener: a failed connection always ends with 'close'.
    ws.addEventListener('close', (event) => {
      if (current !== ws) return
      current = null
      lost(event.code, event.reason)
    })
    updateStatus()
  }

  function handleMessage(message: ServerMessage) {
    if (message.type === 'ready') {
      clearTimer(readyTimer)
      readyTimer = null
      ready = true
      attempt = 0
      failedAttempts = 0
      updateStatus()
    } else if (message.type === 'error') {
      console.warn('server reported an error over the WebSocket', message.payload.code)
    }
    for (const handler of [...(handlers.get(message.type) ?? [])]) {
      try {
        handler(message)
      } catch (err) {
        console.error('server message handler failed', err)
      }
    }
  }

  function sendPing() {
    if (current === null || current.readyState !== READY_STATE_OPEN) return
    const ping: ClientMessage = { type: 'ping' }
    current.send(JSON.stringify(ping))
    // One deadline at a time: a second ping must not push it back.
    pongTimer ??= setTimeout(abandon, PONG_TIMEOUT_MS)
  }

  // Gives up on a connection that is silent. The browser may report the
  // close of a dead TCP connection very late, so we do not wait for it.
  function abandon() {
    const ws = current
    if (ws === null) return
    current = null
    ws.close()
    lost(CLOSE_ABNORMAL, '')
  }

  // The connection ended, by the server, the network or abandon().
  function lost(code: number, reason: string) {
    clearConnectionTimers()
    if (!QUIET_CLOSE_CODES.has(code)) {
      console.warn('WebSocket closed', code, reason)
    }
    const wasReady = ready
    ready = false
    if (!wasReady) failedAttempts++
    scheduleReconnect()
    updateStatus()
    if (!wasReady) notify(failureListeners, failedAttempts)
  }

  function scheduleReconnect() {
    // Offline: the `online` event brings it back.
    if (!started || navigator.onLine === false) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
    attempt++
    retryTimer = setTimeout(connect, delay * (1 - RECONNECT_JITTER * random()))
  }

  function handleOnline() {
    updateStatus()
    connect()
  }

  function handleOffline() {
    clearRetryTimer()
    updateStatus()
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return
    // The tab slept: do not wait for the next timer to find out how things are.
    if (current === null) {
      connect()
    } else if (ready) {
      sendPing()
    }
  }

  return {
    start() {
      if (started) return
      started = true
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      document.addEventListener('visibilitychange', handleVisibilityChange)
      updateStatus()
      connect()
    },

    stop() {
      if (!started) return
      started = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearRetryTimer()
      clearConnectionTimers()
      const ws = current
      current = null
      ws?.close(CLOSE_NORMAL, 'client stopped')
      ready = false
      attempt = 0
      failedAttempts = 0
      updateStatus()
    },

    get status() {
      return status
    },

    on(type, handler) {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      // Safe: this set only ever receives messages of `type`.
      return addTo(set, handler as AnyHandler)
    },

    onStatusChange: (listener) => addTo(statusListeners, listener),
    onAttemptFailed: (listener) => addTo(failureListeners, listener),
  }
}

/** The app's connection. It connects only after start(), see stores/sync.ts. */
export const liveSocket = createLiveSocket({ url: socketUrl(window.location) })
