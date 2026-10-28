import { ref } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { healthService, type HealthService } from '@/services/api/health'

export type HealthState = 'idle' | 'loading' | 'ok' | 'error'

/**
 * Builds the store around a service. Setup stores cannot take parameters,
 * so this factory is how tests inject a fake service.
 */
export function defineHealthStore(service: HealthService) {
  return defineStore('health', () => {
    const state = ref<HealthState>('idle')
    const errorCode = ref<string | null>(null)

    async function check() {
      state.value = 'loading'
      errorCode.value = null
      try {
        await service.getHealth()
        state.value = 'ok'
      } catch (err) {
        state.value = 'error'
        errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    return { state, errorCode, check }
  })
}

export const useHealthStore = defineHealthStore(healthService)
