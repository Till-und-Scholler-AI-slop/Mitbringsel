import { describe, expect, it } from 'vitest'

import type { GroupMember, Role } from '@/types/api'

import { canManage, memberActions, sortMembers } from '../groupRoles'

describe('canManage', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ] as const)('is %s allowed: %s', (role, allowed) => {
    expect(canManage(role)).toBe(allowed)
  })
})

describe('memberActions', () => {
  it.each([
    ['owner', 'member', ['promote', 'remove']],
    ['owner', 'admin', ['demote', 'remove']],
    ['owner', 'owner', []],
    ['admin', 'member', ['remove']],
    ['admin', 'admin', []],
    ['admin', 'owner', []],
    ['member', 'member', []],
    ['member', 'admin', []],
    ['member', 'owner', []],
  ] as const)('%s on %s: %j', (viewer, target, expected) => {
    expect(memberActions(viewer, target)).toEqual(expected)
  })
})

describe('sortMembers', () => {
  function member(name: string, role: Role): GroupMember {
    return {
      userId: name,
      displayName: name,
      avatarUrl: null,
      role,
      joinedAt: '2026-01-01T10:00:00Z',
    }
  }

  it('puts the owner first, then admins, and keeps the order within a role', () => {
    const members = [
      member('a', 'member'),
      member('b', 'admin'),
      member('c', 'member'),
      member('d', 'owner'),
    ]

    expect(sortMembers(members).map((m) => m.displayName)).toEqual(['d', 'b', 'a', 'c'])
    expect(members[0]?.displayName).toBe('a')
  })
})
