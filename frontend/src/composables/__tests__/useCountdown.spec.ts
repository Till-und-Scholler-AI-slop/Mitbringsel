import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useCountdown } from '../useCountdown'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCountdown', () => {
  it('counts down to zero and stops', () => {
    const { remaining, running, start } = useCountdown()

    start(3)
    expect(remaining.value).toBe(3)
    expect(running.value).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(remaining.value).toBe(2)

    vi.advanceTimersByTime(5000)
    expect(remaining.value).toBe(0)
    expect(running.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rounds up and restarts', () => {
    const { remaining, start } = useCountdown()

    start(2.2)
    expect(remaining.value).toBe(3)

    vi.advanceTimersByTime(1000)
    start(10)
    expect(remaining.value).toBe(10)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('does nothing for zero or less', () => {
    const { remaining, running, start } = useCountdown()

    start(0)
    start(-4)

    expect(remaining.value).toBe(0)
    expect(running.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops when its scope ends', () => {
    const scope = effectScope()
    const countdown = scope.run(() => useCountdown())
    countdown?.start(10)

    scope.stop()

    expect(vi.getTimerCount()).toBe(0)
  })
})
