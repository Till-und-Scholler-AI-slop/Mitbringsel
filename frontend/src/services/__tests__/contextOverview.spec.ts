import { afterEach, describe, expect, it, vi } from 'vitest'

import { pinnedListFor, readOverview, rememberPinnedList } from '../contextOverview'

const lists = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('readOverview', () => {
  it('is empty without an entry', () => {
    expect(readOverview('g1')).toEqual({})
  })

  it('is empty for broken JSON or a wrong shape', () => {
    localStorage.setItem('mitbringsel.overview', 'not json')
    expect(readOverview('g1')).toEqual({})

    localStorage.setItem('mitbringsel.overview', '[1]')
    expect(readOverview('g1')).toEqual({})

    localStorage.setItem('mitbringsel.overview', JSON.stringify({ g1: { pinnedListId: 5 } }))
    expect(readOverview('g1')).toEqual({})
  })

  it('is empty when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(readOverview('g1')).toEqual({})
  })
})

describe('rememberPinnedList', () => {
  it('remembers the pin of each household independently', () => {
    rememberPinnedList('g1', 'l2')
    rememberPinnedList('g2', 'l9')

    expect(readOverview('g1')).toEqual({ pinnedListId: 'l2' })
    expect(readOverview('g2')).toEqual({ pinnedListId: 'l9' })
  })

  it('forgets only the pin of that household with null', () => {
    rememberPinnedList('g1', 'l2')
    rememberPinnedList('g2', 'l9')

    rememberPinnedList('g1', null)

    expect(readOverview('g1')).toEqual({})
    expect(readOverview('g2')).toEqual({ pinnedListId: 'l9' })
  })

  it('works without storage instead of failing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(() => rememberPinnedList('g1', 'l2')).not.toThrow()
  })
})

describe('pinnedListFor', () => {
  it('pins the first other list by default', () => {
    expect(pinnedListFor(undefined, lists, 'l1')).toEqual({ id: 'l2' })
  })

  it('pins the remembered list if it is active and not the current one', () => {
    expect(pinnedListFor('l3', lists, 'l1')).toEqual({ id: 'l3' })
  })

  it('never returns the current list', () => {
    expect(pinnedListFor('l1', lists, 'l1')).toEqual({ id: 'l2' })
  })

  it('falls back when the remembered list is gone', () => {
    expect(pinnedListFor('l7', lists, 'l2')).toEqual({ id: 'l1' })
  })

  it('has nothing to pin with only the current list', () => {
    expect(pinnedListFor(undefined, [{ id: 'l1' }], 'l1')).toBeUndefined()
  })
})
