import { afterEach, describe, expect, it } from 'vitest'

import type { ApiErrorCode } from '@/types/api'

import de from '../locales/de.json'
import en from '../locales/en.json'
import {
  createAppI18n,
  detectLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  storeLocale,
} from '../index'

// Turns { a: { b: 'x' } } into ['a.b'] so the key sets can be compared.
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('locale files', () => {
  it('have exactly the same keys in de and en', () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(de).sort())
  })
})

// Listing the codes as object keys makes the type checker demand every code
// from api/openapi.yaml: a new code fails the build here until it is added
// (and translated below).
const API_ERROR_CODES: Record<ApiErrorCode, true> = {
  NOT_FOUND: true,
  METHOD_NOT_ALLOWED: true,
  DB_UNAVAILABLE: true,
  UNAUTHENTICATED: true,
  INTERNAL_ERROR: true,
  CROSS_ORIGIN_REQUEST: true,
  INVALID_REQUEST: true,
  INVALID_IDENTITY: true,
  GROUP_NOT_FOUND: true,
  FORBIDDEN: true,
  GROUP_NAME_INVALID: true,
  INVALID_ROLE: true,
  OWNER_IMMUTABLE: true,
}

describe('error messages', () => {
  it.each(Object.keys(API_ERROR_CODES))('translate %s', (code) => {
    expect(Object.keys(de.errors)).toContain(code)
  })
})

describe('stored locale', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('round-trips a supported language', () => {
    storeLocale('en')
    expect(readStoredLocale()).toBe('en')
  })

  it('ignores values that are not a supported language', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr')
    expect(readStoredLocale()).toBeNull()
  })

  it('wins over the browser language', () => {
    const i18n = createAppI18n(['de'], 'en')
    expect(i18n.global.locale.value).toBe('en')
  })
})

describe('detectLocale', () => {
  it.each([
    { name: 'exact match', languages: ['en'], want: 'en' },
    { name: 'regional variant', languages: ['de-AT'], want: 'de' },
    { name: 'first supported wins', languages: ['fr-FR', 'en-US', 'de'], want: 'en' },
    { name: 'case insensitive', languages: ['EN-gb'], want: 'en' },
    { name: 'nothing supported falls back to german', languages: ['fr', 'es'], want: 'de' },
    { name: 'empty list falls back to german', languages: [], want: 'de' },
  ])('$name', ({ languages, want }) => {
    expect(detectLocale(languages)).toBe(want)
  })
})
