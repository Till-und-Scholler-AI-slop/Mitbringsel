import type { RouteLocationRaw } from 'vue-router'

// How the backend and the app tell the login page why someone is there
// (docs/auth.md): /login?error=<code> and /login?reason=session_expired.
export const LOGIN_QUERY_ERROR = 'error'
export const LOGIN_QUERY_REASON = 'reason'
export const LOGIN_REASON_SESSION_EXPIRED = 'session_expired'

/** The login page, explaining an expired session if there was one. */
export function loginRoute(sessionExpired: boolean): RouteLocationRaw {
  return sessionExpired
    ? { name: 'login', query: { [LOGIN_QUERY_REASON]: LOGIN_REASON_SESSION_EXPIRED } }
    : { name: 'login' }
}
