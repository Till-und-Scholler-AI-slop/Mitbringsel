import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { localData, type LocalData } from '@/services/storage/localData'
import { useAuthStore } from '@/stores/auth'

/** The part of local data needed before logout: checking pending changes. */
export type OutboxReader = Pick<LocalData, 'readOutbox'>

/**
 * Signs out and goes to the login page; shared by the header and the sidebar.
 * Reads the outbox of the signed-in user directly from localData (so entries
 * from other tabs count too): if any changes are pending, it opens a
 * confirmation dialog first instead of dropping them right away.
 */
export function useLogout(storage: OutboxReader = localData) {
  const auth = useAuthStore()
  const router = useRouter()

  const confirmOpen = ref(false)
  const pendingCount = ref(0)
  const busy = ref(false)
  let checking = false

  async function signOut() {
    if (busy.value) return
    busy.value = true
    try {
      try {
        await auth.logout()
      } catch (err) {
        // The store is logged out even if the request failed, so leave anyway.
        console.warn('logout: request failed', err)
      }
      confirmOpen.value = false
      await router.push({ name: 'login' })
    } finally {
      busy.value = false
    }
  }

  async function readPending(userId: string): Promise<number> {
    try {
      return (await storage.readOutbox(userId))?.length ?? 0
    } catch (err) {
      // An unreadable outbox must never block signing out.
      console.warn('logout: could not read outbox', err)
      return 0
    }
  }

  /** Signs out immediately, or asks for confirmation when outbox entries remain. */
  async function logout() {
    if (checking || busy.value) return
    const userId = auth.user?.id
    if (!userId) {
      await signOut()
      return
    }
    checking = true
    let count: number
    try {
      count = await readPending(userId)
    } finally {
      checking = false
    }
    if (auth.user?.id !== userId) return
    if (count > 0) {
      pendingCount.value = count
      confirmOpen.value = true
      return
    }
    await signOut()
  }

  /** Confirms signing out despite pending outbox entries. */
  function confirmLogout() {
    return signOut()
  }

  return {
    logout,
    confirmOpen,
    pendingCount,
    busy,
    confirmLogout,
  }
}
