<script setup lang="ts">
import BaseSpinner from './BaseSpinner.vue'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

const SPINNER_SIZE = 18

// While loading the button is disabled too, so a second click cannot start
// the same action twice.
withDefaults(
  defineProps<{
    variant?: ButtonVariant
    type?: 'button' | 'submit' | 'reset'
    loading?: boolean
    disabled?: boolean
  }>(),
  { variant: 'primary', type: 'button', loading: false, disabled: false },
)
</script>

<template>
  <button
    :type="type"
    :class="['base-button', `base-button--${variant}`]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <BaseSpinner v-if="loading" :size="SPINNER_SIZE" />
    <slot />
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--size-touch);
  padding: 0 var(--space-5);
  border: var(--border-width-md) solid transparent;
  border-radius: var(--radius-full);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-tight);
  cursor: pointer;
}

.base-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

/* Sticker buttons sink onto their shadow when pressed. */
.base-button--primary,
.base-button--secondary {
  box-shadow: var(--shadow-sticker);
  transition:
    transform var(--duration-press) var(--easing-bounce),
    box-shadow var(--duration-press);
}

.base-button--primary:active:not(:disabled),
.base-button--secondary:active:not(:disabled) {
  transform: translateY(3px);
  box-shadow: none;
}

.base-button--primary {
  border-color: var(--color-primary-contrast);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}

.base-button--secondary {
  border-color: var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
}

.base-button--ghost {
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font-weight: var(--font-weight-heavy);
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .base-button {
    transition: none;
  }
}
</style>
