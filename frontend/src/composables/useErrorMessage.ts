import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'

import { ERROR_CODE_UNKNOWN } from '@/services/api/client'

/**
 * Translates an error code from the API (or NETWORK/UNKNOWN from the client)
 * into text. Codes without a translation fall back to the generic message.
 */
export function useErrorMessage(code: MaybeRefOrGetter<string | null>) {
  const { t, te } = useI18n()
  return computed(() => {
    const key = `errors.${toValue(code) ?? ERROR_CODE_UNKNOWN}`
    return t(te(key) ? key : `errors.${ERROR_CODE_UNKNOWN}`)
  })
}
