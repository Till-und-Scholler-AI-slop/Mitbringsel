import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { ItemsService } from '@/services/api/items'
import type { ListsService } from '@/services/api/lists'
import { rememberLastList } from '@/services/lastList'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'
import type { Group, Item, List, ServerMessage } from '@/types/api'

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
  update: vi.fn<ListsService['update']>(),
  setArchived: vi.fn<ListsService['setArchived']>(),
  remove: vi.fn<ListsService['remove']>(),
}))

const itemsService = vi.hoisted(() => ({
  list: vi.fn<ItemsService['list']>(),
  listGroup: vi.fn<ItemsService['listGroup']>(),
  create: vi.fn<ItemsService['create']>(),
  update: vi.fn<ItemsService['update']>(),
  remove: vi.fn<ItemsService['remove']>(),
  removeChecked: vi.fn<ItemsService['removeChecked']>(),
}))

// vi.hoisted runs before the imports, so the fakes have to be imported by hand.
const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)
const outbox = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeOutbox')).createFakeOutbox(),
)

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return {
    ...original,
    useGroupsStore: original.defineGroupsStore(groupsService, () => 'user-1', serverEvents),
  }
})
vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return {
    ...original,
    useListsStore: original.defineListsStore(listsService, () => 'user-1', serverEvents),
  }
})
vi.mock('@/stores/recentChanges', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/recentChanges')>()
  return {
    ...original,
    useRecentChangesStore: original.defineRecentChangesStore(() => 'user-1', serverEvents),
  }
})
vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return {
    ...original,
    useItemsStore: original.defineItemsStore(
      itemsService,
      () => 'user-1',
      serverEvents,
      undefined,
      {
        openOutbox: outbox.open,
      },
    ),
  }
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
    icon: 'general',
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
    updatedBy: 'user-2',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // The stores of the test before are gone with their Pinia; their handlers are not.
  serverEvents.clear()
  outbox.clear()
  outbox.auto(itemsService)
  localStorage.clear()
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

// Mounted behind a real RouterView, so a new URL renders the view again
// with its props, as in the app.
async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/groups/:groupId', name: 'group', component: ListView, props: true },
      {
        path: '/groups/:groupId/settings',
        name: 'group-settings',
        component: { template: '<p />' },
      },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: ListView, props: true },
    ],
  })
  await router.push(path)
  const wrapper = mount(
    { render: () => h(RouterView) },
    {
      global: { plugins: [createAppI18n(['en'], null), router] },
      attachTo: document.body,
    },
  )
  await flushPromises()
  return { wrapper, router }
}

