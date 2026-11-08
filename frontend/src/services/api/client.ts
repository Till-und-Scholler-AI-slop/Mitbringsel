import type { ApiErrorBody } from '@/types/api'

const API_BASE = '/api/v1'

/** The status the backend answers when the request has no valid session. */
export const HTTP_STATUS_UNAUTHORIZED = 401

type UnauthenticatedHandler = () => void

let unauthenticatedHandler: UnauthenticatedHandler | null = null

/**
 * Registers the function called on every 401 answer, before the request
 * rejects. The app reacts to an expired session there, in one place, instead
 * of in every store (see router/sessionExpiry.ts). null removes it.
 */
export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | null) {
  unauthenticatedHandler = handler
}

/** Codes produced by the frontend itself, next to the codes sent by the backend. */
export const ERROR_CODE_NETWORK = 'NETWORK'
export const ERROR_CODE_UNKNOWN = 'UNKNOWN'

/** A failed API call. `code` is a translation key suffix (see `errors.*` in the locales). */
export class ApiError extends Error {
  readonly code: string
  readonly status: number | undefined
  /** From the Retry-After header of a 429 answer: seconds until the next try makes sense. */
  readonly retryAfterSeconds: number | undefined

  constructor(code: string, status?: number, retryAfterSeconds?: number) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

// Retry-After can also be a date; the backend only sends whole seconds, so
// anything else counts as "not given".
function readRetryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('Retry-After'))
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined
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

// Sends the request and turns every failure into an ApiError: no response
// at all (NETWORK) and non-2xx responses with the backend's error code.
async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new ApiError(ERROR_CODE_NETWORK)
  }

  if (!response.ok) {
    if (response.status === HTTP_STATUS_UNAUTHORIZED) {
      unauthenticatedHandler?.()
    }
    throw new ApiError(await readErrorCode(response), response.status, readRetryAfter(response))
  }
  return response
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await request(path)
  return (await response.json()) as T
}

// The request options for `method`, with `body` sent as JSON if there is one.
function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }
}

/**
 * POSTs `body` as JSON, or nothing if it is omitted. Resolves without a value,
 * for endpoints that answer 204 No Content; see apiPostJson for the others.
 */
export async function apiPost(path: string, body?: unknown): Promise<void> {
  await request(path, jsonInit('POST', body))
}

/** Like apiPost, for endpoints that answer with a JSON body (e.g. 201 Created). */
export async function apiPostJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await request(path, jsonInit('POST', body))
  return (await response.json()) as T
}

/** PATCHes `body` as JSON and returns the JSON the endpoint answers with. */
export async function apiPatchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await request(path, jsonInit('PATCH', body))
  return (await response.json()) as T
}

/** PUTs `body` as JSON. Resolves without a value (204 No Content). */
export async function apiPut(path: string, body: unknown): Promise<void> {
  await request(path, jsonInit('PUT', body))
}

/** Like apiPut, for endpoints that answer with a JSON body. */
export async function apiPutJson<T>(path: string, body: unknown): Promise<T> {
  const response = await request(path, jsonInit('PUT', body))
  return (await response.json()) as T
}

/** Sends DELETE. Resolves without a value (204 No Content). */
export async function apiDelete(path: string): Promise<void> {
  await request(path, jsonInit('DELETE'))
}
