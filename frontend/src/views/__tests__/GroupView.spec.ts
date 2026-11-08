import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { ListsService } from '@/services/api/lists'
import type { Group, List, Role } from '@/types/api'

import GroupView from '../GroupView.vue'

const groupsService = vi.hoisted(() => ({
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
  rename: vi.fn<ListsService['rename']>(),
  setArchived: vi.fn<ListsService['setArchived']>(),
  remove: vi.fn<ListsService['remove']>(),
}))

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(groupsService, () => 'user-1') }
})
vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(listsService, () => 'user-1') }
})

function group(role: Role): Group {
  return {
    id: 'g1',
    name: 'WG Kaiserstraße',
    role,
    members: [],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

function list(id: string, name: string, archivedAt: string | null = null): List {
  return {
    id,
    groupId: 'g1',
    name,
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  groupsService.list.mockResolvedValue([group('owner')])
  listsService.list.mockResolvedValue([])
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
      { path: '/groups/:groupId', name: 'group', component: {} },
      { path: '/groups/:groupId/settings', name: 'group-settings', component: {} },
    ],
  })
  await router.push(`/groups/${groupId}`)
  const wrapper = mount(GroupView, {
    props: { groupId },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

const names = (wrapper: Awaited<ReturnType<typeof mountView>>['wrapper']) =>
  wrapper.findAll('.cards h3').map((h) => h.text())

describe('GroupView', () => {
  it('loads the household and its lists and shows the name', async () => {
    listsService.list.mockResolvedValue([list('l1', 'Supermarkt'), list('l2', 'Baumarkt')])

    const { wrapper } = await mountView()

    expect(groupsService.list).toHaveBeenCalledTimes(1)
    expect(listsService.list).toHaveBeenCalledWith('g1', { includeArchived: true })
    expect(wrapper.get('h1').text()).toBe('WG Kaiserstraße')
    expect(names(wrapper)).toEqual(['Supermarkt', 'Baumarkt'])
    wrapper.unmount()
  })

  it('shows a spinner while the lists load', async () => {
    listsService.list.mockReturnValue(new Promise(() => undefined))

    const { wrapper } = await mountView()

    expect(wrapper.get('[role="status"]').text()).toBe('Loading lists …')
    wrapper.unmount()
  })

  it('invites to create a list when there is none', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('.empty-state h2').text()).toBe('No list yet')
    wrapper.unmount()
  })

  it('says so and offers a retry when the lists cannot be loaded', async () => {
    listsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()

    expect(wrapper.get('[role="alert"]').text()).toContain('The lists could not be loaded.')
    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')

    listsService.list.mockResolvedValueOnce([list('l1', 'Supermarkt')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(names(wrapper)).toEqual(['Supermarkt'])
    wrapper.unmount()
  })

  it('says so and offers a retry when the household cannot be loaded', async () => {
    groupsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()

    expect(wrapper.get('[role="alert"]').text()).toContain('The household could not be loaded.')

    groupsService.list.mockResolvedValueOnce([group('owner')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('says that the household is not found when it is not among the loaded ones', async () => {
    const { wrapper, router } = await mountView('other')

    expect(wrapper.text()).toContain('Household not found')
    await wrapper.get('main button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('goes back to the start page and on to the settings', async () => {
    const { wrapper, router } = await mountView()

    await wrapper.get('a[aria-label="Manage household"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('group-settings')

    await router.push('/groups/g1')
    await wrapper.get('button[aria-label="Back to the start page"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  describe('archive', () => {
    const lists = [
      list('l1', 'Supermarkt'),
      list('l2', 'Baumarkt', '2026-02-01T10:00:00Z'),
      list('l3', 'Drogerie', '2026-02-02T10:00:00Z'),
    ]

    it('hides archived lists behind a toggle with their count', async () => {
      listsService.list.mockResolvedValue(lists)
      const { wrapper } = await mountView()

      const toggle = wrapper.get('.archived-toggle')
      expect(toggle.text()).toBe('Archived (2)')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(wrapper.get('#archived-lists').isVisible()).toBe(false)

      await toggle.trigger('click')

      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(wrapper.get('#archived-lists').isVisible()).toBe(true)
      expect(wrapper.get('#archived-lists').text()).toContain('Baumarkt')
      wrapper.unmount()
    })

    it('has no toggle without archived lists', async () => {
      listsService.list.mockResolvedValue([list('l1', 'Supermarkt')])
      const { wrapper } = await mountView()

      expect(wrapper.find('.archived-toggle').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  describe('create', () => {
    it('adds a new list to the page', async () => {
      listsService.list.mockResolvedValue([list('l1', 'Supermarkt')])
      listsService.create.mockResolvedValue(list('l2', 'Baumarkt'))
      const { wrapper } = await mountView()

      await wrapper.get('.section-head button').trigger('click')
      await wrapper.get('input').setValue('Baumarkt')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(listsService.create).toHaveBeenCalledWith('g1', 'Baumarkt')
      expect(names(wrapper)).toEqual(['Supermarkt', 'Baumarkt'])
      wrapper.unmount()
    })
  })

  describe('actions', () => {
    async function openActions(role: Role) {
      groupsService.list.mockResolvedValue([group(role)])
      listsService.list.mockResolvedValue([list('l1', 'Supermarkt')])
      const result = await mountView()
      await result.wrapper.get('button[aria-label="Actions for Supermarkt"]').trigger('click')
      return result
    }

    it('archives a list, which then moves to the archive', async () => {
      const { wrapper } = await openActions('member')
      listsService.setArchived.mockResolvedValue(list('l1', 'Supermarkt', '2026-02-01T10:00:00Z'))

      await wrapper.findAll('.action')[1]!.trigger('click')
      await flushPromises()

      expect(names(wrapper)).toEqual(['Supermarkt'])
      expect(wrapper.find('.cards .card--archived').exists()).toBe(true)
      expect(wrapper.get('.archived-toggle').text()).toBe('Archived (1)')
      expect(wrapper.find('.action').exists()).toBe(false)
      wrapper.unmount()
    })

    it('renames through the name form', async () => {
      const { wrapper } = await openActions('member')
      listsService.rename.mockResolvedValue(list('l1', 'Drogerie'))

      await wrapper.findAll('.action')[0]!.trigger('click')
      await flushPromises()

      // The page has two name forms; this is the one titled "Rename list".
      const form = wrapper
        .findAll('dialog')
        .find((d) => d.get('h2').text() === 'Rename list')!
        .get('form')
      const input = form.get('input')
      expect((input.element as HTMLInputElement).value).toBe('Supermarkt')
      await input.setValue('Drogerie')
      await form.trigger('submit')
      await flushPromises()

      expect(listsService.rename).toHaveBeenCalledWith('l1', 'Drogerie')
      expect(names(wrapper)).toEqual(['Drogerie'])
      wrapper.unmount()
    })

    it('lets owners delete a list', async () => {
      const { wrapper } = await openActions('owner')
      listsService.remove.mockResolvedValue()

      await wrapper.findAll('.action')[2]!.trigger('click')
      await wrapper.get('.delete').trigger('click')
      await flushPromises()

      expect(listsService.remove).toHaveBeenCalledWith('l1')
      expect(names(wrapper)).toEqual([])
      wrapper.unmount()
    })

    it('does not offer delete to members', async () => {
      const { wrapper } = await openActions('member')

      expect(wrapper.findAll('.action-title').map((e) => e.text())).toEqual(['Rename', 'Archive'])
      wrapper.unmount()
    })
  })
})
