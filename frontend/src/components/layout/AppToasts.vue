<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import BaseToast from '@/components/base/BaseToast.vue'
import { TOAST_DURATION_MS, useToastsStore } from '@/stores/toasts'

// The stack of toasts, newest at the bottom, near the thumb. A mouse over it
// or the focus in it pauses every toast (design "toast-stapel"). Only a
// mouse counts as hovering: a finger that taps the text would pause the
// toasts until the next tap elsewhere.
const toasts = useToastsStore()
const stack = ref<HTMLElement | null>(null)
const hovered = ref(false)
const focused = ref(false)

watch(
  computed(() => hovered.value || focused.value),
  (hold) => (hold ? toasts.pause() : toasts.resume()),
)

// With the last toast gone the pointer may still count as over the stack,
// as no pointerleave comes until it moves; the next toast must not start
// paused.
watch(
  () => toasts.toasts.length,
  (count) => {
    if (count === 0) {
      hovered.value = false
      focused.value = false
    }
  },
)

function onPointerEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse') hovered.value = true
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  focused.value = next instanceof Node && (stack.value?.contains(next) ?? false)
}
</script>

<template>
  <div
    ref="stack"
    class="toasts"
    role="status"
    aria-live="polite"
    @pointerenter="onPointerEnter"
    @pointerleave="hovered = false"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <TransitionGroup name="toast">
      <BaseToast
        v-for="toast in toasts.toasts"
        :key="toast.id"
        :kind="toast.kind"
        :text="toast.text"
        :detail="toast.detail"
        :icon="toast.icon"
        :action-label="toast.actionLabel"
        :timed="toast.timed"
        :duration-ms="TOAST_DURATION_MS"
        :elapsed-ms="toasts.elapsedOf(toast.id)"
        :paused="toasts.paused"
        :focus-action="toast.focusAction"
        @action="toasts.runAction(toast.id)"
        @close="toasts.close(toast.id)"
      />
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* Phone: across the screen, above the safe area and above a bar the page
   keeps at the bottom (--app-bottom-bar, set by AppFrame). Above the menus
   of the page (z-index 10); dialogs are in the top layer and cover it
   anyway. */
.toasts {
  position: fixed;
  left: var(--space-3);
  right: var(--space-3);
  bottom: calc(var(--space-4) + var(--app-bottom-bar, 0px) + env(safe-area-inset-bottom));
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Desktop: centered at the bottom of the content, right of the sidebar. */
@media (min-width: 48rem) {
  .toasts {
    left: var(--size-sidebar);
    right: 0;
    bottom: var(--space-6);
    width: calc(100% - var(--size-sidebar) - 2 * var(--space-6));
    max-width: var(--size-toast-max);
    margin-inline: auto;
  }
}

.toast-enter-active {
  transition:
    opacity var(--duration-toast-in) var(--easing-toast-in),
    transform var(--duration-toast-in) var(--easing-toast-in);
}

.toast-leave-active {
  transition:
    opacity var(--duration-toast-out) ease-in,
    transform var(--duration-toast-out) ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(var(--space-4)) scale(0.98);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(var(--space-2));
}

/* Only fading, nothing moves. */
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity var(--duration-toast-out) linear;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: none;
  }
}
</style>
