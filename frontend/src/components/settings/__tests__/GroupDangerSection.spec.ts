import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { ListsService } from '@/services/api/lists'
import type { Group, GroupMember, List, Role } from '@/types/api'

import GroupDangerSection from '../GroupDangerSection.vue'

// See CreateGroupDialog.spec.ts: the store is built around a fake service.
const service = vi.hoisted(() => ({
  list: vi.fn<GroupsService['list']>(),
  create: vi.fn<GroupsService['create']>(),
  rename: vi.fn<GroupsService['rename']>(),
  remove: vi.fn<GroupsService['remove']>(),
  removeMember: vi.fn<GroupsService['removeMember']>(),
  setMemberRole: vi.fn<GroupsService['setMemberRole']>(),
}))

const listsService = vi.hoisted(() => ({
  list: vi.fn<ListsService['list']>(),
  create: vi.fn<ListsService['create']>(),
  update: vi.fn<ListsService['update']>(),
  setArchived: vi.fn<ListsService['setArchived']>(),
  remove: vi.fn<ListsService['remove']>(),
}))

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(listsService, () => 'user-1') }
})

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(service, () => 'user-1') }
})

function member(userId: string): GroupMember {
  return { userId, displayName: userId, avatarUrl: null, role: 'member', joinedAt: '' }
}

function list(id: string, archived = false): List {
  return {
    id,
    groupId: 'g1',
    name: id,
    icon: 'general',
    archivedAt: archived ? '2026-01-02T10:00:00Z' : null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

function group(role: Role, memberCount = 2): Group {
  return {
    id: 'g1',
    name: 'WG Kaiserstraße',
    role,
    members: Array.from({ length: memberCount }, (_, i) => member(`user-${i + 1}`)),
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  service.remove.mockResolvedValue(undefined)
  listsService.list.mockResolvedValue([])
  service.removeMember.mockResolvedValue(undefined)
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

async function mountSection(role: Role, memberCount = 2) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/settings', name: 'settings', component: {} },
    ],
  })
  await router.push('/settings')
  const wrapper = mount(GroupDangerSection, {
    props: { group: group(role, memberCount) },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  return { wrapper, router }
}

describe('GroupDangerSection', () => {
  it('offers the founder to delete the household, not to leave', async () => {
    const { wrapper } = await mountSection('owner')

    expect(wrapper.get('h2').text()).toBe('Delete household')
    expect(wrapper.get('button.open').text()).toBe('Delete household')
    wrapper.unmount()
  })

  it.each(['admin', 'member'] as const)('offers a %s to leave', async (role) => {
    const { wrapper } = await mountSection(role)

    expect(wrapper.get('h2').text()).toBe('Leave household')
    expect(wrapper.get('button.open').text()).toBe('Leave')
    wrapper.unmount()
  })

  it('names how many lists and members go with the household, archived lists included', async () => {
    listsService.list.mockResolvedValue([list('l1'), list('l2'), list('l3', true)])
    const { wrapper } = await mountSection('owner', 6)
    await flushPromises()

    await wrapper.get('button.open').trigger('click')

    expect(listsService.list).toHaveBeenCalledWith('g1', { includeArchived: true })
    expect(wrapper.get('.message').text()).toBe(
      '“WG Kaiserstraße” is deleted with all 3 lists and all items for all 6 members. This cannot be undone.',
    )
    wrapper.unmount()
  })

  it.each([
    [0, 1, '“WG Kaiserstraße” is deleted without lists for you. This cannot be undone.'],
    [
      1,
      2,
      '“WG Kaiserstraße” is deleted with its list and all items for all 2 members. This cannot be undone.',
    ],
  ])('words %i lists and %i members', async (listCount, memberCount, text) => {
    listsService.list.mockResolvedValue(Array.from({ length: listCount }, (_, i) => list(`l${i}`)))
    const { wrapper } = await mountSection('owner', memberCount)
    await flushPromises()

    await wrapper.get('button.open').trigger('click')

    expect(wrapper.get('.message').text()).toBe(text)
    wrapper.unmount()
  })

  it('leaves the numbers out while the lists are not there', async () => {
    listsService.list.mockRejectedValue(new ApiError('NETWORK'))
    const { wrapper } = await mountSection('owner')
    await flushPromises()

    await wrapper.get('button.open').trigger('click')

    expect(wrapper.get('.message').text()).toBe(
      '“WG Kaiserstraße” is deleted with all lists and items for all members. This cannot be undone.',
    )
    wrapper.unmount()
  })

  it('does not load the lists for someone who can only leave', async () => {
    const { wrapper } = await mountSection('member')
    await flushPromises()

    expect(listsService.list).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('deletes the household after the confirmation and goes to the start page', async () => {
    const { wrapper, router } = await mountSection('owner')

    await wrapper.get('button.open').trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe('Delete household?')
    expect(wrapper.get('.message').text()).toContain('“WG Kaiserstraße” is deleted')
    expect(service.remove).not.toHaveBeenCalled()

    await wrapper.get('.confirm').trigger('click')
    await flushPromises()

    expect(service.remove).toHaveBeenCalledWith('g1')
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('leaves with the own user ID and goes to the start page', async () => {
    const { wrapper, router } = await mountSection('member')

    await wrapper.get('button.open').trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe('Leave “WG Kaiserstraße”?')
    await wrapper.get('.confirm').trigger('click')
    await flushPromises()

    expect(service.removeMember).toHaveBeenCalledWith('g1', 'user-1')
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('shows the message of a server error, stays on the page and forgets it when asked again', async () => {
    service.removeMember.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper, router } = await mountSection('member')

    await wrapper.get('button.open').trigger('click')
    await wrapper.get('.confirm').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')
    expect(router.currentRoute.value.name).toBe('settings')

    await wrapper.get('.cancel').trigger('click')
    await wrapper.get('button.open').trigger('click')

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
