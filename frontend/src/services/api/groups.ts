import type { Group, GroupListResponse, GroupNameRequest, Role, SetRoleRequest } from '@/types/api'

import { apiDelete, apiGet, apiPatchJson, apiPostJson, apiPut } from './client'

/** What the groups store needs from the backend; tests replace it with a fake. */
export interface GroupsService {
  /** The groups of the logged-in user with their members, oldest first. */
  list(): Promise<Group[]>
  /** The caller becomes the owner. */
  create(name: string): Promise<Group>
  /** Owner and admins only. Answers the updated group. */
  rename(groupId: string, name: string): Promise<Group>
  /** Owner only. */
  remove(groupId: string): Promise<void>
  /**
   * Removes a member. With the caller's own ID this is leaving the group,
   * which every role but the owner may do.
   */
  removeMember(groupId: string, userId: string): Promise<void>
  /** Owner only; `admin` or `member`. */
  setMemberRole(groupId: string, userId: string, role: Role): Promise<void>
}

const groupPath = (groupId: string) => `/groups/${groupId}`
const memberPath = (groupId: string, userId: string) => `${groupPath(groupId)}/members/${userId}`

export const groupsService: GroupsService = {
  list: async () => (await apiGet<GroupListResponse>('/groups')).groups,
  create: (name) => apiPostJson<Group>('/groups', { name } satisfies GroupNameRequest),
  rename: (groupId, name) =>
    apiPatchJson<Group>(groupPath(groupId), { name } satisfies GroupNameRequest),
  remove: (groupId) => apiDelete(groupPath(groupId)),
  removeMember: (groupId, userId) => apiDelete(memberPath(groupId, userId)),
  setMemberRole: (groupId, userId, role) =>
    apiPut(`${memberPath(groupId, userId)}/role`, { role } satisfies SetRoleRequest),
}
