import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

import type { AuthStatus } from '@/stores/auth'

import { createAppRouter, type AuthGuardStore } from '../index'

// StartView, InviteView and LoginView are imported by the router but never rendered here.
beforeEach(() => {
  setActivePinia(createPinia())
})

/** A fake auth store whose load() ends in the given status. */
function fakeAuth(statusAfterLoad: AuthStatus, sessionExpired = false): AuthGuardStore {
  const auth: AuthGuardStore = {
    status: 'unknown',
    sessionExpired,
    load: vi.fn(() => {
      auth.status = statusAfterLoad
      return Promise.resolve()
    }),
  }
  return auth
}

async function navigate(auth: AuthGuardStore, path: string) {
  const router = createAppRouter(() => auth, createMemoryHistory())
  await router.push(path)
  return router.currentRoute.value.name
}

describe('auth guard', () => {
  it.each([
    { status: 'authenticated', path: '/', want: 'home' },
    { status: 'anonymous', path: '/', want: 'login' },
    { status: 'authenticated', path: '/groups/g1', want: 'group' },
    { status: 'anonymous', path: '/groups/g1', want: 'login' },
    { status: 'authenticated', path: '/groups/g1/lists/l1', want: 'list' },
    { status: 'anonymous', path: '/groups/g1/lists/l1', want: 'login' },
    { status: 'authenticated', path: '/groups/g1/settings', want: 'group-settings' },
    { status: 'anonymous', path: '/groups/g1/settings', want: 'login' },
    { status: 'authenticated', path: '/invite/abc', want: 'invite' },
    // The invite page is open to everyone; it asks anonymous visitors to sign in.
    { status: 'anonymous', path: '/invite/abc', want: 'invite' },
    // A server error must not look like a logout.
    { status: 'error', path: '/', want: 'home' },
    { status: 'anonymous', path: '/login', want: 'login' },
    { status: 'authenticated', path: '/login', want: 'home' },
    { status: 'error', path: '/login', want: 'login' },
  ] as const)('$status user opening $path ends on $want', async ({ status, path, want }) => {
    expect(await navigate(fakeAuth(status), path)).toBe(want)
  })

  it('asks the server only on the first navigation', async () => {
    const auth = fakeAuth('authenticated')
    const router = createAppRouter(() => auth, createMemoryHistory())

    await router.push('/')
    await router.push('/login')

    expect(auth.load).toHaveBeenCalledTimes(1)
  })

  it('explains an expired session on the login page', async () => {
    const router = createAppRouter(() => fakeAuth('anonymous', true), createMemoryHistory())

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ reason: 'session_expired' })
  })

  it('remembers the page that needs the login', async () => {
    const router = createAppRouter(() => fakeAuth('anonymous'), createMemoryHistory())
    router.addRoute({
      path: '/lists/:id',
      name: 'list',
      component: { template: '<p />' },
      meta: { requiresAuth: true },
    })

    await router.push('/lists/7?sort=name')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ next: '/lists/7?sort=name' })
  })

  it('sends a signed-in user from the login page to where the login was meant to lead', async () => {
    const router = createAppRouter(() => fakeAuth('authenticated'), createMemoryHistory())

    await router.push('/login?next=/invite/abc')

    expect(router.currentRoute.value.fullPath).toBe('/invite/abc')
  })

  it('ignores a next path that leads to another site', async () => {
    const router = createAppRouter(() => fakeAuth('authenticated'), createMemoryHistory())

    await router.push('/login?next=//evil.example')

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('adds no reason for someone who was never signed in', async () => {
    const router = createAppRouter(() => fakeAuth('anonymous'), createMemoryHistory())

    await router.push('/')

    expect(router.currentRoute.value.query).toEqual({})
  })
})
