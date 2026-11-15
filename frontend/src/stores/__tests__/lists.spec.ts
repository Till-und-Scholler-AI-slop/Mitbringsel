import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import type { ListsService } from '@/services/api/lists'
import { createFakeServerEvents } from '@/services/sync/__tests__/fakeServerEvents'
import type { List, ServerMessage } from '@/types/api'

import { defineListsStore } from '../lists'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'
const ARCHIVED_AT = '2026-02-01T10:00:00Z'
const CREATED_LATER = '2026-01-02T10:00:00Z'

function list(id: string, name: string, groupId = 'g1', archivedAt: string | null = null): List {
  return {
    id,
    groupId,
    name,
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

/**
 * A fake backend with the lists of each group; tests override single
 * functions. Like the real one, it answers archived lists only on request,
 * and the write calls answer the list as it is afterwards.
 */
function fakeService(
  initial: List[] = [],
): ListsService & { [K in keyof ListsService]: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn((groupId: string, { includeArchived }: { includeArchived: boolean }) =>
      Promise.resolve(
        initial.filter((l) => l.groupId === groupId && (includeArchived || l.archivedAt === null)),
      ),
    ),
    // Created later than the lists above, so it sorts after them.
    create: vi.fn((groupId: string, name: string) =>
      Promise.resolve({ ...list('l-new', name, groupId), createdAt: CREATED_LATER }),
    ),
    rename: vi.fn((id: string, name: string) =>
      Promise.resolve({ ...(initial.find((l) => l.id === id) ?? list(id, name)), name }),
    ),
    setArchived: vi.fn((id: string, archived: boolean) =>
      Promise.resolve({
        ...(initial.find((l) => l.id === id) ?? list(id, 'x')),
        archivedAt: archived ? ARCHIVED_AT : null,
      }),
    ),
    remove: vi.fn(() => Promise.resolve()),
  }
}

/**
 * The signed-in user as a ref, so tests can switch the user, the server
 * events, so tests can send them, and a spy in place of the items store.
 */
function setup(service: ListsService, userId: string | null = ANNA) {
  const user = ref(userId)
  const events = createFakeServerEvents()
  const forgetItems = vi.fn()
  const store = defineListsStore(service, () => user.value, events, forgetItems)()
  return { store, user, events, forgetItems }
}

// Messages as another member's change makes the server send them.
const changed = (changedList: List): ServerMessage => ({
  type: 'listChanged',
  payload: { actorId: BEN, list: changedList },
})
const deleted = (listId: string, groupId = 'g1'): ServerMessage => ({
  type: 'listDeleted',
  payload: { groupId, listId, actorId: BEN },
})
const removedFrom = (groupId: string): ServerMessage => ({
  type: 'groupRemoved',
  payload: { groupId, reason: 'removed', actorId: BEN },
})
const READY: ServerMessage = { type: 'ready' }

/** The same list as a later state of the server: a higher serverSeq and some changed fields. */
const later = (base: List, serverSeq: number, change: Partial<List> = {}): List => ({
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

const names = (lists: List[]) => lists.map((l) => l.name)

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('lists store: load', () => {
  it('knows nothing about a group before it is loaded', () => {
    const { store } = setup(fakeService())

    expect(store.statusOf('g1')).toBe('idle')
    expect(store.errorCodeOf('g1')).toBeNull()
    expect(store.listsOf('g1')).toEqual([])
    expect(store.activeLists('g1')).toEqual([])
    expect(store.archivedLists('g1')).toEqual([])
  })

  it('loads archived lists too and tells them apart', async () => {
    const service = fakeService([
      list('l1', 'Supermarkt'),
      list('l2', 'Baumarkt', 'g1', ARCHIVED_AT),
      list('l3', 'Drogerie'),
    ])
    const { store } = setup(service)

    await store.load('g1')

    expect(service.list).toHaveBeenCalledWith('g1', { includeArchived: true })
    expect(store.statusOf('g1')).toBe('ready')
    expect(names(store.listsOf('g1'))).toEqual(['Supermarkt', 'Baumarkt', 'Drogerie'])
    expect(names(store.activeLists('g1'))).toEqual(['Supermarkt', 'Drogerie'])
    expect(names(store.archivedLists('g1'))).toEqual(['Baumarkt'])
  })

  it('keeps the lists of each group apart', async () => {
    const { store } = setup(fakeService([list('l1', 'Eins'), list('l2', 'Zwei', 'g2')]))

    await store.load('g1')
    await store.load('g2')

    expect(names(store.listsOf('g1'))).toEqual(['Eins'])
    expect(names(store.listsOf('g2'))).toEqual(['Zwei'])
  })

  it('finds a list of any loaded group by its ID', async () => {
    const { store } = setup(fakeService([list('l1', 'Eins'), list('l2', 'Zwei', 'g2')]))
    await store.load('g1')
    await store.load('g2')

    expect(store.byId('l2')?.name).toBe('Zwei')
    expect(store.byId('unknown')).toBeUndefined()
  })

  it('reports the error code and keeps the lists from before', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    const { store } = setup(service)
    await store.load('g1')
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))

    await store.load('g1')

    expect(store.statusOf('g1')).toBe('error')
    expect(store.errorCodeOf('g1')).toBe('NETWORK')
    expect(store.listsOf('g1')).toHaveLength(1)
  })

  it('does not blame other groups for an error', async () => {
    const service = fakeService([list('l2', 'Zwei', 'g2')])
    const { store } = setup(service)
    await store.load('g2')
    service.list.mockRejectedValueOnce(new ApiError('LIST_NOT_FOUND', 404))

    await store.load('g1')

    expect(store.statusOf('g1')).toBe('error')
    expect(store.statusOf('g2')).toBe('ready')
  })

  it('uses UNKNOWN for errors that are not from the API', async () => {
    const service = fakeService()
    service.list.mockRejectedValueOnce(new Error('boom'))
    const { store } = setup(service)

    await store.load('g1')

    expect(store.errorCodeOf('g1')).toBe('UNKNOWN')
  })

  it('clears the error when a later load works', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { store } = setup(service)
    await store.load('g1')

    await store.load('g1')

    expect(store.statusOf('g1')).toBe('ready')
    expect(store.errorCodeOf('g1')).toBeNull()
  })
})

