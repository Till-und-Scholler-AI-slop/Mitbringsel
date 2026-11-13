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

/** An open invite link of a group, without its token (GET /api/v1/groups/{groupId}/invites). */
export type Invite = Schemas['Invite']

/** Response of GET /api/v1/groups/{groupId}/invites. */
export type InviteList = Schemas['InviteList']

/** Response of POST /api/v1/groups/{groupId}/invites: the only time the token is sent. */
export type InviteCreated = Schemas['InviteCreated']

/** Response of POST /api/v1/invites/{token}/accept. */
export type InviteAccepted = Schemas['InviteAccepted']

/** A shopping list of a group (GET /api/v1/lists/{listId}). */
export type List = Schemas['List']

/** Response of GET /api/v1/groups/{groupId}/lists. */
export type ListListResponse = Schemas['ListList']

/** Body of POST /api/v1/groups/{groupId}/lists and PATCH /api/v1/lists/{listId}. */
export type ListNameRequest = Schemas['ListNameRequest']

/** Body of PUT /api/v1/lists/{listId}/archived. */
export type SetListArchivedRequest = Schemas['SetListArchivedRequest']

/** An item of a list (GET /api/v1/items/{itemId}). */
export type Item = Schemas['Item']

/** Response of GET /api/v1/lists/{listId}/items. */
export type ItemListResponse = Schemas['ItemList']

/** Body of POST /api/v1/lists/{listId}/items. */
export type CreateItemRequest = Schemas['CreateItemRequest']

/** Body of PATCH /api/v1/items/{itemId}: only the fields to change. */
export type UpdateItemRequest = Schemas['UpdateItemRequest']

/** Body of POST /api/v1/lists/{listId}/items/remove-checked. */
export type RemoveCheckedItemsRequest = Schemas['RemoveCheckedItemsRequest']

/** Response of POST /api/v1/lists/{listId}/items/remove-checked. */
export type RemovedItems = Schemas['RemovedItems']

/** One deleted item with the serverSeq of its deletion. */
export type DeletedItem = Schemas['DeletedItem']

/** How a quantity is measured (piece, g, kg, ml, l, pack). */
export type Unit = Schemas['Unit']

/** Error body of every failed API call: the backend sends codes, not texts. */
export type ApiErrorBody = Schemas['Error']

/** Every error code the backend can send. */
export type ApiErrorCode = Schemas['ErrorCode']

/** Any message the server sends over the WebSocket (GET /api/v1/ws). */
export type ServerMessage = Schemas['ServerMessage']

/** Any message the client sends over the WebSocket. */
export type ClientMessage = Schemas['ClientMessage']

/** The `type` values of ServerMessage, e.g. 'ready' | 'itemChanged' | …. */
export type ServerMessageType = ServerMessage['type']

/** The one ServerMessage with this `type`, so a handler sees the matching `payload`. */
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>
