import { ApiError, HTTP_STATUS_UNAUTHORIZED } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import type { LocalData } from '@/services/storage/localData'
import type { CreateItemRequest, DeletedItem, Item, UpdateItemRequest } from '@/types/api'

/**
 * The outbox keeps the item changes that are not on the server yet and
 * sends them as the known REST calls, one at a time and in the order they
 * were made (ADR 0006). It lies in IndexedDB, so a change survives a closed
 * tab, a reload and a lost network.
 *
 * It sits next to the stored state, not inside it: the stores keep what the
 * server answered, the outbox only what is still to send. The server alone
 * decides (LWW), the answer replaces the item and the change leaves the
 * outbox.
 *
 * Only one tab sends at a time: a tab that wants to send asks for a lock
 * (navigator.locks), sends until the outbox is empty and lets go of it. A
 * tab that adds a change while another one holds the lock waits in line;
 * a closed tab lets go of the lock by itself.
 *
 * Sending again is harmless (an item ID from the client, a clock that does
 * not win against itself, deleting a tombstone), so a change whose answer
 * got lost simply goes out once more.
 */

/** One change to items, as the REST call that sends it. */
export type OutboxChange =
  // The ID from the client is what makes sending it again harmless: without
  // it, a second try would create a second item.
  | { kind: 'create'; listId: string; item: CreateItemRequest & { id: string } }
  | { kind: 'update'; itemId: string; change: UpdateItemRequest }
  | { kind: 'remove'; itemId: string }
  // At most MAX_REMOVE_CHECKED item IDs; the caller splits bigger sets.
  | { kind: 'removeChecked'; listId: string; itemIds: string[] }

/** A change in the outbox. */
export interface OutboxEntry {
  // Orders the entries: a later change has a greater seq.
  seq: number
  change: OutboxChange
  // Date.now() when the change was made.
  queuedAt: number
}

/** What the server answered to a change. */
export type OutboxAnswer =
  | { kind: 'create'; item: Item }
  | { kind: 'update'; item: Item }
  | { kind: 'remove' }
  | { kind: 'removeChecked'; deleted: DeletedItem[] }

/**
 * The error of a change older than MAX_AGE_MS. It is dropped unsent: the
 * cleanup job may have removed the tombstone of its item by now, so the
 * server could no longer tell that the item was deleted.
 */
export const ERROR_CODE_OUTBOX_EXPIRED = 'OUTBOX_EXPIRED'

/** The tombstone period of the server (cleanup.Task). */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export const FIRST_RETRY_MS = 1000
export const MAX_RETRY_MS = 60 * 1000

const LOCK_NAME = 'mitbringsel-outbox'
const CHANNEL_NAME = 'mitbringsel-outbox'

export type OutboxStorage = Pick<LocalData, 'addOutbox' | 'readOutbox' | 'removeOutbox'>

/** Runs fn while holding the lock with this name, for all tabs. */
export type LockRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>

export interface OutboxOptions {
  storage: OutboxStorage
  items: Pick<ItemsService, 'create' | 'update' | 'remove' | 'removeChecked'>
  // The signed-in user, or null. The outbox reads, sends and reports only
  // the changes of this user.
  userId: () => string | null
  // Called in the tab that sent the change, after it left the outbox. The
  // other tabs learn about it from the event of the server.
  onSent?: (entry: OutboxEntry, answer: OutboxAnswer) => void
  // Called in the tab that sent the change, after it left the outbox: the
  // server refused it, or it was older than MAX_AGE_MS. The item shows the
  // state of the server again.
  onRejected?: (entry: OutboxEntry, error: ApiError) => void
  locks?: LockRunner
  now?: () => number
  // Between 0 and 1, for the jitter of the retry delay.
  random?: () => number
}

export interface Outbox {
  // Stores the change and starts sending.
  enqueue(change: OutboxChange): Promise<void>
  // The changes not sent yet, oldest first.
  entries(): Promise<OutboxEntry[]>
  // Sends now: also after a 401 stopped it, and without waiting for the
  // rest of a retry delay (back online, signed in again).
  trigger(): void
  // Calls listener whenever a change joins or leaves the outbox, in this
  // tab or in another one. Answers a function that ends this.
  subscribe(listener: () => void): () => void
  // Ends sending for good, e.g. when the user signs out.
  stop(): void
}

// Uses navigator.locks if the browser has it. Without it, every tab sends
// on its own: that may change the order between tabs, but sending twice
// is harmless.
const browserLocks: LockRunner = (name, fn) =>
  typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(name, fn) : fn()

type Verdict = 'retry' | 'stop' | 'reject'

// What to do after a failed send. A network error (no status) or anything
// that is not an ApiError at all (e.g. a broken answer body), a timeout,
// too many requests and server errors pass; a missing session waits for the
// next sign-in. Every other 4xx means the server will refuse the change
// again, however often it is sent.
function verdictOf(err: unknown): Verdict {
  if (!(err instanceof ApiError) || err.status === undefined) return 'retry'
  if (err.status === HTTP_STATUS_UNAUTHORIZED) return 'stop'
  if (err.status === 408 || err.status === 429 || err.status >= 500) return 'retry'
  return 'reject'
}

