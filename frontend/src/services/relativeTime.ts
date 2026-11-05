const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** "2 days ago", "just now": how long ago something happened, in the given language. */
export function timeAgo(from: Date, now: Date, locale: string): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const elapsed = Math.max(0, now.getTime() - from.getTime())
  if (elapsed < MINUTE_MS) return formatter.format(0, 'second')
  if (elapsed < HOUR_MS) return formatter.format(-Math.floor(elapsed / MINUTE_MS), 'minute')
  if (elapsed < DAY_MS) return formatter.format(-Math.floor(elapsed / HOUR_MS), 'hour')
  return formatter.format(-Math.floor(elapsed / DAY_MS), 'day')
}

export interface TimeLeft {
  unit: 'day' | 'hour' | 'minute'
  count: number
}

/**
 * How much time is left until something ends, in the largest unit that fits,
 * rounded up so that a link with 4.2 days left says 5, not 4. At least one
 * minute, so an end that is just now does not say "0 minutes left".
 */
export function timeLeft(until: Date, now: Date): TimeLeft {
  const left = Math.max(0, until.getTime() - now.getTime())
  if (left >= DAY_MS) return { unit: 'day', count: Math.ceil(left / DAY_MS) }
  if (left >= HOUR_MS) return { unit: 'hour', count: Math.ceil(left / HOUR_MS) }
  return { unit: 'minute', count: Math.max(1, Math.ceil(left / MINUTE_MS)) }
}
