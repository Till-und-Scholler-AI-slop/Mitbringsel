import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { AuthService } from '@/services/api/auth'
import { redirectTo } from '@/services/navigation'
import { defineAuthStore, type AuthStatus } from '@/stores/auth'
import type { DevLoginRequest } from '@/types/api'

import LoginView from '../LoginView.vue'

// jsdom cannot leave the page; the test only checks where it would go.
vi.mock('@/services/navigation', () => ({ redirectTo: vi.fn() }))

const DEV_USER: DevLoginRequest = { email: 'dev@example.com', name: 'Dev' }
const GOOGLE_LOGIN_URL = '/api/v1/auth/google/login'

interface MountOptions {
  devUser?: DevLoginRequest | null
  path?: string
  status?: AuthStatus
  errorCode?: string
}

/**
 * Mounts the view with a logged-out user. The auth store is created first
 * from fakes; Pinia keeps one store per id, so the view's useAuthStore()
 * gets this instance instead of the real one.
 */
async function mountLogin({
  devUser = null,
  path = '/login',
  status = 'anonymous',
  errorCode,
}: MountOptions = {}) {
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
  // Default: the state after a logout, the server said nobody is logged in.
  auth.status = status
  auth.errorCode = errorCode ?? null

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p>home</p>' } },
      { path: '/login', name: 'login', component: LoginView },
    ],
  })
  await router.push(path)

  const wrapper = mount(LoginView, {
    global: { plugins: [pinia, createAppI18n(['en'], null), router] },
  })
  return { wrapper, service, router }
}

function googleButton(wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper']) {
  return wrapper.get('button.google-sign-in')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(redirectTo).mockClear()
})

describe('LoginView', () => {
  it('offers the dev login in development and logs in with it', async () => {
    const { wrapper, service, router } = await mountLogin({ devUser: DEV_USER })

    const button = wrapper.get('button.dev')
    expect(button.text()).toBe('Sign in as dev@example.com (dev)')

    await button.trigger('click')
    await flushPromises()

    expect(service.devLogin).toHaveBeenCalledWith(DEV_USER)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('has no dev login without a dev user, as in production', async () => {
    const { wrapper } = await mountLogin()

    expect(wrapper.find('button.dev').exists()).toBe(false)
    expect(googleButton(wrapper).text()).toBe('Sign in with Google')
  })

  it('redirects to the Google login and shows that it is on its way', async () => {
    const { wrapper } = await mountLogin()

    await googleButton(wrapper).trigger('click')

    expect(redirectTo).toHaveBeenCalledWith(GOOGLE_LOGIN_URL)
    expect(googleButton(wrapper).attributes('aria-busy')).toBe('true')
    expect(wrapper.get('[role="status"]').text()).toBe('Redirecting to Google …')
  })

  it('is no longer busy when the browser restores the page with the back button', async () => {
    const { wrapper } = await mountLogin()
    await googleButton(wrapper).trigger('click')

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await flushPromises()

    expect(googleButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.redirecting').exists()).toBe(false)
  })

  it('explains that signing in needs a connection while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { wrapper } = await mountLogin()

    expect(wrapper.get('[role="status"]').text()).toContain('Offline')
    expect(googleButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('reports a failed Google login and retries it', async () => {
    const { wrapper } = await mountLogin({ path: '/login?error=access_denied' })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Sign-in didn’t work')

    await alert.get('button.retry').trigger('click')

    expect(redirectTo).toHaveBeenCalledWith(GOOGLE_LOGIN_URL)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('reports an unreachable server with the translated error', async () => {
    const { wrapper } = await mountLogin({ status: 'error', errorCode: 'NETWORK' })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Signing in isn’t possible right now')
    expect(alert.text()).toContain('The server cannot be reached.')
  })

  it('explains an expired session', async () => {
    const { wrapper } = await mountLogin({ path: '/login?reason=session_expired' })

    expect(wrapper.get('[role="status"]').text()).toContain('You’ve been signed out.')
  })
})