export function createOutbox(options: OutboxOptions): Outbox {
  const { storage, items, userId } = options
  const locks = options.locks ?? browserLocks
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random

  // Changes that could not be stored (no IndexedDB): this tab keeps them in
  // memory and sends them after the stored ones. Their seq is negative, so
  // it never meets a stored one.
  let memory: { userId: string; entry: OutboxEntry }[] = []
  let memorySeq = 0
  // Entries this tab is done with. If removing one from the storage fails,
  // it is not sent again and again.
  const done = new Set<number>()

  const listeners = new Set<() => void>()
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
  channel?.addEventListener('message', () => notifyHere())

  let stopped = false
  // After a 401: nothing is sent until trigger().
  let paused = false
  // The running send, so a trigger during it does not start a second one.
  let running: Promise<void> | null = null
  // A trigger came while sending: send once more afterwards, so a change
  // that arrived just after the last read does not wait.
  let again = false
  // Ends a retry delay early.
  let wake: (() => void) | null = null

  function notifyHere() {
    for (const listener of listeners) listener()
  }

  function notify() {
    notifyHere()
    channel?.postMessage('changed')
  }

  async function entriesOf(user: string): Promise<OutboxEntry[]> {
    const stored = (await storage.readOutbox(user)) ?? []
    const kept = memory.filter((m) => m.userId === user).map((m) => m.entry)
    return [...stored, ...kept]
  }

  async function next(user: string): Promise<OutboxEntry | undefined> {
    return (await entriesOf(user)).find((entry) => !done.has(entry.seq))
  }

  async function drop(user: string, entry: OutboxEntry) {
    done.add(entry.seq)
    if (entry.seq < 0) {
      memory = memory.filter((m) => m.entry.seq !== entry.seq)
    } else {
      await storage.removeOutbox(user, entry.seq)
    }
    notify()
  }

  async function send(change: OutboxChange): Promise<OutboxAnswer> {
    switch (change.kind) {
      case 'create':
        return { kind: 'create', item: await items.create(change.listId, change.item) }
      case 'update':
        return { kind: 'update', item: await items.update(change.itemId, change.change) }
      case 'remove':
        try {
          await items.remove(change.itemId)
        } catch (err) {
          // Someone else deleted it already: what the change wanted.
          if (!(err instanceof ApiError && err.code === 'ITEM_NOT_FOUND')) throw err
        }
        return { kind: 'remove' }
      case 'removeChecked':
        return {
          kind: 'removeChecked',
          deleted: await items.removeChecked(change.listId, change.itemIds),
        }
    }
  }

  // Doubles from FIRST_RETRY_MS up to MAX_RETRY_MS, and waits a random part
  // of that between half and all of it, so many clients that lost the
  // server at once do not all come back in the same second. Retry-After of
  // a 429 tells exactly how long.
  function retryDelay(attempt: number, err: unknown): number {
    if (err instanceof ApiError && err.retryAfterSeconds !== undefined) {
      return err.retryAfterSeconds * 1000
    }
    const full = Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS)
    return full / 2 + (random() * full) / 2
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms)
      function finish() {
        clearTimeout(timer)
        wake = null
        resolve()
      }
      wake = finish
    })
  }

  // Runs a callback of the store. Its failure must not end sending.
  function report(callback: () => void) {
    try {
      callback()
    } catch (err) {
      console.warn('outbox: callback failed', err)
    }
  }

  // Sends the entries of the current user until none is left, or until the
  // user changes or a 401 or stop() ends it.
  async function drain() {
    let attempt = 0
    while (!stopped && !paused) {
      const user = userId()
      if (user === null) return
      const entry = await next(user)
      if (!entry) return
      const current = () => !stopped && userId() === user

      if (now() - entry.queuedAt > MAX_AGE_MS) {
        await drop(user, entry)
        if (current()) {
          report(() => options.onRejected?.(entry, new ApiError(ERROR_CODE_OUTBOX_EXPIRED)))
        }
        continue
      }

      let answer: OutboxAnswer
      try {
        answer = await send(entry.change)
      } catch (err) {
        const verdict = verdictOf(err)
        if (verdict === 'retry') {
          await wait(retryDelay(attempt++, err))
          continue
        }
        if (verdict === 'stop') {
          paused = true
          return
        }
        await drop(user, entry)
        attempt = 0
        if (current()) report(() => options.onRejected?.(entry, err as ApiError))
        continue
      }
      await drop(user, entry)
      attempt = 0
      if (current()) report(() => options.onSent?.(entry, answer))
    }
  }

  // Starts sending unless it already runs. Does not end a 401 pause: a new
  // change would only get the next 401.
  function start() {
    if (stopped || paused) return
    if (running) {
      again = true
      return
    }
    running = locks(LOCK_NAME, drain)
      .catch((err: unknown) => console.warn('outbox: sending failed', err))
      .finally(() => {
        running = null
        if (again) {
          again = false
          start()
        }
      })
  }

  function trigger() {
    if (stopped) return
    paused = false
    wake?.()
    start()
  }

  return {
    async enqueue(change) {
      const user = userId()
      if (user === null || stopped) return
      const queuedAt = now()
      const seq = await storage.addOutbox(user, change, queuedAt)
      if (seq === null) {
        memory.push({ userId: user, entry: { seq: -++memorySeq, change, queuedAt } })
      }
      notify()
      start()
    },

    async entries() {
      const user = userId()
      return user === null ? [] : entriesOf(user)
    },

    trigger,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    stop() {
      stopped = true
      wake?.()
      listeners.clear()
      channel?.close()
    },
  }
}
