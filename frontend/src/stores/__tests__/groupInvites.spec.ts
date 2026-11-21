import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { ApiError } from '@/services/api/client'
import type { GroupInvitesService } from '@/services/api/groupInvites'
import type { Invite, InviteCreated } from '@/types/api'

import { defineGroupInvitesStore } from '../groupInvites'

const OLD: Invite = {
  id: 'i-old',
  createdAt: '2026-11-01T10:00:00Z',
  expiresAt: '2026-11-08T10:00:00Z',
  createdBy: 'u-lena',
  createdByName: 'Lena',
}

const NEW: InviteCreated = {
  id: 'i-new',
  createdAt: '2026-11-04T10:00:00Z',
  expiresAt: '2026-11-11T10:00:00Z',
  createdBy: 'u-jonas',
  createdByName: 'Jonas',
  token: 'secret-token',
}

function fakeService() {
  return {
    list: vi.fn<GroupInvitesService['list']>(() => Promise.resolve([OLD])),
    create: vi.fn<GroupInvitesService['create']>(() => Promise.resolve(NEW)),
    revoke: vi.fn<GroupInvitesService['revoke']>(() => Promise.resolve()),
  }
}

function setup(service = fakeService()) {
  const userId = ref<string | null>('user-1')
  const store = defineGroupInvitesStore(service, () => userId.value)()
  return { store, service, userId }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('group invites store', () => {
  it('starts empty', () => {
    const { store } = setup()

    expect(store.status).toBe('idle')
    expect(store.invites).toEqual([])
    expect(store.fresh).toBeNull()
  })

  it('loads the open links of a group', async () => {
    const { store, service } = setup()

    await store.load('g1')

    expect(service.list).toHaveBeenCalledWith('g1')
    expect(store.status).toBe('ready')
    expect(store.invites).toEqual([OLD])
  })

  it('reports the error code of a failed load', async () => {
    const service = fakeService()
    service.list.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403))
    const { store } = setup(service)

    await store.load('g1')

    expect(store.status).toBe('error')
    expect(store.errorCode).toBe('FORBIDDEN')
  })

  it('uses UNKNOWN for errors that are not from the API', async () => {
    const service = fakeService()
    service.list.mockRejectedValueOnce(new Error('boom'))
    const { store } = setup(service)

    await store.load('g1')

    expect(store.errorCode).toBe('UNKNOWN')
  })

  it('puts a new link first and keeps its token apart from the list', async () => {
    const { store } = setup()
    await store.load('g1')

    const created = await store.create('g1')

    expect(created.token).toBe('secret-token')
    expect(store.invites.map((i) => i.id)).toEqual(['i-new', 'i-old'])
    expect(store.invites[0]).not.toHaveProperty('token')
    expect(store.fresh).toEqual({ id: 'i-new', token: 'secret-token' })
  })

  it('passes a refused create on as the ApiError and changes nothing', async () => {
    const service = fakeService()
    service.create.mockRejectedValueOnce(new ApiError('TOO_MANY_INVITES', 409))
    const { store } = setup(service)
    await store.load('g1')

    await expect(store.create('g1')).rejects.toMatchObject({ code: 'TOO_MANY_INVITES' })

    expect(store.invites).toEqual([OLD])
    expect(store.fresh).toBeNull()
  })

  it('keeps the new link when the same group is reloaded', async () => {
    const { store } = setup()
    await store.load('g1')
    await store.create('g1')

    await store.load('g1')

    expect(store.fresh?.token).toBe('secret-token')
  })

  it('forgets the new link when another group is loaded', async () => {
    const { store } = setup()
    await store.load('g1')
    await store.create('g1')

    await store.load('g2')

    expect(store.fresh).toBeNull()
  })

  it('revokes a link and drops it, and the new link with it', async () => {
    const { store, service } = setup()
    await store.load('g1')
    await store.create('g1')

    await store.revoke('g1', 'i-new')

    expect(service.revoke).toHaveBeenCalledWith('g1', 'i-new')
    expect(store.invites.map((i) => i.id)).toEqual(['i-old'])
    expect(store.fresh).toBeNull()
  })

  it('keeps the list when revoking fails', async () => {
    const service = fakeService()
    service.revoke.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { store } = setup(service)
    await store.load('g1')

    await expect(store.revoke('g1', 'i-old')).rejects.toMatchObject({ code: 'NETWORK' })

    expect(store.invites).toEqual([OLD])
  })

  it('ignores an answer that arrives after clear()', async () => {
    const service = fakeService()
    let answer: (invites: Invite[]) => void = () => undefined
    service.list.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const { store } = setup(service)

    const loading = store.load('g1')
    store.clear()
    answer([OLD])
    await loading

    expect(store.status).toBe('idle')
    expect(store.invites).toEqual([])
  })

  it('forgets everything when the signed-in user changes', async () => {
    const { store, userId } = setup()
    await store.load('g1')
    await store.create('g1')

    userId.value = 'user-2'
    await Promise.resolve()

    expect(store.status).toBe('idle')
    expect(store.invites).toEqual([])
    expect(store.fresh).toBeNull()
  })
})
