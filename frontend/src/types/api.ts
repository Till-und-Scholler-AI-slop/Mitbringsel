/**
 * Short names for the API types. They come from api/openapi.yaml via
 * openapi.gen.ts (`npm run generate:api`), so frontend and backend share one
 * contract; never define an API type here by hand.
 */
import type { components } from './openapi.gen'

type Schemas = components['schemas']

/** Response of GET /api/v1/health. */
export type HealthResponse = Schemas['Health']

/** Response of GET /api/v1/me. */
export type MeResponse = Schemas['Me']

/** Body of POST /api/v1/auth/dev/login. */
export type DevLoginRequest = Schemas['DevLoginRequest']

/** Error body of every failed API call: the backend sends codes, not texts. */
export type ApiErrorBody = Schemas['Error']

/** Every error code the backend can send. */
export type ApiErrorCode = Schemas['ErrorCode']