describe('lists store: reset', () => {
  it('forgets the lists when the user logs out', async () => {
    const { store, user } = setup(fakeService([list('l1', 'Supermarkt')]))
    await store.load('g1')

    user.value = null
    await Promise.resolve()

    expect(store.listsOf('g1')).toEqual([])
    expect(store.statusOf('g1')).toBe('idle')
  })

  it('forgets the lists when another user signs in', async () => {
    const { store, user } = setup(fakeService([list('l1', 'Supermarkt')]))
    await store.load('g1')

    user.value = BEN
    await Promise.resolve()

    expect(store.listsOf('g1')).toEqual([])
    expect(store.byId('l1')).toBeUndefined()
  })

  it('ignores a load that was still running at the reset', async () => {
    const service = fakeService()
    let answer: (lists: List[]) => void = () => undefined
    service.list.mockReturnValueOnce(new Promise<List[]>((resolve) => (answer = resolve)))
    const { store, user } = setup(service)

    const loading = store.load('g1')
    user.value = null
    await Promise.resolve()
    answer([list('l1', 'Old user')])
    await loading

    expect(store.listsOf('g1')).toEqual([])
    expect(store.statusOf('g1')).toBe('idle')
  })

  it('ignores a failing load that was still running at the reset', async () => {
    const service = fakeService()
    let fail: (err: Error) => void = () => undefined
    service.list.mockReturnValueOnce(new Promise<List[]>((_, reject) => (fail = reject)))
    const { store, user } = setup(service)

    const loading = store.load('g1')
    user.value = null
    await Promise.resolve()
    fail(new ApiError('NETWORK'))
    await loading

    expect(store.statusOf('g1')).toBe('idle')
    expect(store.errorCodeOf('g1')).toBeNull()
  })
})

