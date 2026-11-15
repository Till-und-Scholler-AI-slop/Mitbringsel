import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { AuthService } from '@/services/api/auth'
import type { GroupsService } from '@/services/api/groups'
import type { ListsService } from '@/services/api/lists'
import { useAuthStore } from '@/stores/auth'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'
import type { Group, List } from '@/types/api'

import AppSidebar from '../AppSidebar.vue'

const { authService, groupsService, listsService } = vi.hoisted(() => ({
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
    rename: vi.fn<ListsService['rename']>(),
    setArchived: vi.fn<ListsService['setArchived']>(),
    remove: vi.fn<ListsService['remove']>(),
  },
}))

// A signed-in user would start the real live socket; the chip stays hidden.
vi.mock('@/stores/sync', () => ({ useSyncStore: () => ({ indicator: 'hidden' }) }))
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

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
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
  listsService.list.mockResolvedValue([
    list('l1', 'Supermarkt'),
    list('l2', 'Baumarkt'),
    list('l3', 'Alt', '2026-01-02T10:00:00Z'),
  ])
  await useAuthStore().load()
  await useGroupsStore().load()
  await useListsStore().load('g1')
})

async function mountSidebar(props: { groupId?: string; listId?: string } = {}) {
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
    global: { plugins: [createAppI18n(['en'], null), router] },
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
      ['WG Kaiserstraße', '4'],
      ['Home', '2'],
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
    expect(links.map((l) => [l.text(), l.attributes('href')])).toEqual([
      ['Supermarkt', '/groups/g1/lists/l1'],
      ['Baumarkt', '/groups/g1/lists/l2'],
    ])
    expect(links.map((l) => l.attributes('aria-current'))).toEqual([undefined, 'page'])
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
})
