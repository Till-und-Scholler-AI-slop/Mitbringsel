import type { LocationQuery, RouteLocationRaw } from 'vue-router'

import { safeNextPath } from './nextPath'

// How the backend and the app tell the login page why someone is there
// (docs/auth.md): /login?error=<code>, /login?reason=session_expired and
// /login?next=<path> for where to go after the sign-in.
export const LOGIN_QUERY_ERROR = 'error'
export const LOGIN_QUERY_REASON = 'reason'
export const LOGIN_QUERY_NEXT = 'next'
export const LOGIN_REASON_SESSION_EXPIRED = 'session_expired'
// The backend sends this when too many sign-ins came from one address.
export const LOGIN_ERROR_RATE_LIMITED = 'rate_limited'

/**
 * The login page, explaining an expired session if there was one, and
 * remembering where to continue after the sign-in. The start page is the
 * default, so it is not worth a parameter.
 */
export function loginRoute(sessionExpired: boolean, next?: string): RouteLocationRaw {
  const query: Record<string, string> = {}
  if (sessionExpired) query[LOGIN_QUERY_REASON] = LOGIN_REASON_SESSION_EXPIRED
  const path = safeNextPath(next)
  if (path !== null && path !== '/') query[LOGIN_QUERY_NEXT] = path
  return { name: 'login', query }
}

/** The path to continue on after the sign-in, or null (then: the start page). */
export function loginNext(query: LocationQuery): string | null {
  return safeNextPath(query[LOGIN_QUERY_NEXT])
}
