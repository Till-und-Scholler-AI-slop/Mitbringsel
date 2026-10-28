import type { ApiErrorBody } from '@/types/api'

const API_BASE = '/api/v1'

/** Codes produced by the frontend itself, next to the codes sent by the backend. */
export const ERROR_CODE_NETWORK = 'NETWORK'
export const ERROR_CODE_UNKNOWN = 'UNKNOWN'

/** A failed API call. `code` is a translation key suffix (see `errors.*` in the locales). */
export class ApiError extends Error {
  readonly code: string
  readonly status: number | undefined

  constructor(code: string, status?: number) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false
  }
  const { error } = value
  return (
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
  )
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    return isApiErrorBody(body) ? body.error.code : ERROR_CODE_UNKNOWN
  } catch {
    // Body is not JSON (e.g. a proxy error page): the status is all we know.
    return ERROR_CODE_UNKNOWN
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`)
  } catch {
    throw new ApiError(ERROR_CODE_NETWORK)
  }

  if (!response.ok) {
    throw new ApiError(await readErrorCode(response), response.status)
  }
  return (await response.json()) as T
}
