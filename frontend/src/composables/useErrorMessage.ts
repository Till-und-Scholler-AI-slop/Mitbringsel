import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'

import { ERROR_CODE_UNKNOWN } from '@/services/api/client'

/**
 * Translates an error code from the API (or NETWORK/UNKNOWN from the client)
 * into text, once, e.g. for a toast. Codes without a translation fall back
 * to the generic message.
 */
export function useErrorText() {
  const { t, te } = useI18n()
  return (code: string | null) => {
    const key = `errors.${code ?? ERROR_CODE_UNKNOWN}`
    return t(te(key) ? key : `errors.${ERROR_CODE_UNKNOWN}`)
  }
}

/** Like useErrorText, but follows the code and the language as they change. */
export function useErrorMessage(code: MaybeRefOrGetter<string | null>) {
  const errorText = useErrorText()
  return computed(() => errorText(toValue(code)))
}
