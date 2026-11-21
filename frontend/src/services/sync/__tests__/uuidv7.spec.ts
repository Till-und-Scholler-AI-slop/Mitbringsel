import { describe, expect, it } from 'vitest'

import { uuidv7 } from '../uuidv7'

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// 2026-03-01T10:00:00Z
const at = Date.UTC(2026, 2, 1, 10)

// A random source that fills every byte with the same value.
function filled(value: number) {
  return (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(value)
}

describe('uuidv7', () => {
  it('has the canonical form with version 7 and the RFC variant', () => {
    for (const value of [0x00, 0x5a, 0xff]) {
      expect(uuidv7(() => at, filled(value))).toMatch(UUIDV7)
    }
    expect(uuidv7()).toMatch(UUIDV7)
  })

  it('starts with the time in milliseconds (48 bits)', () => {
    const id = uuidv7(() => at, filled(0xff))
    const hex = id.replace(/-/g, '').slice(0, 12)
    expect(parseInt(hex, 16)).toBe(at)
  })

  it('keeps a time above 32 bits intact', () => {
    const max = 2 ** 48 - 1
    expect(uuidv7(() => max, filled(0)).startsWith('ffffffff-ffff-7')).toBe(true)
  })

  it('differs between two calls at the same time', () => {
    expect(uuidv7(() => at)).not.toBe(uuidv7(() => at))
  })

  it('sorts a later time after an earlier one', () => {
    const earlier = uuidv7(() => at, filled(0xff))
    const later = uuidv7(() => at + 1, filled(0x00))
    expect(later > earlier).toBe(true)
  })

  it('refuses a time that does not fit 48 bits', () => {
    expect(() => uuidv7(() => -1)).toThrow(RangeError)
    expect(() => uuidv7(() => 2 ** 48)).toThrow(RangeError)
    expect(() => uuidv7(() => 1.5)).toThrow(RangeError)
  })
})
