import type { DevLoginRequest } from '@/types/api'

/** The variables from frontend/.env.local that configure the dev login. */
export interface DevUserEnv {
  VITE_DEV_USER_EMAIL?: string
  VITE_DEV_USER_NAME?: string
}

/** URL parameter that picks another dev user, e.g. ?devUser=anna@example.com */
export const DEV_USER_PARAM = 'devUser'

/**
 * Decides whom the dev login signs in: the user from the URL parameter if
 * given, else the one from .env.local, else nobody (no automatic login).
 * The name from .env.local only applies to its own email address; for any
 * other user the backend derives the name from the email.
 */
export function resolveDevUser(env: DevUserEnv, search: string): DevLoginRequest | null {
  const envEmail = env.VITE_DEV_USER_EMAIL?.trim() ?? ''
  const paramEmail = new URLSearchParams(search).get(DEV_USER_PARAM)?.trim() ?? ''

  const email = paramEmail || envEmail
  if (!email) {
    return null
  }
  if (email === envEmail) {
    const name = env.VITE_DEV_USER_NAME?.trim()
    return name ? { email, name } : { email }
  }
  return { email }
}
