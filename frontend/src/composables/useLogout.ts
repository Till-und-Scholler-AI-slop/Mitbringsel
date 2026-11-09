import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

/** Signs out and goes to the login page; shared by the header and the sidebar. */
export function useLogout() {
  const auth = useAuthStore()
  const router = useRouter()

  return async function logout() {
    try {
      await auth.logout()
    } finally {
      // The store is logged out even if the request failed, so leave anyway.
      await router.push({ name: 'login' })
    }
  }
}
