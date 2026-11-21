import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import { MAX_REMOVE_CHECKED, type ItemsService } from '@/services/api/items'
import { createClock, formatHLC } from '@/services/sync/hlc'
import {
  createOutbox,
  ERROR_CODE_OUTBOX_EXPIRED,
  type OutboxChange,
  type OutboxEntry,
  type OutboxStorage,
} from '@/services/sync/outbox'
import { createFakeOutbox, type FakeOutbox } from '@/services/sync/__tests__/fakeOutbox'
import { createFakeServerEvents } from '@/services/sync/__tests__/fakeServerEvents'
import type { CreateItemRequest, GroupItemList, Item, ServerMessage } from '@/types/api'

import { defineItemsStore, type ItemRejection, type ItemsLocal } from '../items'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'
const NOW = Date.parse('2026-02-01T12:00:00Z')
const CHECKED_AT = '2026-02-01T10:00:00Z'
const CREATED_LATER = '2026-01-02T10:00:00Z'

function item(id: string, name: string, listId = 'l1', checked = false): Item {
  return {
    id,
    listId,
    name,
    quantity: null,
    unit: null,
    note: null,
    checked,
    checkedBy: checked ? BEN : null,
    checkedAt: checked ? CHECKED_AT : null,
    createdBy: ANNA,
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

/**
 * A fake backend with the items of each list; tests override single
 * functions. update() answers the stored item as the real one does: the
 * item with the changed fields, checked by Anna.
 */
function fakeService(
  initial: Item[] = [],
): ItemsService & { [K in keyof ItemsService]: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn((listId: string) => Promise.resolve(initial.filter((i) => i.listId === listId))),
    // Every list of `initial` counts as an active list of g1.
    listGroup: vi.fn(() =>
      Promise.resolve({ listIds: [...new Set(initial.map((i) => i.listId))], items: initial }),
    ),
    // Created later than the items above, so it sorts after them.
    create: vi.fn((listId: string, request: CreateItemRequest) =>
      Promise.resolve({
        ...item(request.id ?? 'i-new', request.name, listId),
        createdAt: CREATED_LATER,
      }),
    ),
    update: vi.fn((id: string, change: Record<string, unknown>) => {
      const stored = initial.find((i) => i.id === id) ?? item(id, 'x')
      const checked = (change.checked as boolean | undefined) ?? stored.checked
      return Promise.resolve({
        ...stored,
        ...change,
        checkedBy: checked ? ANNA : null,
        checkedAt: checked ? CHECKED_AT : null,
      })
    }),
    remove: vi.fn(() => Promise.resolve()),
    // Deletes what is checked in `initial`, as the server deletes only
    // what is still checked.
    removeChecked: vi.fn((listId: string, itemIds: string[]) =>
      Promise.resolve(
        initial
          .filter((i) => i.listId === listId && i.checked && itemIds.includes(i.id))
          .map((i) => ({ itemId: i.id, serverSeq: 10 })),
      ),
    ),
  }
}

/**
 * The storage of the device with the items of each list. Like IndexedDB,
 * readItems gives a copy and writeItems keeps one, so tests see what was
 * written at that moment and the store cannot change what is stored.
 */
function fakeStorage(stored: Record<string, Item[]> = {}) {
  const copy = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T
  const storage = {
    items: copy(stored),
    // Every state that was written, as it was at that moment.
    writes: [] as Item[][],
    readItems: vi.fn((_userId: string, listId: string): Promise<Item[] | null> => {
      const found = storage.items[listId]
      return Promise.resolve(found ? copy(found) : null)
    }),
    writeItems: vi.fn((_userId: string, listId: string, items: Item[]) => {
      storage.items[listId] = copy(items)
      storage.writes.push(copy(items))
      return Promise.resolve()
    }),
    removeItems: vi.fn((_userId: string, listId: string) => {
      delete storage.items[listId]
      return Promise.resolve()
    }),
  }
  return storage
}

/**
 * The signed-in user as a ref, so tests can switch the user, the server
 * events, the device storage and the fake outbox.
 */
function setup(
  service: ItemsService,
  userId: string | null = ANNA,
  storage: ItemsLocal = fakeStorage(),
  outbox: FakeOutbox = createFakeOutbox(),
) {
  let n = 0
  const user = ref(userId)
  const events = createFakeServerEvents()
  const store = defineItemsStore(service, () => user.value, events, storage, {
    openOutbox: outbox.open,
    clock: createClock('tab', () => NOW),
    newId: () => `new-${++n}`,
  })()
  return { store, user, events, outbox }
}

// Messages as another member's change makes the server send them.
const changed = (changedItem: Item): ServerMessage => ({
  type: 'itemChanged',
  payload: { groupId: 'g1', actorId: BEN, item: changedItem },
})
const deleted = (listId: string, itemId: string, serverSeq: number): ServerMessage => ({
  type: 'itemDeleted',
  payload: { groupId: 'g1', listId, itemId, serverSeq, actorId: BEN },
})
const bulkDeleted = (
  listId: string,
  ...gone: [itemId: string, serverSeq: number][]
): ServerMessage => ({
  type: 'itemsDeleted',
  payload: {
    groupId: 'g1',
    listId,
    actorId: BEN,
    items: gone.map(([itemId, serverSeq]) => ({ itemId, serverSeq })),
  },
})

const names = (items: Item[]) => items.map((i) => i.name)

/** The same item as a later state of the server: a higher serverSeq and some changed fields. */
const later = (base: Item, serverSeq: number, change: Partial<Item> = {}): Item => ({
  ...base,
  serverSeq,
  ...change,
})

/** A promise the test settles by hand, to look at the state in between. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (err: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('items store: load', () => {
  it('knows nothing about a list before it is loaded', () => {
    const { store } = setup(fakeService())

    expect(store.statusOf('l1')).toBe('idle')
    expect(store.errorCodeOf('l1')).toBeNull()
    expect(store.itemsOf('l1')).toEqual([])
    expect(store.openItems('l1')).toEqual([])
    expect(store.checkedItems('l1')).toEqual([])
  })

  it('loads the items and tells open and checked ones apart', async () => {
    const service = fakeService([
      item('i1', 'Milch'),
      item('i2', 'Brot', 'l1', true),
      item('i3', 'Eier'),
    ])
    const { store } = setup(service)

    await store.load('l1')

    expect(service.list).toHaveBeenCalledWith('l1')
    expect(store.statusOf('l1')).toBe('ready')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot', 'Eier'])
    expect(names(store.openItems('l1'))).toEqual(['Milch', 'Eier'])
    expect(names(store.checkedItems('l1'))).toEqual(['Brot'])
  })

  it('keeps the items of each list apart', async () => {
    const { store } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Nägel', 'l2')]))

    await store.load('l1')
    await store.load('l2')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(names(store.itemsOf('l2'))).toEqual(['Nägel'])
  })

  it('finds an item of any loaded list by its ID', async () => {
    const { store } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Nägel', 'l2')]))
    await store.load('l1')
    await store.load('l2')

    expect(store.byId('i2')?.name).toBe('Nägel')
    expect(store.byId('unknown')).toBeUndefined()
  })

  it('reports the error code and keeps the items from before', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    await store.load('l1')
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))

    await store.load('l1')

    expect(store.statusOf('l1')).toBe('error')
    expect(store.errorCodeOf('l1')).toBe('NETWORK')
    expect(store.itemsOf('l1')).toHaveLength(1)
  })

  it('does not blame other lists for an error', async () => {
    const service = fakeService([item('i2', 'Nägel', 'l2')])
    const { store } = setup(service)
    await store.load('l2')
    service.list.mockRejectedValueOnce(new ApiError('LIST_NOT_FOUND', 404))

    await store.load('l1')

    expect(store.statusOf('l1')).toBe('error')
    expect(store.statusOf('l2')).toBe('ready')
  })

  it('uses UNKNOWN for errors that are not from the API', async () => {
    const service = fakeService()
    service.list.mockRejectedValueOnce(new Error('boom'))
    const { store } = setup(service)

    await store.load('l1')

    expect(store.errorCodeOf('l1')).toBe('UNKNOWN')
  })

  it('clears the error when a later load works', async () => {
    const service = fakeService([item('i1', 'Milch')])
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { store } = setup(service)
    await store.load('l1')

    await store.load('l1')

    expect(store.statusOf('l1')).toBe('ready')
    expect(store.errorCodeOf('l1')).toBeNull()
  })
})

describe('items store: reset', () => {
  it('forgets the items when the user logs out', async () => {
    const { store, user } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    user.value = null
    await Promise.resolve()

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
  })

  it('forgets the items when another user signs in', async () => {
    const { store, user } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    user.value = BEN
    await Promise.resolve()

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.byId('i1')).toBeUndefined()
  })

  it('ignores a load that was still running at the reset', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store, user } = setup(service)

    const loading = store.load('l1')
    user.value = null
    await Promise.resolve()
    answer.resolve([item('i1', 'Old user')])
    await loading

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
  })

  it('ignores a failing load that was still running at the reset', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store, user } = setup(service)

    const loading = store.load('l1')
    user.value = null
    await Promise.resolve()
    answer.reject(new ApiError('NETWORK'))
    await loading

    expect(store.statusOf('l1')).toBe('idle')
    expect(store.errorCodeOf('l1')).toBeNull()
  })

  it('does not bring back a check that was still pending at the reset', async () => {
    const { store, user, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)
    const [entry] = outbox.entries()
    user.value = null
    await Promise.resolve()
    outbox.opened[0]!.options.onSent(entry!, {
      kind: 'update',
      item: item('i1', 'Milch', 'l1', true),
    })

    expect(store.itemsOf('l1')).toEqual([])
  })

  it('ignores events after the user changed', async () => {
    const { store, user, events } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    user.value = BEN
    await Promise.resolve()
    events.emit(changed(later(item('i1', 'Milch'), 9)))
    events.emit(deleted('l1', 'i1', 10))

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
  })

  it('forgets deletions when the user changed', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, user, events } = setup(service)
    await store.load('l1')
    events.emit(deleted('l1', 'i1', 3))

    user.value = BEN
    await Promise.resolve()
    await store.load('l1')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('stops listening when the store is disposed', () => {
    const { store, events } = setup(fakeService())
    expect(events.count('itemChanged')).toBe(1)

    store.$dispose()

    for (const type of ['itemChanged', 'itemDeleted', 'itemsDeleted'] as const) {
      expect(events.count(type)).toBe(0)
    }
  })

  it('ignores a create that answers after the reset', async () => {
    const { store, user, outbox } = setup(fakeService())
    await store.load('l1')

    await store.create('l1', { name: 'Brot' })
    const [entry] = outbox.entries()
    user.value = null
    await Promise.resolve()
    outbox.opened[0]!.options.onSent(entry!, { kind: 'create', item: item('new-1', 'Brot') })

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
  })
})

describe('items store: outbox lifecycle', () => {
  it('opens an outbox with a signed-in user, reads it and triggers once', async () => {
    const outbox = createFakeOutbox()
    outbox.fromOtherTab({
      kind: 'create',
      listId: 'l1',
      item: { id: 'i-old', name: 'Kaffee', clock: formatHLC(NOW, 0, 'other') },
    })
    const { store } = setup(fakeService(), ANNA, fakeStorage(), outbox)
    await store.load('l1')

    expect(outbox.opened).toHaveLength(1)
    expect(outbox.opened[0]?.stopped).toBe(false)
    expect(outbox.opened[0]?.options.userId()).toBe(ANNA)
    expect(outbox.triggers).toBe(1)
    expect(names(store.itemsOf('l1'))).toEqual(['Kaffee'])
  })

  it('does not open an outbox without a signed-in user', () => {
    const { outbox } = setup(fakeService(), null)

    expect(outbox.opened).toEqual([])
    expect(outbox.triggers).toBe(0)
  })

  it('stops the old outbox and opens a new one when the user changes', async () => {
    const { user, outbox } = setup(fakeService(), ANNA)

    user.value = BEN
    await flushPromises()

    expect(outbox.opened).toHaveLength(2)
    expect(outbox.opened[0]?.stopped).toBe(true)
    expect(outbox.opened[0]?.options.userId()).toBeNull()
    expect(outbox.opened[1]?.stopped).toBe(false)
    expect(outbox.opened[1]?.options.userId()).toBe(BEN)
    expect(outbox.triggers).toBe(2)
  })

  it('stops the outbox when the store is disposed', () => {
    const { store, outbox } = setup(fakeService())

    store.$dispose()

    expect(outbox.opened[0]?.stopped).toBe(true)
  })

  it('ignores answers and rejections of an old outbox after a user switch', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, user, outbox } = setup(service, ANNA)
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))
    await store.load('l1')
    await store.create('l1', { name: 'Brot' })
    const [entry] = outbox.entries()

    user.value = BEN
    await flushPromises()
    await store.load('l1')

    outbox.opened[0]!.options.onSent(entry!, { kind: 'create', item: item('new-1', 'Brot') })
    outbox.opened[0]!.options.onRejected(entry!, new ApiError('FORBIDDEN', 403))

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(rejections).toEqual([])
  })

  it('drops pending changes of the previous user on logout and user switch', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, user } = setup(service, ANNA)
    await store.load('l1')
    await store.create('l1', { name: 'Brot' })
    await store.setChecked('i1', true)
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])

    user.value = BEN
    await flushPromises()
    await store.load('l1')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(store.byId('i1')?.checked).toBe(false)
  })
})

describe('items store: create', () => {
  it('enqueues with client ID and clock, shows at once and replaces with the answer', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.create('l1', { name: 'Brot', quantity: 1, unit: 'pack' })

    expect(outbox.changes()).toEqual([
      {
        kind: 'create',
        listId: 'l1',
        item: {
          id: 'new-1',
          name: 'Brot',
          quantity: 1,
          unit: 'pack',
          clock: formatHLC(NOW, 0, 'tab'),
        },
      },
    ])
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
    expect(store.byId('new-1')).toMatchObject({
      id: 'new-1',
      name: 'Brot',
      quantity: 1,
      unit: 'pack',
      createdBy: ANNA,
      serverSeq: 0,
    })

    outbox.answer({
      kind: 'create',
      item: {
        ...item('new-1', 'Brot'),
        quantity: 1,
        unit: 'pack',
        createdAt: CREATED_LATER,
        serverSeq: 2,
      },
    })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
    expect(store.byId('new-1')?.serverSeq).toBe(2)
  })

  it('does not list an item twice when the event arrives before the answer', async () => {
    const { store, events, outbox } = setup(fakeService())
    await store.load('l1')

    await store.create('l1', { name: 'Milch' })
    const created = later(item('new-1', 'Milch'), 2)
    events.emit(changed(created))
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])

    outbox.answer({ kind: 'create', item: created })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('puts a created item where the server would list it', async () => {
    const service = fakeService([
      item('i1', 'Milch'),
      { ...item('i3', 'Eier'), createdAt: '2026-01-01T12:00:00Z' },
    ])
    const { store, outbox } = setup(service)
    await store.load('l1')

    await store.create('l1', { name: 'Brot' })
    outbox.answer({
      kind: 'create',
      item: { ...item('new-1', 'Brot'), createdAt: '2026-01-01T11:00:00Z', serverSeq: 2 },
    })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot', 'Eier'])
  })

  it('sorts by the moment, not by the text of the date', async () => {
    // The server drops trailing zeros of the fraction. As text, "…:00.5Z" sorts
    // before "…:00Z" ('.' comes before 'Z'), but it is half a second later.
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.create('l1', { name: 'Brot' })
    outbox.answer({
      kind: 'create',
      item: { ...item('new-1', 'Brot'), createdAt: '2026-01-01T10:00:00.5Z', serverSeq: 2 },
    })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('shows a created item only in lists the store holds', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))

    await store.create('l1', { name: 'Brot' })

    expect(outbox.changes()).toHaveLength(1)
    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')

    await store.load('l1')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('neither loses nor tombstones a pending create when the list reloads', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, outbox } = setup(service)
    await store.load('l1')

    await store.create('l1', { name: 'Brot' })
    await store.load('l1')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])

    outbox.answer({
      kind: 'create',
      item: { ...item('new-1', 'Brot'), createdAt: CREATED_LATER, serverSeq: 2 },
    })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
    expect(store.byId('new-1')?.serverSeq).toBe(2)
  })
})

describe('items store: update', () => {
  it('shows the change at once, enqueues with a clock and takes the answer', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    await store.load('l1')

    await store.update('i2', { name: 'Vollkornbrot', quantity: 2 })

    expect(outbox.changes()).toEqual([
      {
        kind: 'update',
        itemId: 'i2',
        change: { name: 'Vollkornbrot', quantity: 2, clock: formatHLC(NOW, 0, 'tab') },
      },
    ])
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Vollkornbrot'])
    expect(store.byId('i2')?.quantity).toBe(2)

    outbox.answer({
      kind: 'update',
      item: later(item('i2', 'Vollkornbrot'), 2, { quantity: 2 }),
    })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Vollkornbrot'])
    expect(store.byId('i2')).toMatchObject({ name: 'Vollkornbrot', quantity: 2, serverSeq: 2 })
  })
})

describe('items store: setChecked', () => {
  it('checks at once with user and time, then takes who and when from the answer', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)

    expect(outbox.changes()).toEqual([
      {
        kind: 'update',
        itemId: 'i1',
        change: { checked: true, clock: formatHLC(NOW, 0, 'tab') },
      },
    ])
    expect(store.byId('i1')?.checked).toBe(true)
    expect(store.byId('i1')?.checkedBy).toBe(ANNA)
    expect(store.byId('i1')?.checkedAt).not.toBeNull()
    expect(names(store.checkedItems('l1'))).toEqual(['Milch'])

    outbox.answer({
      kind: 'update',
      item: later(item('i1', 'Milch', 'l1', true), 2, { checkedBy: ANNA, checkedAt: CHECKED_AT }),
    })
    await flushPromises()

    expect(store.byId('i1')).toMatchObject({
      checked: true,
      checkedBy: ANNA,
      checkedAt: CHECKED_AT,
      serverSeq: 2,
    })
  })

  it('unchecks at once and clears who and when', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch', 'l1', true)]))
    await store.load('l1')

    await store.setChecked('i1', false)

    expect(store.byId('i1')).toMatchObject({ checked: false, checkedBy: null, checkedAt: null })
    expect(names(store.openItems('l1'))).toEqual(['Milch'])

    outbox.answer({ kind: 'update', item: later(item('i1', 'Milch'), 2) })
    await flushPromises()
    expect(store.byId('i1')?.checked).toBe(false)
  })

  it('lets the last tap win while both are pending and as answers arrive', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)
    await store.setChecked('i1', false)
    expect(store.byId('i1')?.checked).toBe(false)

    // The first answer comes back while the second tap is still pending:
    // the second tap stays on top.
    outbox.answer({ kind: 'update', item: later(item('i1', 'Milch', 'l1', true), 2) })
    await flushPromises()
    expect(store.byId('i1')?.checked).toBe(false)

    outbox.answer({ kind: 'update', item: later(item('i1', 'Milch'), 3) })
    await flushPromises()
    expect(store.byId('i1')?.checked).toBe(false)
    expect(store.byId('i1')?.serverSeq).toBe(3)
  })

  it('still enqueues the change for an item it does not know', async () => {
    const { store, outbox } = setup(fakeService())

    await store.setChecked('unknown', true)

    expect(outbox.changes()).toEqual([
      {
        kind: 'update',
        itemId: 'unknown',
        change: { checked: true, clock: formatHLC(NOW, 0, 'tab') },
      },
    ])
  })
})

describe('items store: remove', () => {
  it('hides the item from its list at once and tombstones it on answer', async () => {
    const { store, events, outbox } = setup(
      fakeService([item('i1', 'Milch'), item('i2', 'Brot'), item('i3', 'Nägel', 'l2')]),
    )
    await store.load('l1')
    await store.load('l2')

    await store.remove('i1')

    expect(outbox.changes()).toEqual([{ kind: 'remove', itemId: 'i1' }])
    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
    expect(names(store.itemsOf('l2'))).toEqual(['Nägel'])
    expect(store.byId('i1')).toBeUndefined()

    outbox.answer({ kind: 'remove' })
    await flushPromises()
    events.emit(changed(later(item('i1', 'Milch'), 9)))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('still enqueues a removal for an item it does not know', async () => {
    const { store, outbox } = setup(fakeService())

    await store.remove('unknown')

    expect(outbox.changes()).toEqual([{ kind: 'remove', itemId: 'unknown' }])
  })
})

describe('items store: load merge', () => {
  it('keeps an item that changed while the list was loading', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store, outbox } = setup(service)

    const loading = store.load('l1')
    await store.update('i1', { name: 'Hafermilch' })
    outbox.answer({ kind: 'update', item: later(item('i1', 'Hafermilch'), 3) })
    answer.resolve([item('i1', 'Milch')])
    await loading

    expect(names(store.itemsOf('l1'))).toEqual(['Hafermilch'])
  })

  it('keeps an item that was created while the list was loading', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store, outbox } = setup(service)

    const loading = store.load('l1')
    await store.create('l1', { name: 'Brot' })
    outbox.answer({
      kind: 'create',
      item: { ...item('new-1', 'Brot'), createdAt: CREATED_LATER, serverSeq: 2 },
    })
    answer.resolve([item('i1', 'Milch')])
    await loading

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('drops an item the server no longer has and does not bring it back', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
    const { store, outbox } = setup(service)
    await store.load('l1')
    service.list.mockResolvedValueOnce([item('i1', 'Milch')])

    await store.load('l1')
    // A late answer to a change of the dropped item must not list it again.
    await store.update('i2', { name: 'Brot' })
    outbox.answer({ kind: 'update', item: later(item('i2', 'Brot'), 5) })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('does not put back an item deleted while the list was loading', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store, outbox } = setup(service)

    const loading = store.load('l1')
    await store.remove('i1')
    outbox.answer({ kind: 'remove' })
    answer.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await loading

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('ignores the answer of a load that started before the one already applied', async () => {
    const service = fakeService()
    const first = deferred<Item[]>()
    const second = deferred<Item[]>()
    service.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { store } = setup(service)

    const loadingFirst = store.load('l1')
    const loadingSecond = store.load('l1')
    second.resolve([item('i1', 'Milch')])
    await loadingSecond
    first.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await loadingFirst

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('ignores a failing load that started before the one already applied', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const first = deferred<Item[]>()
    service.list.mockReturnValueOnce(first.promise)
    const { store } = setup(service)

    const loadingFirst = store.load('l1')
    await store.load('l1')
    first.reject(new ApiError('NETWORK'))
    await loadingFirst

    expect(store.statusOf('l1')).toBe('ready')
    expect(store.errorCodeOf('l1')).toBeNull()
  })

  it('stays ready while a loaded list reloads', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    await store.load('l1')
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)

    const reloading = store.load('l1')

    expect(store.statusOf('l1')).toBe('ready')
    answer.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await reloading
    expect(store.statusOf('l1')).toBe('ready')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('shows loading while a list loads for the first time', async () => {
    const service = fakeService()
    service.list.mockReturnValueOnce(new Promise(() => undefined))
    const { store } = setup(service)

    void store.load('l1')

    expect(store.statusOf('l1')).toBe('loading')
  })

  it('keeps a newer item from an answer over the older one of a reload', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, outbox } = setup(service)
    await store.load('l1')

    await store.update('i1', { name: 'Hafermilch' })
    service.list.mockResolvedValueOnce([later(item('i1', 'Milch'), 3, { name: 'Sojamilch' })])
    await store.load('l1')
    outbox.answer({ kind: 'update', item: later(item('i1', 'Milch'), 2, { name: 'Hafermilch' }) })
    await flushPromises()

    expect(store.byId('i1')?.name).toBe('Sojamilch')
  })

  it('does not bring back an item after remove when an older reload arrives', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
    const { store, outbox } = setup(service)
    await store.load('l1')
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)

    const reloading = store.load('l1')
    await store.remove('i1')
    outbox.answer({ kind: 'remove' })
    answer.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await reloading

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })
})

describe('items store: checking while the server changes', () => {
  it('keeps the own check while it is pending and takes the other fields of a reload', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, outbox } = setup(service)
    await store.load('l1')

    await store.setChecked('i1', true)
    service.list.mockResolvedValueOnce([later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })])
    await store.load('l1')

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true, checkedBy: ANNA })
    outbox.answer({ kind: 'update', item: later(item('i1', 'Hafermilch', 'l1', true), 3) })
    await flushPromises()
    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true, serverSeq: 3 })
  })

  it('takes the newest state of the server when a pending check is refused', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, outbox } = setup(service)
    await store.load('l1')

    await store.setChecked('i1', true)
    service.list.mockResolvedValueOnce([later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })])
    await store.load('l1')
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: false, checkedBy: null })
  })

  it('silently drops a refused check of an item deleted meanwhile', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))
    await store.load('l1')

    await store.setChecked('i1', true)
    outbox.reject(new ApiError('ITEM_NOT_FOUND', 404))
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
    expect(rejections).toEqual([])
  })

  it('does not bring back an item that turned out to be deleted when it is reloaded late', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, outbox } = setup(service)
    await store.load('l1')
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)

    const reloading = store.load('l1')
    await store.setChecked('i1', true)
    outbox.reject(new ApiError('ITEM_NOT_FOUND', 404))
    answer.resolve([item('i1', 'Milch')])
    await reloading

    expect(store.itemsOf('l1')).toEqual([])
  })
})

describe('items store: live events', () => {
  it('adds an item another member created, in the order of the server', async () => {
    const service = fakeService([
      item('i1', 'Milch'),
      { ...item('i3', 'Eier'), createdAt: '2026-01-01T12:00:00Z' },
    ])
    const { store, events } = setup(service)
    await store.load('l1')

    events.emit(changed({ ...item('i2', 'Brot'), createdAt: '2026-01-01T11:00:00Z', serverSeq: 5 }))

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot', 'Eier'])
  })

  it('ignores events for a list that is not loaded', () => {
    const { store, events } = setup(fakeService())

    events.emit(changed(item('i1', 'Milch', 'l9')))

    expect(store.itemsOf('l9')).toEqual([])
    expect(store.statusOf('l9')).toBe('idle')
  })

  it('applies a change with a greater serverSeq', async () => {
    const { store, events } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Hafermilch', quantity: 2 })))

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', quantity: 2, serverSeq: 2 })
  })

  it('ignores a change with an equal or lower serverSeq', async () => {
    const { store, events } = setup(fakeService([later(item('i1', 'Milch'), 4)]))
    await store.load('l1')

    events.emit(changed(later(item('i1', 'Milch'), 4, { name: 'Same' })))
    events.emit(changed(later(item('i1', 'Milch'), 3, { name: 'Older' })))

    expect(store.byId('i1')?.name).toBe('Milch')
  })

  it('removes an item on itemDeleted', async () => {
    const { store, events } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    await store.load('l1')

    events.emit(deleted('l1', 'i1', 3))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('does not bring back a deleted item when a change arrives late', async () => {
    const { store, events } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    await store.load('l1')

    events.emit(deleted('l1', 'i1', 3))
    events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Older' })))
    // Deleting wins whatever the numbers say.
    events.emit(changed(later(item('i1', 'Milch'), 9, { name: 'Newer' })))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('remembers a deletion of an item it has not seen yet', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store, events } = setup(service)

    const loading = store.load('l1')
    events.emit(deleted('l1', 'i1', 3))
    events.emit(changed(later(item('i1', 'Milch'), 2)))
    answer.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await loading

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('ignores a second itemDeleted with the same serverSeq', async () => {
    const { store, events } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    await store.load('l1')

    events.emit(deleted('l1', 'i1', 3))
    events.emit(deleted('l1', 'i1', 3))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('ignores a deletion that is not newer than the item it has', async () => {
    const { store, events } = setup(fakeService([later(item('i1', 'Milch'), 5)]))
    await store.load('l1')

    events.emit(deleted('l1', 'i1', 5))

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('removes every item of itemsDeleted', async () => {
    const { store, events } = setup(
      fakeService([item('i1', 'Milch'), item('i2', 'Brot'), item('i3', 'Eier')]),
    )
    await store.load('l1')

    events.emit(bulkDeleted('l1', ['i1', 3], ['i3', 4]))
    events.emit(changed(later(item('i3', 'Eier'), 2)))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('keeps the own check while it is pending and takes the other fields of a change', async () => {
    const { store, events, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)
    events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Hafermilch', quantity: 2 })))

    expect(store.byId('i1')).toMatchObject({
      name: 'Hafermilch',
      quantity: 2,
      checked: true,
      checkedBy: ANNA,
    })
    outbox.answer({ kind: 'update', item: later(item('i1', 'Hafermilch', 'l1', true), 3) })
    await flushPromises()
    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true, serverSeq: 3 })
  })

  it('lets an event with a greater serverSeq beat the answer', async () => {
    const { store, events, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)
    // Another member renamed the item after our change was stored, and the
    // event comes before the answer to our request.
    events.emit(changed(later(item('i1', 'Hafermilch', 'l1', true), 5)))
    outbox.answer({ kind: 'update', item: later(item('i1', 'Milch', 'l1', true), 3) })
    await flushPromises()

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true, serverSeq: 5 })
  })

  it('falls back to the newest server state when a pending check is refused', async () => {
    const { store, events, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)
    events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })))
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: false, checkedBy: null })
  })

  it('does not report a refused check of an item deleted meanwhile by event', async () => {
    const { store, events, outbox } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))
    await store.load('l1')

    await store.setChecked('i1', true)
    events.emit(deleted('l1', 'i1', 3))
    outbox.reject(new ApiError('ITEM_NOT_FOUND', 404))
    await flushPromises()

    expect(rejections).toEqual([])
    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('does not bring back an item that was deleted while its check succeeded', async () => {
    const { store, events, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)
    events.emit(deleted('l1', 'i1', 4))
    outbox.answer({ kind: 'update', item: later(item('i1', 'Milch', 'l1', true), 3) })
    await flushPromises()

    expect(store.itemsOf('l1')).toEqual([])
  })

  it('keeps a newer change from an event over the answer of update', async () => {
    const { store, events, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.update('i1', { name: 'Hafermilch' })
    events.emit(changed(later(item('i1', 'Milch'), 3, { name: 'Sojamilch' })))
    outbox.answer({ kind: 'update', item: later(item('i1', 'Milch'), 2, { name: 'Hafermilch' }) })
    await flushPromises()

    expect(store.byId('i1')?.name).toBe('Sojamilch')
  })

  it('does not bring back an item after remove when its echo arrives', async () => {
    const { store, events, outbox } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    await store.load('l1')

    await store.remove('i1')
    outbox.answer({ kind: 'remove' })
    await flushPromises()
    events.emit(changed(later(item('i1', 'Milch'), 9)))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })
})

describe('items store: other tabs and reload', () => {
  it('shows pending changes made in another tab and drops them when that tab sends', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    const added = outbox.fromOtherTab({
      kind: 'create',
      listId: 'l1',
      item: { id: 'i2', name: 'Brot', clock: formatHLC(NOW, 0, 'other') },
    })
    const edited = outbox.fromOtherTab({
      kind: 'update',
      itemId: 'i1',
      change: { name: 'Hafermilch', clock: formatHLC(NOW, 1, 'other') },
    })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(
      ['Milch', 'Brot'].map((n) => (n === 'Milch' ? 'Hafermilch' : n)),
    )

    outbox.leaveFromOtherTab(edited.seq)
    outbox.leaveFromOtherTab(added.seq)
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('does not bring back an answered entry from a stale outbox read', async () => {
    const fake = createFakeOutbox()
    const slowRead = deferred<OutboxEntry[]>()
    const afterAnswerRead = deferred<OutboxEntry[]>()
    let reads = 0
    const user = ref<string | null>(ANNA)
    const store = defineItemsStore(
      fakeService([item('i1', 'Milch')]),
      () => user.value,
      createFakeServerEvents(),
      fakeStorage(),
      {
        openOutbox(options) {
          const box = fake.open(options)
          return {
            ...box,
            entries() {
              reads++
              // Read 1: initial refresh at open. Read 2: after enqueue (delayed,
              // still contains seq 1). Read 3: after leave inside answer (still pending).
              if (reads === 2) return slowRead.promise
              if (reads === 3) return afterAnswerRead.promise
              return box.entries()
            },
          }
        },
        clock: createClock('tab', () => NOW),
      },
    )()

    await store.load('l1')
    // Start write; its refresh (read 2) is held back while enqueue finished.
    const writing = store.update('i1', { name: 'Hafermilch' })
    const [entry] = fake.entries()
    expect(entry).toBeDefined()

    // Server answers with another name (LWW won elsewhere); read 3 is still pending.
    fake.answer({ kind: 'update', item: later(item('i1', 'Sojamilch'), 2) })
    // Now stale read 2 resolves with the already-settled entry!
    slowRead.resolve([entry!])
    await flushPromises()

    expect(store.byId('i1')?.name).toBe('Sojamilch')

    afterAnswerRead.resolve([])
    await writing
    expect(store.byId('i1')?.name).toBe('Sojamilch')
  })

  it('shows entries left in the outbox before open over stored items on reload', async () => {
    const outbox = createFakeOutbox()
    outbox.fromOtherTab({
      kind: 'update',
      itemId: 'i1',
      change: { checked: true, clock: formatHLC(NOW, 0, 'prev') },
    })
    outbox.fromOtherTab({
      kind: 'create',
      listId: 'l1',
      item: { id: 'i-offline', name: 'Kaffee', clock: formatHLC(NOW, 1, 'prev') },
    })
    const service = fakeService()
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const storage = fakeStorage({ l1: [item('i1', 'Milch')] })
    const { store } = setup(service, ANNA, storage, outbox)

    await store.load('l1')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Kaffee'])
    expect(store.byId('i1')?.checked).toBe(true)
  })
})

describe('items store: HLC', () => {
  const ahead = (minutes: number, counter = 0, node = 'other') =>
    formatHLC(NOW + minutes * 60_000, counter, node)

  const clockOf = (change: OutboxChange): string => {
    if (change.kind === 'create') return change.item.clock!
    if (change.kind === 'update') return change.change.clock!
    throw new Error(`no clock on ${change.kind}`)
  }

  it('issues clocks greater than those seen from load', async () => {
    const futureClock = ahead(4, 3)
    const loaded = item('i1', 'Milch')
    loaded.clocks.name = futureClock
    const { store, outbox } = setup(fakeService([loaded]))
    await store.load('l1')

    await store.update('i1', { name: 'Hafermilch' })

    const written = clockOf(outbox.changes()[0]!)
    expect(written > futureClock).toBe(true)
  })

  it('issues clocks greater than those seen from events, including discarded ones', async () => {
    const fromUnknownList = ahead(2, 1)
    const fromTombstoned = ahead(3, 2)
    const fromOutdatedSeq = ahead(4, 5)
    const { store, events, outbox } = setup(fakeService([later(item('i1', 'Milch'), 5)]))
    await store.load('l1')

    // Discarded: unknown list.
    const unknown = item('i9', 'X', 'l9')
    unknown.clocks.note = fromUnknownList
    events.emit(changed(unknown))

    // Discarded: tombstoned item.
    events.emit(deleted('l1', 'i2', 2))
    const dead = item('i2', 'Y')
    dead.clocks.quantity = fromTombstoned
    events.emit(changed(dead))

    // Discarded: lower serverSeq.
    const stale = later(item('i1', 'Milch'), 3)
    stale.clocks.checked = fromOutdatedSeq
    events.emit(changed(stale))

    await store.setChecked('i1', true)

    const written = clockOf(outbox.changes()[0]!)
    expect(written > fromUnknownList).toBe(true)
    expect(written > fromTombstoned).toBe(true)
    expect(written > fromOutdatedSeq).toBe(true)
  })

  it('issues clocks greater than those seen from device storage', async () => {
    const storedClock = ahead(3, 7)
    const saved = item('i1', 'Milch')
    saved.clocks.unit = storedClock
    const service = fakeService()
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { store, outbox } = setup(service, ANNA, fakeStorage({ l1: [saved] }))
    await store.load('l1')

    await store.create('l1', { name: 'Brot' })

    expect(clockOf(outbox.changes()[0]!) > storedClock).toBe(true)
  })

  it("issues clocks greater than another tab's outbox entries", async () => {
    const createClock = ahead(2, 1, 'tab2')
    const updateClock = ahead(4, 9, 'tab2')
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    outbox.fromOtherTab({
      kind: 'create',
      listId: 'l1',
      item: { id: 'i2', name: 'Brot', clock: createClock },
    })
    outbox.fromOtherTab({
      kind: 'update',
      itemId: 'i1',
      change: { name: 'Hafermilch', clock: updateClock },
    })
    await flushPromises()

    await store.update('i1', { quantity: 2 })

    const own = clockOf(outbox.changes()[2]!)
    expect(own > createClock).toBe(true)
    expect(own > updateClock).toBe(true)
  })
})

describe('items store: rejections', () => {
  it('rolls back and reports kind, name and code for each rejected action', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))
    await store.load('l1')

    // create
    await store.create('l1', { name: 'Käse' })
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])

    // update (name)
    await store.update('i1', { name: 'Hafermilch' })
    outbox.reject(new ApiError('ITEM_NAME_INVALID', 400))
    await flushPromises()
    expect(store.byId('i1')?.name).toBe('Milch')

    // update with checked + another field counts as 'update', not 'check'
    await store.update('i1', { name: 'Hafermilch', checked: true })
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()
    expect(store.byId('i1')).toMatchObject({ name: 'Milch', checked: false })

    // check
    await store.setChecked('i1', true)
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()
    expect(store.byId('i1')?.checked).toBe(false)

    // remove
    await store.remove('i1')
    expect(store.itemsOf('l1')).toEqual([])
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])

    expect(rejections).toEqual([
      { kind: 'create', name: 'Käse', code: 'FORBIDDEN' },
      { kind: 'update', name: 'Milch', code: 'ITEM_NAME_INVALID' },
      { kind: 'update', name: 'Milch', code: 'FORBIDDEN' },
      { kind: 'check', name: 'Milch', code: 'FORBIDDEN' },
      { kind: 'remove', name: 'Milch', code: 'FORBIDDEN' },
    ])
  })

  it('silently forgets on ITEM_NOT_FOUND and ITEM_ID_TAKEN', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))
    await store.load('l1')

    await store.update('i1', { name: 'Hafermilch' })
    outbox.reject(new ApiError('ITEM_NOT_FOUND', 404))
    await store.create('l1', { name: 'Käse' })
    outbox.reject(new ApiError('ITEM_ID_TAKEN', 409))
    await store.create('l1', { name: 'Eier' })
    outbox.reject(new ApiError('ITEM_NOT_FOUND', 404))
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
    expect(rejections).toEqual([])
  })

  it('tombstones an expired create and reports OUTBOX_EXPIRED', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))
    await store.load('l1')

    await store.create('l1', { name: 'Käse' })
    outbox.reject(new ApiError(ERROR_CODE_OUTBOX_EXPIRED))
    // Even if another tab still holds a create for the same ID, tombstone hides it.
    outbox.fromOtherTab({
      kind: 'create',
      listId: 'l1',
      item: { id: 'new-1', name: 'Käse', clock: formatHLC(NOW, 0, 'other') },
    })
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(rejections).toEqual([{ kind: 'create', name: 'Käse', code: ERROR_CODE_OUTBOX_EXPIRED }])
  })

  it('reports nothing when the item name is unknown', async () => {
    const { store, outbox } = setup(fakeService())
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))

    await store.update('unknown', { name: 'X' })
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()

    expect(rejections).toEqual([])
  })

  it('stops notifying an unsubscribed listener', async () => {
    const { store, outbox } = setup(fakeService([item('i1', 'Milch')]))
    const rejections: ItemRejection[] = []
    const stop = store.onRejected((r) => rejections.push(r))
    await store.load('l1')

    stop()
    await store.setChecked('i1', true)
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()

    expect(rejections).toEqual([])
  })
})

describe('items store: loadGroup', () => {
  it('loads the items of every active list of the household at once', async () => {
    const service = fakeService([
      item('i1', 'Milch'),
      item('i2', 'Brot', 'l1', true),
      item('i3', 'Nägel', 'l2'),
    ])
    const { store } = setup(service)

    await expect(store.loadGroup('g1')).resolves.toEqual(['l1', 'l2'])

    expect(service.listGroup).toHaveBeenCalledWith('g1')
    expect(service.list).not.toHaveBeenCalled()
    expect(store.statusOf('l1')).toBe('ready')
    expect(names(store.openItems('l1'))).toEqual(['Milch'])
    expect(names(store.checkedItems('l1'))).toEqual(['Brot'])
    expect(store.statusOf('l2')).toBe('ready')
    expect(names(store.itemsOf('l2'))).toEqual(['Nägel'])
  })

  it('empties a covered list without items, on the device too', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const storage = fakeStorage({ l1: [item('i1', 'Milch')] })
    const { store } = setup(service, ANNA, storage)
    await store.load('l1')
    service.listGroup.mockResolvedValueOnce({ listIds: ['l1'], items: [] })

    await store.loadGroup('g1')
    await flushPromises()

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('ready')
    expect(storage.items.l1).toEqual([])
  })

  it('writes every covered list to the device', async () => {
    const storage = fakeStorage()
    const { store } = setup(
      fakeService([item('i1', 'Milch'), item('i2', 'Nägel', 'l2')]),
      ANNA,
      storage,
    )

    await store.loadGroup('g1')
    await flushPromises()

    expect(names(storage.items.l1 ?? [])).toEqual(['Milch'])
    expect(names(storage.items.l2 ?? [])).toEqual(['Nägel'])
  })

  it('leaves the lists alone that the answer does not cover', async () => {
    // l9 stands for an archived list the user opened: the answer of the
    // household does not cover it.
    const service = fakeService([item('i9', 'Kerzen', 'l9')])
    const { store } = setup(service)
    await store.load('l9')
    service.listGroup.mockResolvedValueOnce({ listIds: ['l1'], items: [item('i1', 'Milch')] })

    await store.loadGroup('g1')

    expect(names(store.itemsOf('l9'))).toEqual(['Kerzen'])
    expect(store.statusOf('l9')).toBe('ready')
  })

  it('changes nothing when the request fails', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    await store.load('l1')
    service.listGroup.mockRejectedValueOnce(new ApiError('NETWORK'))

    await expect(store.loadGroup('g1')).resolves.toBeNull()

    expect(store.statusOf('l1')).toBe('ready')
    expect(store.errorCodeOf('l1')).toBeNull()
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(store.statusOf('l2')).toBe('idle')
  })

  it('ignores an answer that arrives after the user changed', async () => {
    const service = fakeService()
    const answer = deferred<GroupItemList>()
    service.listGroup.mockReturnValueOnce(answer.promise)
    const { store, user } = setup(service)

    const loading = store.loadGroup('g1')
    user.value = BEN
    await Promise.resolve()
    answer.resolve({ listIds: ['l1'], items: [item('i1', 'Milch')] })

    await expect(loading).resolves.toBeNull()
    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
  })

  it('ignores a list whose load started later and was applied already', async () => {
    const service = fakeService()
    const answer = deferred<GroupItemList>()
    service.listGroup.mockReturnValueOnce(answer.promise)
    service.list.mockResolvedValueOnce([item('i1', 'Milch'), item('i2', 'Brot')])
    const { store } = setup(service)

    const loading = store.loadGroup('g1')
    await store.load('l1')
    answer.resolve({ listIds: ['l1'], items: [item('i1', 'Milch')] })
    await loading

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('does not bring back a list that was forgotten while it loaded', async () => {
    const service = fakeService()
    const answer = deferred<GroupItemList>()
    service.listGroup.mockReturnValueOnce(answer.promise)
    const storage = fakeStorage()
    const { store } = setup(service, ANNA, storage)

    const loading = store.loadGroup('g1')
    store.forgetList('l1')
    answer.resolve({ listIds: ['l1'], items: [item('i1', 'Milch')] })
    await loading
    await flushPromises()

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
    expect(storage.items.l1).toBeUndefined()
  })

  it('takes a list again that was forgotten before it started', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    store.forgetList('l1')

    await store.loadGroup('g1')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })
})

describe('items store: reloadLoaded', () => {
  it('reloads every loaded list', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Nägel', 'l2')])
    const { store } = setup(service)
    await store.load('l1')
    await store.load('l2')
    service.list.mockClear()
    service.list.mockResolvedValueOnce([item('i1', 'Milch'), item('i3', 'Brot')])

    store.reloadLoaded()
    await flushPromises()

    expect(service.list.mock.calls.map(([listId]) => listId).sort()).toEqual(['l1', 'l2'])
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('shows no spinner while it reloads', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    await store.load('l1')
    service.list.mockReturnValueOnce(new Promise(() => undefined))

    store.reloadLoaded()

    expect(store.statusOf('l1')).toBe('ready')
  })

  it('does nothing before any list was loaded', () => {
    const service = fakeService()
    const { store } = setup(service)

    store.reloadLoaded()

    expect(service.list).not.toHaveBeenCalled()
  })

  it('does not load a list that only got an item from a create', async () => {
    const service = fakeService()
    const { store, outbox } = setup(service)
    await store.create('l1', { name: 'Brot' })
    outbox.answer({ kind: 'create', item: item('new-1', 'Brot') })
    await flushPromises()

    store.reloadLoaded()

    expect(service.list).not.toHaveBeenCalled()
    expect(store.statusOf('l1')).toBe('idle')
  })

  it('reloads a list that is still loading', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const first = deferred<Item[]>()
    service.list.mockReturnValueOnce(first.promise)
    const { store } = setup(service)

    const loading = store.load('l1')
    store.reloadLoaded()
    await flushPromises()
    expect(service.list).toHaveBeenCalledTimes(2)
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])

    // The first answer is older than the second one and changes nothing.
    first.resolve([])
    await loading
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('keeps the items and reports the error when the reload fails', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    await store.load('l1')
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))

    store.reloadLoaded()
    await flushPromises()

    expect(store.statusOf('l1')).toBe('error')
    expect(store.errorCodeOf('l1')).toBe('NETWORK')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('skips the lists it is told to skip', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Nägel', 'l2')])
    const { store } = setup(service)
    await store.load('l1')
    await store.load('l2')
    service.list.mockClear()

    store.reloadLoaded(new Set(['l1']))

    expect(service.list.mock.calls.map(([listId]) => listId)).toEqual(['l2'])
  })
})

describe('items store: forgetList', () => {
  it('drops the list and its items', async () => {
    const { store } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Nägel', 'l2')]))
    await store.load('l1')
    await store.load('l2')

    store.forgetList('l1')

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
    expect(store.byId('i1')).toBeUndefined()
    expect(names(store.itemsOf('l2'))).toEqual(['Nägel'])
  })

  it('does not reload a forgotten list', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    await store.load('l1')
    store.forgetList('l1')
    service.list.mockClear()

    store.reloadLoaded()
    await flushPromises()

    expect(service.list).not.toHaveBeenCalled()
  })

  it('drops events for a forgotten list', async () => {
    const { store, events } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')
    store.forgetList('l1')

    events.emit(changed(later(item('i1', 'Hafermilch'), 2)))

    expect(store.itemsOf('l1')).toEqual([])
  })

  it('ignores a load of the list that answers after it was forgotten', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store } = setup(service)

    const loading = store.load('l1')
    store.forgetList('l1')
    answer.resolve([item('i1', 'Milch')])
    await loading

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
  })

  it('loads the list again when it is opened again', async () => {
    const { store } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')
    store.forgetList('l1')

    await store.load('l1')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })
})

describe('items store: removing checked items', () => {
  const shopping = () => [
    item('i1', 'Milch'),
    item('i2', 'Brot', 'l1', true),
    item('i3', 'Eier', 'l1', true),
  ]

  it('hides the checked items at once and sends nothing yet', async () => {
    const service = fakeService(shopping())
    const { store } = setup(service)
    await store.load('l1')

    const removal = store.startRemovingChecked('l1')

    expect(names(removal?.items ?? [])).toEqual(['Brot', 'Eier'])
    expect(store.checkedItems('l1')).toEqual([])
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(names(store.openItems('l1'))).toEqual(['Milch'])
    expect(service.removeChecked).not.toHaveBeenCalled()
  })

  it('answers null if no item is checked', async () => {
    const { store } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    expect(store.startRemovingChecked('l1')).toBeNull()
  })

  it('deletes the items for good on commit', async () => {
    const service = fakeService(shopping())
    const { store, events } = setup(service)
    await store.load('l1')

    await store.startRemovingChecked('l1')?.commit()
    // A late state of a deleted item must not bring it back.
    events.emit(changed(later(item('i2', 'Brot', 'l1', true), 20)))

    expect(service.removeChecked).toHaveBeenCalledWith('l1', ['i2', 'i3'])
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('shows an item again that the server did not delete', async () => {
    const service = fakeService(shopping())
    service.removeChecked.mockResolvedValueOnce([{ itemId: 'i2', serverSeq: 10 }])
    const { store } = setup(service)
    await store.load('l1')

    await store.startRemovingChecked('l1')?.commit()

    expect(names(store.checkedItems('l1'))).toEqual(['Eier'])
  })

  it('shows the items again on undo and sends nothing', async () => {
    const service = fakeService(shopping())
    const { store } = setup(service)
    await store.load('l1')

    const removal = store.startRemovingChecked('l1')
    removal?.undo()
    await removal?.commit()

    expect(names(store.checkedItems('l1'))).toEqual(['Brot', 'Eier'])
    expect(service.removeChecked).not.toHaveBeenCalled()
  })

  it('sends once, however often commit is called', async () => {
    const service = fakeService(shopping())
    const { store } = setup(service)
    await store.load('l1')

    const removal = store.startRemovingChecked('l1')
    await Promise.all([removal?.commit(), removal?.commit()])
    removal?.undo()

    expect(service.removeChecked).toHaveBeenCalledTimes(1)
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('shows the items again and throws if the request fails', async () => {
    const service = fakeService(shopping())
    service.removeChecked.mockRejectedValueOnce(new ApiError('INTERNAL', 500))
    const { store } = setup(service)
    await store.load('l1')

    await expect(store.startRemovingChecked('l1')?.commit()).rejects.toThrow(ApiError)

    expect(names(store.checkedItems('l1'))).toEqual(['Brot', 'Eier'])
  })

  it('shows an item that someone unchecks meanwhile among the open items', async () => {
    const { store, events } = setup(fakeService(shopping()))
    await store.load('l1')

    store.startRemovingChecked('l1')
    events.emit(changed(later(item('i2', 'Brot'), 2)))

    expect(names(store.openItems('l1'))).toEqual(['Milch', 'Brot'])
    expect(store.checkedItems('l1')).toEqual([])
  })

  it('leaves an item alone that is checked after the start', async () => {
    const service = fakeService(shopping())
    const { store } = setup(service)
    await store.load('l1')

    const removal = store.startRemovingChecked('l1')
    await store.setChecked('i1', true)
    await removal?.commit()

    expect(service.removeChecked).toHaveBeenCalledWith('l1', ['i2', 'i3'])
    expect(names(store.checkedItems('l1'))).toEqual(['Milch'])
  })

  it('takes the next removal without the items of the first', async () => {
    const service = fakeService(shopping())
    const { store } = setup(service)
    await store.load('l1')

    store.startRemovingChecked('l1')
    await store.setChecked('i1', true)
    const second = store.startRemovingChecked('l1')

    expect(names(second?.items ?? [])).toEqual(['Milch'])
  })

  it('keeps the items hidden while the list loads again', async () => {
    const { store } = setup(fakeService(shopping()))
    await store.load('l1')

    store.startRemovingChecked('l1')
    await store.load('l1')

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('sends many items in blocks and keeps what an earlier block deleted', async () => {
    const many = Array.from({ length: MAX_REMOVE_CHECKED + 1 }, (_, n) =>
      item(`i${String(n).padStart(4, '0')}`, `Artikel ${n}`, 'l1', true),
    )
    const service = fakeService(many)
    service.removeChecked
      .mockImplementationOnce((_listId: string, ids: string[]) =>
        Promise.resolve(ids.map((itemId) => ({ itemId, serverSeq: 10 }))),
      )
      .mockRejectedValueOnce(new ApiError('INTERNAL', 500))
    const { store } = setup(service)
    await store.load('l1')

    await expect(store.startRemovingChecked('l1')?.commit()).rejects.toThrow(ApiError)

    expect(service.removeChecked).toHaveBeenCalledTimes(2)
    expect(service.removeChecked.mock.calls[0]?.[1]).toHaveLength(MAX_REMOVE_CHECKED)
    expect(service.removeChecked.mock.calls[1]?.[1]).toEqual([many[MAX_REMOVE_CHECKED]?.id])
    expect(names(store.itemsOf('l1'))).toEqual([`Artikel ${MAX_REMOVE_CHECKED}`])
  })

  it("does not apply a removal of the previous user's items", async () => {
    const service = fakeService(shopping())
    const answer = deferred<{ itemId: string; serverSeq: number }[]>()
    service.removeChecked.mockReturnValueOnce(answer.promise)
    const { store, user } = setup(service)
    await store.load('l1')

    const committing = store.startRemovingChecked('l1')?.commit()
    user.value = BEN
    await flushPromises()
    await store.load('l1')
    answer.resolve([{ itemId: 'i2', serverSeq: 10 }])
    await committing

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot', 'Eier'])
  })
})

describe('items store: removing one item', () => {
  const shopping = () => [item('i1', 'Milch'), item('i2', 'Brot', 'l1', true)]

  it('hides the item at once, open or checked, and enqueues nothing yet', async () => {
    const { store, outbox } = setup(fakeService(shopping()))
    await store.load('l1')

    const first = store.startRemovingItem('i1')
    store.startRemovingItem('i2')

    expect(names(first?.items ?? [])).toEqual(['Milch'])
    expect(store.itemsOf('l1')).toEqual([])
    expect(outbox.changes()).toEqual([])
  })

  it('answers null for an item it does not show', async () => {
    const { store } = setup(fakeService(shopping()))
    await store.load('l1')
    store.startRemovingItem('i1')

    expect(store.startRemovingItem('i1')).toBeNull()
    expect(store.startRemovingItem('unknown')).toBeNull()
  })

  it('enqueues remove on commit, keeps hidden and tombstones on answer', async () => {
    const { store, events, outbox } = setup(fakeService(shopping()))
    await store.load('l1')

    await store.startRemovingItem('i1')?.commit()

    expect(outbox.changes()).toEqual([{ kind: 'remove', itemId: 'i1' }])
    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
    expect(store.byId('i1')).toBeUndefined()

    outbox.answer({ kind: 'remove' })
    await flushPromises()
    events.emit(changed(later(item('i1', 'Hafermilch'), 20)))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('keeps the item hidden whatever others change meanwhile', async () => {
    const { store, events } = setup(fakeService(shopping()))
    await store.load('l1')

    store.startRemovingItem('i1')
    events.emit(changed(later(item('i1', 'Milch', 'l1', true), 2)))

    expect(store.checkedItems('l1').map((i) => i.id)).toEqual(['i2'])
  })

  it('shows the item again on undo and enqueues nothing', async () => {
    const { store, outbox } = setup(fakeService(shopping()))
    await store.load('l1')

    store.startRemovingItem('i1')?.undo()

    expect(names(store.openItems('l1'))).toEqual(['Milch'])
    expect(outbox.changes()).toEqual([])
  })

  it('does not enqueue when the user changed before commit', async () => {
    const { store, user, outbox } = setup(fakeService(shopping()))
    await store.load('l1')

    const removal = store.startRemovingItem('i1')
    user.value = BEN
    await flushPromises()
    await removal?.commit()

    expect(outbox.changes()).toEqual([])
  })

  it('shows the item again and notifies listeners if the server refuses', async () => {
    const { store, outbox } = setup(fakeService(shopping()))
    const rejections: ItemRejection[] = []
    store.onRejected((r) => rejections.push(r))
    await store.load('l1')

    await store.startRemovingItem('i1')?.commit()
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()

    expect(names(store.openItems('l1'))).toEqual(['Milch'])
    expect(rejections).toEqual([{ kind: 'remove', name: 'Milch', code: 'FORBIDDEN' }])
  })
})

describe('items store: storage on the device', () => {
  // The stored items of a list as [name, checked] pairs.
  const storedOf = (storage: ReturnType<typeof fakeStorage>, listId = 'l1') =>
    (storage.items[listId] ?? []).map((i): [string, boolean] => [i.name, i.checked])

  it('shows the stored items while the server is asked', async () => {
    const service = fakeService()
    const request = deferred<Item[]>()
    service.list.mockReturnValueOnce(request.promise)
    const storage = fakeStorage({ l1: [item('i1', 'Milch')] })
    const { store } = setup(service, ANNA, storage)

    void store.load('l1')
    await flushPromises()

    expect(storage.readItems).toHaveBeenCalledWith(ANNA, 'l1')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(store.statusOf('l1')).toBe('loading')

    request.resolve([later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })])
    await flushPromises()

    expect(store.statusOf('l1')).toBe('ready')
    expect(names(store.itemsOf('l1'))).toEqual(['Hafermilch'])
  })

  it('keeps the stored items when the server cannot be reached', async () => {
    const service = fakeService()
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const storage = fakeStorage({ l1: [item('i1', 'Milch'), item('i2', 'Brot', 'l1', true)] })
    const { store } = setup(service, ANNA, storage)

    await store.load('l1')

    expect(store.statusOf('l1')).toBe('error')
    expect(store.errorCodeOf('l1')).toBe('NETWORK')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
    expect(names(store.openItems('l1'))).toEqual(['Milch'])
    expect(names(store.checkedItems('l1'))).toEqual(['Brot'])
  })

  it('keeps the lists apart', async () => {
    const service = fakeService()
    service.list.mockRejectedValue(new ApiError('NETWORK'))
    const storage = fakeStorage({
      l1: [item('i1', 'Milch')],
      l2: [item('i2', 'Nägel', 'l2')],
    })
    const { store } = setup(service, ANNA, storage)

    await store.load('l2')

    expect(names(store.itemsOf('l2'))).toEqual(['Nägel'])
    expect(store.itemsOf('l1')).toEqual([])
  })

  it('drops a stored item the server no longer has', async () => {
    const storage = fakeStorage({ l1: [item('i1', 'Milch'), item('i2', 'Brot')] })
    const { store, events } = setup(fakeService([item('i1', 'Milch')]), ANNA, storage)

    await store.load('l1')
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
    expect(storedOf(storage)).toEqual([['Milch', false]])

    // It does not come back with a late event either.
    events.emit(changed(later(item('i2', 'Brot'), 0)))
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('drops stored items that arrive after the server answer', async () => {
    const storage = fakeStorage()
    const read = deferred<Item[] | null>()
    storage.readItems.mockReturnValueOnce(read.promise)
    const { store } = setup(fakeService([item('i1', 'Hafermilch')]), ANNA, storage)

    await store.load('l1')
    read.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Hafermilch'])
  })

  it('keeps a newer item from an event over the stored one', async () => {
    const service = fakeService()
    service.list.mockReturnValueOnce(deferred<Item[]>().promise)
    const storage = fakeStorage()
    const read = deferred<Item[] | null>()
    storage.readItems.mockReturnValueOnce(read.promise)
    const { store, events } = setup(service, ANNA, storage)

    void store.load('l1')
    events.emit(changed(later(item('i1', 'x'), 2, { name: 'Hafermilch' })))
    read.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await flushPromises()

    expect(names(store.itemsOf('l1'))).toEqual(['Hafermilch', 'Brot'])
  })

  it('does not bring back an item deleted before the stored items were read', async () => {
    const service = fakeService()
    service.list.mockReturnValueOnce(deferred<Item[]>().promise)
    const storage = fakeStorage()
    const read = deferred<Item[] | null>()
    storage.readItems.mockReturnValueOnce(read.promise)
    const { store, events } = setup(service, ANNA, storage)

    void store.load('l1')
    events.emit(deleted('l1', 'i1', 2))
    read.resolve([item('i1', 'Milch')])
    await flushPromises()

    expect(store.itemsOf('l1')).toEqual([])
  })

  it('writes the items back after a load, own writes and events', async () => {
    const storage = fakeStorage()
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot'), item('i3', 'Eier')])
    const { store, events, outbox } = setup(service, ANNA, storage)

    await store.load('l1')
    await flushPromises()
    expect(storage.writeItems).toHaveBeenCalledWith(ANNA, 'l1', expect.anything())
    expect(names(storage.items.l1 ?? [])).toEqual(['Milch', 'Brot', 'Eier'])

    await store.create('l1', { name: 'Käse' })
    outbox.answer({
      kind: 'create',
      item: { ...item('new-1', 'Käse'), createdAt: CREATED_LATER, serverSeq: 2 },
    })
    await flushPromises()
    expect(names(storage.items.l1 ?? [])).toEqual(['Milch', 'Brot', 'Eier', 'Käse'])

    await store.update('i1', { name: 'Hafermilch' })
    outbox.answer({ kind: 'update', item: later(item('i1', 'Hafermilch'), 2) })
    await flushPromises()
    expect(names(storage.items.l1 ?? [])).toEqual(['Hafermilch', 'Brot', 'Eier', 'Käse'])

    events.emit(changed(later(item('i2', 'Brot'), 2, { name: 'Roggenbrot' })))
    await flushPromises()
    expect(names(storage.items.l1 ?? [])).toEqual(['Hafermilch', 'Roggenbrot', 'Eier', 'Käse'])

    events.emit(deleted('l1', 'i3', 3))
    await flushPromises()
    expect(names(storage.items.l1 ?? [])).toEqual(['Hafermilch', 'Roggenbrot', 'Käse'])

    events.emit(bulkDeleted('l1', ['i1', 4], ['i2', 4]))
    await flushPromises()
    expect(names(storage.items.l1 ?? [])).toEqual(['Käse'])
  })

  it('writes once for several changes in one go', async () => {
    const storage = fakeStorage()
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot'), item('i3', 'Eier')])
    const { store, events } = setup(service, ANNA, storage)
    await store.load('l1')
    await flushPromises()
    storage.writeItems.mockClear()

    events.emit(bulkDeleted('l1', ['i1', 2], ['i2', 2]))
    await flushPromises()

    expect(storage.writeItems).toHaveBeenCalledOnce()
    expect(names(storage.items.l1 ?? [])).toEqual(['Eier'])
  })

  it('removes the stored items of a forgotten list', async () => {
    const storage = fakeStorage({ l2: [item('i2', 'Nägel', 'l2')] })
    const { store } = setup(fakeService([item('i1', 'Milch')]), ANNA, storage)
    await store.load('l1')
    await flushPromises()

    store.forgetList('l1')
    // Never loaded in this session, but stored from an earlier one.
    store.forgetList('l2')
    await flushPromises()

    expect(storage.removeItems).toHaveBeenCalledWith(ANNA, 'l1')
    expect(storage.removeItems).toHaveBeenCalledWith(ANNA, 'l2')
    expect(storage.items).toEqual({})
  })

  it('does not treat a list as read that was forgotten while it loaded', async () => {
    const service = fakeService()
    const request = deferred<Item[]>()
    service.list.mockReturnValueOnce(request.promise)
    const storage = fakeStorage()
    const { store, outbox } = setup(service, ANNA, storage)

    void store.load('l1')
    await flushPromises()
    store.forgetList('l1')
    request.resolve([item('i1', 'Milch')])
    await flushPromises()
    expect(storage.items).toEqual({})

    // The list is opened again; until its stored items are read, nothing is
    // written, as for any list that was not loaded yet.
    service.list.mockReturnValueOnce(deferred<Item[]>().promise)
    storage.readItems.mockReturnValueOnce(deferred<Item[] | null>().promise)
    void store.load('l1')
    await store.create('l1', { name: 'Käse' })
    outbox.answer({ kind: 'create', item: item('new-1', 'Käse') })
    await flushPromises()

    expect(storage.writeItems).not.toHaveBeenCalled()
  })

  it('writes nothing before the stored items were read', async () => {
    const service = fakeService()
    service.list.mockReturnValueOnce(deferred<Item[]>().promise)
    const storage = fakeStorage()
    storage.readItems.mockReturnValueOnce(deferred<Item[] | null>().promise)
    const { store, outbox } = setup(service, ANNA, storage)

    void store.load('l1')
    await store.create('l1', { name: 'Käse' })
    outbox.answer({ kind: 'create', item: item('new-1', 'Käse') })
    await flushPromises()

    expect(storage.writeItems).not.toHaveBeenCalled()
  })

  it('writes nothing from a load of the previous user', async () => {
    const service = fakeService()
    const request = deferred<Item[]>()
    service.list.mockReturnValueOnce(request.promise)
    const storage = fakeStorage()
    const { store, user } = setup(service, ANNA, storage)

    void store.load('l1')
    await flushPromises()
    user.value = BEN
    await flushPromises()
    request.resolve([item('i1', 'Milch')])
    await flushPromises()

    expect(storage.writeItems).not.toHaveBeenCalled()
  })

  describe('pending changes', () => {
    async function loadedWithPendingChanges() {
      const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
      const storage = fakeStorage()
      const { store, events, outbox } = setup(service, ANNA, storage)
      await store.load('l1')
      await flushPromises()
      await store.setChecked('i1', true)
      return { store, events, storage, outbox }
    }

    it('never writes pending changes to the device until the server confirms them', async () => {
      const { store, events, storage, outbox } = await loadedWithPendingChanges()
      await store.create('l1', { name: 'Käse' })
      await store.remove('i2')
      // Another change makes the store write while everything is pending.
      events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })))
      await flushPromises()

      expect(names(store.itemsOf('l1'))).toEqual(['Hafermilch', 'Käse'])
      expect(store.byId('i1')?.checked).toBe(true)
      expect(storedOf(storage)).toEqual([
        ['Hafermilch', false],
        ['Brot', false],
      ])

      outbox.answer({ kind: 'update', item: later(item('i1', 'Hafermilch', 'l1', true), 3) })
      outbox.answer({
        kind: 'create',
        item: { ...item('new-1', 'Käse'), createdAt: CREATED_LATER, serverSeq: 4 },
      })
      outbox.answer({ kind: 'remove' })
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Hafermilch', true],
        ['Käse', false],
      ])
    })

    it('never stores a pending change that the server refuses', async () => {
      const { events, storage, outbox } = await loadedWithPendingChanges()
      events.emit(changed(later(item('i2', 'Brot'), 2, { name: 'Roggenbrot' })))
      await flushPromises()
      expect(storage.writes.length).toBeGreaterThan(0)

      outbox.reject(new ApiError('FORBIDDEN', 403))
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', false],
        ['Roggenbrot', false],
      ])
      for (const written of storage.writes) {
        expect(written.every((entry) => !entry.checked)).toBe(true)
      }
    })

    it('keeps a pending tap over a stored item when the load answers', async () => {
      const service = fakeService()
      const request = deferred<Item[]>()
      service.list.mockReturnValueOnce(request.promise)
      const storage = fakeStorage({ l1: [item('i1', 'Milch')] })
      const { store, outbox } = setup(service, ANNA, storage)

      void store.load('l1')
      await flushPromises()
      await store.setChecked('i1', true)
      request.resolve([item('i1', 'Milch')])
      await flushPromises()

      expect(store.statusOf('l1')).toBe('ready')
      expect(store.byId('i1')?.checked).toBe(true)
      expect(storedOf(storage)).toEqual([['Milch', false]])

      outbox.answer({ kind: 'update', item: later(item('i1', 'Milch', 'l1', true), 2) })
      await flushPromises()

      expect(store.byId('i1')?.checked).toBe(true)
      expect(storedOf(storage)).toEqual([['Milch', true]])
    })
  })

  describe('removals', () => {
    // A loaded and stored list: Milch (checked), Brot (open), Eier (checked).
    async function loadedWithChecked() {
      const service = fakeService([
        item('i1', 'Milch', 'l1', true),
        item('i2', 'Brot'),
        item('i3', 'Eier', 'l1', true),
      ])
      const storage = fakeStorage()
      const { store, events, outbox } = setup(service, ANNA, storage)
      await store.load('l1')
      await flushPromises()
      return { service, store, events, storage, outbox }
    }

    it('keeps the items of a pending removal until it is committed', async () => {
      const { store, events, storage } = await loadedWithChecked()

      const removal = store.startRemovingChecked('l1')
      // Another change makes the store write while the items are hidden.
      events.emit(changed(later(item('i2', 'Brot'), 2, { name: 'Roggenbrot' })))
      await flushPromises()

      expect(names(store.itemsOf('l1'))).toEqual(['Roggenbrot'])
      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Roggenbrot', false],
        ['Eier', true],
      ])

      await removal?.commit()
      await flushPromises()

      expect(storedOf(storage)).toEqual([['Roggenbrot', false]])
    })

    it('keeps the items stored when the removal is undone', async () => {
      const { store, events, storage } = await loadedWithChecked()

      const removal = store.startRemovingChecked('l1')
      removal?.undo()
      events.emit(changed(later(item('i2', 'Brot'), 2, { name: 'Roggenbrot' })))
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Roggenbrot', false],
        ['Eier', true],
      ])
    })

    it('removes a single item from the storage once the server confirmed it', async () => {
      const { store, storage, outbox } = await loadedWithChecked()

      await store.startRemovingItem('i2')?.commit()
      await flushPromises()
      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Brot', false],
        ['Eier', true],
      ])

      outbox.answer({ kind: 'remove' })
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Eier', true],
      ])
    })

    it('removes an item from the storage that is gone when it is checked', async () => {
      const { store, storage, outbox } = await loadedWithChecked()

      await store.setChecked('i2', true)
      outbox.reject(new ApiError('ITEM_NOT_FOUND', 404))
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Eier', true],
      ])
    })
  })
})

describe('items store: real outbox integration', () => {
  function ramOutboxStorage(): OutboxStorage {
    let seq = 0
    let entries: { userId: string; entry: OutboxEntry }[] = []
    return {
      addOutbox(userId, change, queuedAt, hold) {
        const nextSeq = ++seq
        const entry: OutboxEntry = hold
          ? { seq: nextSeq, change, queuedAt, hold }
          : { seq: nextSeq, change, queuedAt }
        entries.push({ userId, entry })
        return Promise.resolve(nextSeq)
      },
      readOutbox(userId) {
        return Promise.resolve(entries.filter((e) => e.userId === userId).map((e) => e.entry))
      },
      removeOutbox(userId, targetSeq) {
        entries = entries.filter((e) => !(e.userId === userId && e.entry.seq === targetSeq))
        return Promise.resolve()
      },
    }
  }

  it('sends a create through the real outbox, shows it once and stores it', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const storage = fakeStorage()
    const outboxStorage = ramOutboxStorage()
    const store = defineItemsStore(service, () => ANNA, createFakeServerEvents(), storage, {
      openOutbox: (options) =>
        createOutbox({
          ...options,
          storage: outboxStorage,
          items: service,
          locks: (_, fn) => fn(),
        }),
      clock: createClock('tab', () => NOW),
      newId: () => 'new-1',
    })()

    try {
      await store.load('l1')
      await store.create('l1', { name: 'Käse' })
      await flushPromises()

      expect(service.create).toHaveBeenCalledWith('l1', {
        id: 'new-1',
        name: 'Käse',
        clock: formatHLC(NOW, 0, 'tab'),
      })
      expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Käse'])
      expect(store.byId('new-1')?.serverSeq).toBe(1)
      expect(names(storage.items.l1 ?? [])).toEqual(['Milch', 'Käse'])
    } finally {
      store.$dispose()
    }
  })

  it('rolls back and reports a 400 update through the real outbox', async () => {
    const service = fakeService([item('i1', 'Milch')])
    service.update.mockRejectedValueOnce(new ApiError('ITEM_NAME_INVALID', 400))
    const outboxStorage = ramOutboxStorage()
    const store = defineItemsStore(service, () => ANNA, createFakeServerEvents(), fakeStorage(), {
      openOutbox: (options) =>
        createOutbox({
          ...options,
          storage: outboxStorage,
          items: service,
          locks: (_, fn) => fn(),
        }),
      clock: createClock('tab', () => NOW),
    })()

    try {
      const rejections: ItemRejection[] = []
      store.onRejected((r) => rejections.push(r))
      await store.load('l1')

      await store.update('i1', { name: 'Bad' })
      await flushPromises()

      expect(store.byId('i1')?.name).toBe('Milch')
      expect(rejections).toEqual([{ kind: 'update', name: 'Milch', code: 'ITEM_NAME_INVALID' }])
    } finally {
      store.$dispose()
    }
  })
})
