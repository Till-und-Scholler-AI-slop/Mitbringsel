import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import { createFakeServerEvents } from '@/services/sync/__tests__/fakeServerEvents'
import type { Group, GroupMember, Role, ServerMessage } from '@/types/api'

import { defineGroupsStore, type GroupsLocal } from '../groups'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'

function member(userId: string, role: Role): GroupMember {
  return {
    userId,
    displayName: userId === ANNA ? 'Anna' : 'Ben',
    avatarUrl: null,
    role,
    joinedAt: '2026-01-01T10:00:00Z',
  }
}

function group(id: string, name: string, role: Role = 'owner'): Group {
  return {
    id,
    name,
    role,
    members: [member(ANNA, 'owner'), member(BEN, 'member')],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

/** A fake backend that answers every call; tests override single functions. */
function fakeService(
  initial: Group[] = [],
): GroupsService & { [K in keyof GroupsService]: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn(() => Promise.resolve(initial)),
    create: vi.fn((name: string) => Promise.resolve(group('g-new', name))),
    rename: vi.fn((id: string, name: string) => Promise.resolve(group(id, name))),
    remove: vi.fn(() => Promise.resolve()),
    removeMember: vi.fn(() => Promise.resolve()),
    setMemberRole: vi.fn(() => Promise.resolve()),
  }
}

/**
 * The storage of the device with the groups it holds. writeGroups keeps a
 * copy, as IndexedDB does, so tests see what was written at that moment.
 */
function fakeStorage(stored: Group[] | null = null) {
  const storage = {
    groups: stored,
    readGroups: vi.fn((): Promise<Group[] | null> => Promise.resolve(storage.groups)),
    writeGroups: vi.fn((_userId: string, groups: Group[]) => {
      storage.groups = JSON.parse(JSON.stringify(groups)) as Group[]
      return Promise.resolve()
    }),
  }
  return storage
}

/**
 * The signed-in user as a ref, so tests can switch the user, the server
 * events, so tests can send them, a spy in place of the lists store, and
 * the storage of the device.
 */
function setup(
  service: GroupsService,
  userId: string | null = ANNA,
  storage: GroupsLocal = fakeStorage(),
) {
  const user = ref(userId)
  const events = createFakeServerEvents()
  const forgetLists = vi.fn()
  const store = defineGroupsStore(service, () => user.value, events, forgetLists, storage)()
  return { store, user, events, forgetLists }
}

// Messages as another member's change makes the server send them.
const changed = (groupId: string): ServerMessage => ({
  type: 'groupChanged',
  payload: { groupId, actorId: BEN },
})
const removedFrom = (groupId: string): ServerMessage => ({
  type: 'groupRemoved',
  payload: { groupId, reason: 'removed', actorId: BEN },
})
const READY: ServerMessage = { type: 'ready' }

/** A request that answers only when the test says so. */
function pending<T>() {
  let answer: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => (answer = resolve))
  return { promise, answer }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('groups store: load', () => {
  it('starts idle and empty', () => {
    const { store } = setup(fakeService())

    expect(store.status).toBe('idle')
    expect(store.groups).toEqual([])
  })

  it('holds the loaded groups', async () => {
    const { store } = setup(fakeService([group('g1', 'WG Kaiserstraße')]))

    await store.load()

    expect(store.status).toBe('ready')
    expect(store.groups.map((g) => g.name)).toEqual(['WG Kaiserstraße'])
    expect(store.byId('g1')?.name).toBe('WG Kaiserstraße')
    expect(store.byId('unknown')).toBeUndefined()
  })

  it('reports the error code and keeps the groups from before', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))

    await store.load()

    expect(store.status).toBe('error')
    expect(store.errorCode).toBe('NETWORK')
    expect(store.groups).toHaveLength(1)
  })

  it('uses UNKNOWN for errors that are not from the API', async () => {
    const service = fakeService()
    service.list.mockRejectedValueOnce(new Error('boom'))
    const { store } = setup(service)

    await store.load()

    expect(store.errorCode).toBe('UNKNOWN')
  })
})