function mountView(listId = 'l1', groupId = 'g1') {
  return mountAt(`/groups/${groupId}/lists/${listId}`)
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
    expect(wrapper.get('.switcher .toggle').text()).toBe('WG Kaiserstraße')
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

    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l1' })
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

describe('ListView: opening the household', () => {
  it('opens the first active list', async () => {
    listsService.list.mockResolvedValue([
      list('l0', 'Alt', '2026-01-02T10:00:00Z'),
      list('l1', 'Supermarkt'),
      list('l2', 'Baumarkt'),
    ])

    const { wrapper, router } = await mountAt('/groups/g1')

    expect(router.currentRoute.value.fullPath).toBe('/groups/g1/lists/l1')
    expect(wrapper.get('h1').text()).toBe('Supermarkt')
    wrapper.unmount()
  })

  it('opens the list that was open last, without a way back to the household', async () => {
    const { wrapper, router } = await mountView('l2')
    await router.push('/')
    await router.push('/groups/g1')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/groups/g1/lists/l2')
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')
    wrapper.unmount()
  })

  it('skips the last list once it is archived', async () => {
    rememberLastList('g1', 'l2')
    listsService.list.mockResolvedValue([
      list('l1', 'Supermarkt'),
      list('l2', 'Baumarkt', '2026-01-02T10:00:00Z'),
    ])

    const { wrapper, router } = await mountAt('/groups/g1')

    expect(router.currentRoute.value.fullPath).toBe('/groups/g1/lists/l1')
    wrapper.unmount()
  })

  it('offers to create the first list, and the archive', async () => {
    listsService.list.mockResolvedValue([list('l2', 'Baumarkt', '2026-01-02T10:00:00Z')])
    listsService.create.mockResolvedValue(list('l3', 'Drogerie'))

    const { wrapper, router } = await mountAt('/groups/g1')

    expect(router.currentRoute.value.fullPath).toBe('/groups/g1')
    expect(wrapper.get('h1').text()).toBe('WG Kaiserstraße')
    expect(wrapper.text()).toContain('No list yet')
    expect(wrapper.findAll('.chip--list')).toHaveLength(0)
    expect(wrapper.get('.chip--archive').text()).toBe('Archive (1)')

    await wrapper.get('main button').trigger('click')
    await wrapper.get('dialog[open] input').setValue('Drogerie')
    await wrapper.get('dialog[open] form').trigger('submit')
    await flushPromises()

    expect(listsService.create).toHaveBeenCalledWith('g1', 'Drogerie', 'drugstore')
    expect(router.currentRoute.value.fullPath).toBe('/groups/g1/lists/l3')
    wrapper.unmount()
  })

  it('says so and offers a retry when the lists cannot be loaded', async () => {
    listsService.list.mockRejectedValue(new ApiError('NETWORK'))

    const { wrapper } = await mountAt('/groups/g1')

    expect(wrapper.get('[role="alert"]').text()).toContain('The list could not be loaded.')
    wrapper.unmount()
  })
})

describe('ListView: header', () => {
  it('stands in the frame with the sidebar, which shows the lists of the household', async () => {
    const { wrapper } = await mountView('l2')

    const sidebarLists = wrapper.findAll('.side .lists a')
    expect(sidebarLists.map((a) => a.get('.list-name').text())).toEqual(['Supermarkt', 'Baumarkt'])
    expect(sidebarLists.map((a) => a.attributes('aria-current'))).toEqual([undefined, 'page'])
    wrapper.unmount()
  })

  it('links the logo to the start page', async () => {
    const { wrapper } = await mountView()

    const home = wrapper.get('a.home')
    expect(home.attributes('href')).toBe('/')
    expect(home.attributes('aria-label')).toBe('To the start page')
    wrapper.unmount()
  })

  it('switches the household with the menu at its name', async () => {
    groupsService.list.mockResolvedValue([GROUP, { ...GROUP, id: 'g2', name: 'Familie' }])
    listsService.list.mockImplementation(async (groupId) =>
      groupId === 'g2'
        ? [{ ...list('l5', 'Drogerie'), groupId: 'g2' }]
        : [list('l1', 'Supermarkt'), list('l2', 'Baumarkt')],
    )
    const { wrapper, router } = await mountView()

    await wrapper.get('.switcher .toggle').trigger('click')
    await wrapper.findAll('.switcher .group')[1]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/groups/g2/lists/l5')
    expect(wrapper.get('.switcher .toggle').text()).toBe('Familie')
    wrapper.unmount()
  })

  it('founds a household from the menu and opens it', async () => {
    groupsService.create.mockResolvedValue({ ...GROUP, id: 'g9', name: 'Familie' })
    listsService.list.mockImplementation(async (groupId) =>
      groupId === 'g9' ? [] : [list('l1', 'Supermarkt'), list('l2', 'Baumarkt')],
    )
    const { wrapper, router } = await mountView()

    await wrapper.get('.switcher .toggle').trigger('click')
    await wrapper.get('.switcher button.action').trigger('click')
    await wrapper.get('dialog[open] input').setValue('Familie')
    await wrapper.get('dialog[open] form').trigger('submit')
    await flushPromises()

    expect(groupsService.create).toHaveBeenCalledWith('Familie')
    expect(router.currentRoute.value.fullPath).toBe('/groups/g9')
    expect(wrapper.text()).toContain('No list yet')
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

  it('keeps the chips in the header below the context column width', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.find('header nav.chips').exists()).toBe(true)
    expect(wrapper.find('main nav.chips').exists()).toBe(false)
    expect(wrapper.get('.add-bar .details').attributes('aria-pressed')).toBeUndefined()
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
    await wrapper.get('dialog[open] input').setValue('Drogerie')
    await wrapper.get('dialog[open] form').trigger('submit')
    await flushPromises()

    expect(listsService.create).toHaveBeenCalledWith('g1', 'Drogerie', 'drugstore')
    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l9' })
    wrapper.unmount()
  })
})

describe('ListView: list actions', () => {
  const actionButton = (w: Mounted, title: string) =>
    w.findAll('button.action').find((b) => b.find('.action-title').text() === title)!

  it('opens the actions when the current chip is chosen again and renames from there', async () => {
    listsService.update.mockResolvedValue(list('l1', 'Wocheneinkauf'))
    const { wrapper } = await mountView()

    await wrapper.get('.chip--list[aria-current="page"]').trigger('click')
    expect(wrapper.get('dialog[open] h2').text()).toBe('Manage list')
    await actionButton(wrapper, 'Edit').trigger('click')
    await wrapper.get('dialog[open] input').setValue('Wocheneinkauf')
    await wrapper.get('dialog[open] form').trigger('submit')
    await flushPromises()

    expect(listsService.update).toHaveBeenCalledWith('l1', 'Wocheneinkauf', 'general')
    expect(wrapper.findAll('.chip-name').map((e) => e.text())).toEqual([
      'Wocheneinkauf',
      'Baumarkt',
    ])
    wrapper.unmount()
  })

  it('opens the actions of another list on a right click', async () => {
    const { wrapper } = await mountView()

    await wrapper.findAll('.chip--list')[1]!.trigger('contextmenu')

    expect(wrapper.get('dialog[open] .question').text()).toBe('What should happen to “Baumarkt”?')
    wrapper.unmount()
  })

  it('goes on with the first active list when the open one is deleted', async () => {
    groupsService.list.mockResolvedValue([{ ...GROUP, role: 'owner' }])
    listsService.remove.mockResolvedValue(undefined)
    const { wrapper, router } = await mountView()

    await wrapper.get('.chip--list[aria-current="page"]').trigger('click')
    await actionButton(wrapper, 'Delete').trigger('click')
    await wrapper.get('dialog[open] button.delete').trigger('click')
    await flushPromises()

    expect(listsService.remove).toHaveBeenCalledWith('l1')
    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l2' })
    expect(wrapper.find('.toast').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a toast and moves to the next active list when another member deletes the open list', async () => {
    const { wrapper, router } = await mountView()

    serverEvents.emit({
      type: 'listDeleted',
      payload: { groupId: 'g1', listId: 'l1', actorId: 'user-2' },
    })
    await flushPromises()

    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l2' })
    expect(wrapper.get('.toast .text').text()).toBe('“Supermarkt” was deleted')
    wrapper.unmount()
  })

  it('shows a toast when the open list is gone after a reload', async () => {
    const { wrapper, router } = await mountView()
    listsService.list.mockResolvedValue([list('l2', 'Baumarkt')])

    await useListsStore().load('g1')
    await flushPromises()

    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l2' })
    expect(wrapper.get('.toast .text').text()).toBe('“Supermarkt” was deleted')
    wrapper.unmount()
  })

  it('closes an open item form and shows only the list toast when someone deletes the list', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Milch')])
    const { wrapper } = await mountView()

    await wrapper.get('.open .edit').trigger('click')
    expect(wrapper.find('dialog[open]').exists()).toBe(true)

    serverEvents.emit({
      type: 'listDeleted',
      payload: { groupId: 'g1', listId: 'l1', actorId: 'user-2' },
    })
    await flushPromises()

    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    expect(wrapper.findAll('.toast .text').map((t) => t.text())).toEqual([
      '“Supermarkt” was deleted',
    ])
    wrapper.unmount()
  })

  it('offers a new list when the last one is deleted', async () => {
    groupsService.list.mockResolvedValue([{ ...GROUP, role: 'owner' }])
    listsService.list.mockResolvedValue([list('l1', 'Supermarkt')])
    listsService.remove.mockResolvedValue(undefined)
    const { wrapper, router } = await mountView()

    await wrapper.get('.chip--list[aria-current="page"]').trigger('click')
    await actionButton(wrapper, 'Delete').trigger('click')
    await wrapper.get('dialog[open] button.delete').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('group')
    expect(wrapper.text()).toContain('No list yet')
    wrapper.unmount()
  })

  it('shows the archived lists behind the archive chip', async () => {
    listsService.list.mockResolvedValue([
      list('l1', 'Supermarkt'),
      list('l3', 'Grillparty', '2026-02-01T10:00:00Z'),
    ])
    const { wrapper } = await mountView()

    await wrapper.get('.chip--archive').trigger('click')

    expect(wrapper.get('dialog[open] h2').text()).toBe('Archived lists')
    expect(wrapper.findAll('dialog[open] a').map((a) => a.text())).toEqual(['Grillparty'])
    wrapper.unmount()
  })

  it('opens list actions from the sidebar on right click and renames the list', async () => {
    listsService.update.mockResolvedValue(list('l2', 'Gartencenter'))
    const { wrapper } = await mountView()

    await wrapper.findAll('.side .lists a')[1]!.trigger('contextmenu')
    expect(wrapper.get('dialog[open] .question').text()).toBe('What should happen to “Baumarkt”?')
    // Member role: delete is hidden just as from the chips.
    expect(actionButton(wrapper, 'Delete')).toBeUndefined()

    await actionButton(wrapper, 'Edit').trigger('click')
    await wrapper.get('dialog[open] input').setValue('Gartencenter')
    await wrapper.get('dialog[open] form').trigger('submit')
    await flushPromises()

    expect(listsService.update).toHaveBeenCalledWith('l2', 'Gartencenter', 'general')
    expect(wrapper.findAll('.side .lists a').map((a) => a.get('.list-name').text())).toEqual([
      'Supermarkt',
      'Gartencenter',
    ])
    expect(wrapper.findAll('.chip-name').map((e) => e.text())).toEqual([
      'Supermarkt',
      'Gartencenter',
    ])
    wrapper.unmount()
  })

  it('opens list actions from the sidebar via context menu key and archives the list', async () => {
    listsService.setArchived.mockResolvedValue(list('l2', 'Baumarkt', '2026-02-01T10:00:00Z'))
    const { wrapper } = await mountView()

    await wrapper.findAll('.side .lists a')[1]!.trigger('keydown', { key: 'ContextMenu' })
    expect(wrapper.get('dialog[open] .question').text()).toBe('What should happen to “Baumarkt”?')

    await actionButton(wrapper, 'Archive').trigger('click')
    await flushPromises()

    expect(listsService.setArchived).toHaveBeenCalledWith('l2', true)
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    expect(wrapper.findAll('.side .lists a').map((a) => a.get('.list-name').text())).toEqual([
      'Supermarkt',
    ])
    expect(wrapper.get('.chip--archive').text()).toBe('Archive (1)')
    wrapper.unmount()
  })

  it('deletes the open list from the sidebar via Shift+F10 and moves to the next active list', async () => {
    groupsService.list.mockResolvedValue([{ ...GROUP, role: 'owner' }])
    listsService.remove.mockResolvedValue(undefined)
    const { wrapper, router } = await mountView()

    await wrapper.findAll('.side .lists a')[0]!.trigger('keydown', { key: 'F10', shiftKey: true })
    await actionButton(wrapper, 'Delete').trigger('click')
    await wrapper.get('dialog[open] button.delete').trigger('click')
    await flushPromises()

    expect(listsService.remove).toHaveBeenCalledWith('l1')
    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l2' })
    expect(wrapper.find('.toast').exists()).toBe(false)
    wrapper.unmount()
  })

  it('navigates on a normal click on a sidebar list entry without opening actions', async () => {
    const { wrapper, router } = await mountView()

    await wrapper.findAll('.side .lists a')[1]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.params).toMatchObject({ groupId: 'g1', listId: 'l2' })
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
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

    const labels = wrapper.findAll('li .toggle').map((b) => b.attributes('aria-label'))
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

    await wrapper.findAll('.open li .toggle')[0]!.trigger('click')

    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      checked: true,
      clock: expect.any(String),
    })
    expect(openNames(wrapper)).toEqual(['Brot'])
    expect(doneNames(wrapper)).toEqual(['Milch', 'Eier'])
    wrapper.unmount()
  })

  it('brings a checked item back', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await mountView()

    await wrapper.get('.done-items li button').trigger('click')

    expect(itemsService.update).toHaveBeenCalledWith('i2', {
      checked: false,
      clock: expect.any(String),
    })
    expect(openNames(wrapper)).toEqual(['Milch', 'Eier', 'Brot'])
    wrapper.unmount()
  })

  it('puts the item back when the server refuses the check', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403))
    const { wrapper } = await mountView()

    await wrapper.findAll('.open li .toggle')[0]!.trigger('click')
    await flushPromises()

    expect(openNames(wrapper)).toEqual(['Milch', 'Brot'])
    wrapper.unmount()
  })
})

