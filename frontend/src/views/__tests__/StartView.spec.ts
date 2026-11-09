import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { AuthService } from '@/services/api/auth'
import type { GroupsService } from '@/services/api/groups'
import type { ListsService } from '@/services/api/lists'
import { useAuthStore } from '@/stores/auth'
import type { Group, List, MeResponse } from '@/types/api'

import StartView from '../StartView.vue'

const ME: MeResponse = {
  id: 'user-1',
  email: 'lena@example.com',
  displayName: 'Lena Müller',
  avatarUrl: null,
  locale: 'en',
  theme: 'system',
}

function group(id: string, name: string): Group {
  return {
    id,
    name,
    role: 'owner',
    members: [
      {
        userId: 'user-1',
        displayName: 'Lena Müller',
        avatarUrl: null,
        role: 'owner',
        joinedAt: '2026-01-01T10:00:00Z',
      },
    ],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

function list(id: string, groupId: string, name: string, archivedAt: string | null = null): List {
  return {
    id,
    groupId,
    name,
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

// The view asks the real getters; replacing them hands it stores built
// around fakes, so the whole view -> store chain runs. vi.hoisted makes the
// fakes exist before the (hoisted) vi.mock factories run.
const { groupsService, listsService, authService } = vi.hoisted(() => ({
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
  authService: {
    getMe: vi.fn<AuthService['getMe']>(),
    devLogin: vi.fn<AuthService['devLogin']>(),
    logout: vi.fn<AuthService['logout']>(),
  },
}))

vi.mock('@/stores/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/auth')>()
  return { ...original, useAuthStore: original.defineAuthStore(authService, null) }
})
vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return {
    ...original,
    useGroupsStore: original.defineGroupsStore(groupsService, () => 'user-1'),
  }
})

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(listsService, () => 'user-1') }
})

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/login', name: 'login', component: { template: '<p />' } },
      { path: '/groups/:groupId', name: 'group', component: { template: '<p />' } },
      {
        path: '/groups/:groupId/settings',
        name: 'group-settings',
        component: { template: '<p />' },
      },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: { template: '<p />' } },
    ],
  })
  await useAuthStore().load()
  const wrapper = mount(StartView, {
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

type Mounted = Awaited<ReturnType<typeof mountView>>['wrapper']
const cardNames = (w: Mounted) => w.findAll('.card .name').map((n) => n.text())

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  authService.getMe.mockResolvedValue(ME)
  authService.devLogin.mockResolvedValue()
  authService.logout.mockResolvedValue()
  groupsService.list.mockResolvedValue([])
  listsService.list.mockResolvedValue([])
  setOnline(true)
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StartView', () => {
  it('greets the user by first name', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('h1').text()).toBe('Hello Lena')
    wrapper.unmount()
  })

  it('shows the groups of the user', async () => {
    groupsService.list.mockResolvedValue([group('g1', 'WG Kaiserstraße'), group('g2', 'Home')])
    const { wrapper } = await mountView()

    expect(cardNames(wrapper)).toEqual(['WG Kaiserstraße', 'Home'])
    wrapper.unmount()
  })

  it('shows the active lists of each household on its card', async () => {
    groupsService.list.mockResolvedValue([group('g1', 'WG Kaiserstraße'), group('g2', 'Home')])
    listsService.list.mockImplementation(async (groupId) =>
      groupId === 'g1'
        ? [list('l1', 'g1', 'Supermarkt'), list('l2', 'g1', 'Alt', '2026-01-02T10:00:00Z')]
        : [list('l3', 'g2', 'Drogerie')],
    )
    const { wrapper } = await mountView()

    expect(listsService.list).toHaveBeenCalledTimes(2)
    const cards = wrapper.findAll('.card')
    expect(cards.map((c) => c.findAll('.list').map((l) => l.text()))).toEqual([
      ['Supermarkt'],
      ['Drogerie'],
    ])
    wrapper.unmount()
  })

  it('shows the cards without lists when those cannot be loaded', async () => {
    groupsService.list.mockResolvedValue([group('g1', 'WG Kaiserstraße')])
    listsService.list.mockRejectedValue(new ApiError('NETWORK'))
    const { wrapper } = await mountView()

    expect(cardNames(wrapper)).toEqual(['WG Kaiserstraße'])
    expect(wrapper.find('.card .lists').exists()).toBe(false)
    expect(wrapper.find('.failed').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers to found or join another household below the cards', async () => {
    groupsService.list.mockResolvedValue([group('g1', 'WG')])
    const { wrapper } = await mountView()

    const buttons = wrapper.findAll('.create-box button')
    expect(buttons.map((b) => b.text())).toEqual(['Create household', 'Paste invite link'])
    await buttons[1]!.trigger('click')
    expect(wrapper.find('dialog[open]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('invites to create a household when there is none', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain('No household yet')
    wrapper.unmount()
  })

  it('opens the create dialog from the button', async () => {
    const { wrapper } = await mountView()

    await wrapper.get('.start-empty .option--create').trigger('click')

    expect(wrapper.get('dialog').attributes('open')).toBeDefined()
    wrapper.unmount()
  })

  it('shows the translated error with a retry button when loading fails', async () => {
    groupsService.list.mockRejectedValueOnce(new ApiError('DB_UNAVAILABLE', 503))
    const { wrapper } = await mountView()

    const failed = wrapper.get('.failed')
    expect(failed.text()).toContain('The database is currently unavailable.')

    groupsService.list.mockResolvedValue([group('g1', 'WG')])
    await failed.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.failed').exists()).toBe(false)
    expect(cardNames(wrapper)).toHaveLength(1)
    wrapper.unmount()
  })

  it('says so when the device is offline', async () => {
    setOnline(false)
    const { wrapper } = await mountView()

    expect(wrapper.get('.offline').text()).toContain('Offline')
    wrapper.unmount()
  })

  it('loads again when the connection comes back after a failed load', async () => {
    setOnline(false)
    groupsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()
    groupsService.list.mockResolvedValue([group('g1', 'WG')])

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(cardNames(wrapper)).toHaveLength(1)
    wrapper.unmount()
  })

  it('logs out and goes to the login page', async () => {
    const { wrapper, router } = await mountView()

    await wrapper.get('.toggle').trigger('click')
    await wrapper.get('.panel button').trigger('click')
    await flushPromises()

    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })
})
