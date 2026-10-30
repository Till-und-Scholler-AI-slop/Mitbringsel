import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '@/services/api/client'
import type { AuthService } from '@/services/api/auth'
import type { SignedInMarker } from '@/services/signedInMarker'
import type { DevLoginRequest, MeResponse } from '@/types/api'

import { defineAuthStore } from '../auth'

function me(email: string): MeResponse {
  return {
    id: '0190a8c4-0000-7000-8000-000000000001',
    email,
    displayName: email.split('@')[0] ?? email,
    avatarUrl: null,
    locale: 'de',
    theme: 'system',
  }
}

/**
 * A fake backend with one session: getMe answers for whoever devLogin or
 * the test logged in, and 401 when nobody is.
 */
function fakeService(loggedIn: string | null = null) {
  let current = loggedIn
  const service = {
    getMe: vi.fn(() =>
      current ? Promise.resolve(me(current)) : Promise.reject(new ApiError('UNAUTHENTICATED', 401)),
    ),
    devLogin: vi.fn((request: DevLoginRequest) => {
      current = request.email
      return Promise.resolve()
    }),
    logout: vi.fn(() => {
      current = null
      return Promise.resolve()
    }),
  } satisfies AuthService
  return service
}

/** An in-memory marker, so tests neither touch nor depend on localStorage. */
function fakeMarker(initiallySet = false): SignedInMarker & { value: boolean } {
  const marker = {
    value: initiallySet,
    isSet: () => marker.value,
    set: () => {
      marker.value = true
    },
    clear: () => {
      marker.value = false
    },
  }
  return marker
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('auth store', () => {
  it('starts unknown', () => {
    const store = defineAuthStore(fakeService(), null)()

    expect(store.status).toBe('unknown')
    expect(store.user).toBeNull()
  })

  it('is authenticated when the backend knows the user', async () => {
    const store = defineAuthStore(fakeService('anna@example.com'), null)()

    await store.load()

    expect(store.status).toBe('authenticated')
    expect(store.user?.email).toBe('anna@example.com')
  })

  it('is anonymous on 401 without a dev user', async () => {
    const service = fakeService()
    const store = defineAuthStore(service, null)()

    await store.load()

    expect(store.status).toBe('anonymous')
    expect(store.user).toBeNull()
    expect(service.devLogin).not.toHaveBeenCalled()
  })

  it('logs in as the dev user on 401', async () => {
    const service = fakeService()
    const store = defineAuthStore(service, { email: 'tino@example.com', name: 'Tino' })()

    await store.load()

    expect(service.devLogin).toHaveBeenCalledWith({ email: 'tino@example.com', name: 'Tino' })
    expect(store.status).toBe('authenticated')
    expect(store.user?.email).toBe('tino@example.com')
  })

  it('keeps an existing session of the dev user', async () => {
    const service = fakeService('tino@example.com')
    const store = defineAuthStore(service, { email: 'tino@example.com' })()

    await store.load()

    expect(service.devLogin).not.toHaveBeenCalled()
    expect(store.status).toBe('authenticated')
  })

  it('switches to another dev user, e.g. from ?devUser=', async () => {
    const service = fakeService('tino@example.com')
    const store = defineAuthStore(service, { email: 'anna@example.com' })()

    await store.load()

    expect(service.devLogin).toHaveBeenCalledWith({ email: 'anna@example.com' })
    expect(store.user?.email).toBe('anna@example.com')
  })

  it.each([
    { name: 'server error', err: new ApiError('INTERNAL_ERROR', 500), wantCode: 'INTERNAL_ERROR' },
    { name: 'server unreachable', err: new ApiError('NETWORK'), wantCode: 'NETWORK' },
    { name: 'unexpected error', err: new Error('boom'), wantCode: 'UNKNOWN' },
  ])('does not log out on $name', async ({ err, wantCode }) => {
    const service = { ...fakeService(), getMe: vi.fn(() => Promise.reject(err)) }
    const store = defineAuthStore(service, { email: 'tino@example.com' })()

    await store.load()

    expect(store.status).toBe('error')
    expect(store.errorCode).toBe(wantCode)
    expect(service.devLogin).not.toHaveBeenCalled()
  })

  it('shares one request between concurrent loads', async () => {
    const service = fakeService('anna@example.com')
    const store = defineAuthStore(service, null)()

    await Promise.all([store.load(), store.load()])

    expect(service.getMe).toHaveBeenCalledTimes(1)
  })

  it('is anonymous after logout', async () => {
    const service = fakeService('anna@example.com')
    const store = defineAuthStore(service, null)()
    await store.load()

    await store.logout()

    expect(service.logout).toHaveBeenCalled()
    expect(store.status).toBe('anonymous')
    expect(store.user).toBeNull()
  })

  it('clears the local state even if logout fails', async () => {
    const service = {
      ...fakeService('anna@example.com'),
      logout: vi.fn(() => Promise.reject(new ApiError('INTERNAL_ERROR', 500))),
    }
    const store = defineAuthStore(service, null)()
    await store.load()

    await expect(store.logout()).rejects.toThrow()

    expect(store.status).toBe('anonymous')
    expect(store.user).toBeNull()
  })
})

describe('session expiry', () => {
  it('remembers a successful sign-in', async () => {
    const marker = fakeMarker()
    const store = defineAuthStore(fakeService('anna@example.com'), null, marker)()

    await store.load()

    expect(marker.value).toBe(true)
    expect(store.sessionExpired).toBe(false)
  })

  it('reports an expired session when someone was signed in on the last visit', async () => {
    const marker = fakeMarker(true)
    const store = defineAuthStore(fakeService(), null, marker)()

    await store.load()

    expect(store.status).toBe('anonymous')
    expect(store.sessionExpired).toBe(true)
    // Reported once: a reload afterwards is a plain "not signed in".
    expect(marker.value).toBe(false)
  })

  it('reports nothing for a first visit', async () => {
    const store = defineAuthStore(fakeService(), null, fakeMarker())()

    await store.load()

    expect(store.sessionExpired).toBe(false)
  })

  it('expires a session that ends while signed in', async () => {
    const marker = fakeMarker()
    const store = defineAuthStore(fakeService('anna@example.com'), null, marker)()
    await store.load()

    expect(store.expireSession()).toBe(true)

    expect(store.status).toBe('anonymous')
    expect(store.user).toBeNull()
    expect(store.sessionExpired).toBe(true)
    expect(marker.value).toBe(false)
  })

  it('ignores a 401 when nobody is signed in, and a second one', async () => {
    const store = defineAuthStore(fakeService('anna@example.com'), null, fakeMarker())()

    expect(store.expireSession()).toBe(false)
    expect(store.sessionExpired).toBe(false)

    await store.load()
    store.expireSession()
    expect(store.expireSession()).toBe(false)
  })

  it('does not report an expired session after logging out on purpose', async () => {
    const marker = fakeMarker()
    const store = defineAuthStore(fakeService('anna@example.com'), null, marker)()
    await store.load()

    await store.logout()

    expect(store.sessionExpired).toBe(false)
    expect(marker.value).toBe(false)
  })

  it('forgets the expiry after the next sign-in', async () => {
    const service = fakeService('anna@example.com')
    const store = defineAuthStore(service, null, fakeMarker())()
    await store.load()
    store.expireSession()

    await store.load()

    expect(store.status).toBe('authenticated')
    expect(store.sessionExpired).toBe(false)
  })
})
