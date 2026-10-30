import { ref } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN, HTTP_STATUS_UNAUTHORIZED } from '@/services/api/client'
import { authService, type AuthService } from '@/services/api/auth'
import { resolveDevUser } from '@/services/devUser'
import { localSignedInMarker, type SignedInMarker } from '@/services/signedInMarker'
import type { DevLoginRequest, MeResponse } from '@/types/api'

/**
 * unknown: not checked yet. anonymous: the server says nobody is logged in.
 * error: the server could not answer; the user is NOT treated as logged out,
 * so a short outage does not throw anyone out.
 */
export type AuthStatus = 'unknown' | 'loading' | 'authenticated' | 'anonymous' | 'error'

/**
 * Builds the store around a service and the dev user. Setup stores cannot
 * take parameters, so this factory is how tests inject fakes.
 *
 * devUser is set only in development: if the backend reports nobody (or
 * somebody else) as logged in, the store logs in as devUser by itself.
 * marker remembers across visits that someone was signed in.
 */
export function defineAuthStore(
  service: AuthService,
  devUser: DevLoginRequest | null,
  marker: SignedInMarker = localSignedInMarker,
) {
  return defineStore('auth', () => {
    const user = ref<MeResponse | null>(null)
    const status = ref<AuthStatus>('unknown')
    const errorCode = ref<string | null>(null)
    // True when the user was signed in and the session ran out; the login
    // page then explains why it is shown. Reset by the next sign-in.
    const sessionExpired = ref(false)

    // The router guard and a view may both call load(); they share one run.
    let running: Promise<void> | null = null

    function load(): Promise<void> {
      running ??= loadOnce().finally(() => {
        running = null
      })
      return running
    }

    async function loadOnce() {
      status.value = 'loading'
      errorCode.value = null
      try {
        let me = await getMeOrNull()
        if (devUser && me?.email !== devUser.email) {
          await service.devLogin(devUser)
          me = await getMeOrNull()
        }
        user.value = me
        if (me) {
          status.value = 'authenticated'
          sessionExpired.value = false
          marker.set()
        } else {
          // Nobody is signed in now. If somebody was on the last visit, the
          // session ran out in between (or was ended on another device).
          status.value = 'anonymous'
          sessionExpired.value = marker.isSet()
          marker.clear()
        }
      } catch (err) {
        status.value = 'error'
        errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    // 401 is an answer ("nobody"), not a failure; everything else is.
    async function getMeOrNull(): Promise<MeResponse | null> {
      try {
        return await service.getMe()
      } catch (err) {
        if (err instanceof ApiError && err.status === HTTP_STATUS_UNAUTHORIZED) {
          return null
        }
        throw err
      }
    }

    /**
     * Called when the server answers 401 although the user is signed in.
     * Returns false if nobody was signed in: a 401 while loading (that is
     * just "nobody") or a second one right after the first changes nothing.
     */
    function expireSession(): boolean {
      if (status.value !== 'authenticated') {
        return false
      }
      user.value = null
      status.value = 'anonymous'
      sessionExpired.value = true
      marker.clear()
      return true
    }

    /**
     * Logs out on the server. The local state is cleared even if that fails:
     * the backend clears the cookie in that case as well.
     */
    async function logout() {
      try {
        await service.logout()
      } finally {
        user.value = null
        status.value = 'anonymous'
        // Logged out on purpose: no "your session ran out" next time.
        sessionExpired.value = false
        marker.clear()
      }
    }

    // Lets the login page offer the dev login again after a logout, without
    // a page reload. null outside development.
    const devUserEmail = devUser?.email ?? null

    return { user, status, errorCode, sessionExpired, devUserEmail, load, expireSession, logout }
  })
}

// import.meta.env.DEV is replaced by false in production builds, so the
// production store never logs in by itself and resolveDevUser is dropped
// from the bundle. authService.devLogin stays in it, but the backend only
// registers that route in development.
export const useAuthStore = defineAuthStore(
  authService,
  import.meta.env.DEV ? resolveDevUser(import.meta.env, window.location.search) : null,
)
