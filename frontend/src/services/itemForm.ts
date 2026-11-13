import type { Unit } from '@/types/api'

/** The limits of the backend (api/openapi.yaml, CreateItemRequest). */
export const ITEM_NAME_MAX_LENGTH = 100
export const ITEM_NOTE_MAX_LENGTH = 500
export const ITEM_QUANTITY_MAX = 100_000

/** The units in the order the form shows them. */
export const UNITS: readonly Unit[] = ['piece', 'g', 'kg', 'ml', 'l', 'pack']

/** What the minus and plus buttons next to the quantity add. */
const QUANTITY_STEP = 1
/** Steps of 1 on 0.1 give 1.1000000000000001; rounding keeps what was typed. */
const QUANTITY_DECIMALS = 3

export type ItemNameProblem = 'empty' | 'tooLong'

// Counted in characters, not UTF-16 units, so an emoji counts once (like on
// the server).
const lengthOf = (text: string) => Array.from(text.trim()).length

/** Checks a name like the backend does: 1 to 100 characters after trimming. */
export function validateItemName(name: string): ItemNameProblem | null {
  const length = lengthOf(name)
  if (length === 0) return 'empty'
  if (length > ITEM_NAME_MAX_LENGTH) return 'tooLong'
  return null
}

/** A note may be empty; at most 500 characters after trimming. */
export function isItemNoteTooLong(note: string): boolean {
  return lengthOf(note) > ITEM_NOTE_MAX_LENGTH
}

/**
 * A quantity as typed: "2,5" and "2.5" are the same, empty and 0 mean no
 * quantity (the design drops a 0 on saving). Anything else that is not a
 * plain decimal number is 'invalid', more than the backend takes 'tooLarge'.
 */
export type ParsedQuantity =
  { ok: true; value: number | null } | { ok: false; problem: 'invalid' | 'tooLarge' }

// Digits with at most one decimal separator; no sign, no exponent, no
// thousands separator: "1.000" would be ambiguous between the languages.
const QUANTITY_PATTERN = /^(\d+([.,]\d*)?|[.,]\d+)$/

export function parseQuantity(text: string): ParsedQuantity {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!QUANTITY_PATTERN.test(trimmed)) return { ok: false, problem: 'invalid' }
  const value = Number(trimmed.replace(',', '.'))
  if (value === 0) return { ok: true, value: null }
  if (value > ITEM_QUANTITY_MAX) return { ok: false, problem: 'tooLarge' }
  return { ok: true, value }
}

/**
 * One step of the minus or plus button. Minus at 1 or below clears the
 * quantity, plus on none gives 1; the result never passes the maximum.
 */
export function stepQuantity(value: number | null, direction: -1 | 1): number | null {
  const next = Number(((value ?? 0) + direction * QUANTITY_STEP).toFixed(QUANTITY_DECIMALS))
  if (next <= 0) return null
  return Math.min(next, ITEM_QUANTITY_MAX)
}