describe('ListView: live changes', () => {
  const changed = (changedItem: Item): ServerMessage => ({
    type: 'itemChanged',
    payload: { groupId: 'g1', actorId: 'user-2', item: changedItem },
  })

  it('shows an item another member checks at once', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Milch'), item('i2', 'Brot')])
    const { wrapper } = await mountView()

    serverEvents.emit(
      changed(item('i1', 'Milch', { checked: true, checkedBy: 'user-2', serverSeq: 2 })),
    )
    await flushPromises()

    expect(openNames(wrapper)).toEqual(['Brot'])
    expect(doneNames(wrapper)).toEqual(['Milch'])
    wrapper.unmount()
  })

  it('shows an item another member adds', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Milch')])
    const { wrapper } = await mountView()

    serverEvents.emit(
      changed(item('i2', 'Käse', { createdAt: '2026-01-01T11:00:00Z', serverSeq: 2 })),
    )
    await flushPromises()

    expect(openNames(wrapper)).toEqual(['Milch', 'Käse'])
    wrapper.unmount()
  })

  it('highlights an item another member just changed, with the name', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Milch'), item('i2', 'Brot')])
    const { wrapper } = await mountView()

    serverEvents.emit(changed(item('i2', 'Vollkornbrot', { serverSeq: 2 })))
    await flushPromises()

    const recent = wrapper.findAll('.open .row--recent')
    expect(recent.map((row) => row.get('.name').text())).toEqual(['Vollkornbrot'])
    expect(recent[0]!.get('.recent').text()).toBe('Jonas · just changed')
    wrapper.unmount()
  })

  it('goes to the start page when the user is removed from the household', async () => {
    const { wrapper, router } = await mountView()
    const replace = vi.spyOn(router, 'replace')

    serverEvents.emit({
      type: 'groupRemoved',
      payload: { groupId: 'g1', reason: 'removed', actorId: 'user-2' },
    })
    await flushPromises()

    // Straight to the start page, not first to the household its list was in.
    expect(replace.mock.calls).toEqual([[{ name: 'home' }]])
    expect(router.currentRoute.value.name).toBe('home')
    // replace, not push: the back button must not lead to the household again.
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('goes to the start page when a reload no longer lists the household', async () => {
    const { wrapper, router } = await mountView()
    groupsService.list.mockResolvedValue([])

    await useGroupsStore().load()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })
})

