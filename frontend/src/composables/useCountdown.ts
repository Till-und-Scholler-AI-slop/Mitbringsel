import { computed, onScopeDispose, readonly, ref } from 'vue'

const TICK_MS = 1000

/**
 * A countdown in whole seconds, e.g. for "try again in 42 s" after a 429.
 * start() begins (or restarts) it; `remaining` reaches 0 and stays there.
 */
export function useCountdown() {
  const remaining = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function start(seconds: number) {
    stop()
    remaining.value = Math.max(0, Math.ceil(seconds))
    if (remaining.value === 0) return
    timer = setInterval(() => {
      remaining.value--
      if (remaining.value <= 0) stop()
    }, TICK_MS)
  }

  // Runs when the component (or effect scope) using this goes away.
  onScopeDispose(stop)

  return { remaining: readonly(remaining), running: computed(() => remaining.value > 0), start }
}
