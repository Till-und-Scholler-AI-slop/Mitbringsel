import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

import type { AuthStatus } from '@/stores/auth'

import { createAppRouter, type AuthGuardStore } from '../index'

// HomeView and LoginView are imported by the router but never rendered here.
beforeEach(() => {
  setActivePinia(createPinia())
})

/** A fake auth store whose load() ends in the given status. */
function fakeAuth(statusAfterLoad: AuthStatus): AuthGuardStore {
  const auth: AuthGuardStore = {
    status: 'unknown',
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
})
