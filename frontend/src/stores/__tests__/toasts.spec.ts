import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { MAX_TOASTS, TOAST_DURATION_MS, type ToastEnd, useToastsStore } from '../toasts'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Shows a toast and records how it ended. */
function showRecorded(kind: 'success' | 'info' | 'error' = 'success') {
  const store = useToastsStore()
  const ends: ToastEnd[] = []
  const id = store.show({ kind, text: 'Milch entfernt', onEnd: (reason) => ends.push(reason) })
  return { store, id, ends }
}

describe('toasts store', () => {
  it('shows a toast with the defaults of its kind', () => {
    const store = useToastsStore()

    store.show({ kind: 'info', text: 'Hallo' })
    store.show({
      kind: 'success',
      text: 'Weg',
      detail: 'Alles',
      icon: 'trash',
      actionLabel: 'Undo',
    })

    expect(store.toasts).toMatchObject([
      { kind: 'info', text: 'Hallo', detail: null, icon: 'info', actionLabel: null, timed: true },
      { kind: 'success', text: 'Weg', detail: 'Alles', icon: 'trash', actionLabel: 'Undo' },
    ])
  })

  it('ends a toast after its time, once', () => {
    const { store, ends } = showRecorded()

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1)
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)

    expect(store.toasts).toHaveLength(0)
    expect(ends).toEqual(['timeout'])
  })

  it('keeps an error until it is closed', () => {
    const { store, id, ends } = showRecorded('error')

    vi.advanceTimersByTime(10 * TOAST_DURATION_MS)
    expect(store.toasts).toMatchObject([{ timed: false, icon: 'alert' }])

    store.close(id)
    expect(store.toasts).toHaveLength(0)
    expect(ends).toEqual(['closed'])
  })

  it('tells closing and the action apart and calls back only once', () => {
    const closed = showRecorded()
    closed.store.close(closed.id)
    closed.store.close(closed.id)
    vi.advanceTimersByTime(TOAST_DURATION_MS)

    const acted = showRecorded()
    acted.store.runAction(acted.id)
    vi.advanceTimersByTime(TOAST_DURATION_MS)

    expect(closed.ends).toEqual(['closed'])
    expect(acted.ends).toEqual(['action'])
  })

  it('pushes out the oldest toast beyond the maximum', () => {
    const oldest = showRecorded()
    for (let i = 1; i < MAX_TOASTS; i++) {
      oldest.store.show({ kind: 'info', text: `Toast ${i}` })
    }
    expect(oldest.ends).toEqual([])

    oldest.store.show({ kind: 'info', text: 'Newest' })

    expect(oldest.ends).toEqual(['replaced'])
    expect(oldest.store.toasts).toHaveLength(MAX_TOASTS)
    expect(oldest.store.toasts[MAX_TOASTS - 1]?.text).toBe('Newest')
  })

  it('pauses every clock and lets it run on with the time that was left', () => {
    const { store, id, ends } = showRecorded()
    vi.advanceTimersByTime(2000)

    store.pause()
    vi.advanceTimersByTime(10 * TOAST_DURATION_MS)
    expect(ends).toEqual([])
    expect(store.elapsedOf(id)).toBe(2000)

    store.resume()
    vi.advanceTimersByTime(TOAST_DURATION_MS - 2000 - 1)
    expect(ends).toEqual([])
    vi.advanceTimersByTime(1)
    expect(ends).toEqual(['timeout'])
  })

  it('starts a toast shown while paused only on resume', () => {
    const store = useToastsStore()
    store.pause()
    const { ends } = showRecorded()

    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(ends).toEqual([])

    store.resume()
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(ends).toEqual(['timeout'])
  })

  it('says how long a toast has been running', () => {
    const { store, id } = showRecorded()
    const error = store.show({ kind: 'error', text: 'Kaputt' })

    vi.advanceTimersByTime(1500)

    expect(store.elapsedOf(id)).toBe(1500)
    expect(store.elapsedOf(error)).toBe(0)
  })
})
