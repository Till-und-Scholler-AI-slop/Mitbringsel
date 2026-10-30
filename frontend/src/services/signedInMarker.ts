/**
 * Remembers in the browser that someone was signed in here, and nothing
 * else. When the app later starts with a 401, this tells "your session ran
 * out" apart from "you never signed in".
 */
export interface SignedInMarker {
  isSet(): boolean
  set(): void
  clear(): void
}

const SIGNED_IN_STORAGE_KEY = 'mitbringsel.signedIn'
const SIGNED_IN_VALUE = '1'

// localStorage can throw (blocked site data, some private modes). Without it
// the app still works, it just cannot explain an expired session on startup.
function withStorage<T>(action: (storage: Storage) => T, fallback: T): T {
  try {
    return action(localStorage)
  } catch {
    return fallback
  }
}

export const localSignedInMarker: SignedInMarker = {
  isSet: () => withStorage((s) => s.getItem(SIGNED_IN_STORAGE_KEY) !== null, false),
  set: () => withStorage((s) => s.setItem(SIGNED_IN_STORAGE_KEY, SIGNED_IN_VALUE), undefined),
  clear: () => withStorage((s) => s.removeItem(SIGNED_IN_STORAGE_KEY), undefined),
}
