import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { apiGet, setUnauthenticatedHandler } from '@/services/api/client'

import { installSessionExpiry, type SessionExpiryStore } from '../sessionExpiry'

function unauthorizedFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })),
    ),
  )
}

async function setup(expireResults: boolean[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p>home</p>' } },
      { path: '/login', name: 'login', component: { template: '<p>login</p>' } },
    ],
  })
  await router.push('/')
  const auth: SessionExpiryStore = { expireSession: vi.fn(() => expireResults.shift() ?? false) }
  installSessionExpiry(router, auth)
  return { router, auth }
}

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthenticatedHandler(null)
})

describe('installSessionExpiry', () => {
  it('sends a signed-in user to the login page when a request gets 401', async () => {
    unauthorizedFetch()
    const { router } = await setup([true])

    await apiGet('/groups').catch(() => undefined)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))

    expect(router.currentRoute.value.query).toEqual({ reason: 'session_expired' })
  })

  it('stays put when the store says nobody was signed in', async () => {
    unauthorizedFetch()
    const { router, auth } = await setup([false])

    await apiGet('/me').catch(() => undefined)

    expect(auth.expireSession).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('home')
  })
})
