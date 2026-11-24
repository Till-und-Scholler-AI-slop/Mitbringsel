import { ref } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN, HTTP_STATUS_UNAUTHORIZED } from '@/services/api/client'
import { authService, type AuthService } from '@/services/api/auth'
import { resolveDevUser } from '@/services/devUser'
import { localSignedInMarker, type SignedInMarker } from '@/services/signedInMarker'
import { localData, type LocalData } from '@/services/storage/localData'
import { liveSocket, type ServerEvents } from '@/services/sync/socket'
import type { DevLoginRequest, MeResponse } from '@/types/api'

/**
 * unknown: not checked yet. anonymous: the server says nobody is logged in.
 * error: the server could not answer; the user is NOT treated as logged out,
 * so a short outage does not throw anyone out.
 */
export type AuthStatus = 'unknown' | 'loading' | 'authenticated' | 'anonymous' | 'error'

/** The part of the local data the store needs: the profile of the owner. */
export type LocalProfile = Pick<LocalData, 'readMe' | 'claim' | 'clear'>

/**
 * Builds the store around a service and the dev user. Setup stores cannot
 * take parameters, so this factory is how tests inject fakes.
 *
 * devUser is set only in development: if the backend reports nobody (or
 * somebody else) as logged in, the store logs in as devUser by itself.
 * marker remembers across visits that someone was signed in.
 *
 * local keeps the profile on the device, so the app can start without a
 * network (ADR 0006): at startup the stored profile counts at once, and
 * GET /me confirms it in the background. events tells when the live socket
 * is back (ready), to confirm a stored profile that could not be checked.
 */
export function defineAuthStore(
  service: AuthService,
  devUser: DevLoginRequest | null,
  marker: SignedInMarker = localSignedInMarker,
  local: LocalProfile = localData,
  events: ServerEvents = liveSocket,
) {
  return defineStore('auth', () => {
    const user = ref<MeResponse | null>(null)
    const status = ref<AuthStatus>('unknown')
    const errorCode = ref<string | null>(null)
    // True when the user was signed in and the session ran out; the login
    // page then explains why it is shown. Reset by the next sign-in.
    const sessionExpired = ref(false)
    // True while the user is the profile stored on this device and the
    // server has not confirmed it yet (started without a network).
    const fromCache = ref(false)

    // Counts logouts and expired sessions. A check of /me that started
    // before one of them must not sign the user in again.
    let signOuts = 0

    // The router guard and a view may both call load(); they share one run.
    let running: Promise<void> | null = null

    /**
     * Finds out who is signed in. On the first call a profile stored on the
     * device counts at once, and the server confirms it in the background;
     * otherwise this waits for the server.
     */
    function load(): Promise<void> {
      running ??= loadOnce().finally(() => {
        running = null
      })
      return running
    }

    async function loadOnce() {
      // Only at startup: after a logout or an expired session the stored
      // profile must not sign anyone in again.
      if (status.value === 'unknown') {
        status.value = 'loading'
        const stored = await local.readMe()
        if (status.value !== 'loading') {
          // Logged out in the meantime.
          return
        }
        if (stored) {
          user.value = stored
          fromCache.value = true
          status.value = 'authenticated'
          void check()
          return
        }
      }
      await check()
    }

    // Asks the server who is signed in; load and the ready event share one run.
    let checking: Promise<void> | null = null

    function check(): Promise<void> {
      checking ??= checkOnce().finally(() => {
        checking = null
      })
      return checking
    }

    async function checkOnce() {
      const startedAt = signOuts
      // A stored profile stays on screen while the server is asked.
      if (!fromCache.value) {
        status.value = 'loading'
      }
      errorCode.value = null
      try {
        let me = await getMeOrNull()
        if (devUser && me?.email !== devUser.email) {
          await service.devLogin(devUser)
          me = await getMeOrNull()
        }
        // Signed out while waiting: the answer is out of date, and the
        // profile must not land on the device again after a logout.
        if (startedAt !== signOuts) {
          return
        }
        if (me) {
          // Before the user changes, so the stores of a new user never find
          // the data of the previous one.
          await local.claim(me)
          if (startedAt !== signOuts) {
            return
          }
        }
        user.value = me
        fromCache.value = false
        if (me) {
          status.value = 'authenticated'
          sessionExpired.value = false
          marker.set()
        } else {
          // Nobody is signed in now. If somebody was on the last visit, the
          // session ran out in between (or was ended on another device). The
          // stored data stays for when the same user signs in again.
          status.value = 'anonymous'
          sessionExpired.value ||= marker.isSet()
          marker.clear()
        }
      } catch (err) {
        errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
        // Offline with a stored profile: the user stays signed in.
        if (!fromCache.value) {
          status.value = 'error'
        }
      }
    }

    // The socket only connects with a valid session: now the server can
    // confirm a profile that came from the device.
    events.on('ready', () => {
      if (fromCache.value) {
        void check()
      }
    })

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
      signOuts++
      user.value = null
      fromCache.value = false
      status.value = 'anonymous'
      sessionExpired.value = true
      marker.clear()
      return true
    }

    /**
     * Logs out on the server and clears local state and device data only after
     * the server confirms. If the request fails (offline, proxy error, 5xx),
     * the HttpOnly session cookie and server session may still be active:
     * clearing local state anyway would falsely appear signed out on a shared
     * device and silently drop pending outbox entries. Keeping state lets the
     * user see the error and retry (even after a backend 500 that already
     * cleared the cookie, a retry returns 204 and clears the device cleanly).
     */
    async function logout() {
      await service.logout()
      signOuts++
      user.value = null
      fromCache.value = false
      status.value = 'anonymous'
      // Logged out on purpose: no "your session ran out" next time.
      sessionExpired.value = false
      marker.clear()
      await local.clear()
    }

    // Lets the login page offer the dev login again after a logout, without
    // a page reload. null outside development.
    const devUserEmail = devUser?.email ?? null

    return {
      user,
      status,
      errorCode,
      sessionExpired,
      fromCache,
      devUserEmail,
      load,
      expireSession,
      logout,
    }
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