describe('ListView: removing done items', () => {
  const makeItems = () => [
    item('i1', 'Milch'),
    item('i2', 'Eier', { checked: true, checkedBy: 'user-1' }),
    item('i3', 'Brot', { checked: true, checkedBy: 'user-1' }),
  ]

  it('hides the done items at once and offers undo', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await wrapper.get('.done .remove').trigger('click')

    expect(wrapper.find('.done').exists()).toBe(false)
    expect(openNames(wrapper)).toEqual(['Milch'])
    expect(wrapper.get('.toast .text').text()).toBe('2 items removed')
    expect(itemsService.removeChecked).not.toHaveBeenCalled()

    await wrapper.get('.toast .action').trigger('click')

    expect(doneNames(wrapper)).toEqual(['Eier', 'Brot'])
    expect(itemsService.removeChecked).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('sends the removal when the toast goes away', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.removeChecked.mockImplementation((_listId, ids) =>
      Promise.resolve(ids.map((itemId) => ({ itemId, serverSeq: 5 }))),
    )
    const { wrapper } = await mountView()

    await wrapper.get('.done .remove').trigger('click')
    await wrapper.get('.toast .close').trigger('click')
    await flushPromises()

    expect(itemsService.removeChecked).toHaveBeenCalledWith('l1', ['i2', 'i3'])
    expect(wrapper.find('.done').exists()).toBe(false)
    expect(wrapper.find('.toast').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ListView: quick add', () => {
  it('adds an item to the open list', async () => {
    itemsService.create.mockImplementation((_l, r) => Promise.resolve(item(r.id!, r.name)))
    const { wrapper } = await mountView()

    await wrapper.get('.add-bar input').setValue('Hafermilch')
    await wrapper.get('form.add-bar').trigger('submit')
    await flushPromises()

    expect(itemsService.create).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        id: expect.any(String),
        name: 'Hafermilch',
        clock: expect.any(String),
      }),
    )
    expect(openNames(wrapper)).toEqual(['Hafermilch'])
    expect(wrapper.get('.frame').classes()).toContain('frame--bottom-bar')
    wrapper.unmount()
  })

  it('has no quick add without a list', async () => {
    listsService.list.mockResolvedValue([])
    const { wrapper } = await mountAt('/groups/g1')

    expect(wrapper.find('.add-bar').exists()).toBe(false)
    expect(wrapper.get('.frame').classes()).not.toContain('frame--bottom-bar')
    wrapper.unmount()
  })

  it('adds an item with details from the form', async () => {
    itemsService.create.mockImplementation((_l, r) =>
      Promise.resolve(item(r.id!, r.name, { quantity: r.quantity ?? null, unit: r.unit ?? null })),
    )
    const { wrapper } = await mountView()

    await wrapper.get('.add-bar input').setValue('Tomaten')
    await wrapper.get('.add-bar .details').trigger('click')
    const form = wrapper.get('dialog[open] form')
    expect((form.get('input').element as HTMLInputElement).value).toBe('Tomaten')
    await form.get('input[inputmode="decimal"]').setValue('6')
    await form.trigger('submit')
    await flushPromises()

    expect(itemsService.create).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        id: expect.any(String),
        name: 'Tomaten',
        quantity: 6,
        unit: 'piece',
        note: null,
        clock: expect.any(String),
      }),
    )
    expect(openNames(wrapper)).toEqual(['Tomaten'])
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ListView: editing items', () => {
  const makeItems = () => [item('i1', 'Milch', { note: 'Hafer' }), item('i2', 'Brot')]

  it('edits an item in its form and saves only what changed', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockResolvedValue(item('i1', 'Hafermilch', { note: 'Hafer', serverSeq: 2 }))
    const { wrapper } = await mountView()

    await wrapper.findAll('.open .edit')[0]!.trigger('click')
    const form = wrapper.get('dialog[open] form')
    expect(form.get('.meta').text()).toBe('By Jonas · Supermarkt')
    await form.get('input').setValue('Hafermilch')
    await form.trigger('submit')
    await flushPromises()

    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      name: 'Hafermilch',
      clock: expect.any(String),
    })
    expect(openNames(wrapper)).toEqual(['Hafermilch', 'Brot'])
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('deletes an item from its form with undo', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.remove.mockResolvedValue()
    const { wrapper } = await mountView()

    await wrapper.findAll('.open .edit')[0]!.trigger('click')
    await wrapper.get('dialog[open] .remove').trigger('click')

    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    expect(openNames(wrapper)).toEqual(['Brot'])
    expect(wrapper.get('.toast .text').text()).toBe('“Milch” removed')
    expect(itemsService.remove).not.toHaveBeenCalled()

    await wrapper.get('.toast .action').trigger('click')

    expect(openNames(wrapper)).toEqual(['Milch', 'Brot'])
    expect(itemsService.remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('closes the form and says so when someone else deletes the item', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await wrapper.findAll('.open .edit')[0]!.trigger('click')
    serverEvents.emit({
      type: 'itemDeleted',
      payload: { groupId: 'g1', listId: 'l1', itemId: 'i1', serverSeq: 5, actorId: 'user-2' },
    })
    await flushPromises()

    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    expect(wrapper.get('.toast .text').text()).toBe('“Milch” was deleted')
    wrapper.unmount()
  })
})

