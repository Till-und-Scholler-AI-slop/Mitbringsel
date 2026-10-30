import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { FALLBACK_LOCALE, isSupported, storeLocale, type Locale } from '@/i18n'

/**
 * The active language and a way to switch it. Switching is remembered for
 * the next visit; App.vue keeps <html lang> in step.
 */
export function useLocale() {
  // useScope 'global': switch the language of the whole app, not of one component.
  const { locale } = useI18n({ useScope: 'global' })

  const current = computed<Locale>(() =>
    isSupported(locale.value) ? locale.value : FALLBACK_LOCALE,
  )

  function setLocale(next: Locale) {
    locale.value = next
    storeLocale(next)
  }

  return { locale: current, setLocale }
}
