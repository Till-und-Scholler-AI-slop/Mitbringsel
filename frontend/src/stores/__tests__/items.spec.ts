import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import { createFakeServerEvents } from '@/services/sync/__tests__/fakeServerEvents'
import { MAX_REMOVE_CHECKED } from '@/services/api/items'
import type { GroupItemList, Item, ServerMessage } from '@/types/api'

import { defineItemsStore, type ItemsLocal } from '../items'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'
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
    create: vi.fn((listId: string, request: { name: string }) =>
      Promise.resolve({ ...item('i-new', request.name, listId), createdAt: CREATED_LATER }),
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
 * events, so tests can send them, and the storage of the device.
 */
function setup(
  service: ItemsService,
  userId: string | null = ANNA,
  storage: ItemsLocal = fakeStorage(),
) {
  const user = ref(userId)
  const events = createFakeServerEvents()
  const store = defineItemsStore(service, () => user.value, events, storage)()
  return { store, user, events }
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

  it('does not bring back a check that was still running at the reset', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store, user } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    user.value = null
    await Promise.resolve()
    answer.resolve(item('i1', 'Milch', 'l1', true))
    await checking

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
    const service = fakeService()
    const answer = deferred<Item>()
    service.create.mockReturnValueOnce(answer.promise)
    const { store, user } = setup(service)

    const creating = store.create('l1', { name: 'Brot' })
    user.value = null
    await Promise.resolve()
    answer.resolve(item('i1', 'Brot'))
    await creating

    expect(store.itemsOf('l1')).toEqual([])
    expect(store.statusOf('l1')).toBe('idle')
  })
})

