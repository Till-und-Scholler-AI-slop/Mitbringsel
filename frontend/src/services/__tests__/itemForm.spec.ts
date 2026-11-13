import { describe, expect, it } from 'vitest'

import {
  isItemNoteTooLong,
  ITEM_NAME_MAX_LENGTH,
  ITEM_NOTE_MAX_LENGTH,
  ITEM_QUANTITY_MAX,
  parseQuantity,
  stepQuantity,
  validateItemName,
} from '../itemForm'

describe('validateItemName', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['Milch', null],
    ['  Milch  ', null],
    ['x'.repeat(ITEM_NAME_MAX_LENGTH), null],
    ['x'.repeat(ITEM_NAME_MAX_LENGTH + 1), 'tooLong'],
    // An emoji is one character, as on the server.
    ['🥛'.repeat(ITEM_NAME_MAX_LENGTH), null],
  ])('%j is %s', (name, want) => {
    expect(validateItemName(name)).toBe(want)
  })
})

describe('isItemNoteTooLong', () => {
  it.each([
    ['', false],
    ['x'.repeat(ITEM_NOTE_MAX_LENGTH), false],
    [` ${'x'.repeat(ITEM_NOTE_MAX_LENGTH)} `, false],
    ['x'.repeat(ITEM_NOTE_MAX_LENGTH + 1), true],
  ])('%#: %s', (note, want) => {
    expect(isItemNoteTooLong(note)).toBe(want)
  })
})

describe('parseQuantity', () => {
  it.each([
    ['', { ok: true, value: null }],
    ['  ', { ok: true, value: null }],
    ['0', { ok: true, value: null }],
    ['0,0', { ok: true, value: null }],
    ['2', { ok: true, value: 2 }],
    ['2,5', { ok: true, value: 2.5 }],
    ['2.5', { ok: true, value: 2.5 }],
    [' 2,5 ', { ok: true, value: 2.5 }],
    ['2,', { ok: true, value: 2 }],
    [',5', { ok: true, value: 0.5 }],
    [String(ITEM_QUANTITY_MAX), { ok: true, value: ITEM_QUANTITY_MAX }],
    [String(ITEM_QUANTITY_MAX + 1), { ok: false, problem: 'tooLarge' }],
    ['-1', { ok: false, problem: 'invalid' }],
    ['1e3', { ok: false, problem: 'invalid' }],
    ['1.000,5', { ok: false, problem: 'invalid' }],
    ['zwei', { ok: false, problem: 'invalid' }],
    [',', { ok: false, problem: 'invalid' }],
  ])('%j gives %j', (text, want) => {
    expect(parseQuantity(text)).toEqual(want)
  })
})

describe('stepQuantity', () => {
  it.each([
    [null, 1, 1],
    [1, 1, 2],
    [2.5, 1, 3.5],
    [0.1, 1, 1.1],
    [ITEM_QUANTITY_MAX, 1, ITEM_QUANTITY_MAX],
    [ITEM_QUANTITY_MAX - 0.5, 1, ITEM_QUANTITY_MAX],
    [2, -1, 1],
    [1, -1, null],
    [0.5, -1, null],
    [null, -1, null],
    [2.5, -1, 1.5],
  ] as const)('%s %s gives %s', (value, direction, want) => {
    expect(stepQuantity(value, direction)).toBe(want)
  })
})