describe('lists store: create', () => {
  it('adds a created list at the end and returns it', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    const { store } = setup(service)
    await store.load('g1')

    const created = await store.create('g1', 'Baumarkt')

    expect(service.create).toHaveBeenCalledWith('g1', 'Baumarkt')
    expect(created.id).toBe('l-new')
    expect(names(store.activeLists('g1'))).toEqual(['Supermarkt', 'Baumarkt'])
  })

  it('does not add a list when creating fails', async () => {
    const service = fakeService()
    service.create.mockRejectedValueOnce(new ApiError('LIST_NAME_INVALID', 400))
    const { store } = setup(service)

    await expect(store.create('g1', '')).rejects.toMatchObject({ code: 'LIST_NAME_INVALID' })
    expect(store.listsOf('g1')).toEqual([])
  })
})

describe('lists store: rename and archive', () => {
  it('takes the renamed list from the answer of the server', async () => {
    const { store } = setup(fakeService([list('l1', 'Supermarkt'), list('l2', 'Baumarkt')]))
    await store.load('g1')

    await store.rename('l2', 'Drogerie')

    expect(names(store.listsOf('g1'))).toEqual(['Supermarkt', 'Drogerie'])
  })

  it('keeps the name when renaming fails', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    service.rename.mockRejectedValueOnce(new ApiError('LIST_NAME_INVALID', 400))
    const { store } = setup(service)
    await store.load('g1')

    await expect(store.rename('l1', ' ')).rejects.toMatchObject({ code: 'LIST_NAME_INVALID' })
    expect(store.byId('l1')?.name).toBe('Supermarkt')
  })

  it('moves an archived list to the archive and back', async () => {
    const service = fakeService([list('l1', 'Supermarkt'), list('l2', 'Baumarkt')])
    const { store } = setup(service)
    await store.load('g1')

    await store.archive('l1')

    expect(service.setArchived).toHaveBeenLastCalledWith('l1', true)
    expect(names(store.activeLists('g1'))).toEqual(['Baumarkt'])
    expect(names(store.archivedLists('g1'))).toEqual(['Supermarkt'])

    await store.unarchive('l1')

    expect(service.setArchived).toHaveBeenLastCalledWith('l1', false)
    expect(names(store.activeLists('g1'))).toEqual(['Supermarkt', 'Baumarkt'])
    expect(store.archivedLists('g1')).toEqual([])
  })

  it('keeps the list active when archiving fails', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    service.setArchived.mockRejectedValueOnce(new ApiError('LIST_NOT_FOUND', 404))
    const { store } = setup(service)
    await store.load('g1')

    await expect(store.archive('l1')).rejects.toMatchObject({ code: 'LIST_NOT_FOUND' })
    expect(names(store.activeLists('g1'))).toEqual(['Supermarkt'])
  })
})

describe('lists store: remove', () => {
  it('drops a deleted list from its group only', async () => {
    const { store } = setup(
      fakeService([list('l1', 'Eins'), list('l2', 'Zwei'), list('l3', 'Drei', 'g2')]),
    )
    await store.load('g1')
    await store.load('g2')

    await store.remove('l1')

    expect(names(store.listsOf('g1'))).toEqual(['Zwei'])
    expect(names(store.listsOf('g2'))).toEqual(['Drei'])
  })

  it('keeps the list when deleting is refused', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    service.remove.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403))
    const { store } = setup(service)
    await store.load('g1')

    await expect(store.remove('l1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(names(store.listsOf('g1'))).toEqual(['Supermarkt'])
  })

  it('still asks the server about a list it does not know', async () => {
    const service = fakeService()
    const { store } = setup(service)

    await store.remove('unknown')

    expect(service.remove).toHaveBeenCalledWith('unknown')
  })
})

describe('lists store: own deletion and items', () => {
  it('tells the items store when it deletes a list', async () => {
    const { store, forgetItems } = setup(fakeService([list('l1', 'Supermarkt')]))
    await store.load('g1')

    await store.remove('l1')

    expect(forgetItems).toHaveBeenCalledWith('l1')
  })

  it('keeps the items when deleting is refused', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    service.remove.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403))
    const { store, forgetItems } = setup(service)
    await store.load('g1')

    await expect(store.remove('l1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(forgetItems).not.toHaveBeenCalled()
  })
})

