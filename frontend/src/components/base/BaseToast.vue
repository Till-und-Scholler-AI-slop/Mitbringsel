<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from './BaseIcon.vue'
import type { IconName } from './icons'

const BADGE_ICON_SIZE = 16
const CLOSE_ICON_SIZE = 20
const ICON_STROKE_WIDTH = 2.75

// One toast. It only shows: the time runs in the toasts store, the bar
// follows it. elapsedMs is read once, so a toast drawn again (e.g. after
// switching pages) starts its bar where the clock is.
const props = withDefaults(
  defineProps<{
    kind: 'success' | 'info' | 'error'
    text: string
    icon: IconName
    detail?: string | null
    actionLabel?: string | null
    /** Shows the bar; errors are not timed. */
    timed?: boolean
    durationMs?: number
    elapsedMs?: number
    paused?: boolean
    focusAction?: boolean
  }>(),
  {
    detail: null,
    actionLabel: null,
    timed: false,
    durationMs: 0,
    elapsedMs: 0,
    paused: false,
    focusAction: false,
  },
)
defineEmits<{ action: []; close: [] }>()

const { t } = useI18n()
const actionButton = ref<HTMLButtonElement | null>(null)

// A negative delay starts the animation part way through.
const barStyle = {
  animationDuration: `${props.durationMs}ms`,
  animationDelay: `-${props.elapsedMs}ms`,
}

onMounted(() => {
  if (props.focusAction) actionButton.value?.focus()
})
</script>

<template>
  <div
    class="toast"
    :class="[`toast--${kind}`, { 'toast--timed': timed, 'toast--paused': paused }]"
    :role="kind === 'error' ? 'alert' : undefined"
  >
    <span class="body">
      <span class="badge" aria-hidden="true">
        <BaseIcon :name="icon" :size="BADGE_ICON_SIZE" :stroke-width="ICON_STROKE_WIDTH" />
      </span>
      <span class="texts">
        <span class="text">{{ text }}</span>
        <span v-if="detail" class="detail">{{ detail }}</span>
      </span>
    </span>
    <span class="buttons">
      <button
        v-if="actionLabel"
        ref="actionButton"
        type="button"
        class="action"
        @click="$emit('action')"
      >
        {{ actionLabel }}
      </button>
      <button type="button" class="close" :aria-label="t('toast.close')" @click="$emit('close')">
        <BaseIcon name="close" :size="CLOSE_ICON_SIZE" :stroke-width="ICON_STROKE_WIDTH" />
      </button>
    </span>
    <span v-if="timed" class="bar" aria-hidden="true">
      <span class="bar-fill" :style="barStyle" />
    </span>
  </div>
</template>

<style scoped>
/* Design "toast-*": an ink surface with a hard shadow, the actions on the
   right; they move below the text once it would get narrower than 170px. */
.toast {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--space-2);
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-1) var(--space-1) var(--space-1) 0.875rem;
  border: var(--border-width-sm) solid var(--color-toast-bg);
  border-radius: var(--radius-lg);
  background: var(--color-toast-bg);
  color: var(--color-toast-text);
  box-shadow: var(--shadow-toast);
  pointer-events: auto;
}

/* Room for the bar. */
.toast--timed {
  padding-bottom: 0.625rem;
}

.toast--error {
  border-width: var(--border-width-lg);
  border-color: var(--color-toast-error-border);
}

.toast :focus-visible {
  outline-color: var(--color-toast-focus);
  outline-offset: 2px;
}

.body {
  flex: 1 1 10.625rem;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.4375rem 0;
}

.badge {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.875rem;
  height: 1.875rem;
  border-radius: var(--radius-full);
}

.toast--success .badge {
  background: var(--color-toast-success-badge);
  color: var(--color-toast-success-badge-text);
}

.toast--info .badge {
  background: var(--color-toast-info-badge);
  color: var(--color-toast-info-badge-text);
}

.toast--error .badge {
  background: var(--color-toast-error-badge);
  color: var(--color-toast-error-badge-text);
}

.texts {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: var(--space-1);
}

/* Long German words and names break instead of overflowing. */
.text {
  font-size: var(--font-size-md);
  line-height: 1.3125rem;
  font-weight: var(--font-weight-bold);
  hyphens: auto;
  overflow-wrap: anywhere;
}

.detail {
  font-size: var(--font-size-xs);
  line-height: 1.1875rem;
  font-weight: var(--font-weight-medium);
  color: var(--color-toast-detail);
  overflow-wrap: anywhere;
}

.buttons {
  flex: none;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.action {
  min-height: 2.75rem;
  padding: 0 var(--space-4);
  box-sizing: border-box;
  border: var(--border-width-sm) solid var(--color-toast-action-border);
  border-radius: var(--radius-full);
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-black);
  cursor: pointer;
}

.close {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--space-1);
  background: var(--color-toast-bar-track);
}

.bar-fill {
  display: block;
  height: 100%;
  background: var(--color-toast-bar);
  transform-origin: left center;
  animation-name: toast-bar;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

.toast--paused .bar-fill {
  animation-play-state: paused;
}

@keyframes toast-bar {
  from {
    transform: scaleX(1);
  }

  to {
    transform: scaleX(0);
  }
}

/* The bar jumps in five steps instead of gliding. */
@media (prefers-reduced-motion: reduce) {
  .bar-fill {
    animation-timing-function: steps(5, end);
  }
}
</style>
