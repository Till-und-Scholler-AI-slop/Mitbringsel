import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '@/services/api/client'
import type { HealthService } from '@/services/api/health'

import { defineHealthStore } from '../health'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('health store', () => {
  it('starts idle', () => {
    const store = defineHealthStore({ getHealth: () => Promise.resolve({ status: 'ok' }) })()

    expect(store.state).toBe('idle')
    expect(store.errorCode).toBeNull()
  })

  it('is ok after a successful check', async () => {
    const store = defineHealthStore({ getHealth: () => Promise.resolve({ status: 'ok' }) })()

    await store.check()

    expect(store.state).toBe('ok')
    expect(store.errorCode).toBeNull()
  })

  it('keeps the api error code on failure', async () => {
    const service: HealthService = {
      getHealth: () => Promise.reject(new ApiError('DB_UNAVAILABLE', 503)),
    }
    const store = defineHealthStore(service)()

    await store.check()

    expect(store.state).toBe('error')
    expect(store.errorCode).toBe('DB_UNAVAILABLE')
  })

  it('uses UNKNOWN for errors that are not api errors', async () => {
    const service: HealthService = { getHealth: () => Promise.reject(new Error('boom')) }
    const store = defineHealthStore(service)()

    await store.check()

    expect(store.state).toBe('error')
    expect(store.errorCode).toBe('UNKNOWN')
  })

  it('clears the error when a retry succeeds', async () => {
    let healthy = false
    const service: HealthService = {
      getHealth: () =>
        healthy ? Promise.resolve({ status: 'ok' }) : Promise.reject(new ApiError('NETWORK')),
    }
    const store = defineHealthStore(service)()

    await store.check()
    healthy = true
    await store.check()

    expect(store.state).toBe('ok')
    expect(store.errorCode).toBeNull()
  })
})