describe('lists store: live events', () => {
  it('adds a list another member created, in the order of the server', async () => {
    const { store, events } = setup(fakeService([list('l1', 'Supermarkt'), list('l3', 'Drogerie')]))
    await store.load('g1')

    events.emit(changed(list('l2', 'Baumarkt')))

    expect(names(store.listsOf('g1'))).toEqual(['Supermarkt', 'Baumarkt', 'Drogerie'])
  })

  it('takes a rename or an archive with a greater serverSeq', async () => {
    const base = list('l1', 'Supermarkt')
    const { store, events } = setup(fakeService([base]))
    await store.load('g1')

    events.emit(changed(later(base, 2, { name: 'Wochenmarkt' })))
    events.emit(changed(later(base, 3, { name: 'Wochenmarkt', archivedAt: ARCHIVED_AT })))

    expect(store.activeLists('g1')).toEqual([])
    expect(names(store.archivedLists('g1'))).toEqual(['Wochenmarkt'])
  })

  it('drops an event that is not newer than what it has', async () => {
    const base = list('l1', 'Supermarkt')
    const { store, events } = setup(fakeService([base]))
    await store.load('g1')
    events.emit(changed(later(base, 3, { name: 'Neu' })))

    events.emit(changed(later(base, 2, { name: 'Älter' })))
    events.emit(changed(later(base, 3, { name: 'Gleich' })))

    expect(store.byId('l1')?.name).toBe('Neu')
  })

  it('drops events for a group it has not loaded', () => {
    const { store, events } = setup(fakeService())

    events.emit(changed(list('l1', 'Supermarkt')))

    expect(store.listsOf('g1')).toEqual([])
    expect(store.statusOf('g1')).toBe('idle')
  })

  it('shows its own new list once, when the event comes before the answer', async () => {
    const service = fakeService()
    const answer = deferred<List>()
    service.create.mockReturnValueOnce(answer.promise)
    const { store, events } = setup(service)
    await store.load('g1')

    const creating = store.create('g1', 'Baumarkt')
    events.emit(changed(list('l-new', 'Baumarkt')))
    answer.resolve(list('l-new', 'Baumarkt'))
    await creating

    expect(names(store.listsOf('g1'))).toEqual(['Baumarkt'])
  })

  it('shows its own new list once, when the event comes after the answer', async () => {
    const { store, events } = setup(fakeService())
    await store.load('g1')

    const created = await store.create('g1', 'Baumarkt')
    events.emit(changed(created))

    expect(names(store.listsOf('g1'))).toEqual(['Baumarkt'])
  })

  it('keeps a newer event when the answer to its own rename comes late', async () => {
    const base = list('l1', 'Supermarkt')
    const service = fakeService([base])
    const answer = deferred<List>()
    service.rename.mockReturnValueOnce(answer.promise)
    const { store, events } = setup(service)
    await store.load('g1')

    const renaming = store.rename('l1', 'Mein Name')
    events.emit(changed(later(base, 3, { name: 'Name von Ben' })))
    answer.resolve(later(base, 2, { name: 'Mein Name' }))
    await renaming

    expect(store.byId('l1')?.name).toBe('Name von Ben')
  })

  it('drops a list another member deleted and its items', async () => {
    const { store, events, forgetItems } = setup(
      fakeService([list('l1', 'Eins'), list('l2', 'Zwei'), list('l3', 'Drei', 'g2')]),
    )
    await store.load('g1')
    await store.load('g2')

    events.emit(deleted('l1'))

    expect(names(store.listsOf('g1'))).toEqual(['Zwei'])
    expect(names(store.listsOf('g2'))).toEqual(['Drei'])
    expect(forgetItems).toHaveBeenCalledWith('l1')
  })

  it('does not bring a deleted list back with a late change', async () => {
    const base = list('l1', 'Supermarkt')
    const { store, events } = setup(fakeService([base]))
    await store.load('g1')

    events.emit(deleted('l1'))
    events.emit(changed(later(base, 5, { name: 'Zu spät' })))

    expect(store.listsOf('g1')).toEqual([])
  })

  it('forgets a group it was removed from, with the items of its lists', async () => {
    const { store, events, forgetItems } = setup(
      fakeService([list('l1', 'Eins'), list('l2', 'Zwei'), list('l3', 'Drei', 'g2')]),
    )
    await store.load('g1')
    await store.load('g2')

    events.emit(removedFrom('g1'))

    expect(store.listsOf('g1')).toEqual([])
    expect(store.statusOf('g1')).toBe('idle')
    expect(forgetItems.mock.calls.map(([listId]) => listId)).toEqual(['l1', 'l2'])
    expect(names(store.listsOf('g2'))).toEqual(['Drei'])
  })

  it('shows the lists again after being invited back', async () => {
    const { store, events } = setup(fakeService([list('l1', 'Eins')]))
    await store.load('g1')
    events.emit(removedFrom('g1'))

    await store.load('g1')

    expect(names(store.listsOf('g1'))).toEqual(['Eins'])
  })

  it('ignores groupRemoved for a group it has not loaded', () => {
    const { store, events, forgetItems } = setup(fakeService())

    events.emit(removedFrom('g1'))

    expect(store.statusOf('g1')).toBe('idle')
    expect(forgetItems).not.toHaveBeenCalled()
  })

  it('stops listening when the store is disposed', () => {
    const { store, events } = setup(fakeService())

    store.$dispose()

    expect(events.count('listChanged')).toBe(0)
    expect(events.count('listDeleted')).toBe(0)
    expect(events.count('groupRemoved')).toBe(0)
    expect(events.count('ready')).toBe(0)
  })
})

