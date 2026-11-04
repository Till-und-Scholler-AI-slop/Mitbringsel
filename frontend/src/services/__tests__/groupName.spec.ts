import { describe, expect, it } from 'vitest'

import { GROUP_NAME_MAX_LENGTH, validateGroupName } from '../groupName'

describe('validateGroupName', () => {
  it('accepts a normal name', () => {
    expect(validateGroupName('WG Kaiserstraße')).toBeNull()
  })

  it.each(['', '   '])('rejects %j as empty', (name) => {
    expect(validateGroupName(name)).toBe('empty')
  })

  it('accepts exactly the maximum and rejects one more', () => {
    expect(validateGroupName('x'.repeat(GROUP_NAME_MAX_LENGTH))).toBeNull()
    expect(validateGroupName('x'.repeat(GROUP_NAME_MAX_LENGTH + 1))).toBe('tooLong')
  })

  it('ignores whitespace around the name', () => {
    expect(validateGroupName(` ${'x'.repeat(GROUP_NAME_MAX_LENGTH)} `)).toBeNull()
  })

  it('counts an emoji as one character', () => {
    expect(validateGroupName('😀'.repeat(GROUP_NAME_MAX_LENGTH))).toBeNull()
  })
})
