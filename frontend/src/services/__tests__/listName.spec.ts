import { describe, expect, it } from 'vitest'

import { LIST_NAME_MAX_LENGTH, validateListName } from '../listName'

describe('validateListName', () => {
  it.each([
    ['Wocheneinkauf', null],
    ['', 'empty'],
    ['   ', 'empty'],
    ['  a  ', null],
    ['a'.repeat(LIST_NAME_MAX_LENGTH), null],
    ['a'.repeat(LIST_NAME_MAX_LENGTH + 1), 'tooLong'],
    // Counted in characters, not in UTF-16 units: an emoji is one character.
    ['🛒'.repeat(LIST_NAME_MAX_LENGTH), null],
    ['🛒'.repeat(LIST_NAME_MAX_LENGTH + 1), 'tooLong'],
  ])('checks %j', (name, want) => {
    expect(validateListName(name)).toBe(want)
  })

  it('does not count the whitespace around the name', () => {
    expect(validateListName(` ${'a'.repeat(LIST_NAME_MAX_LENGTH)} `)).toBeNull()
  })
})
