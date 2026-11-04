import type { Role } from '@/types/api'

/**
 * Whether the role may rename the group and invite people. The backend
 * decides again on every request (FORBIDDEN); this only hides what would fail.
 */
export function canManage(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}