describe('groups store: reset', () => {
  it('forgets the groups when the user logs out', async () => {
    const { store, user } = setup(fakeService([group('g1', 'WG')]))
    await store.load()

    user.value = null
    await Promise.resolve()

    expect(store.groups).toEqual([])
    expect(store.status).toBe('idle')
  })

  it('forgets the groups when another user signs in', async () => {
    const { store, user } = setup(fakeService([group('g1', 'WG')]))
    await store.load()

    user.value = BEN
    await Promise.resolve()

    expect(store.groups).toEqual([])
  })

  it('ignores a load that was still running at the reset', async () => {
    const service = fakeService()
    let answer: (groups: Group[]) => void = () => undefined
    service.list.mockReturnValueOnce(new Promise<Group[]>((resolve) => (answer = resolve)))
    const { store, user } = setup(service)

    const loading = store.load()
    user.value = null
    await Promise.resolve()
    answer([group('g1', 'Old user')])
    await loading

    expect(store.groups).toEqual([])
    expect(store.status).toBe('idle')
  })
})

describe('groups store: create, rename, remove', () => {
  it('adds a created group and returns it', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()

    const created = await store.create('Büro')

    expect(service.create).toHaveBeenCalledWith('Büro')
    expect(created.id).toBe('g-new')
    expect(store.groups.map((g) => g.name)).toEqual(['WG', 'Büro'])
  })

  it('does not add a group when creating fails', async () => {
    const service = fakeService()
    service.create.mockRejectedValueOnce(new ApiError('GROUP_NAME_INVALID', 400))
    const { store } = setup(service)

    await expect(store.create('')).rejects.toMatchObject({ code: 'GROUP_NAME_INVALID' })
    expect(store.groups).toEqual([])
  })

  it('takes the renamed group from the answer of the server', async () => {
    const { store } = setup(fakeService([group('g1', 'WG'), group('g2', 'Büro')]))
    await store.load()

    await store.rename('g2', 'Firma')

    expect(store.groups.map((g) => g.name)).toEqual(['WG', 'Firma'])
  })

  it('keeps the name when renaming fails', async () => {
    const service = fakeService([group('g1', 'WG')])
    service.rename.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403))
    const { store } = setup(service)
    await store.load()

    await expect(store.rename('g1', 'Neu')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(store.byId('g1')?.name).toBe('WG')
  })

  it('drops a deleted group', async () => {
    const { store } = setup(fakeService([group('g1', 'WG'), group('g2', 'Büro')]))
    await store.load()

    await store.remove('g1')

    expect(store.groups.map((g) => g.id)).toEqual(['g2'])
  })
})

describe('groups store: members', () => {
  it('leaves with the own user ID and drops the group', async () => {
    const service = fakeService([group('g1', 'WG', 'member'), group('g2', 'Büro')])
    const { store } = setup(service, BEN)
    await store.load()

    await store.leave('g1')

    expect(service.removeMember).toHaveBeenCalledWith('g1', BEN)
    expect(store.groups.map((g) => g.id)).toEqual(['g2'])
  })

  it('keeps the group when leaving is refused', async () => {
    const service = fakeService([group('g1', 'WG')])
    service.removeMember.mockRejectedValueOnce(new ApiError('OWNER_IMMUTABLE', 409))
    const { store } = setup(service)
    await store.load()

    await expect(store.leave('g1')).rejects.toMatchObject({ code: 'OWNER_IMMUTABLE' })
    expect(store.groups).toHaveLength(1)
  })

  it('rejects leaving when nobody is signed in', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service, null)

    await expect(store.leave('g1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(service.removeMember).not.toHaveBeenCalled()
  })

  it('removes a member from the group', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()

    await store.removeMember('g1', BEN)

    expect(service.removeMember).toHaveBeenCalledWith('g1', BEN)
    expect(store.byId('g1')?.members.map((m) => m.userId)).toEqual([ANNA])
  })

  it('changes the role of a member', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()

    await store.setMemberRole('g1', BEN, 'admin')

    expect(service.setMemberRole).toHaveBeenCalledWith('g1', BEN, 'admin')
    expect(store.byId('g1')?.members.find((m) => m.userId === BEN)?.role).toBe('admin')
  })

  it('keeps the role when changing it fails', async () => {
    const service = fakeService([group('g1', 'WG')])
    service.setMemberRole.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403))
    const { store } = setup(service)
    await store.load()

    await expect(store.setMemberRole('g1', BEN, 'admin')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(store.byId('g1')?.members.find((m) => m.userId === BEN)?.role).toBe('member')
  })
})

