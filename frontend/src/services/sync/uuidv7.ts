// UUIDv7 (RFC 9562) for the IDs of items that are made on this device, so an
// item can be created offline and sent later without an ID conflict
// (docs/sync.md). The first 48 bits are the Unix time in milliseconds, so
// IDs made later sort after IDs made earlier.
//
// Own code instead of a library or crypto.randomUUID(): randomUUID() makes
// a version 4 UUID (no time part, but the docs require version 7), and it
// exists only in secure contexts, so it is missing in development over
// http://<LAN-IP>. getRandomValues works there. For about 20 lines a new
// dependency is not worth it.

const TIMESTAMP_BYTES = 6
const UUID_BYTES = 16
const MAX_TIMESTAMP = 2 ** 48 - 1
const BYTE = 256
// The version 7 in the high nibble of byte 6, and the variant bits 10 in the
// two high bits of byte 8.
const VERSION_7 = 0x70
const VARIANT_RFC = 0x80

/**
 * A new UUIDv7 in the lowercase 8-4-4-4-12 form. Within the same
 * millisecond the order of two IDs is random, which is enough here: the
 * order of changes comes from the clocks and the outbox, not from the IDs.
 *
 * `now` and `random` can be replaced in tests.
 */
export function uuidv7(
  now: () => number = Date.now,
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (bytes) =>
    crypto.getRandomValues(bytes),
): string {
  const ms = now()
  // A programming error (or a broken clock), not something a user can cause.
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMESTAMP) {
    throw new RangeError(`UUIDv7: time ${ms} does not fit 48 bits`)
  }

  const bytes = random(new Uint8Array(UUID_BYTES))
  // Divides instead of shifting: JavaScript bit operators work on 32 bits,
  // a millisecond timestamp needs 48.
  let rest = ms
  for (let i = TIMESTAMP_BYTES - 1; i >= 0; i--) {
    bytes[i] = rest % BYTE
    rest = Math.floor(rest / BYTE)
  }
  bytes[6] = VERSION_7 | ((bytes[6] ?? 0) & 0x0f)
  bytes[8] = VARIANT_RFC | ((bytes[8] ?? 0) & 0x3f)

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
