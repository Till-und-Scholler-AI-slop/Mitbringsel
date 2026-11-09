import { getCurrentScope, onScopeDispose } from 'vue'

/** How long a finger has to stay on the element. */
export const LONG_PRESS_MS = 500
/** A finger that moves farther scrolls instead of pressing. */
export const LONG_PRESS_TOLERANCE_PX = 10

/**
 * Detects a long press on one of several elements, each with its own target
 * (e.g. the list behind a chip).
 *
 * Android and desktop browsers report a long press or right click as a
 * `contextmenu` event. iOS Safari does not, so a touch is timed here as well.
 * Whichever comes first fires; the other one is ignored.
 *
 * After a long press the browser may still send a click on release, which
 * would follow a link. The click handler asks `consumeClick` and drops it.
 */
export function useLongPress<T>(onPress: (target: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start: { x: number; y: number } | null = null
  let fired = false

  function cancel() {
    clearTimeout(timer)
    timer = undefined
    start = null
  }

  function fire(target: T) {
    cancel()
    fired = true
    onPress(target)
  }

  /** Event listeners for one element, for `v-on="handlers(target)"`. */
  function handlers(target: T) {
    return {
      pointerdown(event: PointerEvent) {
        fired = false
        // Mouse and pen use the right click, which arrives as contextmenu.
        if (event.pointerType !== 'touch') return
        cancel()
        start = { x: event.clientX, y: event.clientY }
        timer = setTimeout(() => fire(target), LONG_PRESS_MS)
      },
      pointermove(event: PointerEvent) {
        if (!start) return
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (distance > LONG_PRESS_TOLERANCE_PX) cancel()
      },
      pointerup: cancel,
      // The browser took the touch over, e.g. to scroll the chip row.
      pointercancel: cancel,
      contextmenu(event: MouseEvent) {
        // No browser menu and no link preview.
        event.preventDefault()
        if (!fired) fire(target)
      },
    }
  }

  /**
   * True if the click belongs to a long press that already fired; true only
   * once. A click from the keyboard (detail 0) never belongs to one.
   */
  function consumeClick(event: MouseEvent): boolean {
    if (event.detail === 0) return false
    const belongs = fired
    fired = false
    return belongs
  }

  // A timer must not fire into a component that is gone.
  if (getCurrentScope()) onScopeDispose(cancel)

  return { handlers, consumeClick }
}