describe('items store: create', () => {
  it('adds a created item in the order of the server and returns it', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store } = setup(service)
    await store.load('l1')

    const created = await store.create('l1', { name: 'Brot', quantity: 1, unit: 'pack' })

    expect(service.create).toHaveBeenCalledWith('l1', { name: 'Brot', quantity: 1, unit: 'pack' })
    expect(created.id).toBe('i-new')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('does not list an item twice when the server answers a repeated request', async () => {
    const service = fakeService([item('i1', 'Milch')])
    service.create.mockResolvedValue(item('i1', 'Milch'))
    const { store } = setup(service)
    await store.load('l1')

    await store.create('l1', { id: 'i1', name: 'Milch' })

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('puts a created item where the server would list it', async () => {
    const service = fakeService([
      item('i1', 'Milch'),
      { ...item('i3', 'Eier'), createdAt: '2026-01-01T12:00:00Z' },
    ])
    service.create.mockResolvedValue({ ...item('i2', 'Brot'), createdAt: '2026-01-01T11:00:00Z' })
    const { store } = setup(service)
    await store.load('l1')

    await store.create('l1', { name: 'Brot' })

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot', 'Eier'])
  })

  it('sorts by the moment, not by the text of the date', async () => {
    // The server drops trailing zeros of the fraction. As text, "…:00.5Z" sorts
    // before "…:00Z" ('.' comes before 'Z'), but it is half a second later.
    const service = fakeService([item('i1', 'Milch')])
    service.create.mockResolvedValue({ ...item('i2', 'Brot'), createdAt: '2026-01-01T10:00:00.5Z' })
    const { store } = setup(service)
    await store.load('l1')

    await store.create('l1', { name: 'Brot' })

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('does not add an item when creating fails', async () => {
    const service = fakeService()
    service.create.mockRejectedValueOnce(new ApiError('ITEM_NAME_INVALID', 400))
    const { store } = setup(service)

    await expect(store.create('l1', { name: '' })).rejects.toMatchObject({
      code: 'ITEM_NAME_INVALID',
    })
    expect(store.itemsOf('l1')).toEqual([])
  })
})

describe('items store: update', () => {
  it('takes the changed item from the answer of the server', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
    const { store } = setup(service)
    await store.load('l1')

    await store.update('i2', { name: 'Vollkornbrot', quantity: 2 })

    expect(service.update).toHaveBeenCalledWith('i2', { name: 'Vollkornbrot', quantity: 2 })
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Vollkornbrot'])
    expect(store.byId('i2')?.quantity).toBe(2)
  })

  it('shows nothing early: the item stays until the server answers', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const updating = store.update('i1', { name: 'Hafermilch' })
    await Promise.resolve()

    expect(store.byId('i1')?.name).toBe('Milch')
    answer.resolve(item('i1', 'Hafermilch'))
    await updating
    expect(store.byId('i1')?.name).toBe('Hafermilch')
  })

  it('keeps the item when updating fails', async () => {
    const service = fakeService([item('i1', 'Milch')])
    service.update.mockRejectedValueOnce(new ApiError('ITEM_NAME_INVALID', 400))
    const { store } = setup(service)
    await store.load('l1')

    await expect(store.update('i1', { name: ' ' })).rejects.toMatchObject({
      code: 'ITEM_NAME_INVALID',
    })
    expect(store.byId('i1')?.name).toBe('Milch')
  })
})

describe('items store: setChecked', () => {
  it('checks at once, before the server answers', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)

    expect(service.update).toHaveBeenCalledWith('i1', { checked: true })
    expect(store.byId('i1')?.checked).toBe(true)
    expect(store.byId('i1')?.checkedBy).toBe(ANNA)
    expect(store.byId('i1')?.checkedAt).not.toBeNull()
    expect(names(store.checkedItems('l1'))).toEqual(['Milch'])

    answer.resolve(item('i1', 'Milch', 'l1', true))
    await checking
  })

  it('takes who and when from the answer of the server', async () => {
    const { store } = setup(fakeService([item('i1', 'Milch')]))
    await store.load('l1')

    await store.setChecked('i1', true)

    expect(store.byId('i1')?.checkedBy).toBe(ANNA)
    expect(store.byId('i1')?.checkedAt).toBe(CHECKED_AT)
  })

  it('unchecks at once and clears who and when', async () => {
    const service = fakeService([item('i1', 'Milch', 'l1', true)])
    const answer = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const unchecking = store.setChecked('i1', false)

    expect(store.byId('i1')).toMatchObject({ checked: false, checkedBy: null, checkedAt: null })
    expect(names(store.openItems('l1'))).toEqual(['Milch'])

    answer.resolve(item('i1', 'Milch'))
    await unchecking
  })

  it('puts the old state back and throws when the request fails', async () => {
    const service = fakeService([item('i1', 'Milch', 'l1', true)])
    service.update.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { store } = setup(service)
    await store.load('l1')

    await expect(store.setChecked('i1', false)).rejects.toMatchObject({ code: 'NETWORK' })

    expect(store.byId('i1')).toMatchObject({
      checked: true,
      checkedBy: BEN,
      checkedAt: CHECKED_AT,
    })
  })

  it('lets the last tap win when the answers come in a different order', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const first = deferred<Item>()
    const second = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const checking = store.setChecked('i1', true)
    const unchecking = store.setChecked('i1', false)
    expect(store.byId('i1')?.checked).toBe(false)

    // The late answer to the first tap must not check the item again.
    second.resolve(item('i1', 'Milch'))
    await unchecking
    first.resolve(item('i1', 'Milch', 'l1', true))
    await checking

    expect(store.byId('i1')?.checked).toBe(false)
  })

  it('does not roll back an older tap that fails after a newer one', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const first = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(first.promise)

    const checking = store.setChecked('i1', true)
    const unchecking = store.setChecked('i1', false)
    first.reject(new ApiError('NETWORK'))

    // The first tap still reports its error to the caller ...
    await expect(checking).rejects.toMatchObject({ code: 'NETWORK' })
    await unchecking
    // ... but the state belongs to the newest tap.
    expect(store.byId('i1')?.checked).toBe(false)
  })

  it('does not roll back onto an item that a reload has replaced', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    service.list.mockResolvedValueOnce([item('i1', 'Milch', 'l1', true)])
    await store.load('l1')
    answer.reject(new ApiError('NETWORK'))
    await expect(checking).rejects.toBeInstanceOf(ApiError)

    // The reload holds fresher data from the server than the state before the tap.
    expect(store.byId('i1')?.checked).toBe(true)
  })

  it('still sends the change for an item it does not know', async () => {
    const service = fakeService()
    const { store } = setup(service)

    await store.setChecked('unknown', true)

    expect(service.update).toHaveBeenCalledWith('unknown', { checked: true })
  })
})

