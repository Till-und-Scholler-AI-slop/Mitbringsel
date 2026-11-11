import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupInvitesService } from '@/services/api/groupInvites'
import type { GroupsService } from '@/services/api/groups'
import { useAuthStore } from '@/stores/auth'
import type { Group, GroupMember, Role } from '@/types/api'

import GroupSettingsView from '../GroupSettingsView.vue'

const service = vi.hoisted(() => ({
  list: vi.fn<GroupsService['list']>(),
  create: vi.fn<GroupsService['create']>(),
  rename: vi.fn<GroupsService['rename']>(),
  remove: vi.fn<GroupsService['remove']>(),
  removeMember: vi.fn<GroupsService['removeMember']>(),
  setMemberRole: vi.fn<GroupsService['setMemberRole']>(),
}))

const invitesService = vi.hoisted(() => ({
  list: vi.fn<GroupInvitesService['list']>(),
  create: vi.fn<GroupInvitesService['create']>(),
  revoke: vi.fn<GroupInvitesService['revoke']>(),
}))

vi.mock('@/stores/groupInvites', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groupInvites')>()
  return {
    ...original,
    useGroupInvitesStore: original.defineGroupInvitesStore(invitesService, () => 'user-1'),
  }
})
// A signed-in user would start the real live socket; the chip stays hidden.
vi.mock('@/stores/sync', () => ({ useSyncStore: () => ({ indicator: 'hidden' }) }))
vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(service, () => 'user-1') }
})

function member(userId: string, displayName: string, role: Role): GroupMember {
  return { userId, displayName, avatarUrl: null, role, joinedAt: '2026-01-01T10:00:00Z' }
}

