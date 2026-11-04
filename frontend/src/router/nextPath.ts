// Keeps the return path small enough for the login cookie (docs/auth.md).
const MAX_NEXT_PATH_BYTES = 512

// Any base works: it only shows whether the path stays on the same origin.
const PROBE_ORIGIN = 'http://probe.invalid'

/**
 * Returns next if it is a path inside this app, and null if not. The same
 * rules as `safeNextPath` in backend/internal/httpapi/nextpath.go: the user
 * is sent to this path after the login, so it must never lead to another
 * site (open redirect). Anything from the URL is checked again here, before
 * the app uses it.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== 'string' || next === '' || next[0] !== '/') return null
  if (next[1] === '/' || next[1] === '\\') return null
  // Control characters are dropped from URLs by browsers: "/<Tab>/host" would become "//host".
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null
  if (new TextEncoder().encode(next).length > MAX_NEXT_PATH_BYTES) return null
  try {
    // Throws for a lone surrogate, the JS counterpart of invalid UTF-8.
    encodeURIComponent(next)
    return new URL(next, PROBE_ORIGIN).origin === PROBE_ORIGIN ? next : null
  } catch {
    return null
  }
}
