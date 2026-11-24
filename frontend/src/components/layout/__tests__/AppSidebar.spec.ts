import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { AuthService } from '@/services/api/auth'
import type { GroupsService } from '@/services/api/groups'
import type { ItemsService } from '@/services/api/items'
import type { ListsService } from '@/services/api/lists'
import { localData } from '@/services/storage/localData'
import { useAuthStore } from '@/stores/auth'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import { STICKERS } from '@/components/base/stickers'
import type { Group, Item, List } from '@/types/api'

import AppSidebar from '../AppSidebar.vue'

const { authService, groupsService, listsService, itemsService } = vi.hoisted(() => ({
  authService: {
    getMe: vi.fn<AuthService['getMe']>(),
    devLogin: vi.fn<AuthService['devLogin']>(),
    logout: vi.fn<AuthService['logout']>(),
  },
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
  itemsService: {
    list: vi.fn<ItemsService['list']>(),
    listGroup: vi.fn<ItemsService['listGroup']>(),
    create: vi.fn<ItemsService['create']>(),
    update: vi.fn<ItemsService['update']>(),
    remove: vi.fn<ItemsService['remove']>(),
    removeChecked: vi.fn<ItemsService['removeChecked']>(),
  },
}))

// A signed-in user would start the real live socket and outbox; the chip stays hidden by default.
const syncState = vi.hoisted(() => ({ indicator: 'hidden' as 'hidden' | 'synced' | 'offline' }))
const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)
const outbox = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeOutbox')).createFakeOutbox(),
)
vi.mock('@/stores/sync', () => ({ useSyncStore: () => syncState }))
vi.mock('@/stores/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/auth')>()
  return { ...original, useAuthStore: original.defineAuthStore(authService, null) }
})
vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(groupsService, () => 'u1') }
})
vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(listsService, () => 'u1') }
})
vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return {
    ...original,
    useItemsStore: original.defineItemsStore(itemsService, () => 'u1', serverEvents, undefined, {
      openOutbox: outbox.open,
    }),
  }
})

