import { ref } from 'vue'
import { defineStore } from 'pinia'

import type { IconName } from '@/components/base/icons'

/** How long a toast stays, unless it is an error or the stack is paused. */
export const TOAST_DURATION_MS = 5000
/** At most this many toasts are shown; a new one pushes out the oldest. */
export const MAX_TOASTS = 3

export type ToastKind = 'success' | 'info' | 'error'

/**
 * Why a toast went away: its time ran out, the user closed it, pressed its
 * action, or a newer toast pushed it out.
 */
export type ToastEnd = 'timeout' | 'closed' | 'action' | 'replaced'

export interface ToastOptions {
  kind: ToastKind
  text: string
  /** A second, smaller line. */
  detail?: string
  /** The symbol on the badge; each kind has a default. */
  icon?: IconName
  /** The label of a button next to the text, e.g. "Undo". */
  actionLabel?: string
  /**
   * Moves the focus to the action once the toast is shown. Only for a toast
   * started from the keyboard: the focus pauses the time.
   */
  focusAction?: boolean
  /** Called once when the toast goes away, with the reason. */
  onEnd?: (reason: ToastEnd) => void
}

/** A toast as the screen shows it. */
export interface Toast {
  id: number
  kind: ToastKind
  text: string
  detail: string | null
  icon: IconName
  actionLabel: string | null
  focusAction: boolean
  /** False for errors: they stay until closed. */
  timed: boolean
}

const DEFAULT_ICONS: Record<ToastKind, IconName> = {
  success: 'check',
  info: 'info',
  error: 'alert',
}

// The clock of one timed toast. While running, `startedAt` says since when;
// `remaining` is the time left when it last started.
interface Clock {
  remaining: number
  startedAt: number
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * The toasts of the whole app, newest last. Each timed toast has a clock of
 * its own; hovering or focusing the stack pauses all of them (docs/design.md,
 * design "toast-stapel"). Errors have no clock.
 *
 * The store holds the time, not the animation of the bar: what happens when
 * a toast ends (e.g. deleting items for good) must not depend on CSS.
 */
export const useToastsStore = defineStore('toasts', () => {
  const toasts = ref<Toast[]>([])
  const paused = ref(false)

  // Not shown, so plain Maps next to the reactive state.
  const clocks = new Map<number, Clock>()
  const callbacks = new Map<number, (reason: ToastEnd) => void>()
  let nextId = 0

  function start(id: number, clock: Clock) {
    clock.startedAt = Date.now()
    clock.timer = setTimeout(() => end(id, 'timeout'), clock.remaining)
  }

  function stop(clock: Clock) {
    if (clock.timer === null) {
      return
    }
    clearTimeout(clock.timer)
    clock.timer = null
    clock.remaining -= Date.now() - clock.startedAt
  }

  /** Shows a toast and returns its ID. */
  function show(options: ToastOptions): number {
    const id = ++nextId
    const timed = options.kind !== 'error'
    toasts.value.push({
      id,
      kind: options.kind,
      text: options.text,
      detail: options.detail ?? null,
      icon: options.icon ?? DEFAULT_ICONS[options.kind],
      actionLabel: options.actionLabel ?? null,
      focusAction: options.focusAction ?? false,
      timed,
    })
    if (options.onEnd) {
      callbacks.set(id, options.onEnd)
    }
    if (timed) {
      const clock: Clock = { remaining: TOAST_DURATION_MS, startedAt: 0, timer: null }
      clocks.set(id, clock)
      if (!paused.value) {
        start(id, clock)
      }
    }
    if (toasts.value.length > MAX_TOASTS) {
      end(toasts.value[0]!.id, 'replaced')
    }
    return id
  }

  // Takes the toast away and tells its owner why. Ending a toast that is
  // gone already does nothing, so the callback runs once.
  function end(id: number, reason: ToastEnd) {
    const index = toasts.value.findIndex((toast) => toast.id === id)
    if (index === -1) {
      return
    }
    toasts.value.splice(index, 1)
    const clock = clocks.get(id)
    if (clock?.timer) {
      clearTimeout(clock.timer)
    }
    clocks.delete(id)
    const onEnd = callbacks.get(id)
    callbacks.delete(id)
    onEnd?.(reason)
  }

  /** The user closed the toast. */
  function close(id: number) {
    end(id, 'closed')
  }

  /** The user pressed the action of the toast; it goes away with it. */
  function runAction(id: number) {
    end(id, 'action')
  }

  /** Stops every clock, e.g. while the pointer or the focus is on the stack. */
  function pause() {
    if (paused.value) {
      return
    }
    paused.value = true
    for (const clock of clocks.values()) {
      stop(clock)
    }
  }

  /** Lets every clock run on from where it stopped. */
  function resume() {
    if (!paused.value) {
      return
    }
    paused.value = false
    for (const [id, clock] of clocks) {
      start(id, clock)
    }
  }

  /**
   * How long the toast has been running, so a bar drawn later (e.g. after
   * switching pages) starts where the clock is. 0 for an untimed toast.
   */
  function elapsedOf(id: number): number {
    const clock = clocks.get(id)
    if (!clock) {
      return 0
    }
    const running = clock.timer === null ? 0 : Date.now() - clock.startedAt
    return TOAST_DURATION_MS - clock.remaining + running
  }

  return { toasts, paused, show, close, runAction, pause, resume, elapsedOf }
})
