import { describe, expect, it } from 'vitest'

import de from '../locales/de.json'
import en from '../locales/en.json'
import { detectLocale } from '../index'

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
