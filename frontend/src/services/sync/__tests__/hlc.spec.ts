import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  MAX_CLOCK_SKEW_MS,
  createClock,
  formatHLC,
  hlcParts,
  parseHLC,
  randomNode,
  type HLC,
} from '../hlc'

interface Case {
  name: string
  in: string
}
interface HLCCases {
  valid: Case[]
  invalid: Case[]
  ordered: { name: string; older: string; newer: string }[]
}

// The cases shared with backend/internal/item/hlc_test.go, so both clocks
// agree on what is valid and on the order. Read at run time, not imported:
// the Docker build type-checks the tests with only frontend/ in its context.
const cases: HLCCases = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../api/testdata/hlc.json'), 'utf8'),
)

function hlc(s: string): HLC {
  const parsed = parseHLC(s)
  if (!parsed) throw new Error(`not an HLC: ${s}`)
  return parsed
}

// 2026-03-01T10:00:00Z, the time the Go tests use.
const at = Date.UTC(2026, 2, 1, 10)

describe('parseHLC (shared cases)', () => {
  it.each(cases.valid)('accepts $name', ({ in: s }) => {
    const parsed = parseHLC(s)
    expect(parsed).toBe(s)
    // Building it again from its parts gives the same string.
    const { wallMs, counter, node } = hlcParts(parsed!)
    expect(formatHLC(wallMs, counter, node)).toBe(s)
  })

  it.each(cases.invalid)('refuses $name', ({ in: s }) => {
    expect(parseHLC(s)).toBeNull()
  })

  it.each(cases.ordered)('orders by string: $name', ({ older, newer }) => {
    expect(hlc(older) < hlc(newer)).toBe(true)
  })
})

describe('parseHLC', () => {
  it('refuses a wall time beyond a safe JavaScript integer', () => {
    // Valid in Go (63 bits), but JavaScript numbers lose precision above 2^53.
    expect(parseHLC('0020000000000000-0000-a')).toBeNull()
    expect(parseHLC('001fffffffffffff-0000-a')).not.toBeNull()
  })
})

describe('formatHLC', () => {
  it('writes the fixed format', () => {
    expect(formatHLC(0x19a2b3c4d5e, 1, '3f2a9c')).toBe('0000019a2b3c4d5e-0001-3f2a9c')
  })

  it.each([
    ['a negative wall time', -1, 0, 'a'],
    ['a fractional wall time', 1.5, 0, 'a'],
    ['a counter above 16 bits', at, 0x10000, 'a'],
    ['a negative counter', at, -1, 'a'],
    ['an empty node', at, 0, ''],
    ['a node with a space', at, 0, 'a b'],
    ['a node over the limit', at, 0, 'a'.repeat(65)],
  ])('throws for %s', (_, wallMs, counter, node) => {
    expect(() => formatHLC(wallMs, counter, node)).toThrow(RangeError)
  })
})

describe('randomNode', () => {
  it('is a valid node of 12 hex characters, different each time', () => {
    const a = randomNode()
    const b = randomNode()
    expect(a).toMatch(/^[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})

describe('createClock', () => {
  // A clock whose device time the test sets.
  function clockAt(start: number, node = 'tab') {
    let time = start
    const clock = createClock(node, () => time)
    return {
      clock,
      set(ms: number) {
        time = ms
      },
    }
  }

  it('picks a random node by default', () => {
    expect(createClock().node).toMatch(/^[0-9a-f]{12}$/)
    expect(createClock().node).not.toBe(createClock().node)
  })

  it('refuses a bad node', () => {
    expect(() => createClock('a b')).toThrow(RangeError)
  })

  it('stamps the device time with its node', () => {
    const { clock } = clockAt(at)
    expect(clock.next()).toBe(formatHLC(at, 0, 'tab'))
  })

  it('counts on within the same millisecond', () => {
    const { clock } = clockAt(at)
    const first = clock.next()
    const second = clock.next()
    expect(hlcParts(second)).toEqual({ wallMs: at, counter: 1, node: 'tab' })
    expect(first < second).toBe(true)
  })

  it('starts the counter again in a new millisecond', () => {
    const { clock, set } = clockAt(at)
    clock.next()
    clock.next()
    set(at + 1)
    expect(hlcParts(clock.next())).toEqual({ wallMs: at + 1, counter: 0, node: 'tab' })
  })

  it('keeps rising when the device time goes backwards', () => {
    const { clock, set } = clockAt(at)
    const before = clock.next()
    set(at - 60_000)
    const after = clock.next()
    expect(hlcParts(after)).toEqual({ wallMs: at, counter: 1, node: 'tab' })
    expect(before < after).toBe(true)
  })

  it('borrows the next millisecond when the counter runs out', () => {
    const { clock } = clockAt(at)
    let last = clock.next()
    for (let i = 0; i < 0xffff; i++) last = clock.next()
    expect(hlcParts(last).counter).toBe(0xffff)

    const next = clock.next()
    expect(hlcParts(next)).toEqual({ wallMs: at + 1, counter: 0, node: 'tab' })
    expect(last < next).toBe(true)
  })

  describe('observe', () => {
    it('stamps the next change after a newer clock, even with a slower device time', () => {
      const { clock } = clockAt(at)
      // Another device, a minute ahead, with a node that sorts after ours.
      const seen = formatHLC(at + 60_000, 3, 'zzz')
      clock.observe(seen)

      const next = clock.next()
      expect(hlcParts(next)).toEqual({ wallMs: at + 60_000, counter: 4, node: 'tab' })
      expect(seen < next).toBe(true)
    })

    it('ignores an older clock', () => {
      const { clock } = clockAt(at)
      clock.next()
      clock.observe(formatHLC(at - 1, 9, 'zzz'))
      expect(hlcParts(clock.next())).toEqual({ wallMs: at, counter: 1, node: 'tab' })
    })

    it('takes a higher counter in the same millisecond', () => {
      const { clock } = clockAt(at)
      clock.next()
      clock.observe(formatHLC(at, 7, 'other'))
      expect(hlcParts(clock.next())).toEqual({ wallMs: at, counter: 8, node: 'tab' })
    })

    it('ignores a clock too far ahead of the device time', () => {
      const { clock } = clockAt(at)
      clock.observe(formatHLC(at + MAX_CLOCK_SKEW_MS + 1, 0, 'broken'))
      expect(hlcParts(clock.next())).toEqual({ wallMs: at, counter: 0, node: 'tab' })
    })

    it('takes a clock right at the limit', () => {
      const { clock } = clockAt(at)
      clock.observe(formatHLC(at + MAX_CLOCK_SKEW_MS, 0, 'ahead'))
      expect(hlcParts(clock.next()).wallMs).toBe(at + MAX_CLOCK_SKEW_MS)
    })

    it('ignores what is not a clock', () => {
      const { clock } = clockAt(at)
      clock.observe('nonsense')
      clock.observe('')
      expect(clock.next()).toBe(formatHLC(at, 0, 'tab'))
    })
  })
})