describe('ListView: context column on a wide screen', () => {
  const makeItems = () => [item('i1', 'Milch', { note: 'Hafer' }), item('i2', 'Brot')]
  const changed = (changedItem: Item): ServerMessage => ({
    type: 'itemChanged',
    payload: { groupId: 'g1', actorId: 'user-2', item: changedItem },
  })

  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cardOf = (w: Mounted) => w.get('.context-column section')
  const titleOf = (w: Mounted) => cardOf(w).get('h2').text()
  const nameField = (w: Mounted) => cardOf(w).get('input').element as HTMLInputElement
  const rows = (w: Mounted) => w.findAll('.open li')

  async function openEdit(w: Mounted, index: number) {
    const button = rows(w)[index]!.get('.edit')
    ;(button.element as HTMLElement).focus()
    await button.trigger('click')
    await flushPromises()
    return button.element
  }

  async function typeName(w: Mounted, value: string) {
    nameField(w).value = value
    await cardOf(w).get('input').trigger('input')
  }

  it('puts the chips at the top of the list column, not in the header', async () => {
    const { wrapper, router } = await mountView()

    expect(wrapper.find('header nav.chips').exists()).toBe(false)
    expect(wrapper.findAll('main nav.chips')).toHaveLength(1)

    await wrapper.findAll('main nav.chips .chip--list')[1]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.params).toMatchObject({ listId: 'l2' })
    wrapper.unmount()
  })

  it('shows the member avatars larger in the header', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('header .member').attributes('style')).toContain('width: 34px')
    wrapper.unmount()
  })

  it('shows the round button pressed while the card offers a new item', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()
    const details = () => wrapper.get('.add-bar .details')

    expect(details().attributes('aria-pressed')).toBe('true')
    expect(details().attributes('aria-label')).toBe('Add item with quantity and note')

    await openEdit(wrapper, 0)
    expect(details().attributes('aria-pressed')).toBe('false')

    await cardOf(wrapper).get('input').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(details().attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('keeps what was typed in the card when the pressed round button is pressed again', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await typeName(wrapper, 'Tomaten')
    await wrapper.get('.add-bar .details').trigger('click')
    await flushPromises()

    expect(nameField(wrapper).value).toBe('Tomaten')
    expect(document.activeElement).toBe(nameField(wrapper))
    wrapper.unmount()
  })

  it('offers an empty form for a new item next to the list, without taking the focus', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    expect(titleOf(wrapper)).toBe('New item')
    expect(cardOf(wrapper).get('.tag').text()).toBe('New in Supermarkt')
    expect(nameField(wrapper).value).toBe('')
    expect(document.activeElement).not.toBe(nameField(wrapper))
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('edits an item in the card, not in a dialog, and offers a new item again after saving', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.update.mockResolvedValue(item('i1', 'Hafermilch', { note: 'Hafer', serverSeq: 2 }))
    const { wrapper } = await mountView()

    const button = await openEdit(wrapper, 0)

    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    expect(titleOf(wrapper)).toBe('Milch')
    expect(document.activeElement).toBe(nameField(wrapper))
    expect(rows(wrapper)[0]!.get('.editing').text()).toBe('Editing')
    expect(button.getAttribute('aria-haspopup')).toBeNull()

    await typeName(wrapper, 'Hafermilch')
    await cardOf(wrapper).get('form').trigger('submit')
    await flushPromises()

    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      name: 'Hafermilch',
      clock: expect.any(String),
    })
    expect(titleOf(wrapper)).toBe('New item')
    expect(nameField(wrapper).value).toBe('')
    expect(wrapper.find('.editing').exists()).toBe(false)
    // Back where the user was.
    expect(document.activeElement).toBe(button)
    wrapper.unmount()
  })

  it('switches to another item while it stays open', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await openEdit(wrapper, 0)
    await typeName(wrapper, 'Hafermilch')
    await openEdit(wrapper, 1)

    expect(nameField(wrapper).value).toBe('Brot')
    expect(document.activeElement).toBe(nameField(wrapper))
    expect(rows(wrapper).map((r) => r.find('.editing').exists())).toEqual([false, true])
    wrapper.unmount()
  })

  it('keeps what was typed when someone else changes the same item', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await openEdit(wrapper, 0)
    await typeName(wrapper, 'Hafermilch')
    serverEvents.emit(changed(item('i1', 'Milch', { note: 'Soja', serverSeq: 2 })))
    await flushPromises()

    expect(nameField(wrapper).value).toBe('Hafermilch')
    wrapper.unmount()
  })

  it('opens a new item with details in place of the edited one', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await openEdit(wrapper, 0)
    await wrapper.get('.add-bar input').setValue('Tomaten')
    await wrapper.get('.add-bar .details').trigger('click')
    await flushPromises()

    expect(titleOf(wrapper)).toBe('New item')
    expect(nameField(wrapper).value).toBe('Tomaten')
    expect(document.activeElement).toBe(nameField(wrapper))
    expect(wrapper.find('.editing').exists()).toBe(false)
    expect(wrapper.get('.add-bar .details').attributes('aria-haspopup')).toBeUndefined()
    wrapper.unmount()
  })

  it('stays open and empty after adding, for the next item', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    itemsService.create.mockImplementation(async (_listId, req) =>
      item(req.id ?? 'i3', req.name, { serverSeq: 3 }),
    )
    const { wrapper } = await mountView()

    await typeName(wrapper, 'Tomaten')
    await cardOf(wrapper).get('form').trigger('submit')
    await flushPromises()

    expect(openNames(wrapper)).toHaveLength(3)
    expect(openNames(wrapper)).toContain('Tomaten')
    expect(titleOf(wrapper)).toBe('New item')
    expect(nameField(wrapper).value).toBe('')
    expect(document.activeElement).toBe(nameField(wrapper))
    wrapper.unmount()
  })

  it('empties the new item form on cancel', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await typeName(wrapper, 'Tomaten')
    await cardOf(wrapper).get('.cancel').trigger('click')
    await flushPromises()

    expect(nameField(wrapper).value).toBe('')
    wrapper.unmount()
  })

  it('closes the edit form with Escape and gives the focus back', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    const button = await openEdit(wrapper, 0)
    await cardOf(wrapper).get('input').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(titleOf(wrapper)).toBe('New item')
    expect(document.activeElement).toBe(button)
    wrapper.unmount()
  })

  it('offers a new item again when the item is deleted from it, with undo', async () => {
    itemsService.list.mockResolvedValue(makeItems())
    const { wrapper } = await mountView()

    await openEdit(wrapper, 0)
    await cardOf(wrapper).get('.remove').trigger('click')
    await flushPromises()

    expect(titleOf(wrapper)).toBe('New item')
    expect(openNames(wrapper)).toEqual(['Brot'])
    expect(wrapper.get('.toast .text').text()).toBe('“Milch” removed')
    wrapper.unmount()
  })
})

