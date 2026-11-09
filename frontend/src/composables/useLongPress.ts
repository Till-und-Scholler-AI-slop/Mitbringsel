import { getCurrentScope, onScopeDispose } from 'vue'

/** How long a finger has to stay on the element. */
export const LONG_PRESS_MS = 500
/** A finger that moves farther scrolls instead of pressing. */
export const LONG_PRESS_TOLERANCE_PX = 10

/**
 * Detects a long press or right click on one of several elements, each with
 * its own target (e.g. the list behind a chip).
 *
 * A right click fires at once. A finger fires when it lifts, not while it
 * still holds: the browser runs its own long press on whatever lies under
 * the finger by then, and if that is a dialog we just opened, it selects
 * text in it and shows its copy and share menu.
 *
 * A finger counts as held after LONG_PRESS_MS of our own timer (iOS Safari
 * reports nothing) or once Android reports its long press as a contextmenu
 * event, whichever comes first.
 */
export function useLongPress<T>(onPress: (target: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  // Where the finger went down; null while no finger is on the element.
  let start: { x: number; y: number } | null = null
  // The finger has stayed long enough; it fires when it lifts.
  let held = false

  function reset() {
    clearTimeout(timer)
    timer = undefined
    start = null
    held = false
  }

  function hold() {
    clearTimeout(timer)
    timer = undefined
    held = true
  }

  /** Event listeners for one element, for `v-on="handlers(target)"`. */
  function handlers(target: T) {
    return {
      pointerdown(event: PointerEvent) {
        // Mouse and pen use the right click, which arrives as contextmenu.
        if (event.pointerType !== 'touch') return
        reset()
        start = { x: event.clientX, y: event.clientY }
        timer = setTimeout(hold, LONG_PRESS_MS)
      },
      pointermove(event: PointerEvent) {
        if (!start) return
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (distance > LONG_PRESS_TOLERANCE_PX) reset()
      },
      // The finger lifts; touchend follows and decides.
      pointerup() {
        clearTimeout(timer)
        timer = undefined
        start = null
      },
      // The browser took the touch over. While scrolling the chip row that
      // happens before the finger counts as held; after that, Android does
      // not scroll any more and the press still counts.
      pointercancel() {
        const fire = held
        reset()
        if (fire) onPress(target)
      },
      touchend(event: Event) {
        if (!held) return
        reset()
        // No click after the press: it would follow the chip.
        event.preventDefault()
        onPress(target)
      },
      contextmenu(event: MouseEvent) {
        // No browser menu.
        event.preventDefault()
        // A finger on the element: Android's long press, it waits for the
        // finger to lift. Otherwise a right click, it fires at once. This
        // does not depend on a pointerdown before it, which Firefox does not
        // always send after a right click that opened a modal dialog.
        if (start) hold()
        else onPress(target)
      },
    }
  }

  // A timer must not outlive the component.
  if (getCurrentScope()) onScopeDispose(reset)

  return { handlers }
}
