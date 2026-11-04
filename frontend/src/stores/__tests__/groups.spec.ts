import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { Group, GroupMember, Role } from '@/types/api'

import { defineGroupsStore } from '../groups'

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

/** The signed-in user as a ref, so tests can switch the user. */
function setup(service: GroupsService, userId: string | null = ANNA) {
  const user = ref(userId)
  const store = defineGroupsStore(service, () => user.value)()
  return { store, user }
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
