import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { ItemsService } from '@/services/api/items'
import type { ListsService } from '@/services/api/lists'
import type { Group, Item, List } from '@/types/api'

import ListView from '../ListView.vue'

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

const itemsService = vi.hoisted(() => ({
  list: vi.fn<ItemsService['list']>(),
  create: vi.fn<ItemsService['create']>(),
  update: vi.fn<ItemsService['update']>(),
  remove: vi.fn<ItemsService['remove']>(),
}))

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(groupsService, () => 'user-1') }
})
vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(listsService, () => 'user-1') }
})
vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return { ...original, useItemsStore: original.defineItemsStore(itemsService, () => 'user-1') }
})

const GROUP: Group = {
  id: 'g1',
  name: 'WG Kaiserstraße',
  role: 'member',
  members: [
    {
      userId: 'user-1',
      displayName: 'Lena',
      avatarUrl: null,
      role: 'owner',
      joinedAt: '2026-01-01T10:00:00Z',
    },
    {
      userId: 'user-2',
      displayName: 'Jonas',
      avatarUrl: null,
      role: 'member',
      joinedAt: '2026-01-01T10:00:00Z',
    },
  ],
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
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

function item(id: string, name: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    listId: 'l1',
    name,
    quantity: null,
    unit: null,
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: 'user-2',
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  groupsService.list.mockResolvedValue([GROUP])
  listsService.list.mockResolvedValue([list('l1', 'Supermarkt'), list('l2', 'Baumarkt')])
  itemsService.list.mockResolvedValue([])
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

async function mountView(listId = 'l1', groupId = 'g1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/groups/:groupId', name: 'group', component: { template: '<p />' } },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: { template: '<p />' } },
    ],
  })
  await router.push(`/groups/${groupId}/lists/${listId}`)
  const wrapper = mount(ListView, {
    props: { groupId, listId },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

type Mounted = Awaited<ReturnType<typeof mountView>>['wrapper']
const openNames = (w: Mounted) => w.findAll('.open .name').map((e) => e.text())
const doneNames = (w: Mounted) => w.findAll('.done-items .name').map((e) => e.text())

describe('ListView: loading', () => {
  it('loads household, lists and items and shows the list', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Milch'), item('i2', 'Brot')])

    const { wrapper } = await mountView()

    expect(groupsService.list).toHaveBeenCalledTimes(1)
    expect(listsService.list).toHaveBeenCalledWith('g1', { includeArchived: true })
    expect(itemsService.list).toHaveBeenCalledWith('l1')
    expect(wrapper.get('h1').text()).toBe('Supermarkt')
    expect(wrapper.get('.group-name').text()).toBe('WG Kaiserstraße')
    expect(openNames(wrapper)).toEqual(['Milch', 'Brot'])
    wrapper.unmount()
  })

  it('shows a spinner while the list loads', async () => {
    listsService.list.mockReturnValue(new Promise(() => undefined))

    const { wrapper } = await mountView()

    expect(wrapper.get('[role="status"]').text()).toBe('Loading list …')
    wrapper.unmount()
  })

  it('says so and offers a retry when the lists cannot be loaded', async () => {
    listsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()

    expect(wrapper.get('[role="alert"]').text()).toContain('The list could not be loaded.')
    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')

    listsService.list.mockResolvedValueOnce([list('l1', 'Supermarkt')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Supermarkt')
    wrapper.unmount()
  })

  it('says that the list is not found when it is not among the loaded ones', async () => {
    const { wrapper, router } = await mountView('other')

    expect(wrapper.text()).toContain('List not found')
    await wrapper.get('main button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('group')
    wrapper.unmount()
  })

  it('does not show a list of another household', async () => {
    listsService.list.mockResolvedValue([list('l1', 'Supermarkt')])
    const { wrapper } = await mountView('l1', 'g2')

    expect(wrapper.text()).toContain('List not found')
    wrapper.unmount()
  })

  it('shows a spinner for the items and an error with retry', async () => {
    itemsService.list.mockReturnValueOnce(new Promise(() => undefined))
    const loading = await mountView()
    expect(loading.wrapper.get('[role="status"]').text()).toBe('Loading items …')
    loading.wrapper.unmount()

    setActivePinia(createPinia())
    itemsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()
    expect(wrapper.get('[role="alert"]').text()).toContain('The items could not be loaded.')

    itemsService.list.mockResolvedValueOnce([item('i1', 'Milch')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(openNames(wrapper)).toEqual(['Milch'])
    wrapper.unmount()
  })

  it('invites to fill an empty list', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('.empty-state h2').text()).toBe('Nothing on the list yet')
    wrapper.unmount()
  })
})

describe('ListView: header', () => {
  it('links the logo to the start page and the household name to the household', async () => {
    const { wrapper, router } = await mountView()

    expect(wrapper.get('a.home').attributes('href')).toBe('/')
    await wrapper.get('a[aria-label="Open household WG Kaiserstraße"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('group')
    wrapper.unmount()
  })

  it('shows the active lists as chips and the open count on the current one', async () => {
    listsService.list.mockResolvedValue([
      list('l1', 'Supermarkt'),
      list('l2', 'Baumarkt'),
      list('l3', 'Alt', '2026-02-01T10:00:00Z'),
    ])
    itemsService.list.mockResolvedValue([
      item('i1', 'Milch'),
      item('i2', 'Brot'),
      item('i3', 'Eier', { checked: true, checkedBy: 'user-1' }),
    ])
    const { wrapper } = await mountView()

    expect(wrapper.findAll('.chip-name').map((e) => e.text())).toEqual(['Supermarkt', 'Baumarkt'])
    expect(wrapper.get('.count').text()).toBe('2')
    wrapper.unmount()
  })

  it('marks an archived list', async () => {
    listsService.list.mockResolvedValue([list('l1', 'Supermarkt', '2026-02-01T10:00:00Z')])
    const { wrapper } = await mountView()

    expect(wrapper.get('.archived').text()).toBe('Archived')
    wrapper.unmount()
  })

  it('creates a list from the plus chip and opens it', async () => {
    listsService.create.mockResolvedValue(list('l9', 'Drogerie'))
    const { wrapper, router } = await mountView()

    await wrapper.get('button[aria-label="New list"]').trigger('click')
    await wrapper.get('input').setValue('Drogerie')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(listsService.create).toHaveBeenCalledWith('g1', 'Drogerie')
    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l9' })
    wrapper.unmount()
  })
})

describe('ListView: items', () => {
  // A function: the store changes the items it is given, so tests must not share them.
  const makeItems = () => [
    item('i1', 'Milch', { quantity: 2, unit: 'l', createdBy: 'user-2' }),
    item('i2', 'Eier', { quantity: 10, unit: 'piece', checked: true, checkedBy: 'user-1' }),
    item('i3', 'Brot', { note: 'Vollkorn' }),
  ]

  it('keeps open and checked items apart', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    expect(openNames(wrapper)).toEqual(['Milch', 'Brot'])
    expect(doneNames(wrapper)).toEqual(['Eier'])
    expect(wrapper.get('.done-toggle').text()).toBe('Done (1)')
    wrapper.unmount()
  })

  it('has no done section without checked items', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Milch')])
    const { wrapper } = await mountView()

    expect(wrapper.find('.done').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says who added an item and who checked one', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    const labels = wrapper.findAll('li button').map((b) => b.attributes('aria-label'))
    expect(labels).toEqual([
      'Milch, 2 l, by Jonas – check off',
      'Brot, Vollkorn, by Jonas – check off',
      'Eier, 10 pieces, checked by Lena – bring back',
    ])
    wrapper.unmount()
  })

  it('folds the done section away and back', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()
    const toggle = wrapper.get('.done-toggle')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('#done-items').isVisible()).toBe(true)

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('#done-items').isVisible()).toBe(false)
    wrapper.unmount()
  })

  it('checks an item at once and moves it to the done section', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await mountView()

    await wrapper.findAll('.open li button')[0]!.trigger('click')

    expect(itemsService.update).toHaveBeenCalledWith('i1', { checked: true })
    expect(openNames(wrapper)).toEqual(['Brot'])
    expect(doneNames(wrapper)).toEqual(['Milch', 'Eier'])
    wrapper.unmount()
  })

  it('brings a checked item back', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await mountView()

    await wrapper.get('.done-items li button').trigger('click')

    expect(itemsService.update).toHaveBeenCalledWith('i2', { checked: false })
    expect(openNames(wrapper)).toEqual(['Milch', 'Eier', 'Brot'])
    wrapper.unmount()
  })

  it('puts the item back and says so when checking fails', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockRejectedValue(new ApiError('NETWORK'))
    const { wrapper } = await mountView()

    await wrapper.findAll('.open li button')[0]!.trigger('click')
    await flushPromises()

    expect(openNames(wrapper)).toEqual(['Milch', 'Brot'])
    expect(wrapper.get('[role="alert"]').text()).toContain('Checking the item did not work.')
    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')
    wrapper.unmount()
  })

  it('takes the message away after the next check that works', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()
    await wrapper.findAll('.open li button')[0]!.trigger('click')
    await flushPromises()

    itemsService.update.mockResolvedValueOnce({
      ...makeItems()[2]!,
      checked: true,
      checkedBy: 'user-1',
    })
    await wrapper.findAll('.open li button')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
