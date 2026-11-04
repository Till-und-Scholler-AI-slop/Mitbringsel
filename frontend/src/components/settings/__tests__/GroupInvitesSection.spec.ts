import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupInvitesService } from '@/services/api/groupInvites'
import type { Group } from '@/types/api'

import GroupInvitesSection from '../GroupInvitesSection.vue'

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

const GROUP: Group = {
  id: 'g1',
  name: 'WG Kaiserstraße',
  role: 'owner',
  members: [],
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  service.list.mockResolvedValue([])
  service.create.mockResolvedValue({
    id: 'i1',
    createdAt: '2026-11-04T10:00:00Z',
    expiresAt: '2026-11-11T10:00:00Z',
    createdByName: 'Lena',
    token: 'secret-token',
  })
})

async function mountSection() {
  const wrapper = mount(GroupInvitesSection, {
    props: { group: GROUP },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
  await flushPromises()
  return wrapper
}

describe('GroupInvitesSection', () => {
  it('loads the open links of the group and offers to create one', async () => {
    const wrapper = await mountSection()

    expect(service.list).toHaveBeenCalledWith('g1')
    expect(wrapper.get('h2').text()).toBe('Invite link')
    expect(wrapper.get('button').text()).toBe('Create invite link')
  })

  it('creates a link and shows it instead of the create button', async () => {
    const wrapper = await mountSection()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(service.create).toHaveBeenCalledWith('g1')
    expect(wrapper.get('.link').text()).toBe(`${window.location.host}/invite/secret-token`)
    expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('Create invite link')
  })

  it('shows the open links and the new link in the list', async () => {
    service.list.mockResolvedValue([
      {
        id: 'i0',
        createdAt: '2026-11-03T10:00:00Z',
        expiresAt: '2026-11-10T10:00:00Z',
        createdByName: 'Jonas',
      },
    ])
    const wrapper = await mountSection()

    expect(wrapper.findAll('.row')).toHaveLength(1)

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.created-by').map((e) => e.text())).toEqual([
      'Created by Lena',
      'Created by Jonas',
    ])
    expect(wrapper.get('.count').text()).toBe('2 of 10')
  })

  it('forgets the "10 links" message once a link is revoked', async () => {
    service.list.mockResolvedValue([
      {
        id: 'i0',
        createdAt: '2026-11-03T10:00:00Z',
        expiresAt: '2026-11-10T10:00:00Z',
        createdByName: 'Jonas',
      },
    ])
    service.create.mockRejectedValueOnce(new ApiError('TOO_MANY_INVITES', 409))
    service.revoke.mockResolvedValue(undefined)
    const wrapper = await mountSection()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.section > .problem').exists()).toBe(true)

    await wrapper.get('.revoke').trigger('click')
    await flushPromises()

    expect(wrapper.find('.section > .problem').exists()).toBe(false)
  })

  it('says that 10 links are open when the limit is reached', async () => {
    service.create.mockRejectedValueOnce(new ApiError('TOO_MANY_INVITES', 409))
    const wrapper = await mountSection()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('There are already 10 open links.')
    expect(wrapper.get('button').text()).toBe('Create invite link')
  })

  it('shows the message of any other error and lets the user try again', async () => {
    service.create.mockRejectedValueOnce(new ApiError('NETWORK'))
    const wrapper = await mountSection()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.link').exists()).toBe(true)
  })
})