describe('lists store: load merge', () => {
  it('drops a list the answer no longer has, with its items', async () => {
    const service = fakeService([list('l1', 'Eins'), list('l2', 'Zwei')])
    const { store, forgetItems } = setup(service)
    await store.load('g1')
    service.list.mockResolvedValueOnce([list('l1', 'Eins')])

    await store.load('g1')

    expect(names(store.listsOf('g1'))).toEqual(['Eins'])
    expect(forgetItems).toHaveBeenCalledWith('l2')
  })

  it('keeps a list that came by event while the load was on its way', async () => {
    const service = fakeService()
    const answer = deferred<List[]>()
    const { store, events } = setup(service)
    await store.load('g1')
    service.list.mockReturnValueOnce(answer.promise)

    const loading = store.load('g1')
    events.emit(changed(list('l1', 'Neu')))
    answer.resolve([])
    await loading

    expect(names(store.listsOf('g1'))).toEqual(['Neu'])
  })

  it('keeps a state that is newer than the answer', async () => {
    const base = list('l1', 'Supermarkt')
    const service = fakeService([base])
    const answer = deferred<List[]>()
    const { store, events } = setup(service)
    await store.load('g1')
    service.list.mockReturnValueOnce(answer.promise)

    const loading = store.load('g1')
    events.emit(changed(later(base, 3, { name: 'Neu' })))
    answer.resolve([later(base, 2, { name: 'Alt' })])
    await loading

    expect(store.byId('l1')?.name).toBe('Neu')
  })

  it('does not bring back a list deleted while the load was on its way', async () => {
    const service = fakeService([list('l1', 'Eins')])
    const answer = deferred<List[]>()
    const { store, events } = setup(service)
    await store.load('g1')
    service.list.mockReturnValueOnce(answer.promise)

    const loading = store.load('g1')
    events.emit(deleted('l1'))
    answer.resolve([list('l1', 'Eins')])
    await loading

    expect(store.listsOf('g1')).toEqual([])
  })

  it('drops the answer of a load that started before an applied one', async () => {
    const service = fakeService()
    const first = deferred<List[]>()
    service.list.mockReturnValueOnce(first.promise)
    service.list.mockResolvedValueOnce([list('l1', 'Eins')])
    const { store } = setup(service)

    const firstLoad = store.load('g1')
    await store.load('g1')
    first.resolve([])
    await firstLoad

    expect(names(store.listsOf('g1'))).toEqual(['Eins'])
  })
})

