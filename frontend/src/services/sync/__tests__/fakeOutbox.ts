import { ApiError, HTTP_STATUS_UNAUTHORIZED } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import type {
  Outbox,
  OutboxAnswer,
  OutboxChange,
  OutboxEntry,
  OutboxOptions,
} from '@/services/sync/outbox'

/** What a store passes when it opens an outbox (the rest is wired in). */
export type FakeOutboxCallbacks = Required<Pick<OutboxOptions, 'userId' | 'onSent' | 'onRejected'>>

type Sender = Pick<ItemsService, 'create' | 'update' | 'remove' | 'removeChecked'>

/**
 * Outboxes the test drives by hand, instead of createOutbox with IndexedDB,
 * locks and timers. All outboxes opened from one fake share one list of
 * entries, like the tabs of a browser share the storage.
 *
 * Every method works synchronously and calls the listeners and callbacks
 * at once, in the order of the real outbox: an entry leaves the list and
 * the listeners hear of it before onSent or onRejected. Tests await
 * flushPromises() for what the store does with that.
 */
export interface FakeOutbox {
  /** Opens an outbox for a store; pass it as `openOutbox`. */
  open(options: FakeOutboxCallbacks): Outbox
  /** Every outbox opened so far, oldest first, and whether it was stopped. */
  readonly opened: { options: FakeOutboxCallbacks; stopped: boolean }[]
  /** The entries not sent yet, oldest first. */
  entries(): OutboxEntry[]
  /** The changes of those entries. */
  changes(): OutboxChange[]
  /** How often trigger() was called. */
  readonly triggers: number
  /** The server answers the oldest entry: it leaves, onSent follows. */
  answer(answer: OutboxAnswer): void
  /** The server refuses the oldest entry: it leaves, onRejected follows. */
  reject(error: ApiError): void
  /**
   * Another tab adds a change. Also before open(): then it waits in the
   * storage, as after a reload.
   */
  fromOtherTab(change: OutboxChange, queuedAt?: number): OutboxEntry
  /** Another tab sent an entry (the oldest by default): it leaves without callbacks. */
  leaveFromOtherTab(seq?: number): void
  /**
   * From now on, sends every entry through `service` by itself, as the real
   * outbox does; for tests of components that do not care about the outbox.
   */
  auto(service: Sender): void
  /** Forgets the entries and stops every outbox, e.g. between tests; keeps auto. */
  clear(): void
}

interface Instance {
  options: FakeOutboxCallbacks
  stopped: boolean
  listeners: Set<() => void>
}

// Like the real outbox: a missing session waits, a timeout, too many
// requests and server errors wait for the next try. Every other 4xx is a
// refusal.
function refuses(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status !== undefined &&
    err.status >= 400 &&
    err.status < 500 &&
    ![HTTP_STATUS_UNAUTHORIZED, 408, 429].includes(err.status)
  )
}

async function send(service: Sender, change: OutboxChange): Promise<OutboxAnswer> {
  switch (change.kind) {
    case 'create':
      return { kind: 'create', item: await service.create(change.listId, change.item) }
    case 'update':
      return { kind: 'update', item: await service.update(change.itemId, change.change) }
    case 'remove':
      try {
        await service.remove(change.itemId)
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'ITEM_NOT_FOUND')) throw err
      }
      return { kind: 'remove' }
    case 'removeChecked':
      return {
        kind: 'removeChecked',
        deleted: await service.removeChecked(change.listId, change.itemIds),
      }
  }
}

