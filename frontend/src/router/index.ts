import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'

import { useAuthStore, type AuthStatus } from '@/stores/auth'

import StartView from '../views/StartView.vue'
import LoginView from '../views/LoginView.vue'
import { loginRoute } from './loginQuery'

declare module 'vue-router' {
  interface RouteMeta {
    /** Only logged-in users may open the route; others are sent to the login. */
    requiresAuth?: boolean
  }
}

/** The part of the auth store the guard needs; tests pass a fake. */
export interface AuthGuardStore {
  status: AuthStatus
  /** The user was signed in and the session ran out; the login page says so. */
  sessionExpired: boolean
  load(): Promise<void>
}

export function createAppRouter(
  useAuth: () => AuthGuardStore = useAuthStore,
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', name: 'home', component: StartView, meta: { requiresAuth: true } },
      { path: '/login', name: 'login', component: LoginView },
    ],
  })

  router.beforeEach(async (to) => {
    const auth = useAuth()
    // Only the first navigation asks the server; later ones use the result.
    if (auth.status === 'unknown') {
      await auth.load()
    }

    // 'error' passes on purpose: if the server is briefly unreachable, the
    // page shows the error instead of pretending the user is logged out.
    if (to.meta.requiresAuth && auth.status === 'anonymous') {
      return loginRoute(auth.sessionExpired)
    }
    if (to.name === 'login' && auth.status === 'authenticated') {
      return { name: 'home' }
    }
    return true
  })

  return router
}

export default createAppRouter()
