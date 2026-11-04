<script setup lang="ts">
import BaseIcon from './BaseIcon.vue'
import type { IconName } from './icons'

const ICON_SIZE = 22

// The label is required because the button has no visible text: it is what
// screen readers announce. Clicks reach the parent as a native click event.
withDefaults(
  defineProps<{
    icon: IconName
    label: string
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  { type: 'button', disabled: false },
)
</script>

<template>
  <button :type="type" class="icon-button" :aria-label="label" :disabled="disabled">
    <BaseIcon :name="icon" :size="ICON_SIZE" />
  </button>
</template>

<style scoped>
.icon-button {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
