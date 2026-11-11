import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import { createFakeServerEvents } from '@/services/sync/__tests__/fakeServerEvents'
import type { Item, ServerMessage } from '@/types/api'

import { defineItemsStore } from '../items'

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
  }
}

/**
 * The signed-in user as a ref, so tests can switch the user, and the server
 * events, so tests can send them.
 */
function setup(service: ItemsService, userId: string | null = ANNA) {
  const user = ref(userId)
  const events = createFakeServerEvents()
  const store = defineItemsStore(service, () => user.value, events)()
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
const READY: ServerMessage = { type: 'ready' }

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

    for (const type of ['itemChanged', 'itemDeleted', 'itemsDeleted', 'ready'] as const) {
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

describe('items store: ready', () => {
  it('reloads every loaded list after ready', async () => {
    const service = fakeService([item('i1', 'Milch'), item('i2', 'Nägel', 'l2')])
    const { store, events } = setup(service)
    await store.load('l1')
    await store.load('l2')
    service.list.mockClear()
    service.list.mockResolvedValueOnce([item('i1', 'Milch'), item('i3', 'Brot')])

    events.emit(READY)
    await flushPromises()

    expect(service.list.mock.calls.map(([listId]) => listId).sort()).toEqual(['l1', 'l2'])
    expect(names(store.itemsOf('l1'))).toEqual(['Milch', 'Brot'])
  })

  it('shows no spinner while it reloads', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const { store, events } = setup(service)
    await store.load('l1')
    service.list.mockReturnValueOnce(new Promise(() => undefined))

    events.emit(READY)

    expect(store.statusOf('l1')).toBe('ready')
  })

  it('does nothing on ready before any list was loaded', () => {
    const service = fakeService()
    const { events } = setup(service)

    events.emit(READY)

    expect(service.list).not.toHaveBeenCalled()
  })

  it('does not load a list that only got an item from a create', async () => {
    const service = fakeService()
    const { store, events } = setup(service)
    await store.create('l1', { name: 'Brot' })

    events.emit(READY)

    expect(service.list).not.toHaveBeenCalled()
    expect(store.statusOf('l1')).toBe('idle')
  })

  it('reloads a list that was still loading when ready came', async () => {
    const service = fakeService([item('i1', 'Milch')])
    const first = deferred<Item[]>()
    service.list.mockReturnValueOnce(first.promise)
    const { store, events } = setup(service)

    const loading = store.load('l1')
    events.emit(READY)
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
    const { store, events } = setup(service)
    await store.load('l1')
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))

    events.emit(READY)
    await flushPromises()

    expect(store.statusOf('l1')).toBe('error')
    expect(store.errorCodeOf('l1')).toBe('NETWORK')
    expect(names(store.itemsOf('l1'))).toEqual(['Milch'])
  })
})
