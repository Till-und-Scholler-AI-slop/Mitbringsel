import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { AuthService } from '@/services/api/auth'
import type { GroupsService } from '@/services/api/groups'
import { useAuthStore } from '@/stores/auth'
import type { Group, MeResponse } from '@/types/api'

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

// The view asks the real getters; replacing them hands it stores built
// around fakes, so the whole view -> store chain runs. vi.hoisted makes the
// fakes exist before the (hoisted) vi.mock factories run.
const { groupsService, authService } = vi.hoisted(() => ({
  groupsService: {
    list: vi.fn<GroupsService['list']>(),
    create: vi.fn<GroupsService['create']>(),
    rename: vi.fn<GroupsService['rename']>(),
    remove: vi.fn<GroupsService['remove']>(),
    removeMember: vi.fn<GroupsService['removeMember']>(),
    setMemberRole: vi.fn<GroupsService['setMemberRole']>(),
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

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: { template: '<p />' } },
      {
        path: '/groups/:groupId/settings',
        name: 'group-settings',
        component: { template: '<p />' },
      },
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

    expect(wrapper.findAll('h3').map((h) => h.text())).toEqual(['WG Kaiserstraße', 'Home'])
    wrapper.unmount()
  })

  it('invites to create a household when there is none', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain('No household yet')
    wrapper.unmount()
  })

  it('opens the create dialog from the button', async () => {
    const { wrapper } = await mountView()

    await wrapper.get('.empty-state button').trigger('click')

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
    expect(wrapper.findAll('h3')).toHaveLength(1)
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

    expect(wrapper.findAll('h3')).toHaveLength(1)
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
