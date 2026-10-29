import type { DevLoginRequest, MeResponse } from '@/types/api'

import { apiGet, apiPost } from './client'

/** What the auth store needs from the backend; tests replace it with a fake. */
export interface AuthService {
  /** Rejects with an ApiError with status 401 if nobody is logged in. */
  getMe(): Promise<MeResponse>
  /** Only exists on a backend running with APP_ENV=development. */
  devLogin(request: DevLoginRequest): Promise<void>
  logout(): Promise<void>
}

export const authService: AuthService = {
  getMe: () => apiGet<MeResponse>('/me'),
  devLogin: (request) => apiPost('/auth/dev/login', request),
  logout: () => apiPost('/auth/logout'),
}
