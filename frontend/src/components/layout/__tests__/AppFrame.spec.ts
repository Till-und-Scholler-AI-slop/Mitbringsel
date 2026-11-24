import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { GroupsService } from '@/services/api/groups'
import type { ListsService } from '@/services/api/lists'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'

import AppFrame from '../AppFrame.vue'

const { groupsService, listsService } = vi.hoisted(() => ({
  groupsService: {
    list: vi.fn<GroupsService['list']>(),
    create: vi.fn<GroupsService['create']>(),
    rename: vi.fn<GroupsService['rename']>(),
    remove: vi.fn<GroupsService['remove']>(),
    removeMember: vi.fn<GroupsService['removeMember']>(),
    setMemberRole: vi.fn<GroupsService['setMemberRole']>(),
  },
  listsService: {
    list: vi.fn<ListsService['list']>(),
    create: vi.fn<ListsService['create']>(),
    update: vi.fn<ListsService['update']>(),
    setArchived: vi.fn<ListsService['setArchived']>(),
    remove: vi.fn<ListsService['remove']>(),
  },
}))

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(groupsService, () => 'u1') }
})
vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(listsService, () => 'u1') }
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

async function mountFrame(
  props: { groupId?: string; listId?: string; pinnedListId?: string } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/groups/:groupId', name: 'group', component: { template: '<p />' } },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: { template: '<p />' } },
    ],
  })
  await router.push('/')
  const wrapper = mount(AppFrame, {
    props,
    slots: { default: '<p class="content">Page</p>' },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  return { wrapper, router }
}

describe('AppFrame', () => {
  it('puts the page next to the sidebar', async () => {
    const { wrapper } = await mountFrame()

    expect(wrapper.find('.side nav').exists()).toBe(true)
    expect(wrapper.get('.page .content').text()).toBe('Page')
    wrapper.unmount()
  })

  it('founds a household from the sidebar and opens it', async () => {
    groupsService.create.mockResolvedValue({
      id: 'g9',
      name: 'Familie',
      role: 'owner',
      members: [],
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    })
    const { wrapper, router } = await mountFrame()

    await wrapper.get('.side button.create').trigger('click')
    await wrapper.get('dialog[open] input').setValue('Familie')
    await wrapper.get('dialog[open] form').trigger('submit')
    await flushPromises()

    expect(groupsService.create).toHaveBeenCalledWith('Familie')
    expect(router.currentRoute.value.fullPath).toBe('/groups/g9')
    wrapper.unmount()
  })

  it('forwards listActions from the sidebar', async () => {
    groupsService.list.mockResolvedValue([
      {
        id: 'g1',
        name: 'WG',
        role: 'owner',
        members: [],
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:00:00Z',
      },
    ])
    listsService.list.mockResolvedValue([
      {
        id: 'l1',
        groupId: 'g1',
        name: 'Supermarkt',
        icon: 'supermarket',
        archivedAt: null,
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:00:00Z',
        serverSeq: 1,
      },
    ])
    await useGroupsStore().load()
    await useListsStore().load('g1')
    const { wrapper } = await mountFrame({ groupId: 'g1', listId: 'l1' })

    await wrapper.get('.side .lists a').trigger('contextmenu')

    expect(wrapper.emitted('listActions')).toEqual([[expect.objectContaining({ id: 'l1' })]])
    wrapper.unmount()
  })

  it('passes the pinned list on to the sidebar', async () => {
    groupsService.list.mockResolvedValue([
      {
        id: 'g1',
        name: 'WG',
        role: 'owner',
        members: [],
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:00:00Z',
      },
    ])
    listsService.list.mockResolvedValue([
      {
        id: 'l1',
        groupId: 'g1',
        name: 'Supermarkt',
        icon: 'supermarket',
        archivedAt: null,
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:00:00Z',
        serverSeq: 1,
      },
    ])
    await useGroupsStore().load()
    await useListsStore().load('g1')
    const { wrapper } = await mountFrame({ groupId: 'g1', listId: 'l2', pinnedListId: 'l1' })

    expect(wrapper.get('.side .lists [role="img"]').attributes('aria-label')).toBe('pinned')
    wrapper.unmount()
  })
})
