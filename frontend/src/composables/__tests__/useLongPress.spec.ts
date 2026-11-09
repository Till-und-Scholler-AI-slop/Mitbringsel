import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LONG_PRESS_MS, useLongPress } from '../useLongPress'

function pointer(type: string, pointerType = 'touch', x = 0, y = 0) {
  return new PointerEvent(type, { pointerType, clientX: x, clientY: y })
}

// detail 1: a click from a pointer; 0: from the keyboard.
function click(detail = 1) {
  return new MouseEvent('click', { detail })
}

function setup() {
  const onPress = vi.fn<(target: string) => void>()
  const press = useLongPress(onPress)
  return { onPress, press, chip: press.handlers('l1') }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLongPress', () => {
  it('fires when a finger stays on the element', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(onPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(onPress).toHaveBeenCalledExactlyOnceWith('l1')
  })

  it('does not fire when the finger lifts early', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    chip.pointerup()
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onPress).not.toHaveBeenCalled()
  })

  it('does not fire when the finger moves to scroll', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown', 'touch', 100, 20))
    chip.pointermove(pointer('pointermove', 'touch', 104, 23))
    chip.pointermove(pointer('pointermove', 'touch', 120, 20))
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onPress).not.toHaveBeenCalled()
  })

  it('does not fire when the browser takes the touch over', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    chip.pointercancel()
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onPress).not.toHaveBeenCalled()
  })

  it('does not time a mouse button', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown', 'mouse'))
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onPress).not.toHaveBeenCalled()
  })

  it('fires on a right click or system long press and keeps the browser menu closed', () => {
    const { onPress, chip } = setup()
    const event = new MouseEvent('contextmenu', { cancelable: true })

    chip.contextmenu(event)

    expect(onPress).toHaveBeenCalledExactlyOnceWith('l1')
    expect(event.defaultPrevented).toBe(true)
  })

  it('fires once when both the timer and the system report the same press', () => {
    const { onPress, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    chip.contextmenu(new MouseEvent('contextmenu', { cancelable: true }))

    expect(onPress).toHaveBeenCalledOnce()
  })

  it('drops the one click that follows a long press', () => {
    const { press, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(press.consumeClick(click())).toBe(true)
    expect(press.consumeClick(click())).toBe(false)
  })

  it('keeps a plain tap and a click from the keyboard', () => {
    const { press, chip } = setup()

    chip.pointerdown(pointer('pointerdown'))
    chip.pointerup()
    expect(press.consumeClick(click())).toBe(false)

    chip.contextmenu(new MouseEvent('contextmenu', { cancelable: true }))
    expect(press.consumeClick(click(0))).toBe(false)
  })
})