describe('groups store: own writes and lists', () => {
  it('forgets the lists of a group it deletes or leaves', async () => {
    const service = fakeService([group('g1', 'WG', 'member'), group('g2', 'Büro')])
    const { store, forgetLists } = setup(service, BEN)
    await store.load()

    await store.leave('g1')
    await store.remove('g2')

    expect(forgetLists.mock.calls).toEqual([['g1'], ['g2']])
  })

  it('adds a created group only once when the reload after its groupChanged was faster', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store, events } = setup(service)
    await store.load()
    const creating = pending<Group>()
    service.create.mockReturnValueOnce(creating.promise)
    service.list.mockResolvedValueOnce([group('g1', 'WG'), group('g-new', 'Büro')])

    const result = store.create('Büro')
    events.emit(changed('g-new'))
    await flushPromises()
    creating.answer(group('g-new', 'Büro'))
    await result

    expect(store.groups.map((g) => g.id)).toEqual(['g1', 'g-new'])
  })

  it('does not bring back an old user’s group with a late write answer', async () => {
    const service = fakeService()
    const creating = pending<Group>()
    service.create.mockReturnValueOnce(creating.promise)
    const { store, user } = setup(service)

    const result = store.create('Büro')
    user.value = BEN
    await Promise.resolve()
    creating.answer(group('g-new', 'Büro'))
    await result

    expect(store.groups).toEqual([])
  })

  it('does not bring back a group the user was removed from while renaming', async () => {
    const service = fakeService([group('g1', 'WG')])
    const renaming = pending<Group>()
    service.rename.mockReturnValueOnce(renaming.promise)
    const { store, events } = setup(service)
    await store.load()

    const result = store.rename('g1', 'Neu')
    events.emit(removedFrom('g1'))
    renaming.answer(group('g1', 'Neu'))
    await result

    expect(store.groups).toEqual([])
  })
})