function group(id: string, name: string, memberCount: number): Group {
  return {
    id,
    name,
    role: 'member',
    members: Array.from({ length: memberCount }, (_, i) => ({
      userId: `u${i}`,
      displayName: `Member ${i}`,
      avatarUrl: null,
      role: 'member' as const,
      joinedAt: '2026-01-01T10:00:00Z',
    })),
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

function list(id: string, name: string, groupId = 'g1', archivedAt: string | null = null): List {
  return {
    id,
    groupId,
    name,
    icon: 'general',
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

function item(id: string, listId: string, checked = false): Item {
  return {
    id,
    listId,
    name: id,
    quantity: null,
    unit: null,
    note: null,
    checked,
    checkedBy: checked ? 'u1' : null,
    checkedAt: checked ? '2026-01-02T10:00:00Z' : null,
    createdBy: 'u1',
    createdAt: '2026-01-01T10:00:00Z',
    updatedBy: 'u1',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  syncState.indicator = 'hidden'
  serverEvents.clear()
  outbox.clear()
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
  authService.getMe.mockResolvedValue({
    id: 'u1',
    email: 'lena@example.com',
    displayName: 'Lena',
    avatarUrl: null,
    locale: 'en',
    theme: 'system',
  })
  authService.logout.mockResolvedValue()
  groupsService.list.mockResolvedValue([group('g1', 'WG Kaiserstraße', 4), group('g2', 'Home', 2)])
  listsService.list.mockImplementation(async (groupId) => {
    if (groupId === 'g1') {
      return [
        { ...list('l1', 'Supermarkt', 'g1'), icon: 'supermarket' },
        { ...list('l2', 'Baumarkt', 'g1'), icon: 'hardware' },
        list('l3', 'Alt', 'g1', '2026-01-02T10:00:00Z'),
      ]
    }
    return [list('l4', 'Wochenmarkt', 'g2')]
  })
  itemsService.listGroup.mockImplementation(async (groupId) => {
    if (groupId === 'g1') {
      return {
        listIds: ['l1', 'l2'],
        items: [
          item('i1', 'l1', false),
          item('i2', 'l1', false),
          item('i3', 'l1', true),
          item('i4', 'l2', false),
        ],
      }
    }
    return {
      listIds: ['l4'],
      items: [
        item('i5', 'l4', false),
        item('i6', 'l4', false),
        item('i7', 'l4', false),
        item('i8', 'l4', false),
        item('i9', 'l4', false),
      ],
    }
  })
  await useAuthStore().load()
  await useGroupsStore().load()
  await Promise.all([
    useListsStore().load('g1'),
    useListsStore().load('g2'),
    useItemsStore().loadGroup('g1'),
    useItemsStore().loadGroup('g2'),
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function mountSidebar(
  props: { groupId?: string; listId?: string } = {},
  locale: 'en' | 'de' = 'en',
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/login', name: 'login', component: { template: '<p />' } },
      { path: '/groups/:groupId', name: 'group', component: { template: '<p />' } },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: { template: '<p />' } },
    ],
  })
  await router.push('/')
  const wrapper = mount(AppSidebar, {
    props,
    global: { plugins: [createAppI18n([locale], null), router] },
    attachTo: document.body,
  })
  return { wrapper, router }
}

type Mounted = Awaited<ReturnType<typeof mountSidebar>>['wrapper']
const entries = (w: Mounted) => w.findAll('.entry')

describe('AppSidebar', () => {
  it('marks start as the current page on the start page and shows no lists', async () => {
    const { wrapper } = await mountSidebar()

    expect(wrapper.get('nav').attributes('aria-label')).toBe('Navigation')
    const [start, ...households] = entries(wrapper)
    expect(start!.text()).toBe('Start')
    expect(start!.attributes('aria-current')).toBe('page')
    expect(
      households.map((h) => [h.get('.entry-name').text(), h.get('.entry-count').text()]),
    ).toEqual([
      ['WG Kaiserstraße', '3'],
      ['Home', '5'],
    ])
    expect(households.map((h) => h.attributes('href'))).toEqual(['/groups/g1', '/groups/g2'])
    expect(wrapper.find('.lists').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the active lists of the open household and marks the open list', async () => {
    const { wrapper } = await mountSidebar({ groupId: 'g1', listId: 'l2' })

    const [start, kaiser, home] = entries(wrapper)
    expect(start!.attributes('aria-current')).toBeUndefined()
    expect(kaiser!.attributes('aria-current')).toBe('true')
    expect(kaiser!.classes()).toContain('entry--current')
    expect(home!.attributes('aria-current')).toBeUndefined()

    const lists = wrapper.get('.lists')
    expect(lists.attributes('aria-label')).toBe('Lists of WG Kaiserstraße')
    const links = lists.findAll('a')
    expect(
      links.map((l) => [
        l.get('.list-name').text(),
        l.get('.list-count').text(),
        l.attributes('href'),
      ]),
    ).toEqual([
      ['Supermarkt', '2', '/groups/g1/lists/l1'],
      ['Baumarkt', '1', '/groups/g1/lists/l2'],
    ])
    expect(links.map((l) => l.attributes('aria-current'))).toEqual([undefined, 'page'])
    wrapper.unmount()
  })

  it('shows open item counts for households and lists with screen reader text', async () => {
    const { wrapper } = await mountSidebar({ groupId: 'g1', listId: 'l2' })

    const [, kaiser, home] = entries(wrapper)
    expect(kaiser!.get('.entry-count').attributes('aria-hidden')).toBe('true')
    expect(kaiser!.get('.entry-count').text()).toBe('3')
    expect(kaiser!.get('.sr-only').text()).toBe(', 3 open items')
    expect(home!.get('.entry-count').attributes('aria-hidden')).toBe('true')
    expect(home!.get('.entry-count').text()).toBe('5')
    expect(home!.get('.sr-only').text()).toBe(', 5 open items')

    const [supermarket, hardware] = wrapper.get('.lists').findAll('a')
    expect(supermarket!.get('.list-count').attributes('aria-hidden')).toBe('true')
    expect(supermarket!.get('.list-count').text()).toBe('2')
    expect(supermarket!.get('.sr-only').text()).toBe(', 2 open items')
    expect(hardware!.get('.list-count').attributes('aria-hidden')).toBe('true')
    expect(hardware!.get('.list-count').text()).toBe('1')
    expect(hardware!.get('.sr-only').text()).toBe(', 1 open item')
    wrapper.unmount()

    const german = await mountSidebar({ groupId: 'g1', listId: 'l2' }, 'de')
    const [deSupermarket, deHardware] = german.wrapper.get('.lists').findAll('a')
    expect(deSupermarket!.get('.sr-only').text()).toBe(', 2 offene Artikel')
    expect(deHardware!.get('.sr-only').text()).toBe(', 1 offener Artikel')
    german.wrapper.unmount()
  })

  it('shows no counts while lists or items are not loaded yet', async () => {
    setActivePinia(createPinia())
    await useAuthStore().load()
    await useGroupsStore().load()
    await useListsStore().load('g1')

    const { wrapper } = await mountSidebar({ groupId: 'g1', listId: 'l1' })

    const [, kaiser, home] = entries(wrapper)
    expect(kaiser!.find('.entry-count').exists()).toBe(false)
    expect(kaiser!.find('.sr-only').exists()).toBe(false)
    expect(home!.find('.entry-count').exists()).toBe(false)
    expect(home!.find('.sr-only').exists()).toBe(false)

    for (const link of wrapper.get('.lists').findAll('a')) {
      expect(link.find('.list-count').exists()).toBe(false)
      expect(link.find('.sr-only').exists()).toBe(false)
    }
    wrapper.unmount()
  })

  it('shows the sticker of each list, but none for the households', async () => {
    const { wrapper } = await mountSidebar({ groupId: 'g1', listId: 'l2' })

    const rotations = wrapper
      .get('.lists')
      .findAll('a')
      .map((l) => l.get('.sticker > g').attributes('transform'))
    expect(rotations).toEqual([
      `rotate(${STICKERS.supermarket.rotate} 24 24)`,
      `rotate(${STICKERS.hardware.rotate} 24 24)`,
    ])
    expect(entries(wrapper).some((e) => e.find('.sticker').exists())).toBe(false)
    wrapper.unmount()
  })

  it('asks the parent to found a household', async () => {
    const { wrapper } = await mountSidebar()

    await wrapper.get('button.create').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
    wrapper.unmount()
  })

  it('signs out from the profile at the bottom', async () => {
    const { wrapper, router } = await mountSidebar()

    await wrapper.get('.profile .toggle').trigger('click')
    await wrapper.get('.profile .panel button').trigger('click')
    await flushPromises()

    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })

  it('asks before signing out when the outbox has pending changes', async () => {
    vi.spyOn(localData, 'readOutbox').mockResolvedValue([
      { seq: 1, queuedAt: 1, change: { kind: 'remove', itemId: 'i1' } },
      { seq: 2, queuedAt: 2, change: { kind: 'remove', itemId: 'i2' } },
    ])
    const { wrapper, router } = await mountSidebar()

    await wrapper.get('.profile .toggle').trigger('click')
    await wrapper.get('.profile .panel button').trigger('click')
    await flushPromises()

    expect(authService.logout).not.toHaveBeenCalled()
    const dialog = wrapper.get('dialog[open]')
    expect(dialog.get('h2').text()).toBe('Sign out?')
    expect(dialog.get('.message-text').text()).toBe(
      '2 changes have not reached the server yet. If you sign out now, they will be lost.',
    )

    await dialog.get('.cancel').trigger('click')
    await flushPromises()
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    expect(authService.logout).not.toHaveBeenCalled()

    await wrapper.get('.profile .toggle').trigger('click')
    await wrapper.get('.profile .panel button').trigger('click')
    await flushPromises()
    await wrapper.get('dialog[open] .confirm').trigger('click')
    await flushPromises()

    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })

  it('opens list actions on right click without navigating and suppresses the browser menu', async () => {
    const { wrapper, router } = await mountSidebar({ groupId: 'g1', listId: 'l2' })
    await router.push('/groups/g1/lists/l2')
    const firstLink = wrapper.get('.lists').findAll('a')[0]!

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    firstLink.element.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('listActions')).toEqual([[expect.objectContaining({ id: 'l1' })]])
    expect(router.currentRoute.value.fullPath).toBe('/groups/g1/lists/l2')
    wrapper.unmount()
  })

  it.each([
    { name: 'ContextMenu key', init: { key: 'ContextMenu' } },
    { name: 'Shift+F10', init: { key: 'F10', shiftKey: true } },
  ])('opens list actions via keyboard ($name) and prevents the browser menu', async ({ init }) => {
    const { wrapper, router } = await mountSidebar({ groupId: 'g1', listId: 'l2' })
    await router.push('/groups/g1/lists/l2')
    const secondLink = wrapper.get('.lists').findAll('a')[1]!

    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
    secondLink.element.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('listActions')).toEqual([[expect.objectContaining({ id: 'l2' })]])
    expect(router.currentRoute.value.fullPath).toBe('/groups/g1/lists/l2')
    wrapper.unmount()
  })

  it('ignores other keys and navigates on normal click', async () => {
    const { wrapper, router } = await mountSidebar({ groupId: 'g1', listId: 'l2' })
    await router.push('/groups/g1/lists/l2')
    const firstLink = wrapper.get('.lists').findAll('a')[0]!

    await firstLink.trigger('keydown', { key: 'F10' })
    await firstLink.trigger('keydown', { key: 'F10', shiftKey: true, ctrlKey: true })
    await firstLink.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('listActions')).toBeUndefined()

    await firstLink.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('listActions')).toBeUndefined()
    expect(router.currentRoute.value.fullPath).toBe('/groups/g1/lists/l1')
    wrapper.unmount()
  })

  it('tells screen readers how to open list actions on every sidebar list entry', async () => {
    const { wrapper } = await mountSidebar({ groupId: 'g1', listId: 'l2' })
    const links = wrapper.get('.lists').findAll('a')

    const describedByIds = links.map((l) => l.attributes('aria-describedby'))
    expect(describedByIds[0]).toBeTruthy()
    expect(describedByIds[1]).toBe(describedByIds[0])
    expect(wrapper.get(`#${describedByIds[0]}`).text()).toBe(
      'Right-click or press Context Menu (Shift+F10) to edit, archive or delete',
    )
    wrapper.unmount()
  })

  it('names the open household in the pending sync hint, and stays neutral on the start page', async () => {
    syncState.indicator = 'synced'
    outbox.fromOtherTab({ kind: 'remove', itemId: 'i1' })
    await flushPromises()

    const inHousehold = await mountSidebar({ groupId: 'g1', listId: 'l1' })
    expect(inHousehold.wrapper.get('.sync .hint').text()).toBe('Sending to WG Kaiserstraße …')
    inHousehold.wrapper.unmount()

    const onStart = await mountSidebar()
    expect(onStart.wrapper.get('.sync .hint').text()).toBe('Sending changes …')
    onStart.wrapper.unmount()
  })
})
