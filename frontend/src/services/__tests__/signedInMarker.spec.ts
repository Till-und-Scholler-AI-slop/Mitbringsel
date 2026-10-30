import { afterEach, describe, expect, it, vi } from 'vitest'

import { localSignedInMarker } from '../signedInMarker'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('localSignedInMarker', () => {
  it('can be set and cleared', () => {
    expect(localSignedInMarker.isSet()).toBe(false)

    localSignedInMarker.set()
    expect(localSignedInMarker.isSet()).toBe(true)

    localSignedInMarker.clear()
    expect(localSignedInMarker.isSet()).toBe(false)
  })

  it('treats blocked storage as not set instead of failing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(() => localSignedInMarker.set()).not.toThrow()
    expect(localSignedInMarker.isSet()).toBe(false)
  })
})
