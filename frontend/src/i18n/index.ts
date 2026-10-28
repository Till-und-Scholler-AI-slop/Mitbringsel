import { createI18n } from 'vue-i18n'

import de from './locales/de.json'
import en from './locales/en.json'

export const SUPPORTED_LOCALES = ['de', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const FALLBACK_LOCALE: Locale = 'de'

type MessageSchema = typeof de

function isSupported(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Picks the first supported language from the browser's preference list,
 * e.g. ['fr-FR', 'en-US'] -> 'en'. Falls back to German.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0] ?? ''
    if (isSupported(base)) {
      return base
    }
  }
  return FALLBACK_LOCALE
}

export function createAppI18n(languages: readonly string[] = navigator.languages) {
  return createI18n<[MessageSchema], Locale, false>({
    legacy: false,
    locale: detectLocale(languages),
    fallbackLocale: FALLBACK_LOCALE,
    messages: { de, en },
  })
}