export function createFakeOutbox(): FakeOutbox {
  let list: OutboxEntry[] = []
  let seq = 0
  // The user the storage belongs to: opening an outbox for another one
  // empties it, like localData.claim() at the sign-in. Entries from another
  // tab before the first open() belong to whoever opens it.
  let owner: string | null = null
  let instances: Instance[] = []
  let triggers = 0
  let service: Sender | null = null
  let sending = false
  // Bumped by clear() so a hung send from the previous test neither blocks
  // the next test nor settles after it started.
  let sendRun = 0

  const live = () => instances.filter((instance) => !instance.stopped)

  function notify() {
    for (const instance of live()) {
      for (const listener of [...instance.listeners]) listener()
    }
  }

  function add(change: OutboxChange, queuedAt: number): OutboxEntry {
    const entry = { seq: ++seq, change, queuedAt }
    list.push(entry)
    notify()
    return entry
  }

  // The newest open outbox whose user is still signed in gets the callback,
  // as only the tab that sent hears of the answer.
  function receiver(): Instance | undefined {
    return live()
      .reverse()
      .find((instance) => instance.options.userId() !== null)
  }

  function oldest(): OutboxEntry {
    const entry = list[0]
    if (!entry) throw new Error('fake outbox: no entry to answer')
    return entry
  }

  function leave(entry: OutboxEntry) {
    list = list.filter((e) => e !== entry)
    notify()
  }

  function settle(entry: OutboxEntry, result: { answer: OutboxAnswer } | { error: ApiError }) {
    leave(entry)
    const to = receiver()?.options
    if (!to) return
    if ('answer' in result) to.onSent(entry, result.answer)
    else to.onRejected(entry, result.error)
  }

  // Sends one entry at a time until none is left, or until one fails
  // without a refusal (offline): it stays for the next trigger.
  async function sendAll() {
    if (sending || !service) return
    const run = ++sendRun
    sending = true
    try {
      for (let entry = list[0]; entry && service && run === sendRun; entry = list[0]) {
        let result: { answer: OutboxAnswer } | { error: ApiError }
        try {
          result = { answer: await send(service, entry.change) }
        } catch (err) {
          if (run !== sendRun || !refuses(err)) return
          result = { error: err }
        }
        // Cleared or sent elsewhere meanwhile.
        if (run !== sendRun || list[0] !== entry) return
        settle(entry, result)
      }
    } finally {
      if (run === sendRun) sending = false
    }
  }

  return {
    open(options) {
      const user = options.userId()
      if (user !== null && owner !== null && user !== owner) list = []
      owner = user ?? owner
      const instance: Instance = { options, stopped: false, listeners: new Set() }
      instances.push(instance)
      const signedIn = () => {
        const current = options.userId()
        return !instance.stopped && current !== null && current === owner
      }

      return {
        enqueue(change) {
          if (signedIn()) {
            add(change, Date.now())
            void sendAll()
          }
          return Promise.resolve()
        },
        entries: () => Promise.resolve(signedIn() ? [...list] : []),
        trigger() {
          if (instance.stopped) return
          triggers++
          void sendAll()
        },
        subscribe(listener) {
          instance.listeners.add(listener)
          return () => instance.listeners.delete(listener)
        },
        stop() {
          instance.stopped = true
          instance.listeners.clear()
        },
      }
    },

    get opened() {
      return instances.map(({ options, stopped }) => ({ options, stopped }))
    },
    entries: () => [...list],
    changes: () => list.map((entry) => entry.change),
    get triggers() {
      return triggers
    },

    answer(answer) {
      settle(oldest(), { answer })
    },
    reject(error) {
      settle(oldest(), { error })
    },

    fromOtherTab(change, queuedAt = Date.now()) {
      return add(change, queuedAt)
    },
    leaveFromOtherTab(entrySeq) {
      const entry = entrySeq === undefined ? oldest() : list.find((e) => e.seq === entrySeq)
      if (!entry) throw new Error(`fake outbox: no entry ${entrySeq}`)
      leave(entry)
    },

    auto(sender) {
      service = sender
    },

    clear() {
      for (const instance of instances) {
        instance.stopped = true
        instance.listeners.clear()
      }
      instances = []
      list = []
      owner = null
      triggers = 0
      sendRun++
      sending = false
    },
  }
}