describe('lists store: ready', () => {
  it('reloads every loaded group after ready', async () => {
    const service = fakeService([list('l1', 'Eins'), list('l2', 'Zwei', 'g2')])
    const { store, events } = setup(service)
    await store.load('g1')
    await store.load('g2')
    service.list.mockClear()
    service.list.mockResolvedValueOnce([list('l1', 'Eins'), list('l3', 'Drei')])

    events.emit(READY)
    await flushPromises()

    expect(service.list.mock.calls.map(([groupId]) => groupId).sort()).toEqual(['g1', 'g2'])
    expect(names(store.listsOf('g1'))).toEqual(['Eins', 'Drei'])
  })

  it('does nothing on ready before any group was loaded', () => {
    const service = fakeService()
    const { events } = setup(service)

    events.emit(READY)

    expect(service.list).not.toHaveBeenCalled()
  })

  it('does not load a group that only got a list from a create', async () => {
    const service = fakeService()
    const { store, events } = setup(service)
    await store.create('g1', 'Baumarkt')

    events.emit(READY)

    expect(service.list).not.toHaveBeenCalled()
    expect(store.statusOf('g1')).toBe('idle')
  })

  it('shows no spinner while it reloads', async () => {
    const service = fakeService([list('l1', 'Eins')])
    const { store, events } = setup(service)
    await store.load('g1')
    service.list.mockReturnValueOnce(new Promise(() => undefined))

    events.emit(READY)

    expect(store.statusOf('g1')).toBe('ready')
  })

  it('keeps the lists and reports the error when the reload fails', async () => {
    const service = fakeService([list('l1', 'Eins')])
    const { store, events } = setup(service)
    await store.load('g1')
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))

    events.emit(READY)
    await flushPromises()

    expect(store.statusOf('g1')).toBe('error')
    expect(names(store.listsOf('g1'))).toEqual(['Eins'])
  })
})

describe('lists store: deletions', () => {
  it('remembers when another member deletes a list, and keeps self on own delete', async () => {
    const service = fakeService([list('l1', 'Supermarkt'), list('l2', 'Baumarkt')])
    const { store, events } = setup(service)
    await store.load('g1')

    expect(store.deletionOf('l1')).toBeUndefined()

    events.emit(deleted('l1'))
    expect(store.deletionOf('l1')).toEqual({ name: 'Supermarkt', cause: 'deleted' })

    await store.remove('l2')
    events.emit({ type: 'listDeleted', payload: { groupId: 'g1', listId: 'l2', actorId: ANNA } })
    expect(store.deletionOf('l2')).toEqual({ name: 'Baumarkt', cause: 'self' })
  })

  it('marks a list deleted by our own listDeleted event before remove settles as self', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    const removing = deferred<void>()
    service.remove.mockReturnValueOnce(removing.promise)
    const { store, events } = setup(service)
    await store.load('g1')

    const call = store.remove('l1')
    events.emit({ type: 'listDeleted', payload: { groupId: 'g1', listId: 'l1', actorId: ANNA } })
    removing.resolve(undefined)
    await call

    expect(store.deletionOf('l1')).toEqual({ name: 'Supermarkt', cause: 'self' })
  })

  it('treats a listDeleted event of the same user from another device or tab as deleted', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    const { store, events } = setup(service)
    await store.load('g1')

    events.emit({ type: 'listDeleted', payload: { groupId: 'g1', listId: 'l1', actorId: ANNA } })

    expect(store.deletionOf('l1')).toEqual({ name: 'Supermarkt', cause: 'deleted' })
  })

  it('remembers a list missing after reload as unknown and forgets deletions on user change', async () => {
    const service = fakeService([list('l1', 'Supermarkt')])
    const { store, user } = setup(service)
    await store.load('g1')
    service.list.mockResolvedValueOnce([])

    await store.load('g1')
    expect(store.deletionOf('l1')).toEqual({ name: 'Supermarkt', cause: 'unknown' })

    user.value = null
    await flushPromises()
    expect(store.deletionOf('l1')).toBeUndefined()
  })
})
