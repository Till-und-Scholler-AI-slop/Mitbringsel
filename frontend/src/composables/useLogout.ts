import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useErrorMessage, useErrorText } from '@/composables/useErrorMessage'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { localData, type LocalData } from '@/services/storage/localData'
import { useAuthStore } from '@/stores/auth'
import { useToastsStore } from '@/stores/toasts'

/** The part of local data needed before logout: checking pending changes. */
export type OutboxReader = Pick<LocalData, 'readOutbox'>

/**
 * Signs out and goes to the login page; shared by the header and the sidebar.
 * Reads the outbox of the signed-in user directly from localData (so entries
 * from other tabs count too): if any changes are pending, it opens a
 * confirmation dialog first instead of dropping them right away.
 *
 * Signing out requires a connection so the server ends the session and clears
 * the HttpOnly cookie. If the request fails despite navigator.onLine, the user
 * stays signed in with local data intact and sees the error in the open dialog
 * or as a persistent error toast.
 */
export function useLogout(storage: OutboxReader = localData) {
  const { t } = useI18n()
  const auth = useAuthStore()
  const router = useRouter()
  const toasts = useToastsStore()
  const { online } = useOnlineStatus()
  const errorText = useErrorText()

  const confirmOpen = ref(false)
  const pendingCount = ref(0)
  const busy = ref(false)
  const errorCode = ref<string | null>(null)
  const errorMessage = useErrorMessage(errorCode)
  const error = computed(() => (errorCode.value ? errorMessage.value : null))
  let checking = false

  watch(confirmOpen, (open) => {
    if (!open) {
      errorCode.value = null
    }
  })

  async function signOut() {
    if (busy.value || !online.value) return
    busy.value = true
    errorCode.value = null
    try {
      await auth.logout()
      confirmOpen.value = false
      await router.push({ name: 'login' })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      if (confirmOpen.value) {
        errorCode.value = code
      } else {
        toasts.show({
          kind: 'error',
          text: t('logout.failed'),
          detail: errorText(code),
        })
      }
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
    if (checking || busy.value || !online.value) return
    errorCode.value = null
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
    if (auth.user?.id !== userId || !online.value) return
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
    error,
    confirmLogout,
  }
}
