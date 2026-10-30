import { createI18n } from 'vue-i18n'

import de from './locales/de.json'
import en from './locales/en.json'

export const SUPPORTED_LOCALES = ['de', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const FALLBACK_LOCALE: Locale = 'de'

/** Each language in its own words, so people find theirs whatever is active. */
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' }

/** Where the language picked on the language switch is remembered. */
export const LOCALE_STORAGE_KEY = 'mitbringsel.locale'

type MessageSchema = typeof de

export function isSupported(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Reads the language the user picked earlier, or null if there is none.
 * localStorage can throw (blocked site data, some private modes); the app
 * then simply starts with the browser language.
 */
export function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY)
    return value !== null && isSupported(value) ? value : null
  } catch {
    return null
  }
}

/** Remembers the picked language. Failing to store it only loses the convenience. */
export function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignored on purpose: see readStoredLocale.
  }
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

/** Starts with the language picked earlier, else the browser's. */
export function createAppI18n(
  languages: readonly string[] = navigator.languages,
  storedLocale: Locale | null = readStoredLocale(),
) {
  return createI18n<[MessageSchema], Locale, false>({
    legacy: false,
    locale: storedLocale ?? detectLocale(languages),
    fallbackLocale: FALLBACK_LOCALE,
    messages: { de, en },
  })
}
