import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useOnlineStatus } from '../useOnlineStatus'

// jsdom's navigator.onLine is always true; the spy plays the network.
function setNavigatorOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

// Runs the composable in its own scope, like a component would, so the
// test can end it and check that the listeners are gone.
function useInScope() {
  const scope = effectScope()
  const status = scope.run(() => useOnlineStatus())
  if (!status) throw new Error('scope did not run')
  return { ...status, stop: () => scope.stop() }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useOnlineStatus', () => {
  it('starts with the current state', () => {
    setNavigatorOnline(false)

    const { online, stop } = useInScope()

    expect(online.value).toBe(false)
    stop()
  })

  it('follows the offline and online events', () => {
    setNavigatorOnline(true)
    const { online, stop } = useInScope()

    setNavigatorOnline(false)
    window.dispatchEvent(new Event('offline'))
    expect(online.value).toBe(false)

    setNavigatorOnline(true)
    window.dispatchEvent(new Event('online'))
    expect(online.value).toBe(true)
    stop()
  })

  it('stops listening when its scope ends', () => {
    setNavigatorOnline(true)
    const { online, stop } = useInScope()
    stop()

    setNavigatorOnline(false)
    window.dispatchEvent(new Event('offline'))

    expect(online.value).toBe(true)
  })
})
