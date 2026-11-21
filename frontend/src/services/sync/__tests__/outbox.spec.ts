import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ERROR_CODE_NETWORK } from '@/services/api/client'
import type { CreateItemRequest, Item } from '@/types/api'

import {
  createOutbox,
  ERROR_CODE_OUTBOX_EXPIRED,
  MAX_AGE_MS,
  type LockRunner,
  type Outbox,
  type OutboxChange,
  type OutboxEntry,
  type OutboxOptions,
  type OutboxStorage,
} from '../outbox'

const ANNA = 'anna'
const BEN = 'ben'
const LIST = 'list-1'
const START = Date.parse('2026-11-21T10:00:00Z')

function serverItem(id: string, name = id): Item {
  return {
    id,
    listId: LIST,
    name,
    quantity: null,
    unit: null,
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: ANNA,
    createdAt: '2026-11-21T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

function creation(id: string): OutboxChange {
  return { kind: 'create', listId: LIST, item: { id, name: id } }
}

function removal(itemId: string): OutboxChange {
  return { kind: 'remove', itemId }
}

// The storage of one browser, shared by its tabs. Like localData, it
// belongs to one user, answers nothing for another one and removes
// everything when another user claims it.
function fakeStorage() {
  let owner = ANNA
  let entries: OutboxEntry[] = []
  let seq = 0
  const storage: OutboxStorage = {
    addOutbox: async (userId, change, queuedAt, hold) => {
      if (userId !== owner) return null
      entries.push(hold ? { seq: ++seq, change, queuedAt, hold } : { seq: ++seq, change, queuedAt })
      return seq
    },
    readOutbox: async (userId) => (userId === owner ? [...entries] : null),
    removeOutbox: async (userId, s) => {
      if (userId === owner) entries = entries.filter((e) => e.seq !== s)
    },
  }
  return {
    storage,
    changes: () => entries.map((e) => e.change),
    claim(userId: string) {
      if (userId !== owner) entries = []
      owner = userId
    },
  }
}

// Like navigator.locks: one holder per name, the others wait in line.
function fakeLocks(): LockRunner {
  const tails = new Map<string, Promise<unknown>>()
  return <T>(name: string, fn: () => Promise<T>) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(fn)
    tails.set(
      name,
      run.catch(() => {}),
    )
    return run
  }
}

// The items service: answers like the server unless a test says otherwise.
// Its create takes any CreateItemRequest, but the outbox always sends one
// with an ID, hence item.id! here and below.
function fakeItems() {
  return {
    create: vi.fn(async (_listId: string, item: CreateItemRequest) =>
      serverItem(item.id!, item.name),
    ),
    update: vi.fn(async (itemId: string) => serverItem(itemId)),
    remove: vi.fn(async () => {}),
    removeChecked: vi.fn(async () => []),
  }
}

// Every pending promise runs to its end; timers only fire when a test
// moves the time.
const settle = () => vi.advanceTimersByTimeAsync(0)

let items: ReturnType<typeof fakeItems>
let store: ReturnType<typeof fakeStorage>
let locks: LockRunner
let user: string | null
let outboxes: Outbox[]

function open(overrides: Partial<OutboxOptions> = {}): Outbox {
  const outbox = createOutbox({
    storage: store.storage,
    items,
    userId: () => user,
    locks,
    random: () => 1,
    ...overrides,
  })
  outboxes.push(outbox)
  return outbox
}

beforeEach(() => {
  vi.useFakeTimers({ now: START })
  items = fakeItems()
  user = ANNA
  store = fakeStorage()
  locks = fakeLocks()
  outboxes = []
})

afterEach(() => {
  for (const outbox of outboxes) outbox.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('outbox', () => {
  it('sends a change and reports the answer', async () => {
    const onSent = vi.fn()
    const outbox = open({ onSent })

    await outbox.enqueue(creation('milk'))
    await settle()

    expect(items.create).toHaveBeenCalledWith(LIST, { id: 'milk', name: 'milk' })
    expect(onSent).toHaveBeenCalledWith(
      { seq: 1, change: creation('milk'), queuedAt: START },
      { kind: 'create', item: serverItem('milk') },
    )
    expect(store.changes()).toEqual([])
    expect(await outbox.entries()).toEqual([])
  })

  it('sends every kind of change with its REST call', async () => {
    const onSent = vi.fn()
    const outbox = open({ onSent })

    await outbox.enqueue({ kind: 'update', itemId: 'milk', change: { checked: true } })
    await outbox.enqueue(removal('bread'))
    await outbox.enqueue({ kind: 'removeChecked', listId: LIST, itemIds: ['eggs'] })
    await settle()

    expect(items.update).toHaveBeenCalledWith('milk', { checked: true })
    expect(items.remove).toHaveBeenCalledWith('bread')
    expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['eggs'])
    expect(onSent.mock.calls.map(([, answer]) => answer)).toEqual([
      { kind: 'update', item: serverItem('milk') },
      { kind: 'remove' },
      { kind: 'removeChecked', deleted: [] },
    ])
  })

  it('sends in order, one change at a time', async () => {
    const answers: ((item: Item) => void)[] = []
    items.create.mockImplementation(
      (_listId, item) =>
        new Promise((resolve) => answers.push(() => resolve(serverItem(item.id!)))),
    )
    const outbox = open()

    await outbox.enqueue(creation('a'))
    await outbox.enqueue(creation('b'))
    await outbox.enqueue(creation('c'))
    await settle()
    expect(items.create).toHaveBeenCalledTimes(1)

    answers[0]!(serverItem('a'))
    await settle()
    expect(items.create).toHaveBeenCalledTimes(2)
    answers[1]!(serverItem('b'))
    await settle()
    answers[2]!(serverItem('c'))
    await settle()

    expect(items.create.mock.calls.map(([, item]) => item.id)).toEqual(['a', 'b', 'c'])
    expect(store.changes()).toEqual([])
  })

  it('tells listeners when a change joins or leaves the outbox', async () => {
    const outbox = open()
    const listener = vi.fn()
    outbox.subscribe(listener)

    await outbox.enqueue(creation('milk'))
    expect(listener).toHaveBeenCalledTimes(1)
    await settle()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  describe('when sending fails', () => {
    it('tries again later after a network error, waiting longer each time', async () => {
      items.create.mockRejectedValue(new ApiError(ERROR_CODE_NETWORK))
      const outbox = open()

      await outbox.enqueue(creation('milk'))
      await settle()
      expect(items.create).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(999)
      expect(items.create).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(items.create).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect(items.create).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(4000)
      expect(items.create).toHaveBeenCalledTimes(4)

      expect(store.changes()).toEqual([creation('milk')])
    })

    it('waits at most a minute between two tries', async () => {
      items.create.mockRejectedValue(new ApiError(ERROR_CODE_NETWORK))
      const outbox = open()
      await outbox.enqueue(creation('milk'))
      await settle()
      // 1 + 2 + 4 + 8 + 16 + 32 seconds, then 60 instead of 64.
      await vi.advanceTimersByTimeAsync(63_000)
      expect(items.create).toHaveBeenCalledTimes(7)

      await vi.advanceTimersByTimeAsync(59_999)
      expect(items.create).toHaveBeenCalledTimes(7)
      await vi.advanceTimersByTimeAsync(1)
      expect(items.create).toHaveBeenCalledTimes(8)
    })

    it('waits a random part between half and all of the delay', async () => {
      items.create.mockRejectedValue(new ApiError(ERROR_CODE_NETWORK))
      const outbox = open({ random: () => 0 })
      await outbox.enqueue(creation('milk'))
      await settle()

      await vi.advanceTimersByTimeAsync(500)
      expect(items.create).toHaveBeenCalledTimes(2)
    })

    it('waits as long as Retry-After says', async () => {
      items.create.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 429, 30))
      const outbox = open()
      await outbox.enqueue(creation('milk'))
      await settle()

      await vi.advanceTimersByTimeAsync(29_999)
      expect(items.create).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(items.create).toHaveBeenCalledTimes(2)
      expect(store.changes()).toEqual([])
    })

    it.each([500, 502, 503, 408])('tries again after %i', async (status) => {
      items.create.mockRejectedValueOnce(new ApiError('UNKNOWN', status))
      const onRejected = vi.fn()
      const outbox = open({ onRejected })
      await outbox.enqueue(creation('milk'))
      await settle()

      await vi.advanceTimersByTimeAsync(1000)
      expect(items.create).toHaveBeenCalledTimes(2)
      expect(onRejected).not.toHaveBeenCalled()
    })

    it('starts the next try at once on trigger', async () => {
      items.create.mockRejectedValueOnce(new ApiError(ERROR_CODE_NETWORK))
      const outbox = open()
      await outbox.enqueue(creation('milk'))
      await settle()

      outbox.trigger()
      await settle()

      expect(items.create).toHaveBeenCalledTimes(2)
      expect(store.changes()).toEqual([])
    })

    it('stops on 401, keeps everything and goes on after trigger', async () => {
      items.create.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 401))
      const onRejected = vi.fn()
      const outbox = open({ onRejected })
      await outbox.enqueue(creation('milk'))
      await settle()

      // Neither time nor a new change sends again.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await outbox.enqueue(creation('bread'))
      await settle()
      expect(items.create).toHaveBeenCalledTimes(1)
      expect(store.changes()).toEqual([creation('milk'), creation('bread')])
      expect(onRejected).not.toHaveBeenCalled()

      // Signed in again.
      outbox.trigger()
      await settle()
      expect(items.create.mock.calls.map(([, item]) => item.id)).toEqual(['milk', 'milk', 'bread'])
      expect(store.changes()).toEqual([])
    })

    it.each([
      [400, 'ITEM_NAME_INVALID'],
      [403, 'FORBIDDEN'],
      [404, 'LIST_NOT_FOUND'],
      [409, 'ITEM_ID_TAKEN'],
      [413, 'UNKNOWN'],
      [422, 'UNKNOWN'],
    ])('drops a change the server refuses with %i and goes on', async (status, code) => {
      const refusal = new ApiError(code, status)
      items.create.mockRejectedValueOnce(refusal)
      const onRejected = vi.fn()
      const onSent = vi.fn()
      const outbox = open({ onRejected, onSent })

      await outbox.enqueue(creation('milk'))
      await outbox.enqueue(creation('bread'))
      await settle()

      expect(onRejected).toHaveBeenCalledWith(
        { seq: 1, change: creation('milk'), queuedAt: START },
        refusal,
      )
      expect(onSent).toHaveBeenCalledTimes(1)
      expect(onSent.mock.calls[0]![0].change).toEqual(creation('bread'))
      expect(store.changes()).toEqual([])
    })

    it('counts deleting an item that is gone already as sent', async () => {
      items.remove.mockRejectedValueOnce(new ApiError('ITEM_NOT_FOUND', 404))
      const onSent = vi.fn()
      const onRejected = vi.fn()
      const outbox = open({ onSent, onRejected })

      await outbox.enqueue(removal('milk'))
      await settle()

      expect(onSent).toHaveBeenCalledWith(expect.anything(), { kind: 'remove' })
      expect(onRejected).not.toHaveBeenCalled()
    })

    it('goes on when a callback throws', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const outbox = open({
        onSent: () => {
          throw new Error('store broke')
        },
      })

      await outbox.enqueue(creation('milk'))
      await outbox.enqueue(creation('bread'))
      await settle()

      expect(items.create).toHaveBeenCalledTimes(2)
      expect(store.changes()).toEqual([])
    })
  })

  it('drops changes older than the tombstone period unsent', async () => {
    const onRejected = vi.fn()
    const outbox = open({ onRejected })
    items.create.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 401))
    await outbox.enqueue(creation('milk'))
    await settle()

    // A month offline and signed out, then a new change and a sign-in.
    vi.setSystemTime(START + MAX_AGE_MS + 1)
    await outbox.enqueue(creation('bread'))
    outbox.trigger()
    await settle()

    expect(items.create.mock.calls.map(([, item]) => item.id)).toEqual(['milk', 'bread'])
    expect(onRejected).toHaveBeenCalledWith(
      { seq: 1, change: creation('milk'), queuedAt: START },
      new ApiError(ERROR_CODE_OUTBOX_EXPIRED),
    )
    expect(store.changes()).toEqual([])
  })

  it('sends what an earlier tab left, like after a reload', async () => {
    items.create.mockRejectedValueOnce(new ApiError(ERROR_CODE_NETWORK))
    const before = open()
    await before.enqueue(creation('milk'))
    await settle()
    before.stop()

    const after = open()
    expect(await after.entries()).toEqual([{ seq: 1, change: creation('milk'), queuedAt: START }])
    after.trigger()
    await settle()

    expect(items.create).toHaveBeenCalledTimes(2)
    expect(store.changes()).toEqual([])
  })

  it('lets only one tab send at a time', async () => {
    let answer: (() => void) | undefined
    items.create.mockImplementation(
      (_listId, item) =>
        new Promise((resolve) => {
          answer = () => resolve(serverItem(item.id!))
        }),
    )
    const first = open()
    const second = open()

    await first.enqueue(creation('a'))
    await second.enqueue(creation('b'))
    await settle()
    // The second tab waits for the lock while the first one sends.
    expect(items.create).toHaveBeenCalledTimes(1)

    answer!()
    await settle()
    // The first tab sends the change of the second one too, as it keeps
    // the lock until the outbox is empty.
    expect(items.create).toHaveBeenCalledTimes(2)
    answer!()
    await settle()

    expect(items.create.mock.calls.map(([, item]) => item.id)).toEqual(['a', 'b'])
    expect(store.changes()).toEqual([])
  })

  describe('user', () => {
    it('sends nothing without a signed-in user', async () => {
      user = null
      const outbox = open()

      await outbox.enqueue(creation('milk'))
      await settle()

      expect(items.create).not.toHaveBeenCalled()
      expect(await outbox.entries()).toEqual([])
    })

    it('does not report an answer to the next user', async () => {
      let answer: (() => void) | undefined
      items.create.mockImplementation(
        (_listId, item) =>
          new Promise((resolve) => {
            answer = () => resolve(serverItem(item.id!))
          }),
      )
      const onSent = vi.fn()
      const outbox = open({ onSent })
      await outbox.enqueue(creation('milk'))
      await outbox.enqueue(creation('bread'))
      await settle()

      user = BEN
      store.claim(BEN)
      answer!()
      await settle()

      expect(onSent).not.toHaveBeenCalled()
      expect(items.create).toHaveBeenCalledTimes(1)
    })
  })

  describe('without storage', () => {
    it('keeps the change in memory and sends it', async () => {
      const outbox = open({
        storage: {
          addOutbox: async () => null,
          readOutbox: async () => null,
          removeOutbox: async () => {},
        },
      })
      items.create.mockRejectedValueOnce(new ApiError(ERROR_CODE_NETWORK))

      await outbox.enqueue(creation('milk'))
      await settle()
      expect(await outbox.entries()).toEqual([
        { seq: -1, change: creation('milk'), queuedAt: START },
      ])

      await vi.advanceTimersByTimeAsync(1000)
      expect(items.create).toHaveBeenCalledTimes(2)
      expect(await outbox.entries()).toEqual([])
    })
  })

  it('sends nothing after stop', async () => {
    items.create.mockRejectedValueOnce(new ApiError(ERROR_CODE_NETWORK))
    const outbox = open()
    await outbox.enqueue(creation('milk'))
    await settle()

    outbox.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    outbox.trigger()
    await outbox.enqueue(creation('bread'))
    await settle()

    expect(items.create).toHaveBeenCalledTimes(1)
    expect(store.changes()).toEqual([creation('milk')])
  })

  describe('held entries', () => {
    function removeChecked(...itemIds: string[]): OutboxChange {
      return { kind: 'removeChecked', listId: LIST, itemIds }
    }

    let holdCounter: number

    beforeEach(() => {
      holdCounter = 0
    })

    const openWithHolds = (overrides: Partial<OutboxOptions> = {}) =>
      open({ newHoldId: () => `h${++holdCounter}`, ...overrides })

    it('holds entries until release and blocks later entries behind them', async () => {
      const onSent = vi.fn()
      const outbox = openWithHolds({ onSent })

      const held = outbox.enqueueHeld([removeChecked('a'), removeChecked('b')])
      await held.stored
      await outbox.enqueue(creation('milk'))
      await settle()

      expect(held.holdId).toBe('mitbringsel-outbox-hold-h1')
      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(items.create).not.toHaveBeenCalled()
      expect(await outbox.entries()).toEqual([
        { seq: 1, change: removeChecked('a'), queuedAt: START, hold: held.holdId },
        { seq: 2, change: removeChecked('b'), queuedAt: START, hold: held.holdId },
        { seq: 3, change: creation('milk'), queuedAt: START },
      ])

      held.release()
      await settle()

      expect(items.removeChecked).toHaveBeenCalledTimes(2)
      expect(items.removeChecked.mock.calls).toEqual([
        [LIST, ['a']],
        [LIST, ['b']],
      ])
      expect(items.create).toHaveBeenCalledTimes(1)
      expect(onSent).toHaveBeenCalledTimes(3)
      expect(store.changes()).toEqual([])
    })

    it('removes entries unsent on cancel, notifies listeners and sends later entries', async () => {
      const outbox = openWithHolds()
      const listener = vi.fn()
      outbox.subscribe(listener)

      const held = outbox.enqueueHeld([removeChecked('a'), removeChecked('b')])
      await held.stored
      await outbox.enqueue(creation('milk'))
      await settle()
      listener.mockClear()

      await held.cancel()
      await settle()

      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(items.create).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalled()
      expect(store.changes()).toEqual([])
    })

    it('lets another tab wait on the hold and send after release', async () => {
      const tabA = openWithHolds()
      const tabB = openWithHolds()
      // Tab B already holds the outbox lock (sending an earlier entry).
      let finishFirst: (() => void) | undefined
      items.create.mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = () => resolve(serverItem('first')))),
      )
      await tabB.enqueue(creation('first'))
      await settle()

      const held = tabA.enqueueHeld([removeChecked('a')])
      await held.stored
      finishFirst!()
      await settle()

      // Tab B reached the held entry and waits for tab A's hold lock.
      expect(items.removeChecked).not.toHaveBeenCalled()

      held.release()
      await settle()

      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['a'])
      expect(store.changes()).toEqual([])
    })

    it('makes another tab skip cancelled entries when the hold ends', async () => {
      const tabA = openWithHolds()
      const tabB = openWithHolds()
      let finishFirst: (() => void) | undefined
      items.create.mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = () => resolve(serverItem('first')))),
      )
      await tabB.enqueue(creation('first'))
      await settle()

      const held = tabA.enqueueHeld([removeChecked('a')])
      await held.stored
      await tabB.enqueue(creation('after'))
      finishFirst!()
      await settle()

      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(items.create).toHaveBeenCalledTimes(1)

      await held.cancel()
      await settle()

      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(items.create.mock.calls.map(([, item]) => item.id)).toEqual(['first', 'after'])
      expect(store.changes()).toEqual([])
    })

    it('sends an abandoned hold from storage at once, as after a crash', async () => {
      await store.storage.addOutbox(ANNA, removeChecked('a'), START, 'mitbringsel-outbox-hold-dead')
      const outbox = openWithHolds()

      outbox.trigger()
      await settle()

      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['a'])
      expect(store.changes()).toEqual([])
    })

    it('releases holds on stop without letting the stopped outbox send', async () => {
      const tabA = openWithHolds()
      const held = tabA.enqueueHeld([removeChecked('a')])
      await held.stored
      await settle()
      expect(items.removeChecked).not.toHaveBeenCalled()

      tabA.stop()
      await settle()

      // Stopped tab A's waiting drain must not send, and the hold lock is free.
      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(store.changes()).toEqual([removeChecked('a')])

      const tabB = openWithHolds()
      tabB.trigger()
      await settle()

      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['a'])
      expect(store.changes()).toEqual([])
    })

    it('supports hold, release and cancel in memory without storage', async () => {
      const outbox = openWithHolds({
        storage: {
          addOutbox: async () => null,
          readOutbox: async () => null,
          removeOutbox: async () => {},
        },
      })

      const first = outbox.enqueueHeld([removeChecked('a')])
      await first.stored
      await settle()
      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(await outbox.entries()).toEqual([
        { seq: -1, change: removeChecked('a'), queuedAt: START, hold: first.holdId },
      ])

      await first.cancel()
      await settle()
      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(await outbox.entries()).toEqual([])

      const second = outbox.enqueueHeld([removeChecked('b')])
      await second.stored
      await settle()
      expect(items.removeChecked).not.toHaveBeenCalled()

      second.release()
      await settle()
      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['b'])
      expect(await outbox.entries()).toEqual([])
    })

    it('does not bypass a hold on trigger', async () => {
      const outbox = openWithHolds()
      const held = outbox.enqueueHeld([removeChecked('a')])
      await held.stored
      await settle()

      outbox.trigger()
      await settle()

      expect(items.removeChecked).not.toHaveBeenCalled()

      held.release()
      await settle()
      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['a'])
    })

    it('drops an expired held entry without waiting for its hold', async () => {
      const onRejected = vi.fn()
      const outbox = openWithHolds({ onRejected })
      items.create.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 401))
      await outbox.enqueue(creation('blocker'))
      await settle()

      const held = outbox.enqueueHeld([removeChecked('a')])
      await held.stored

      vi.setSystemTime(START + MAX_AGE_MS + 1)
      outbox.trigger()
      await settle()

      // Expired held entry is dropped even though held.release() was never called.
      expect(items.removeChecked).not.toHaveBeenCalled()
      expect(onRejected).toHaveBeenCalledWith(
        { seq: 2, change: removeChecked('a'), queuedAt: START, hold: held.holdId },
        new ApiError(ERROR_CODE_OUTBOX_EXPIRED),
      )
      expect(store.changes()).toEqual([])
    })

    it('allows release before stored resolves', async () => {
      const outbox = openWithHolds()
      const held = outbox.enqueueHeld([removeChecked('a')])
      held.release()

      await held.stored
      await settle()

      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['a'])
      expect(store.changes()).toEqual([])
    })

    it('counts only the first call of release or cancel', async () => {
      const outbox = openWithHolds()

      const releasedFirst = outbox.enqueueHeld([removeChecked('a')])
      await releasedFirst.stored
      releasedFirst.release()
      await releasedFirst.cancel()
      await settle()
      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['a'])

      items.removeChecked.mockClear()
      const cancelledFirst = outbox.enqueueHeld([removeChecked('b')])
      await cancelledFirst.stored
      const cancelling = cancelledFirst.cancel()
      cancelledFirst.release()
      await cancelling
      await settle()
      expect(items.removeChecked).not.toHaveBeenCalled()
    })

    it('stores nothing without a signed-in user or after stop', async () => {
      user = null
      const withoutUser = openWithHolds()
      const h1 = withoutUser.enqueueHeld([removeChecked('a')])
      await h1.stored
      expect(store.changes()).toEqual([])

      user = ANNA
      const stopped = openWithHolds()
      stopped.stop()
      const h2 = stopped.enqueueHeld([removeChecked('b')])
      await h2.stored
      expect(store.changes()).toEqual([])
    })

    it('keeps holds working in the same tab without navigator.locks', async () => {
      // Omit `locks` so createOutbox uses the browserLocks fallback (jsdom has no navigator.locks).
      const outbox = createOutbox({
        storage: store.storage,
        items,
        userId: () => user,
        random: () => 1,
        newHoldId: () => `fb${++holdCounter}`,
      })
      outboxes.push(outbox)

      const held = outbox.enqueueHeld([removeChecked('a')])
      await held.stored
      await settle()
      expect(items.removeChecked).not.toHaveBeenCalled()

      held.release()
      await settle()
      expect(items.removeChecked).toHaveBeenCalledWith(LIST, ['a'])
    })
  })
})

describe('outbox across tabs', () => {
  it('tells the listeners of other tabs', async () => {
    // BroadcastChannel delivers on the real event loop.
    vi.useRealTimers()
    const first = open()
    const second = open()
    const listener = vi.fn()
    second.subscribe(listener)

    await first.enqueue(creation('milk'))

    await vi.waitFor(() => expect(listener).toHaveBeenCalled())
  })
})
