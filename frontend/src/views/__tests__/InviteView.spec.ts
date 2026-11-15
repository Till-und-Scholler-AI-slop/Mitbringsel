import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { InvitesService } from '@/services/api/invites'
import { redirectTo } from '@/services/navigation'
import { useAuthStore, type AuthStatus } from '@/stores/auth'
import type { InvitePreview } from '@/types/api'

import InviteView from '../InviteView.vue'

const PREVIEW: InvitePreview = {
  groupName: 'WG Kaiserstraße',
  invitedByName: 'Lena',
  invitedByAvatarUrl: null,
  expiresAt: '2026-12-01T10:00:00Z',
  memberCount: 1,
  members: [{ firstName: 'Lena', avatarUrl: null }],
}

// The view asks the real getters; replacing them hands it stores built
// around fakes. vi.hoisted makes the fakes exist before vi.mock runs.
const { invitesService, groupsService } = vi.hoisted(() => ({
  invitesService: {
    preview: vi.fn<InvitesService['preview']>(),
    accept: vi.fn<InvitesService['accept']>(),
  },
  groupsService: {
    list: vi.fn<GroupsService['list']>(),
    create: vi.fn<GroupsService['create']>(),
    rename: vi.fn<GroupsService['rename']>(),
    remove: vi.fn<GroupsService['remove']>(),
    removeMember: vi.fn<GroupsService['removeMember']>(),
    setMemberRole: vi.fn<GroupsService['setMemberRole']>(),
  },
}))

// jsdom cannot leave the page; the test only checks where it would go.
vi.mock('@/services/navigation', () => ({ redirectTo: vi.fn() }))

vi.mock('@/stores/invites', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/invites')>()
  return { ...original, useInvitesStore: original.defineInvitesStore(invitesService) }
})
vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(groupsService, () => 'user-1') }
})

async function mountView(status: AuthStatus = 'authenticated') {
  useAuthStore().status = status
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/invite/:token', name: 'invite', component: InviteView, props: true },
    ],
  })
  await router.push('/invite/t1')
  await router.isReady()
  const wrapper = mount(InviteView, {
    props: { token: 't1' },
    global: { plugins: [createAppI18n(['en'], null), router] },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  invitesService.preview.mockResolvedValue(PREVIEW)
  invitesService.accept.mockResolvedValue({ groupId: 'g1', groupName: 'WG Kaiserstraße' })
  groupsService.list.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('InviteView', () => {
  it('shows the invite and the join button', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('h1').text()).toBe('You are invited!')
    expect(wrapper.get('h2').text()).toBe('WG Kaiserstraße')
    expect(wrapper.get('.action').text()).toBe('Join')
    wrapper.unmount()
  })

  it('has the slogan and the shop stickers for the desktop header, hidden from screen readers', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('.tagline').text()).toBe('Shopping together, live in sync.')
    const chips = wrapper.get('.chips')
    expect(chips.attributes('aria-hidden')).toBe('true')
    expect(chips.findAll('.chip').map((c) => c.text())).toEqual([
      'Supermarket',
      'Drugstore',
      'Hardware',
    ])
    wrapper.unmount()
  })

  it('asks someone who is not signed in to join with Google and come back here', async () => {
    const { wrapper } = await mountView('anonymous')

    expect(wrapper.get('h2').text()).toBe('WG Kaiserstraße')
    expect(wrapper.get('.sign-in-note').text()).toContain('After signing in')
    const button = wrapper.get('button.google-sign-in')
    expect(button.text()).toBe('Join with Google')

    await button.trigger('click')

    expect(redirectTo).toHaveBeenCalledWith('/api/v1/auth/google/login?next=%2Finvite%2Ft1')
    expect(button.attributes('aria-busy')).toBe('true')
    expect(invitesService.accept).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('offers no Google button to someone who is signed in', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.find('button.google-sign-in').exists()).toBe(false)
    wrapper.unmount()
  })

  it('joins, reloads the households and goes to the start page', async () => {
    const { wrapper, router } = await mountView()

    await wrapper.get('.action').trigger('click')
    await flushPromises()

    expect(invitesService.accept).toHaveBeenCalledWith('t1')
    expect(groupsService.list).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('stays on the invite and shows the message when joining fails for another reason', async () => {
    invitesService.accept.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper, router } = await mountView()

    await wrapper.get('.action').trigger('click')
    await flushPromises()

    expect(wrapper.get('.problem').text()).toContain('The server cannot be reached.')
    expect(wrapper.get('h2').text()).toBe('WG Kaiserstraße')
    expect(router.currentRoute.value.name).toBe('invite')
    wrapper.unmount()
  })

  it.each(['INVITE_NOT_FOUND', 'INVITE_EXPIRED'])(
    'shows "no longer valid" for %s',
    async (code) => {
      invitesService.preview.mockRejectedValue(new ApiError(code, 410))
      const { wrapper } = await mountView()

      expect(wrapper.get('h1').text()).toBe('Oops, no match')
      expect(wrapper.get('h2').text()).toBe('This link is no longer valid')
      wrapper.unmount()
    },
  )

  it('switches to "no longer valid" when the invite expires while looking at it', async () => {
    invitesService.accept.mockRejectedValueOnce(new ApiError('INVITE_EXPIRED', 410))
    const { wrapper } = await mountView()

    await wrapper.get('.action').trigger('click')
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe('This link is no longer valid')
    wrapper.unmount()
  })

  it('shows the translated error with a retry for other load errors', async () => {
    invitesService.preview.mockRejectedValueOnce(new ApiError('DB_UNAVAILABLE', 503))
    const { wrapper } = await mountView()

    expect(wrapper.get('h2').text()).toBe('The invite could not be loaded')
    expect(wrapper.text()).toContain('The database is currently unavailable.')

    await wrapper.get('.action').trigger('click')
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('counts down after a rate limit and allows a retry afterwards', async () => {
    vi.useFakeTimers()
    invitesService.preview.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 429, 2))
    const { wrapper } = await mountView()

    expect(wrapper.get('h1').text()).toBe('Take a breath')
    expect(wrapper.get('.wait').text()).toContain('2 seconds left')
    expect(wrapper.get('.action').text()).toBe('Try again in 2 s')
    expect(wrapper.get('.action').attributes('disabled')).toBeDefined()

    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.get('.action').attributes('disabled')).toBeUndefined()

    await wrapper.get('.action').trigger('click')
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('uses the invite the join dialog loaded and does not ask again', async () => {
    const { useInvitesStore } = await import('@/stores/invites')
    await useInvitesStore().load('t1')
    invitesService.preview.mockClear()

    const { wrapper } = await mountView()

    expect(invitesService.preview).not.toHaveBeenCalled()
    expect(wrapper.get('h2').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })
})
