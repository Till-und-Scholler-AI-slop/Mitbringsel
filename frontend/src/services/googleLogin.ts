// The backend redirects to Google from here (docs/auth.md).
export const GOOGLE_LOGIN_URL = '/api/v1/auth/google/login'

/**
 * The URL that starts the Google login. With `next` (a path checked by
 * safeNextPath) the backend sends the user there afterwards.
 */
export function googleLoginUrl(next: string | null = null): string {
  return next === null ? GOOGLE_LOGIN_URL : `${GOOGLE_LOGIN_URL}?next=${encodeURIComponent(next)}`
}
