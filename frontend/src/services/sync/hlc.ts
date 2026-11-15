// Hybrid logical clocks (HLC), the same as backend/internal/item/hlc.go and
// clock.go. An HLC stamps the change of one field; the server keeps the
// latest per field (last write wins, docs/sync.md).
//
// Format "<wall>-<counter>-<node>", e.g. 0000019a2b3c4d5e-0001-3f2a9c:
// milliseconds since 1970 (16 lowercase hex digits), a counter (4 lowercase
// hex digits) and the node that made the change (1 to 64 characters of
// A-Z a-z 0-9 _ -). Because of the fixed widths, comparing two HLCs as
// strings (a < b) compares the clocks.

declare const hlcBrand: unique symbol
// A string that was checked to be an HLC, so a clock cannot be mixed up with
// any other string (like the type HLC in Go).
export type HLC = string & { readonly [hlcBrand]: true }

export interface HLCParts {
  wallMs: number
  counter: number
  node: string
}

export const MAX_NODE_LENGTH = 64
const MAX_COUNTER = 0xffff
// Like item.MaxClockSkew: the server sets a clock further ahead to its time.
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

const HLC_PATTERN = /^([0-9a-f]{16})-([0-9a-f]{4})-([A-Za-z0-9_-]{1,64})$/
const NODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// The parts of s if it is an HLC in the exact format, otherwise null. Only
// the exact format keeps the string order equal to the clock order.
//
// Unlike Go (63 bits), the wall time must fit a safe JavaScript integer:
// numbers above 2^53 lose precision. That is the year 287396.
function parts(s: string): HLCParts | null {
  const match = HLC_PATTERN.exec(s)
  if (!match) return null
  const [, wallHex, counterHex, node] = match as unknown as [string, string, string, string]
  const wallMs = parseInt(wallHex, 16)
  if (wallMs > Number.MAX_SAFE_INTEGER) return null
  return { wallMs, counter: parseInt(counterHex, 16), node }
}

// Returns s as an HLC, or null if it is not one.
export function parseHLC(s: string): HLC | null {
  return parts(s) ? (s as HLC) : null
}

export function hlcParts(h: HLC): HLCParts {
  // A value of type HLC passed parseHLC or formatHLC.
  return parts(h)!
}

// Builds a clock from its parts. Throws on parts that do not fit the format:
// a programming error, not something a user can cause.
export function formatHLC(wallMs: number, counter: number, node: string): HLC {
  if (!Number.isSafeInteger(wallMs) || wallMs < 0)
    throw new RangeError(`HLC: bad wall time ${wallMs}`)
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new RangeError(`HLC: bad counter ${counter}`)
  }
  if (!NODE_PATTERN.test(node)) throw new RangeError(`HLC: bad node ${JSON.stringify(node)}`)
  const wall = wallMs.toString(16).padStart(16, '0')
  return `${wall}-${counter.toString(16).padStart(4, '0')}-${node}` as HLC
}

// A random node ID, 12 hex characters. Every tab takes its own: tabs of one
// browser share localStorage, and two tabs with the same node could stamp
// two different changes with the same clock, where the second one loses. It
// only has to be unique, not stable; after a reload, observe keeps the new
// clocks above everything the tab has seen.
export function randomNode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface HLCClock {
  readonly node: string
  // A new clock, greater than every clock this one returned or observed
  // before, even if the device time goes backwards.
  next(): HLC
  // The receive rule: remember a clock from elsewhere (an item from the
  // server), so the next change is newer than it, even if the device time
  // runs behind. Ignores what is not an HLC and clocks more than
  // MAX_CLOCK_SKEW_MS ahead of the device time.
  observe(clock: string): void
}

export function createClock(node: string = randomNode(), now: () => number = Date.now): HLCClock {
  if (!NODE_PATTERN.test(node)) throw new RangeError(`HLC: bad node ${JSON.stringify(node)}`)
  // The latest clock issued or observed.
  let wallMs = 0
  let counter = 0

  return {
    node,
    next() {
      const ms = now()
      if (ms > wallMs) {
        wallMs = ms
        counter = 0
      } else if (counter === MAX_COUNTER) {
        // 65536 clocks within one millisecond: borrow the next one.
        wallMs++
        counter = 0
      } else {
        // Same millisecond, the device time went backwards or an observed
        // clock is ahead: keep the wall time and count on.
        counter++
      }
      return formatHLC(wallMs, counter, node)
    },
    observe(clock) {
      const p = parts(clock)
      if (!p || p.wallMs > now() + MAX_CLOCK_SKEW_MS) return
      if (p.wallMs > wallMs || (p.wallMs === wallMs && p.counter > counter)) {
        wallMs = p.wallMs
        counter = p.counter
      }
    },
  }
}
