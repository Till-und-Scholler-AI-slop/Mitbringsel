import type { Invite, InviteCreated, InviteList } from '@/types/api'

import { apiDelete, apiGet, apiPostJson } from './client'

/** What the group invites store needs from the backend; tests replace it with a fake. */
export interface GroupInvitesService {
  /** Owner and admins only. The open links, newest first, without their tokens. */
  list(groupId: string): Promise<Invite[]>
  /** Owner and admins only. Rejects with TOO_MANY_INVITES at 10 open links. */
  create(groupId: string): Promise<InviteCreated>
  /** Owner and admins only. People who joined through the link stay members. */
  revoke(groupId: string, inviteId: string): Promise<void>
}

const invitesPath = (groupId: string) => `/groups/${groupId}/invites`

export const groupInvitesService: GroupInvitesService = {
  list: async (groupId) => (await apiGet<InviteList>(invitesPath(groupId))).invites,
  create: (groupId) => apiPostJson<InviteCreated>(invitesPath(groupId)),
  revoke: (groupId, inviteId) => apiDelete(`${invitesPath(groupId)}/${inviteId}`),
}
