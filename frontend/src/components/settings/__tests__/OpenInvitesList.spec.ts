import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupInvitesService } from '@/services/api/groupInvites'
import { useAuthStore } from '@/stores/auth'
import type { Invite } from '@/types/api'

import OpenInvitesList from '../OpenInvitesList.vue'

const service = vi.hoisted(() => ({
  list: vi.fn<GroupInvitesService['list']>(),
  create: vi.fn<GroupInvitesService['create']>(),
  revoke: vi.fn<GroupInvitesService['revoke']>(),
}))

vi.mock('@/stores/groupInvites', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groupInvites')>()
  return {
    ...original,
    useGroupInvitesStore: original.defineGroupInvitesStore(service, () => 'user-1'),
  }
})

import { useGroupInvitesStore } from '@/stores/groupInvites'

// The creator's ID is made from the name; no name means a deleted account.
function invite(id: string, name: string | null = 'Lena'): Invite {
  return {
    id,
    createdAt: '2026-11-04T10:00:00Z',
    expiresAt: '2026-11-11T10:00:00Z',
    createdBy: name === null ? null : `u-${name.toLowerCase()}`,
    createdByName: name,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().user = {
    id: 'u-jonas',
    email: 'jonas@example.com',
    displayName: 'Jonas',
    avatarUrl: null,
    locale: 'en',
    theme: 'system',
  }
  vi.clearAllMocks()
  service.list.mockResolvedValue([])
  service.revoke.mockResolvedValue(undefined)
})

// The parent section loads the links; the tests do the same.
async function mountList(invites: Invite[]) {
  service.list.mockResolvedValue(invites)
  await useGroupInvitesStore().load('g1')
  const wrapper = mount(OpenInvitesList, {
    props: { groupId: 'g1' },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
  return wrapper
}

describe('OpenInvitesList', () => {
  it('lists all open links with the count out of 10', async () => {
    const wrapper = await mountList(Array.from({ length: 10 }, (_, i) => invite(`i${i}`)))

    expect(wrapper.get('h3').text()).toBe('Open links')
    expect(wrapper.get('.count').text()).toBe('10 of 10')
    expect(wrapper.findAll('.row')).toHaveLength(10)
  })

  it('tells the links of the signed-in user apart by ID, not by name', async () => {
    const wrapper = await mountList([
      invite('i1', 'Jonas'),
      // Another Jonas: same name, other account.
      { ...invite('i2', 'Jonas'), createdBy: 'u-other-jonas' },
      invite('i3', 'Lena'),
      invite('i4', null),
    ])

    expect(wrapper.findAll('.created-by').map((e) => e.text())).toEqual([
      'Created by you',
      'Created by Jonas',
      'Created by Lena',
      'Created by a deleted account',
    ])
  })

  it('says so when there is no open link', async () => {
    const wrapper = await mountList([])

    expect(wrapper.get('.count').text()).toBe('0 of 10')
    expect(wrapper.get('.status').text()).toBe('No open links.')
  })

  it('shows a spinner while the links load', () => {
    service.list.mockReturnValue(new Promise(() => undefined))
    void useGroupInvitesStore().load('g1')
    const wrapper = mount(OpenInvitesList, {
      props: { groupId: 'g1' },
      global: { plugins: [createAppI18n(['en'], null)] },
    })

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('says so when the links cannot be loaded and loads them again on request', async () => {
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    await useGroupInvitesStore().load('g1')
    const wrapper = mount(OpenInvitesList, {
      props: { groupId: 'g1' },
      global: { plugins: [createAppI18n(['en'], null)] },
    })

    expect(wrapper.get('[role="alert"]').text()).toContain('The open links could not be loaded.')
    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')

    service.list.mockResolvedValueOnce([invite('i1')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.row')).toHaveLength(1)
  })

  it('revokes a link, drops its row and tells the parent', async () => {
    const wrapper = await mountList([invite('i1', 'Lena'), invite('i2', 'Jonas')])

    await wrapper.get('button[aria-label="Revoke the link of Jonas"]').trigger('click')
    await flushPromises()

    expect(service.revoke).toHaveBeenCalledWith('g1', 'i2')
    expect(wrapper.findAll('.created-by').map((e) => e.text())).toEqual(['Created by Lena'])
    expect(wrapper.emitted('revoked')).toHaveLength(1)
  })

  it('shows the error at the row of the link that could not be revoked', async () => {
    service.revoke.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403))
    const wrapper = await mountList([invite('i1', 'Lena'), invite('i2', 'Jonas')])

    await wrapper.get('button[aria-label="Revoke the link of Jonas"]').trigger('click')
    await flushPromises()

    const rows = wrapper.findAll('.row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('[role="alert"]').exists()).toBe(false)
    expect(rows[1]!.get('[role="alert"]').text()).toContain('You are not allowed to do this.')
    expect(wrapper.emitted('revoked')).toBeUndefined()
  })

  it('shows a calm offline notice instead of a load error when offline without links', async () => {
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    await useGroupInvitesStore().load('g1')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const wrapper = mount(OpenInvitesList, {
      props: { groupId: 'g1' },
      global: { plugins: [createAppI18n(['en'], null)] },
    })

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.count').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Open links are only visible with an internet connection.',
    )
  })

  it('disables revoking loaded links with a hint when going offline', async () => {
    const wrapper = await mountList([invite('i1', 'Lena'), invite('i2', 'Jonas')])

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    expect(wrapper.findAll('.revoke').map((b) => b.attributes('disabled'))).toEqual(['', ''])
    expect(wrapper.get('[role="status"]').text()).toBe('Requires an internet connection.')
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
