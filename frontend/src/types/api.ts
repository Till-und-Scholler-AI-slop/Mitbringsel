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

/** A group with its members, as sent by GET /api/v1/groups. */
export type Group = Schemas['Group']

/** Response of GET /api/v1/groups. */
export type GroupListResponse = Schemas['GroupList']

export type GroupMember = Schemas['GroupMember']

/** The role of a member: one owner per group, then admins and members. */
export type Role = Schemas['Role']

/** Body of POST /api/v1/groups and PATCH /api/v1/groups/{groupId}. */
export type GroupNameRequest = Schemas['GroupNameRequest']

/** Body of PUT /api/v1/groups/{groupId}/members/{userId}/role. */
export type SetRoleRequest = Schemas['SetRoleRequest']

/** What an invite link leads to, as sent by GET /api/v1/invites/{token}. */
export type InvitePreview = Schemas['InvitePreview']

export type InviteMember = Schemas['InviteMember']

/** Response of POST /api/v1/invites/{token}/accept. */
export type InviteAccepted = Schemas['InviteAccepted']

/** Error body of every failed API call: the backend sends codes, not texts. */
export type ApiErrorBody = Schemas['Error']

/** Every error code the backend can send. */
export type ApiErrorCode = Schemas['ErrorCode']