describe('items store: remove', () => {
  it('drops a deleted item from its list only', async () => {
    const { store } = setup(
      fakeService([item('i1', 'Milch'), item('i2', 'Brot'), item('i3', 'Nägel', 'l2')]),
    )
    await store.load('l1')
    await store.load('l2')

    await store.remove('i1')

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
    expect(names(store.itemsOf('l2'))).toEqual(['Nägel'])
  })

  it('keeps the item when deleting fails', async () => {
    const service = fakeService([item('i1', 'Milch')])
    service.remove.mockRejectedValueOnce(new ApiError('ITEM_NOT_FOUND', 404))
    const { store } = setup(service)
    await store.load('l1')

    await expect(store.remove('i1')).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('still asks the server about an item it does not know', async () => {
    const service = fakeService()
    const { store } = setup(service)

    await store.remove('unknown')

    expect(service.remove).toHaveBeenCalledWith('unknown')
  })
})

describe('items store: load merge', () => {
  it('keeps an item that changed while the list was loading', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    service.update.mockResolvedValueOnce(later(item('i1', 'Hafermilch'), 3))
    const { store } = setup(service)

    const loading = store.load('l1')
    await store.update('i1', { name: 'Hafermilch' })
    answer.resolve([item('i1', 'Milch')])
    await loading

    expect(names(store.itemsOf('l1'))).toEqual(['Hafermilch'])
  })

  it('keeps an item that was created while the list was loading', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store } = setup(service)

    const loading = store.load('l1')
    await store.create('l1', { name: 'Brot' })
    answer.resolve([item('i1', 'Milch')])
    await loading

    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('drops an item the server no longer has and does not bring it back', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
    const { store } = setup(service)
    await store.load('l1')
    service.list.mockResolvedValueOnce([item('i1', 'Milch')])

    await store.load('l1')
    // A late answer to a change of the dropped item must not list it again.
    service.update.mockResolvedValueOnce(later(item('i2', 'Brot'), 5))
    await store.update('i2', { name: 'Brot' })

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('does not put back an item deleted while the list was loading', async () => {
    const service = fakeService()
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)
    const { store } = setup(service)

    const loading = store.load('l1')
    await store.remove('i1')
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
    const answer = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const updating = store.update('i1', { name: 'Hafermilch' })
    service.list.mockResolvedValueOnce([later(item('i1', 'Milch'), 3, { name: 'Sojamilch' })])
    await store.load('l1')
    answer.resolve(later(item('i1', 'Milch'), 2, { name: 'Hafermilch' }))
    await updating

    expect(store.byId('i1')?.name).toBe('Sojamilch')
  })

  it('does not bring back an item after remove when an older reload arrives', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
    const { store } = setup(service)
    await store.load('l1')
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)

    const reloading = store.load('l1')
    await store.remove('i1')
    answer.resolve([item('i1', 'Milch'), item('i2', 'Brot')])
    await reloading

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })
})

