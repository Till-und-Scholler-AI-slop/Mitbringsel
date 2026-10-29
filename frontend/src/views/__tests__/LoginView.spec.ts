import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { AuthService } from '@/services/api/auth'
import { defineAuthStore } from '@/stores/auth'
import type { DevLoginRequest } from '@/types/api'

import LoginView from '../LoginView.vue'

const DEV_USER: DevLoginRequest = { email: 'dev@example.com', name: 'Dev' }

/**
 * Mounts the view with a logged-out user. The auth store is created first
 * from fakes; Pinia keeps one store per id, so the view's useAuthStore()
 * gets this instance instead of the real one.
 */
async function mountLogin(devUser: DevLoginRequest | null) {
  let loggedIn = false
  const service = {
    getMe: vi.fn(() =>
      loggedIn
        ? Promise.resolve({
            id: '0190a8c4-0000-7000-8000-000000000001',
            email: DEV_USER.email,
            displayName: 'Dev',
            avatarUrl: null,
            locale: 'de' as const,
            theme: 'system' as const,
          })
        : Promise.reject(new ApiError('UNAUTHENTICATED', 401)),
    ),
    devLogin: vi.fn(() => {
      loggedIn = true
      return Promise.resolve()
    }),
    logout: vi.fn(() => Promise.resolve()),
  } satisfies AuthService

  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = defineAuthStore(service, devUser)()
  // State after a logout: the server said nobody is logged in.
  auth.status = 'anonymous'

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p>home</p>' } },
      { path: '/login', name: 'login', component: LoginView },
    ],
  })
  await router.push('/login')

  const wrapper = mount(LoginView, {
    global: { plugins: [pinia, createAppI18n(['en']), router] },
  })
  return { wrapper, service, router }
}

describe('LoginView', () => {
  it('offers the dev login in development and logs in with it', async () => {
    const { wrapper, service, router } = await mountLogin(DEV_USER)

    const button = wrapper.get('button.dev')
    expect(button.text()).toBe('Sign in as dev@example.com (dev)')

    await button.trigger('click')
    await flushPromises()

    expect(service.devLogin).toHaveBeenCalledWith(DEV_USER)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('has no dev login without a dev user, as in production', async () => {
    const { wrapper } = await mountLogin(null)

    expect(wrapper.find('button.dev').exists()).toBe(false)
    expect(wrapper.get('a.google').attributes('href')).toBe('/api/v1/auth/google/login')
  })
})