describe('ListView: switching lists', () => {
  it('closes the edit form on switch without a deleted-meanwhile toast', async () => {
    itemsService.list.mockImplementation(async (listId) =>
      listId === 'l1' ? [item('i1', 'Milch')] : [item('i2', 'Schrauben', { listId: 'l2' })],
    )
    const { wrapper } = await mountView()

    await wrapper.get('.open .edit').trigger('click')
    expect(wrapper.find('dialog[open]').exists()).toBe(true)

    await wrapper.findAll('.chip--list')[1]!.trigger('click')
    await flushPromises()

    expect(openNames(wrapper)).toEqual(['Schrauben'])
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    expect(wrapper.find('.toast').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps text typed into the quick-add bar on switch', async () => {
    const { wrapper } = await mountView()

    await wrapper.get('.add-bar input').setValue('Hafermilch')
    await wrapper.findAll('.chip--list')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Baumarkt')
    expect((wrapper.get('.add-bar input').element as HTMLInputElement).value).toBe('Hafermilch')
    wrapper.unmount()
  })

  it('keeps the done section folded when switching back to a loaded list', async () => {
    itemsService.list.mockImplementation(async (listId) =>
      listId === 'l1'
        ? [item('i1', 'Eier', { checked: true, checkedBy: 'user-1' })]
        : [item('i2', 'Nägel', { listId: 'l2', checked: true, checkedBy: 'user-1' })],
    )
    const { wrapper } = await mountView()

    // Visit l2 first so both lists are loaded and switching back does not
    // pass through the loading state that unmounts DoneSection.
    await wrapper.findAll('.chip--list')[1]!.trigger('click')
    await flushPromises()
    await wrapper.get('.done-toggle').trigger('click')
    expect(wrapper.get('.done-toggle').attributes('aria-expanded')).toBe('false')

    await wrapper.findAll('.chip--list')[0]!.trigger('click')
    await flushPromises()

    expect(doneNames(wrapper)).toEqual(['Eier'])
    expect(wrapper.get('.done-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('#done-items').isVisible()).toBe(false)
    wrapper.unmount()
  })
})

describe('ListView: pending indicator', () => {
  it('shows a clock icon only on items with unsynced changes and removes it once synced', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Milch')])
    let createdId = ''
    let finishCreate: (created: Item) => void = () => undefined
    itemsService.create.mockImplementation((_listId, req) => {
      createdId = req.id ?? 'i2'
      return new Promise((resolve) => {
        finishCreate = resolve
      })
    })
    const { wrapper } = await mountView()

    await wrapper.get('.add-bar input').setValue('Olivenöl')
    await wrapper.get('form.add-bar').trigger('submit')
    await flushPromises()

    const rows = wrapper.findAll('.open li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.pending').exists()).toBe(false)
    expect(rows[1]!.get('.name').text()).toBe('Olivenöl')
    expect(rows[1]!.get('.pending').attributes('aria-label')).toBe('Not synced yet')

    finishCreate(item(createdId, 'Olivenöl', { createdAt: '2026-01-02T10:00:00Z', serverSeq: 2 }))
    await flushPromises()

    expect(wrapper.find('.open .pending').exists()).toBe(false)
    wrapper.unmount()
  })
})
