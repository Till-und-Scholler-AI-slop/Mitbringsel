import { describe, expect, it } from 'vitest'

import { canManage } from '../groupRoles'

describe('canManage', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ] as const)('is %s allowed: %s', (role, allowed) => {
    expect(canManage(role)).toBe(allowed)
  })
})
