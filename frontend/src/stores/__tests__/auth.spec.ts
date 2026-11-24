import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

import { ApiError } from '@/services/api/client'
import type { AuthService } from '@/services/api/auth'
import type { SignedInMarker } from '@/services/signedInMarker'
import { createFakeServerEvents } from '@/services/sync/__tests__/fakeServerEvents'
import type { DevLoginRequest, MeResponse } from '@/types/api'

import { defineAuthStore, type LocalProfile } from '../auth'

const ANNA_ID = '0190a8c4-0000-7000-8000-000000000001'
const BEN_ID = '0190a8c4-0000-7000-8000-000000000002'

function me(email: string, id = ANNA_ID): MeResponse {
  return {
    id,
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

/** The profile stored on the device, in memory. */
function fakeLocal(initial: MeResponse | null = null) {
  let stored = initial
  return {
    get stored() {
      return stored
    },
    readMe: vi.fn((): Promise<MeResponse | null> => Promise.resolve(stored)),
    claim: vi.fn((profile: MeResponse) => {
      stored = profile
      return Promise.resolve()
    }),
    clear: vi.fn(() => {
      stored = null
      return Promise.resolve()
    }),
  } satisfies LocalProfile & { readonly stored: MeResponse | null }
}

/** A promise the test settles by hand, for a server that has not answered yet. */
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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

  it.each([
    { name: 'network error', err: new ApiError('NETWORK') },
    { name: 'server error', err: new ApiError('INTERNAL_ERROR', 500) },
  ])('keeps the user signed in when logout fails with a $name', async ({ err }) => {
    const marker = fakeMarker()
    const service = {
      ...fakeService('anna@example.com'),
      logout: vi.fn(() => Promise.reject(err)),
    }
    const store = defineAuthStore(service, null, marker)()
    await store.load()

    await expect(store.logout()).rejects.toThrow()

    expect(store.status).toBe('authenticated')
    expect(store.user?.email).toBe('anna@example.com')
    expect(marker.value).toBe(true)
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

describe('local profile', () => {
  // A store with a fake device storage and fake live events; the marker says
  // someone was signed in on the last visit, as it does after a stored sign-in.
  function setup(service: ReturnType<typeof fakeService>, stored: MeResponse | null) {
    const local = fakeLocal(stored)
    const events = createFakeServerEvents()
    const marker = fakeMarker(stored !== null)
    const store = defineAuthStore(service, null, marker, local, events)()
    return { store, local, events, marker }
  }

  it('stores the profile after a sign-in', async () => {
    const { store, local } = setup(fakeService('anna@example.com'), null)

    await store.load()

    expect(local.claim).toHaveBeenCalledWith(me('anna@example.com'))
    expect(store.fromCache).toBe(false)
  })

  it('starts with the stored profile at once and confirms it in the background', async () => {
    const answer = pending<MeResponse>()
    const service = { ...fakeService(), getMe: vi.fn(() => answer.promise) }
    const { store, local } = setup(service, me('anna@example.com'))

    await store.load()

    expect(store.status).toBe('authenticated')
    expect(store.user).toEqual(me('anna@example.com'))
    expect(store.fromCache).toBe(true)

    const renamed = { ...me('anna@example.com'), displayName: 'Anna B.' }
    answer.resolve(renamed)
    await flushPromises()

    expect(store.user).toEqual(renamed)
    expect(store.fromCache).toBe(false)
    expect(local.claim).toHaveBeenCalledWith(renamed)
  })

  it('switches to another user the server reports, and hands the storage over first', async () => {
    const { store, local } = setup(
      { ...fakeService(), getMe: vi.fn(() => Promise.resolve(me('ben@example.com', BEN_ID))) },
      me('anna@example.com'),
    )
    // The storage must belong to Ben before the stores see him.
    let userWhileClaiming: string | undefined
    local.claim.mockImplementation(() => {
      userWhileClaiming = store.user?.id
      return Promise.resolve()
    })

    await store.load()
    await flushPromises()

    expect(local.claim).toHaveBeenCalledWith(me('ben@example.com', BEN_ID))
    expect(userWhileClaiming).toBe(ANNA_ID)
    expect(store.user?.id).toBe(BEN_ID)
  })

  it('reports an expired session when the server does not know the stored user', async () => {
    const { store, local, marker } = setup(fakeService(), me('anna@example.com'))

    await store.load()
    await flushPromises()

    expect(store.status).toBe('anonymous')
    expect(store.user).toBeNull()
    expect(store.fromCache).toBe(false)
    expect(store.sessionExpired).toBe(true)
    expect(marker.value).toBe(false)
    // Kept for when the same user signs in again.
    expect(local.clear).not.toHaveBeenCalled()
  })

  it('keeps the stored profile when the server cannot be reached', async () => {
    const service = {
      ...fakeService(),
      getMe: vi.fn(() => Promise.reject(new ApiError('NETWORK'))),
    }
    const { store } = setup(service, me('anna@example.com'))

    await store.load()
    await flushPromises()

    expect(store.status).toBe('authenticated')
    expect(store.user).toEqual(me('anna@example.com'))
    expect(store.fromCache).toBe(true)
    expect(store.errorCode).toBe('NETWORK')
  })

  it('is an error without a stored profile when the server cannot be reached', async () => {
    const service = {
      ...fakeService(),
      getMe: vi.fn(() => Promise.reject(new ApiError('NETWORK'))),
    }
    const { store } = setup(service, null)

    await store.load()

    expect(store.status).toBe('error')
    expect(store.user).toBeNull()
  })

  it('confirms the stored profile once the live socket is back', async () => {
    const service = {
      ...fakeService(),
      getMe: vi.fn((): Promise<MeResponse> => Promise.reject(new ApiError('NETWORK'))),
    }
    const { store, events } = setup(service, me('anna@example.com'))
    await store.load()
    await flushPromises()

    service.getMe.mockImplementation(() => Promise.resolve(me('anna@example.com')))
    events.emit({ type: 'ready' })
    await flushPromises()

    expect(store.fromCache).toBe(false)
    expect(store.status).toBe('authenticated')
  })

  it('does not ask again on ready once the server confirmed the user', async () => {
    const service = fakeService('anna@example.com')
    const { store, events } = setup(service, null)
    await store.load()

    events.emit({ type: 'ready' })
    await flushPromises()

    expect(service.getMe).toHaveBeenCalledTimes(1)
  })

  it('does not use the stored profile after the session expired', async () => {
    const service = fakeService('anna@example.com')
    const { store } = setup(service, me('anna@example.com'))
    await store.load()
    await flushPromises()
    store.expireSession()

    service.getMe.mockImplementation(() => Promise.reject(new ApiError('NETWORK')))
    await store.load()

    expect(store.status).toBe('error')
    expect(store.user).toBeNull()
  })

  it('clears the device on logout', async () => {
    const { store, local } = setup(fakeService('anna@example.com'), null)
    await store.load()

    await store.logout()

    expect(local.clear).toHaveBeenCalled()
    expect(local.stored).toBeNull()
  })

  it.each([
    { name: 'network error', err: new ApiError('NETWORK') },
    { name: 'server error', err: new ApiError('INTERNAL_ERROR', 500) },
  ])('keeps device data when logout fails with a $name', async ({ err }) => {
    const service = {
      ...fakeService('anna@example.com'),
      logout: vi.fn(() => Promise.reject(err)),
    }
    const { store, local, marker } = setup(service, null)
    await store.load()

    await expect(store.logout()).rejects.toThrow()

    expect(local.clear).not.toHaveBeenCalled()
    expect(local.stored).toEqual(me('anna@example.com'))
    expect(store.status).toBe('authenticated')
    expect(marker.value).toBe(true)
  })

  it('still accepts an in-flight check when logout fails', async () => {
    const answer = pending<MeResponse>()
    const service = {
      ...fakeService(),
      getMe: vi.fn(() => answer.promise),
      logout: vi.fn(() => Promise.reject(new ApiError('NETWORK'))),
    }
    const { store, local } = setup(service, me('anna@example.com'))
    await store.load()

    await expect(store.logout()).rejects.toThrow()

    const renamed = { ...me('anna@example.com'), displayName: 'Anna B.' }
    answer.resolve(renamed)
    await flushPromises()

    expect(store.status).toBe('authenticated')
    expect(store.user).toEqual(renamed)
    expect(store.fromCache).toBe(false)
    expect(local.claim).toHaveBeenCalledWith(renamed)
  })

  it('does not sign in again when a check answers after the logout', async () => {
    const answer = pending<MeResponse>()
    const service = { ...fakeService(), getMe: vi.fn(() => answer.promise) }
    const { store, local } = setup(service, me('anna@example.com'))
    await store.load()

    await store.logout()
    answer.resolve(me('anna@example.com'))
    await flushPromises()

    expect(store.status).toBe('anonymous')
    expect(store.user).toBeNull()
    // The profile must not land on the device again.
    expect(local.claim).not.toHaveBeenCalled()
    expect(local.stored).toBeNull()
  })
})
