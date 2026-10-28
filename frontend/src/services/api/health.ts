import type { HealthResponse } from '@/types/api'

import { apiGet } from './client'

/** What stores need from the health endpoint; tests replace it with a fake. */
export interface HealthService {
  getHealth(): Promise<HealthResponse>
}

export const healthService: HealthService = {
  getHealth: () => apiGet<HealthResponse>('/health'),
}
