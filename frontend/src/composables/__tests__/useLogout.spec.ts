import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { AuthService } from '@/services/api/auth'
import type { OutboxEntry } from '@/services/sync/outbox'
import { useAuthStore } from '@/stores/auth'
import { useToastsStore } from '@/stores/toasts'

import { useLogout, type OutboxReader } from '../useLogout'

const authService = vi.hoisted(() => ({
  getMe: vi.fn<AuthService['getMe']>(),
  devLogin: vi.fn<AuthService['devLogin']>(),
  logout: vi.fn<AuthService['logout']>(),
}))

vi.mock('@/stores/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/auth')>()
  return { ...original, useAuthStore: original.defineAuthStore(authService, null) }
})

function entry(seq: number): OutboxEntry {
  return {
    seq,
    queuedAt: 1_700_000_000_000,
    change: { kind: 'remove', itemId: `i${seq}` },
  }
}

async function setup(signedIn = true) {
  const storage: OutboxReader = {
    readOutbox: vi.fn<OutboxReader['readOutbox']>().mockResolvedValue([]),
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/login', name: 'login', component: { template: '<p />' } },
    ],
  })
  await router.push('/')

  if (signedIn) {
    await useAuthStore().load()
  }

  let result!: ReturnType<typeof useLogout>
  const Probe = defineComponent({
    setup() {
      result = useLogout(storage)
      return () => null
    },
  })
  const wrapper = mount(Probe, {
    global: { plugins: [createAppI18n(['en'], null), router] },
  })
  return { wrapper, router, storage, ...result }
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  setOnline(true)
  authService.getMe.mockResolvedValue({
    id: 'u1',
    email: 'lena@example.com',
    displayName: 'Lena',
    avatarUrl: null,
    locale: 'en',
    theme: 'system',
  })
  authService.logout.mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLogout', () => {
  it('signs out immediately when the outbox is empty', async () => {
    const { wrapper, router, storage, logout, confirmOpen } = await setup()

    await logout()

    expect(storage.readOutbox).toHaveBeenCalledWith('u1')
    expect(confirmOpen.value).toBe(false)
    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })

  it('signs out immediately when the outbox is unavailable (null)', async () => {
    const { wrapper, router, storage, logout, confirmOpen } = await setup()
    vi.mocked(storage.readOutbox).mockResolvedValue(null)

    await logout()

    expect(confirmOpen.value).toBe(false)
    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })

  it('signs out immediately and warns when reading the outbox fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper, router, storage, logout, confirmOpen } = await setup()
    vi.mocked(storage.readOutbox).mockRejectedValue(new Error('idb broken'))

    await logout()

    expect(warn).toHaveBeenCalled()
    expect(confirmOpen.value).toBe(false)
    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })

  it('asks for confirmation when the outbox has pending entries, and stays signed in on cancel', async () => {
    const { wrapper, router, storage, logout, confirmOpen, pendingCount } = await setup()
    vi.mocked(storage.readOutbox).mockResolvedValue([entry(1), entry(2)])

    await logout()

    expect(confirmOpen.value).toBe(true)
    expect(pendingCount.value).toBe(2)
    expect(authService.logout).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('home')

    confirmOpen.value = false

    expect(authService.logout).not.toHaveBeenCalled()
    expect(useAuthStore().user?.id).toBe('u1')
    wrapper.unmount()
  })

  it('signs out and navigates to login after confirmation', async () => {
    const { wrapper, router, storage, logout, confirmOpen, confirmLogout } = await setup()
    vi.mocked(storage.readOutbox).mockResolvedValue([entry(1)])

    await logout()
    expect(confirmOpen.value).toBe(true)

    await confirmLogout()

    expect(confirmOpen.value).toBe(false)
    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })

  it('does nothing when offline', async () => {
    setOnline(false)
    const { wrapper, router, storage, logout, confirmOpen } = await setup()

    await logout()

    expect(storage.readOutbox).not.toHaveBeenCalled()
    expect(authService.logout).not.toHaveBeenCalled()
    expect(confirmOpen.value).toBe(false)
    expect(useAuthStore().user?.id).toBe('u1')
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('does not confirm logout once the browser goes offline', async () => {
    const { wrapper, router, storage, logout, confirmOpen, confirmLogout } = await setup()
    vi.mocked(storage.readOutbox).mockResolvedValue([entry(1)])

    await logout()
    expect(confirmOpen.value).toBe(true)

    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    await confirmLogout()

    expect(authService.logout).not.toHaveBeenCalled()
    expect(confirmOpen.value).toBe(true)
    expect(useAuthStore().user?.id).toBe('u1')
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it('stays signed in and shows a persistent error toast when logout fails with an empty outbox', async () => {
    authService.logout.mockRejectedValue(new ApiError('NETWORK'))
    const { wrapper, router, logout } = await setup()

    await logout()

    expect(useAuthStore().user?.id).toBe('u1')
    expect(router.currentRoute.value.name).toBe('home')
    expect(useToastsStore().toasts).toEqual([
      expect.objectContaining({
        kind: 'error',
        timed: false,
        text: 'Signing out didn’t work. You are still signed in.',
        detail: 'The server cannot be reached.',
      }),
    ])
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when confirming logout fails, and succeeds on retry', async () => {
    authService.logout.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper, router, storage, logout, confirmOpen, error, confirmLogout } = await setup()
    vi.mocked(storage.readOutbox).mockResolvedValue([entry(1)])

    await logout()
    await confirmLogout()

    expect(confirmOpen.value).toBe(true)
    expect(error.value).toBe('The server cannot be reached.')
    expect(useToastsStore().toasts).toHaveLength(0)
    expect(useAuthStore().user?.id).toBe('u1')
    expect(router.currentRoute.value.name).toBe('home')

    authService.logout.mockResolvedValueOnce()
    await confirmLogout()

    expect(error.value).toBeNull()
    expect(confirmOpen.value).toBe(false)
    expect(useAuthStore().user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })

  it('skips reading the outbox when nobody is signed in', async () => {
    const { wrapper, router, storage, logout } = await setup(false)

    await logout()

    expect(storage.readOutbox).not.toHaveBeenCalled()
    expect(authService.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
    wrapper.unmount()
  })
})