describe('groups store: live events', () => {
  it('registers its handlers and removes them on dispose', () => {
    const { store, events } = setup(fakeService())

    expect(events.count('groupChanged')).toBe(1)
    expect(events.count('groupRemoved')).toBe(1)
    expect(events.count('ready')).toBe(1)

    store.$dispose()

    expect(events.count('groupChanged')).toBe(0)
    expect(events.count('groupRemoved')).toBe(0)
    expect(events.count('ready')).toBe(0)
  })

  it('reloads on groupChanged and takes the new name and role', async () => {
    const service = fakeService([group('g1', 'WG', 'member')])
    const { store, events } = setup(service)
    await store.load()
    service.list.mockResolvedValueOnce([group('g1', 'WG Kaiserstraße', 'admin')])

    events.emit(changed('g1'))
    await flushPromises()

    expect(service.list).toHaveBeenCalledTimes(2)
    expect(store.byId('g1')).toMatchObject({ name: 'WG Kaiserstraße', role: 'admin' })
  })

  it('shows a group it was just added to after the reload', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store, events } = setup(service)
    await store.load()
    service.list.mockResolvedValueOnce([group('g1', 'WG'), group('g2', 'Familie')])

    events.emit(changed('g2'))
    await flushPromises()

    expect(store.groups.map((g) => g.id)).toEqual(['g1', 'g2'])
  })

  it('does not load on groupChanged or ready before anything was loaded', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store, events } = setup(service)

    events.emit(changed('g1'))
    events.emit(READY)
    await flushPromises()

    expect(service.list).not.toHaveBeenCalled()
    expect(store.status).toBe('idle')
  })

  it('reloads after ready without a spinner', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store, events } = setup(service)
    await store.load()
    const reloading = pending<Group[]>()
    service.list.mockReturnValueOnce(reloading.promise)

    events.emit(READY)

    expect(store.status).toBe('ready')
    reloading.answer([group('g1', 'Neu')])
    await flushPromises()
    expect(store.byId('g1')?.name).toBe('Neu')
  })

  it('drops the group and its lists on groupRemoved', async () => {
    const { store, events, forgetLists } = setup(
      fakeService([group('g1', 'WG'), group('g2', 'Büro')]),
    )
    await store.load()

    events.emit(removedFrom('g1'))

    expect(store.groups.map((g) => g.id)).toEqual(['g2'])
    expect(forgetLists).toHaveBeenCalledWith('g1')
  })

  it('does not bring back a removed group with a load that started before', async () => {
    const service = fakeService([group('g1', 'WG'), group('g2', 'Büro')])
    const { store, events } = setup(service)
    await store.load()
    const reloading = pending<Group[]>()
    service.list.mockReturnValueOnce(reloading.promise)

    const loading = store.load()
    events.emit(removedFrom('g1'))
    reloading.answer([group('g1', 'WG'), group('g2', 'Büro')])
    await loading

    expect(store.groups.map((g) => g.id)).toEqual(['g2'])
  })

  it('shows a group again after the user is invited back', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store, events } = setup(service)
    await store.load()
    events.emit(removedFrom('g1'))

    await store.load()

    expect(store.groups.map((g) => g.id)).toEqual(['g1'])
  })

  it('forgets the lists of a group a reload no longer lists (missed groupRemoved)', async () => {
    const service = fakeService([group('g1', 'WG'), group('g2', 'Büro')])
    const { store, forgetLists } = setup(service)
    await store.load()
    service.list.mockResolvedValueOnce([group('g2', 'Büro')])

    await store.load()

    expect(store.groups.map((g) => g.id)).toEqual(['g2'])
    expect(forgetLists).toHaveBeenCalledWith('g1')
  })

  it('keeps a group created while a load was on its way', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()
    const reloading = pending<Group[]>()
    service.list.mockReturnValueOnce(reloading.promise)

    const loading = store.load()
    await store.create('Büro')
    reloading.answer([group('g1', 'WG')])
    await loading

    expect(store.groups.map((g) => g.id)).toEqual(['g1', 'g-new'])
  })

  it('keeps a rename answer that is newer than the load answer', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()
    const reloading = pending<Group[]>()
    service.list.mockReturnValueOnce(reloading.promise)

    const loading = store.load()
    await store.rename('g1', 'Neu')
    reloading.answer([group('g1', 'WG')])
    await loading

    expect(store.byId('g1')?.name).toBe('Neu')
  })

  it('drops the answer of a load that started before the last applied one', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()
    const first = pending<Group[]>()
    service.list.mockReturnValueOnce(first.promise)
    service.list.mockResolvedValueOnce([group('g1', 'Neu')])

    const older = store.load()
    await store.load()
    first.answer([group('g1', 'Alt')])
    await older

    expect(store.byId('g1')?.name).toBe('Neu')
  })
})

