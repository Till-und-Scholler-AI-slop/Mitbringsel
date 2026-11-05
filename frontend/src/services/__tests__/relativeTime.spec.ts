import { describe, expect, it } from 'vitest'

import { timeAgo, timeLeft } from '../relativeTime'

const NOW = new Date('2026-11-04T12:00:00Z')

function minutesFromNow(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000)
}

describe('timeAgo', () => {
  it.each([
    [0, 'now'],
    [-0.5, 'now'],
    [-5, '5 minutes ago'],
    [-60, '1 hour ago'],
    [-150, '2 hours ago'],
    [-24 * 60, 'yesterday'],
    [-2 * 24 * 60, '2 days ago'],
  ])('says %f minutes from now as "%s"', (minutes, text) => {
    expect(timeAgo(minutesFromNow(minutes), NOW, 'en')).toBe(text)
  })

  it('speaks German', () => {
    expect(timeAgo(minutesFromNow(-2 * 24 * 60), NOW, 'de')).toBe('vorgestern')
    expect(timeAgo(minutesFromNow(-3 * 24 * 60), NOW, 'de')).toBe('vor 3 Tagen')
  })

  it('does not say "in the future" for a clock that is slightly off', () => {
    expect(timeAgo(minutesFromNow(3), NOW, 'en')).toBe('now')
  })
})

describe('timeLeft', () => {
  it.each([
    [7 * 24 * 60, { unit: 'day', count: 7 }],
    [4.2 * 24 * 60, { unit: 'day', count: 5 }],
    [24 * 60, { unit: 'day', count: 1 }],
    [23 * 60, { unit: 'hour', count: 23 }],
    [90, { unit: 'hour', count: 2 }],
    [59, { unit: 'minute', count: 59 }],
    [0.2, { unit: 'minute', count: 1 }],
    [-5, { unit: 'minute', count: 1 }],
  ])('%f minutes left is %j', (minutes, expected) => {
    expect(timeLeft(minutesFromNow(minutes), NOW)).toEqual(expected)
  })
})
