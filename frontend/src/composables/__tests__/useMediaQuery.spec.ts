import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useMediaQuery } from '../useMediaQuery'

// A MediaQueryList that the test can switch.
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = {
    matches,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
  }
  const matchMedia = vi.fn(() => media)
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    matchMedia,
    listeners,
    change(now: boolean) {
      media.matches = now
      for (const listener of listeners) listener({ matches: now } as MediaQueryListEvent)
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMediaQuery', () => {
  it('starts with whether the query matches and follows its changes', () => {
    const media = stubMatchMedia(true)
    const scope = effectScope()
    const matches = scope.run(() => useMediaQuery('(min-width: 79rem)'))!

    expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 79rem)')
    expect(matches.value).toBe(true)

    media.change(false)
    expect(matches.value).toBe(false)

    // The listener goes with the component that used it.
    scope.stop()
    expect(media.listeners.size).toBe(0)
  })

  it('is false where there is no matchMedia, as in jsdom', () => {
    vi.stubGlobal('matchMedia', undefined)

    const scope = effectScope()
    expect(scope.run(() => useMediaQuery('(min-width: 79rem)'))!.value).toBe(false)
    scope.stop()
  })
})