// The viewer is always "user-1" (Jonas); the other members are given per test.
function group(role: Role, others: GroupMember[] = [], name = 'WG Kaiserstraße'): Group {
  return {
    id: 'g1',
    name,
    role,
    members: [member('user-1', 'Jonas', role), ...others],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  invitesService.list.mockResolvedValue([])
  useAuthStore().user = {
    id: 'user-1',
    email: 'jonas@example.com',
    displayName: 'Jonas',
    avatarUrl: null,
    locale: 'en',
    theme: 'system',
  }
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

async function mountView(groupId = 'g1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/groups/:groupId', name: 'group', component: { template: '<p />' } },
      { path: '/groups/:groupId/settings', name: 'group-settings', component: {} },
    ],
  })
  await router.push(`/groups/${groupId}/settings`)
  const wrapper = mount(GroupSettingsView, {
    props: { groupId },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

describe('GroupSettingsView', () => {
  it('loads the households when it is opened directly and shows the name', async () => {
    service.list.mockResolvedValue([group('owner')])

    const { wrapper } = await mountView()

    expect(service.list).toHaveBeenCalledTimes(1)
    expect(wrapper.get('h1').text()).toBe('Manage household')
    expect(wrapper.get('.name').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('shows a spinner while loading', async () => {
    service.list.mockReturnValue(new Promise(() => undefined))

    const { wrapper } = await mountView()

    expect(wrapper.get('[role="status"]').text()).toBe('Loading household …')
    wrapper.unmount()
  })

  it('says so and offers a retry when the households cannot be loaded', async () => {
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()

    expect(wrapper.get('[role="alert"]').text()).toContain('The household could not be loaded.')
    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')

    service.list.mockResolvedValueOnce([group('member')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.get('.name').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('says that the household is not found when it is not among the loaded ones', async () => {
    service.list.mockResolvedValue([group('owner')])

    const { wrapper, router } = await mountView('other')

    expect(wrapper.get('h2').text()).toBe('Household not found')
    await wrapper.get('main button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ] as const)('%s may rename: %s', async (role, mayRename) => {
    service.list.mockResolvedValue([group(role)])

    const { wrapper } = await mountView()

    const rename = wrapper.findAll('main button').find((b) => b.text() === 'Rename')
    expect(rename !== undefined).toBe(mayRename)
    wrapper.unmount()
  })

  it('renames the household and shows the new name', async () => {
    service.list.mockResolvedValue([group('owner')])
    service.rename.mockResolvedValue(group('owner', [], 'WG Süd'))
    const { wrapper } = await mountView()

    await wrapper
      .findAll('main button')
      .find((b) => b.text() === 'Rename')!
      .trigger('click')
    await wrapper.get('dialog input').setValue('WG Süd')
    await wrapper.get('dialog form').trigger('submit')
    await flushPromises()

    expect(service.rename).toHaveBeenCalledWith('g1', 'WG Süd')
    expect(wrapper.get('.name').text()).toBe('WG Süd')
    wrapper.unmount()
  })

  it('lists the members, owner first, and marks the signed-in user', async () => {
    service.list.mockResolvedValue([
      group('admin', [member('u-mehmet', 'Mehmet', 'member'), member('u-lena', 'Lena', 'owner')]),
    ])

    const { wrapper } = await mountView()

    const count = wrapper.get('.members-card .count')
    expect(count.text()).toBe('3')
    expect(count.attributes('aria-label')).toBe('3 members')
    expect(wrapper.findAll('.member .name').map((e) => e.text())).toEqual([
      'Lena',
      'Jonas (You)',
      'Mehmet',
    ])
    wrapper.unmount()
  })

  it.each([
    ['owner', ['Actions for Anna', 'Actions for Mehmet']],
    ['admin', ['Actions for Mehmet']],
    ['member', []],
  ] as const)('a %s can open the actions of: %j', async (role, labels) => {
    // Lena is the owner; for an owner viewer she is replaced by Anna, an admin.
    const others = [member('u-mehmet', 'Mehmet', 'member')]
    others.unshift(
      role === 'owner' ? member('u-anna', 'Anna', 'admin') : member('u-lena', 'Lena', 'owner'),
    )
    service.list.mockResolvedValue([group(role, others)])

    const { wrapper } = await mountView()

    expect(wrapper.findAll('.member button').map((b) => b.attributes('aria-label'))).toEqual(labels)
    wrapper.unmount()
  })

  it('makes a member admin from the actions dialog', async () => {
    service.list.mockResolvedValue([group('owner', [member('u-mehmet', 'Mehmet', 'member')])])
    service.setMemberRole.mockResolvedValue(undefined)
    const { wrapper } = await mountView()

    await wrapper.get('.member button').trigger('click')
    await wrapper.findAll('dialog .action')[0]!.trigger('click')
    await flushPromises()

    expect(service.setMemberRole).toHaveBeenCalledWith('g1', 'u-mehmet', 'admin')
    expect(wrapper.findAll('.member .role').map((e) => e.text())).toEqual(['Founder', 'Admin'])
    expect(wrapper.find('dialog .action').exists()).toBe(false)
    wrapper.unmount()
  })

  it('drops a removed member from the list', async () => {
    service.list.mockResolvedValue([
      group('admin', [member('u-lena', 'Lena', 'owner'), member('u-mehmet', 'Mehmet', 'member')]),
    ])
    service.removeMember.mockResolvedValue(undefined)
    const { wrapper } = await mountView()

    await wrapper.get('.member button').trigger('click')
    await wrapper.get('dialog .action').trigger('click')
    await wrapper.get('dialog .remove').trigger('click')
    await flushPromises()

    expect(service.removeMember).toHaveBeenCalledWith('g1', 'u-mehmet')
    expect(wrapper.findAll('.member .name').map((e) => e.text())).toEqual(['Lena', 'Jonas (You)'])
    expect(wrapper.find('dialog .action').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['owner', 'Delete household'],
    ['admin', 'Leave household'],
    ['member', 'Leave household'],
  ] as const)('a %s sees "%s"', async (role, title) => {
    service.list.mockResolvedValue([group(role)])

    const { wrapper } = await mountView()

    expect(wrapper.get('.card--danger h2').text()).toBe(title)
    wrapper.unmount()
  })

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ] as const)('a %s sees the invite link section: %s', async (role, sees) => {
    service.list.mockResolvedValue([group(role)])

    const { wrapper } = await mountView()

    expect(wrapper.find('.invites').exists()).toBe(sees)
    expect(invitesService.list).toHaveBeenCalledTimes(sees ? 1 : 0)
    wrapper.unmount()
  })

  it('goes back to the household', async () => {
    service.list.mockResolvedValue([group('owner')])
    const { wrapper, router } = await mountView()

    await wrapper.get('button[aria-label="Back to the household"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('group')
    expect(router.currentRoute.value.params.groupId).toBe('g1')
    wrapper.unmount()
  })

  it('goes to the start page when the household disappears', async () => {
    service.list.mockResolvedValue([group('member')])
    const { wrapper, router } = await mountView()
    service.list.mockResolvedValue([])

    const { useGroupsStore } = await import('@/stores/groups')
    await useGroupsStore().load()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('stays on a household it does not know and shows "not found"', async () => {
    service.list.mockResolvedValue([group('member')])

    const { wrapper, router } = await mountView('unknown')

    expect(router.currentRoute.value.name).toBe('group-settings')
    expect(wrapper.text()).toContain('not found')
    wrapper.unmount()
  })
})
