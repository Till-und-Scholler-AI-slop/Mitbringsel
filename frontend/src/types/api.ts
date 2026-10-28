/** Response of GET /api/v1/health. */
export interface HealthResponse {
  status: 'ok'
}

/** Error body of every failed API call: the backend sends codes, not texts. */
export interface ApiErrorBody {
  error: {
    code: string
  }
}