describe('items store: checking while the server changes', () => {
  it('keeps the own check while it is pending and takes the other fields of a reload', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    service.list.mockResolvedValueOnce([later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })])
    await store.load('l1')

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true, checkedBy: ANNA })
    answer.resolve(later(item('i1', 'Hafermilch', 'l1', true), 3))
    await checking
    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true, serverSeq: 3 })
  })

  it('takes the newest state of the server when a pending check fails', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    service.list.mockResolvedValueOnce([later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })])
    await store.load('l1')
    answer.reject(new ApiError('NETWORK'))
    await expect(checking).rejects.toMatchObject({ code: 'NETWORK' })

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: false, checkedBy: null })
  })

  it('does not report a failed check of an item deleted meanwhile', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
    service.update.mockRejectedValueOnce(new ApiError('ITEM_NOT_FOUND', 404))
    const { store } = setup(service)
    await store.load('l1')

    await expect(store.setChecked('i1', true)).resolves.toBeUndefined()

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('does not bring back an item that turned out to be deleted when it is reloaded late', async () => {
    const service = fakeService([item('i1', 'Milch')])
    service.update.mockRejectedValueOnce(new ApiError('ITEM_NOT_FOUND', 404))
    const { store } = setup(service)
    await store.load('l1')
    const answer = deferred<Item[]>()
    service.list.mockReturnValueOnce(answer.promise)

    const reloading = store.load('l1')
    await store.setChecked('i1', true)
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
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store, events } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Hafermilch', quantity: 2 })))

    expect(store.byId('i1')).toMatchObject({
      name: 'Hafermilch',
      quantity: 2,
      checked: true,
      checkedBy: ANNA,
    })
    answer.resolve(later(item('i1', 'Hafermilch', 'l1', true), 3))
    await checking
  })

  it('takes the newest state when a pending check settles', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store, events } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    // Another member renamed the item after our change was stored, and the
    // event comes before the answer to our request.
    events.emit(changed(later(item('i1', 'Hafermilch', 'l1', true), 5)))
    answer.resolve(later(item('i1', 'Milch', 'l1', true), 3))
    await checking

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true, serverSeq: 5 })
  })

  it('falls back to the newest server state when a pending check fails', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store, events } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })))
    answer.reject(new ApiError('NETWORK'))
    await expect(checking).rejects.toMatchObject({ code: 'NETWORK' })

    expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: false, checkedBy: null })
  })

  it('does not report a failed check of an item deleted meanwhile', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
    const answer = deferred<Item>()
    const { store, events } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    events.emit(deleted('l1', 'i1', 3))
    answer.reject(new ApiError('ITEM_NOT_FOUND', 404))

    await expect(checking).resolves.toBeUndefined()
    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('does not bring back an item that was deleted while its check succeeded', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store, events } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const checking = store.setChecked('i1', true)
    events.emit(deleted('l1', 'i1', 4))
    answer.resolve(later(item('i1', 'Milch', 'l1', true), 3))
    await checking

    expect(store.itemsOf('l1')).toEqual([])
  })

  it('does not list an item twice when the event arrives before the answer of create', async () => {
    const service = fakeService()
    const answer = deferred<Item>()
    service.create.mockReturnValueOnce(answer.promise)
    const { store, events } = setup(service)
    await store.load('l1')

    const creating = store.create('l1', { id: 'i1', name: 'Milch' })
    events.emit(changed(later(item('i1', 'Milch'), 2)))
    answer.resolve(later(item('i1', 'Milch'), 2))
    await creating

    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('keeps a newer change from an event over the answer of update', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const answer = deferred<Item>()
    const { store, events } = setup(service)
    await store.load('l1')
    service.update.mockReturnValueOnce(answer.promise)

    const updating = store.update('i1', { name: 'Hafermilch' })
    events.emit(changed(later(item('i1', 'Milch'), 3, { name: 'Sojamilch' })))
    answer.resolve(later(item('i1', 'Milch'), 2, { name: 'Hafermilch' }))
    await updating

    expect(store.byId('i1')?.name).toBe('Sojamilch')
  })

  it('does not bring back an item after remove when its echo arrives', async () => {
    const { store, events } = setup(fakeService([item('i1', 'Milch'), item('i2', 'Brot')]))
    await store.load('l1')

    await store.remove('i1')
    events.emit(changed(later(item('i1', 'Milch'), 9)))

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
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
    const { store } = setup(service)
    await store.create('l1', { name: 'Brot' })

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

  it('hides the item at once, open or checked, and sends nothing yet', async () => {
    const service = fakeService(shopping())
    const { store } = setup(service)
    await store.load('l1')

    const first = store.startRemovingItem('i1')
    store.startRemovingItem('i2')

    expect(names(first?.items ?? [])).toEqual(['Milch'])
    expect(store.itemsOf('l1')).toEqual([])
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('answers null for an item it does not show', async () => {
    const { store } = setup(fakeService(shopping()))
    await store.load('l1')
    store.startRemovingItem('i1')

    expect(store.startRemovingItem('i1')).toBeNull()
    expect(store.startRemovingItem('unknown')).toBeNull()
  })

  it('deletes the item for good on commit', async () => {
    const service = fakeService(shopping())
    const { store, events } = setup(service)
    await store.load('l1')

    await store.startRemovingItem('i1')?.commit()
    events.emit(changed(later(item('i1', 'Hafermilch'), 20)))

    expect(service.remove).toHaveBeenCalledWith('i1')
    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
    expect(store.byId('i1')).toBeUndefined()
  })

  it('keeps the item hidden whatever others change meanwhile', async () => {
    const { store, events } = setup(fakeService(shopping()))
    await store.load('l1')

    store.startRemovingItem('i1')
    events.emit(changed(later(item('i1', 'Milch', 'l1', true), 2)))

    expect(store.checkedItems('l1').map((i) => i.id)).toEqual(['i2'])
  })

  it('shows the item again on undo and sends nothing', async () => {
    const service = fakeService(shopping())
    const { store } = setup(service)
    await store.load('l1')

    store.startRemovingItem('i1')?.undo()

    expect(names(store.openItems('l1'))).toEqual(['Milch'])
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('counts an item someone else deleted meanwhile as deleted', async () => {
    const service = fakeService(shopping())
    service.remove.mockRejectedValueOnce(new ApiError('ITEM_NOT_FOUND', 404))
    const { store } = setup(service)
    await store.load('l1')

    await store.startRemovingItem('i1')?.commit()

    expect(names(store.itemsOf('l1'))).toEqual(['Brot'])
  })

  it('shows the item again and throws if the request fails', async () => {
    const service = fakeService(shopping())
    service.remove.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { store } = setup(service)
    await store.load('l1')

    await expect(store.startRemovingItem('i1')?.commit()).rejects.toThrow(ApiError)

    expect(names(store.openItems('l1'))).toEqual(['Milch'])
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
    const { store, events } = setup(service, ANNA, storage)

    await store.load('l1')
    await flushPromises()
    expect(storage.writeItems).toHaveBeenCalledWith(ANNA, 'l1', expect.anything())
    expect(names(storage.items.l1 ?? [])).toEqual(['Milch', 'Brot', 'Eier'])

    await store.create('l1', { name: 'Käse' })
    await flushPromises()
    expect(names(storage.items.l1 ?? [])).toEqual(['Milch', 'Brot', 'Eier', 'Käse'])

    await store.update('i1', { name: 'Hafermilch' })
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
    const { store } = setup(service, ANNA, storage)

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
    await flushPromises()

    expect(storage.writeItems).not.toHaveBeenCalled()
  })

  it('writes nothing before the stored items were read', async () => {
    const service = fakeService()
    service.list.mockReturnValueOnce(deferred<Item[]>().promise)
    const storage = fakeStorage()
    storage.readItems.mockReturnValueOnce(deferred<Item[] | null>().promise)
    const { store } = setup(service, ANNA, storage)

    void store.load('l1')
    await store.create('l1', { name: 'Käse' })
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

  describe('a tap that waits for the server', () => {
    // A loaded and stored list with two items; the next update() waits for
    // the test to answer.
    async function loadedWithPendingTap() {
      const service = fakeService([item('i1', 'Milch'), item('i2', 'Brot')])
      const storage = fakeStorage()
      const { store, events } = setup(service, ANNA, storage)
      await store.load('l1')
      await flushPromises()
      const answer = deferred<Item>()
      service.update.mockReturnValueOnce(answer.promise)
      const checking = store.setChecked('i1', true)
      return { store, events, storage, answer, checking }
    }

    it('is not stored until the server confirmed it', async () => {
      const { store, events, storage, answer, checking } = await loadedWithPendingTap()

      // Another change makes the store write while the tap is waiting.
      events.emit(changed(later(item('i2', 'Brot'), 2, { name: 'Roggenbrot' })))
      await flushPromises()

      expect(store.byId('i1')?.checked).toBe(true)
      expect(storedOf(storage)).toEqual([
        ['Milch', false],
        ['Roggenbrot', false],
      ])

      answer.resolve(later(item('i1', 'Milch', 'l1', true), 2))
      await checking
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Roggenbrot', false],
      ])
    })

    it('is never stored when the server refuses it', async () => {
      const { events, storage, answer, checking } = await loadedWithPendingTap()
      events.emit(changed(later(item('i2', 'Brot'), 2, { name: 'Roggenbrot' })))
      await flushPromises()
      expect(storage.writes.length).toBeGreaterThan(0)

      answer.reject(new ApiError('NETWORK'))
      await expect(checking).rejects.toBeInstanceOf(ApiError)
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', false],
        ['Roggenbrot', false],
      ])
      for (const written of storage.writes) {
        expect(written.every((stored) => !stored.checked)).toBe(true)
      }
    })

    it('stores the new fields of an event but not the tap', async () => {
      const { store, events, storage, answer, checking } = await loadedWithPendingTap()

      events.emit(changed(later(item('i1', 'Milch'), 2, { name: 'Hafermilch' })))
      await flushPromises()

      // On screen the new name and the tap, on the device the new name only.
      expect(store.byId('i1')).toMatchObject({ name: 'Hafermilch', checked: true })
      expect(storedOf(storage)).toEqual([
        ['Hafermilch', false],
        ['Brot', false],
      ])

      answer.resolve(later(item('i1', 'Hafermilch', 'l1', true), 3))
      await checking
    })

    it('stays visible when the answer of a load arrives after a tap on a stored item', async () => {
      const service = fakeService()
      const request = deferred<Item[]>()
      service.list.mockReturnValueOnce(request.promise)
      const tapAnswer = deferred<Item>()
      service.update.mockReturnValueOnce(tapAnswer.promise)
      const storage = fakeStorage({ l1: [item('i1', 'Milch')] })
      const { store } = setup(service, ANNA, storage)

      void store.load('l1')
      await flushPromises()
      const checking = store.setChecked('i1', true)
      request.resolve([item('i1', 'Milch')])
      await flushPromises()

      expect(store.statusOf('l1')).toBe('ready')
      expect(store.byId('i1')?.checked).toBe(true)
      expect(storedOf(storage)).toEqual([['Milch', false]])

      tapAnswer.resolve(later(item('i1', 'Milch', 'l1', true), 2))
      await checking
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
      const { store, events } = setup(service, ANNA, storage)
      await store.load('l1')
      await flushPromises()
      return { service, store, events, storage }
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

    it('removes a single item from the storage when it is committed', async () => {
      const { store, storage } = await loadedWithChecked()

      await store.startRemovingItem('i2')?.commit()
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Eier', true],
      ])
    })

    it('removes an item from the storage that is gone when it is checked', async () => {
      const { service, store, storage } = await loadedWithChecked()
      service.update.mockRejectedValueOnce(new ApiError('ITEM_NOT_FOUND', 404))

      await store.setChecked('i2', true)
      await flushPromises()

      expect(storedOf(storage)).toEqual([
        ['Milch', true],
        ['Eier', true],
      ])
    })
  })
})