describe('groups store: why a group went', () => {
  const removal = (reason: 'removed' | 'deleted', actorId: string): ServerMessage => ({
    type: 'groupRemoved',
    payload: { groupId: 'g1', reason, actorId },
  })

  it('knows nothing about a group the user is still in', async () => {
    const { store } = setup(fakeService([group('g1', 'WG')]))
    await store.load()

    expect(store.departureOf('g1')).toBeUndefined()
    expect(store.departureOf('unknown')).toBeUndefined()
  })

  it.each(['removed', 'deleted'] as const)(
    'remembers the name when another member %s it',
    async (reason) => {
      const { store, events } = setup(fakeService([group('g1', 'WG')]))
      await store.load()

      events.emit(removal(reason, BEN))

      expect(store.departureOf('g1')).toEqual({ name: 'WG', cause: reason })
    },
  )

  it('counts an event of the user from another tab as their own doing', async () => {
    const { store, events } = setup(fakeService([group('g1', 'WG')]))
    await store.load()

    events.emit(removal('deleted', ANNA))

    expect(store.departureOf('g1')).toEqual({ name: 'WG', cause: 'self' })
  })

  it.each(['leave', 'remove'] as const)('counts %s as the own doing', async (action) => {
    const { store, events } = setup(fakeService([group('g1', 'WG')]))
    await store.load()

    await store[action]('g1')
    // The own event that follows does not change the cause.
    events.emit(removal('removed', ANNA))

    expect(store.departureOf('g1')).toEqual({ name: 'WG', cause: 'self' })
  })

  it('does not know why if a load no longer lists the group', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store } = setup(service)
    await store.load()

    service.list.mockResolvedValueOnce([])
    await store.load()

    expect(store.departureOf('g1')).toEqual({ name: 'WG', cause: 'unknown' })
  })

  it('forgets the departure when the group comes back', async () => {
    const service = fakeService([group('g1', 'WG')])
    const { store, events } = setup(service)
    await store.load()
    events.emit(removal('removed', BEN))

    await store.load()

    expect(store.departureOf('g1')).toBeUndefined()
  })

  it('forgets departures with the user', async () => {
    const { store, events, user } = setup(fakeService([group('g1', 'WG')]))
    await store.load()
    events.emit(removal('removed', BEN))

    user.value = BEN
    await flushPromises()

    expect(store.departureOf('g1')).toBeUndefined()
  })
})

