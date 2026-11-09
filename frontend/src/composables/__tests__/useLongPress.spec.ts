import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LONG_PRESS_MS, useLongPress } from '../useLongPress'

function pointer(type: string, pointerType = 'touch', x = 0, y = 0) {
  return new PointerEvent(type, { pointerType, clientX: x, clientY: y })
}

function cancelable(type: string) {
  return new Event(type, { cancelable: true })
}

function contextmenu() {
  return new MouseEvent('contextmenu', { cancelable: true })
}

function setup() {
  const onPress = vi.fn<(target: string) => void>()
  const press = useLongPress(onPress)
  return { onPress, chip: press.handlers('l1') }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLongPress with a finger', () => {
  it('fires when the finger lifts after holding, and keeps the click away', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    // Still holding: a dialog now would be under the finger.
    expect(onPress).not.toHaveBeenCalled()

    chip.pointerup()
    const touchend = cancelable('touchend')
    chip.touchend(touchend)

    expect(onPress).toHaveBeenCalledExactlyOnceWith('l1')
    expect(touchend.defaultPrevented).toBe(true)
  })

  it('does not fire when the finger lifts early, and keeps the click', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    chip.pointerup()
    const touchend = cancelable('touchend')
    chip.touchend(touchend)
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onPress).not.toHaveBeenCalled()
    expect(touchend.defaultPrevented).toBe(false)
  })

  it('does not fire when the finger moves to scroll', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown', 'touch', 100, 20))
    chip.pointermove(pointer('pointermove', 'touch', 104, 23))
    chip.pointermove(pointer('pointermove', 'touch', 120, 20))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    chip.pointerup()
    chip.touchend(cancelable('touchend'))

    expect(onPress).not.toHaveBeenCalled()
  })

  it('does not fire when the browser takes the touch over to scroll', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    chip.pointercancel()
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onPress).not.toHaveBeenCalled()
  })

  it('fires when the browser takes a held touch over', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    chip.pointercancel()

    expect(onPress).toHaveBeenCalledExactlyOnceWith('l1')
  })

  it("waits for the finger after Android's long press and keeps its menu closed", () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS - 100)
    const event = contextmenu()
    chip.contextmenu(event)
    vi.advanceTimersByTime(100)
    expect(event.defaultPrevented).toBe(true)
    expect(onPress).not.toHaveBeenCalled()

    chip.pointerup()
    chip.touchend(cancelable('touchend'))

    expect(onPress).toHaveBeenCalledExactlyOnceWith('l1')
  })
})

describe('useLongPress with a mouse', () => {
  it('does not time a mouse button', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown', 'mouse'))
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onPress).not.toHaveBeenCalled()
  })

  it('fires at once on a right click and keeps the browser menu closed', () => {
    const { onPress, chip } = setup()
    const event = contextmenu()

    chip.pointerdown(pointer('pointerdown', 'mouse'))
    chip.contextmenu(event)

    expect(onPress).toHaveBeenCalledExactlyOnceWith('l1')
    expect(event.defaultPrevented).toBe(true)
  })

  it('fires on every right click, also without a pointerdown before it', () => {
    const { onPress, chip } = setup()

    chip.contextmenu(contextmenu())
    chip.contextmenu(contextmenu())

    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('fires on a right click after a long press with a finger', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    chip.pointerup()
    chip.touchend(cancelable('touchend'))
    chip.contextmenu(contextmenu())

    expect(onPress).toHaveBeenCalledTimes(2)
  })
})
