import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import type { ListsService } from '@/services/api/lists'
import type { List } from '@/types/api'

import { defineListsStore } from '../lists'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'
const ARCHIVED_AT = '2026-02-01T10:00:00Z'

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
        initial.filter(
          (l) => l.groupId === groupId && (includeArchived || l.archivedAt === null),
        ),
      ),
    ),
    create: vi.fn((groupId: string, name: string) => Promise.resolve(list('l-new', name, groupId))),
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

/** The signed-in user as a ref, so tests can switch the user. */
function setup(service: ListsService, userId: string | null = ANNA) {
  const user = ref(userId)
  const store = defineListsStore(service, () => user.value)()
  return { store, user }
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