describe('groups store: storage on the device', () => {
  it('shows the stored groups while the server is asked', async () => {
    const service = fakeService()
    const request = pending<Group[]>()
    service.list.mockReturnValueOnce(request.promise)
    const storage = fakeStorage([group('g1', 'WG')])
    const { store } = setup(service, ANNA, storage)

    void store.load()
    await flushPromises()

    expect(storage.readGroups).toHaveBeenCalledWith(ANNA)
    expect(store.groups.map((g) => g.name)).toEqual(['WG'])
    // A stored state is not the server's: "no groups" must not show early.
    expect(store.status).toBe('loading')

    request.answer([group('g1', 'WG Kaiserstraße')])
    await flushPromises()

    expect(store.status).toBe('ready')
    expect(store.groups.map((g) => g.name)).toEqual(['WG Kaiserstraße'])
  })

  it('keeps the stored groups when the server cannot be reached', async () => {
    const service = fakeService()
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { store } = setup(service, ANNA, fakeStorage([group('g1', 'WG')]))

    await store.load()

    expect(store.status).toBe('error')
    expect(store.errorCode).toBe('NETWORK')
    expect(store.groups.map((g) => g.name)).toEqual(['WG'])
  })

  it('reads the stored groups only on the first load', async () => {
    const storage = fakeStorage()
    const { store } = setup(fakeService(), ANNA, storage)

    await store.load()
    await store.load()

    expect(storage.readGroups).toHaveBeenCalledOnce()
  })

  it('drops a stored group the server no longer lists', async () => {
    const storage = fakeStorage([group('g1', 'WG'), group('g2', 'Familie')])
    const { store, forgetLists } = setup(fakeService([group('g1', 'WG')]), ANNA, storage)

    await store.load()
    await flushPromises()

    expect(store.groups.map((g) => g.id)).toEqual(['g1'])
    expect(store.departureOf('g2')).toEqual({ name: 'Familie', cause: 'unknown' })
    expect(forgetLists).toHaveBeenCalledWith('g2')
    expect(storage.groups?.map((g) => g.id)).toEqual(['g1'])
  })

  it('drops stored groups that arrive after the server answer', async () => {
    const storage = fakeStorage()
    const read = pending<Group[] | null>()
    storage.readGroups.mockReturnValueOnce(read.promise)
    const { store } = setup(fakeService([group('g1', 'WG Kaiserstraße')]), ANNA, storage)

    await store.load()
    read.answer([group('g1', 'WG'), group('g2', 'Familie')])
    await flushPromises()

    expect(store.groups.map((g) => g.name)).toEqual(['WG Kaiserstraße'])
  })

  it('keeps a newer group from an answer over the stored one', async () => {
    const service = fakeService()
    service.list.mockReturnValueOnce(pending<Group[]>().promise)
    const storage = fakeStorage()
    const read = pending<Group[] | null>()
    storage.readGroups.mockReturnValueOnce(read.promise)
    const { store } = setup(service, ANNA, storage)

    void store.load()
    await store.create('WG neu')
    read.answer([group('g-new', 'WG alt'), group('g2', 'Familie')])
    await flushPromises()

    expect(store.groups.map((g) => g.name)).toEqual(['WG neu', 'Familie'])
  })

  it('writes the groups back after a load', async () => {
    const storage = fakeStorage()
    const { store } = setup(fakeService([group('g1', 'WG')]), ANNA, storage)

    await store.load()
    await flushPromises()

    expect(storage.writeGroups).toHaveBeenCalledWith(ANNA, expect.anything())
    expect(storage.groups?.map((g) => g.name)).toEqual(['WG'])
  })

  it('writes the groups back after own writes and events', async () => {
    const storage = fakeStorage()
    const service = fakeService([group('g1', 'WG'), group('g2', 'Familie')])
    const { store, events } = setup(service, ANNA, storage)
    await store.load()

    await store.rename('g1', 'WG Kaiserstraße')
    await flushPromises()
    expect(storage.groups?.map((g) => g.name)).toEqual(['WG Kaiserstraße', 'Familie'])

    await store.setMemberRole('g1', BEN, 'admin')
    await flushPromises()
    expect(storage.groups?.[0]?.members.find((m) => m.userId === BEN)?.role).toBe('admin')

    events.emit(removedFrom('g2'))
    await flushPromises()
    expect(storage.groups?.map((g) => g.id)).toEqual(['g1'])
  })

  it('writes once for several changes in one go', async () => {
    const storage = fakeStorage()
    const service = fakeService([group('g1', 'WG'), group('g2', 'Familie')])
    const { store, events } = setup(service, ANNA, storage)
    await store.load()
    await flushPromises()
    storage.writeGroups.mockClear()

    events.emit(removedFrom('g1'))
    events.emit(removedFrom('g2'))
    await flushPromises()

    expect(storage.writeGroups).toHaveBeenCalledOnce()
    expect(storage.groups).toEqual([])
  })

  it('writes nothing before the stored groups were read', async () => {
    const service = fakeService()
    service.list.mockReturnValueOnce(pending<Group[]>().promise)
    const storage = fakeStorage()
    storage.readGroups.mockReturnValueOnce(pending<Group[] | null>().promise)
    const { store } = setup(service, ANNA, storage)

    void store.load()
    await store.create('WG')
    await flushPromises()

    // Writing now would replace the stored groups with only the new one.
    expect(storage.writeGroups).not.toHaveBeenCalled()
  })

  it('writes nothing from a load of the previous user', async () => {
    const service = fakeService()
    const request = pending<Group[]>()
    service.list.mockReturnValueOnce(request.promise)
    const storage = fakeStorage()
    const { store, user } = setup(service, ANNA, storage)

    void store.load()
    await flushPromises()
    user.value = BEN
    await flushPromises()
    request.answer([group('g1', 'WG')])
    await flushPromises()

    expect(storage.writeGroups).not.toHaveBeenCalled()
  })

  it('reads nothing without a signed-in user', async () => {
    const storage = fakeStorage([group('g1', 'WG')])
    const service = fakeService()
    service.list.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 401))
    const { store } = setup(service, null, storage)

    await store.load()

    expect(storage.readGroups).not.toHaveBeenCalled()
    expect(store.groups).toEqual([])
  })
})
