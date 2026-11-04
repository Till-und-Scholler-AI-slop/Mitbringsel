import type { Router } from 'vue-router'

import { setUnauthenticatedHandler } from '@/services/api/client'

import { loginRoute } from './loginQuery'

/** The part of the auth store this needs; tests pass a fake. */
export interface SessionExpiryStore {
  expireSession(): boolean
}

/**
 * Sends the user to the login page as soon as any API request finds the
 * session gone, whichever store made the request. Called once at startup.
 */
export function installSessionExpiry(router: Router, auth: SessionExpiryStore) {
  setUnauthenticatedHandler(() => {
    // false while nobody is signed in: then a 401 is an answer, not news.
    if (!auth.expireSession()) {
      return
    }
    // The user comes back to this page after signing in again.
    router.push(loginRoute(true, router.currentRoute.value.fullPath)).catch((err: unknown) => {
      // The user stays on the page and sees the failed request instead;
      // logged so the cause is not lost.
      console.error('redirect to login after expired session failed', err)
    })
  })
}
