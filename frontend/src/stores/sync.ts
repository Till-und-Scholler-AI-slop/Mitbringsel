import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { authService, type AuthService } from '@/services/api/auth'
import { liveSocket, type LiveSocket } from '@/services/sync/socket'
import { useAuthStore } from '@/stores/auth'

/**
 * After this many failed attempts in a row (and after every multiple of it)
 * the store asks the server whether the session is still valid.
 */
const SESSION_CHECK_EVERY_FAILURES = 3

/**
 * Builds the store around the socket, the part of the auth service that
 * checks the session, and a getter for the ID of the signed-in user. Setup
 * stores cannot take parameters, so this factory is how tests inject fakes.
 *
 * The socket is open exactly while somebody is signed in: it starts with the
 * sign-in, stops on logout or an expired session, and restarts for another
 * user, so a connection never outlives its session. The store has no actions.
 */
export function defineSyncStore(
  socket: LiveSocket,
  session: Pick<AuthService, 'getMe'>,
  currentUserId: () => string | null,
) {
  return defineStore('sync', () => {
    const status = ref(socket.status)
    // When the server last said `ready`; null before the first one.
    const lastReadyAt = ref<number | null>(null)
    const connected = computed(() => status.value === 'connected')

    socket.onStatusChange((next) => {
      status.value = next
    })
    socket.on('ready', () => {
      lastReadyAt.value = Date.now()
    })

    // A failed handshake only shows up as "closed" (no HTTP status), so a
    // dead session looks like any outage. Asking /me tells them apart: a 401
    // reaches the unauthenticated handler inside the request, which ends the
    // session, which stops the socket below.
    socket.onAttemptFailed((consecutive) => {
      if (consecutive % SESSION_CHECK_EVERY_FAILURES !== 0) {
        return
      }
      session.getMe().catch(() => {
        // Expected while the network is down; anything but a 401 changes nothing.
      })
    })

    watch(
      currentUserId,
      (userId) => {
        socket.stop()
        lastReadyAt.value = null
        if (userId) {
          socket.start()
        }
      },
      { immediate: true },
    )

    return { status, lastReadyAt, connected }
  })
}

export const useSyncStore = defineSyncStore(
  liveSocket,
  authService,
  () => useAuthStore().user?.id ?? null,
)
