import type { GroupMember, Role } from '@/types/api'

/**
 * Whether the role may rename the group and invite people. The backend
 * decides again on every request (FORBIDDEN); this only hides what would fail.
 */
export function canManage(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}

/** What a viewer can do with another member. */
export type MemberAction = 'promote' | 'demote' | 'remove'

/**
 * The actions the viewer may take on a member other than themselves: the
 * owner appoints and removes admins and removes members, an admin removes
 * members. The backend decides again (FORBIDDEN).
 */
export function memberActions(viewer: Role, target: Role): MemberAction[] {
  if (viewer === 'owner') {
    if (target === 'admin') return ['demote', 'remove']
    if (target === 'member') return ['promote', 'remove']
  }
  if (viewer === 'admin' && target === 'member') return ['remove']
  return []
}

const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, member: 2 }

/** Owner first, then admins, then members; the order of joining stays within a role. */
export function sortMembers(members: GroupMember[]): GroupMember[] {
  return [...members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
}
