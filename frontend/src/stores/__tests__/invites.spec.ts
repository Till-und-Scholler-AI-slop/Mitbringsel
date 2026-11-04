import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '@/services/api/client'
import type { InvitesService } from '@/services/api/invites'
import type { InvitePreview } from '@/types/api'

import { defineInvitesStore } from '../invites'

const PREVIEW: InvitePreview = {
  groupName: 'WG Kaiserstraße',
  invitedByName: 'Lena',
  invitedByAvatarUrl: null,
  expiresAt: '2026-12-01T10:00:00Z',
  memberCount: 6,
  members: [{ firstName: 'Lena', avatarUrl: null }],
}

function fakeService() {
  return {
    preview: vi.fn<InvitesService['preview']>(() => Promise.resolve(PREVIEW)),
    accept: vi.fn<InvitesService['accept']>(() =>
      Promise.resolve({ groupId: 'g1', groupName: 'WG Kaiserstraße' }),
    ),
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('invites store', () => {
  it('starts empty', () => {
    const store = defineInvitesStore(fakeService())()

    expect(store.status).toBe('idle')
    expect(store.has('t')).toBe(false)
  })

  it('holds the loaded invite for its token', async () => {
    const service = fakeService()
    const store = defineInvitesStore(service)()

    await store.load('t1')

    expect(service.preview).toHaveBeenCalledWith('t1')
    expect(store.status).toBe('ready')
    expect(store.preview?.groupName).toBe('WG Kaiserstraße')
    expect(store.has('t1')).toBe(true)
    expect(store.has('other')).toBe(false)
  })

  it('reports the error code', async () => {
    const service = fakeService()
    service.preview.mockRejectedValueOnce(new ApiError('INVITE_EXPIRED', 410))
    const store = defineInvitesStore(service)()

    await store.load('t1')

    expect(store.status).toBe('error')
    expect(store.errorCode).toBe('INVITE_EXPIRED')
    expect(store.preview).toBeNull()
    expect(store.retryAfterSeconds).toBeNull()
    expect(store.has('t1')).toBe(false)
  })

  it('keeps the seconds to wait after a rate limit', async () => {
    const service = fakeService()
    service.preview.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 429, 42))
    const store = defineInvitesStore(service)()

    await store.load('t1')

    expect(store.errorCode).toBe('RATE_LIMITED')
    expect(store.retryAfterSeconds).toBe(42)
  })

  it('uses UNKNOWN for errors that are not from the API', async () => {
    const service = fakeService()
    service.preview.mockRejectedValueOnce(new Error('boom'))
    const store = defineInvitesStore(service)()

    await store.load('t1')

    expect(store.errorCode).toBe('UNKNOWN')
  })

  it('forgets the old invite when another one is loaded', async () => {
    const service = fakeService()
    service.preview.mockRejectedValueOnce(new ApiError('INVITE_EXPIRED', 410))
    const store = defineInvitesStore(service)()
    await store.load('t1')

    await store.load('t2')

    expect(store.errorCode).toBeNull()
    expect(store.status).toBe('ready')
  })

  it('ignores an answer that arrives after clear()', async () => {
    const service = fakeService()
    let answer: (preview: InvitePreview) => void = () => undefined
    service.preview.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const store = defineInvitesStore(service)()

    const loading = store.load('t1')
    store.clear()
    answer(PREVIEW)
    await loading

    expect(store.status).toBe('idle')
    expect(store.preview).toBeNull()
  })

  it('accepts and passes the answer on', async () => {
    const service = fakeService()
    const store = defineInvitesStore(service)()

    await expect(store.accept('t1')).resolves.toEqual({
      groupId: 'g1',
      groupName: 'WG Kaiserstraße',
    })
    expect(service.accept).toHaveBeenCalledWith('t1')
  })

  it('passes a refused accept on as the ApiError', async () => {
    const service = fakeService()
    service.accept.mockRejectedValueOnce(new ApiError('INVITE_EXPIRED', 410))
    const store = defineInvitesStore(service)()

    await expect(store.accept('t1')).rejects.toMatchObject({ code: 'INVITE_EXPIRED' })
  })
})
