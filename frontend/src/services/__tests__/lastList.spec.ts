import { afterEach, describe, expect, it, vi } from 'vitest'

import { listToOpen, rememberLastList } from '../lastList'

const lists = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('lastList', () => {
  it('opens the first list when none was remembered', () => {
    expect(listToOpen('g1', lists)).toEqual({ id: 'l1' })
  })

  it('opens the remembered list of each household', () => {
    rememberLastList('g1', 'l2')
    rememberLastList('g2', 'l9')

    expect(listToOpen('g1', lists)).toEqual({ id: 'l2' })
    expect(listToOpen('g2', [{ id: 'l8' }, { id: 'l9' }])).toEqual({ id: 'l9' })
  })

  it('opens the first list when the remembered one is gone or archived', () => {
    rememberLastList('g1', 'l7')

    expect(listToOpen('g1', lists)).toEqual({ id: 'l1' })
  })

  it('has nothing to open without lists', () => {
    rememberLastList('g1', 'l1')

    expect(listToOpen('g1', [])).toBeUndefined()
  })

  it('ignores a broken stored value', () => {
    localStorage.setItem('mitbringsel.lastList', 'not json')

    expect(listToOpen('g1', lists)).toEqual({ id: 'l1' })
  })

  it('works without storage instead of failing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(() => rememberLastList('g1', 'l2')).not.toThrow()
    expect(listToOpen('g1', lists)).toEqual({ id: 'l1' })
  })
})
