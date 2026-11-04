<script setup lang="ts">
import { computed, useId } from 'vue'

import BaseIcon from './BaseIcon.vue'

// Not the native maxlength: the user may type past the limit and then sees
// the error and the red counter, instead of the field silently refusing
// keys. The backend validates again (GROUP_NAME_INVALID).
const props = defineProps<{
  label: string
  /** Shown instead of the hint; also marks the field as invalid. */
  error?: string | null
  hint?: string
  /** Shows a "length/max" counter. */
  maxLength?: number
}>()

const model = defineModel<string>({ required: true })

// Everything else (placeholder, autocomplete, inputmode, autofocus, ...)
// belongs on the <input>, not on the wrapper.
defineOptions({ inheritAttrs: false })

const id = useId()
const messageId = `${id}-message`

// Counted in characters, not UTF-16 units, so an emoji counts once (like on
// the server).
const length = computed(() => Array.from(model.value).length)
const overLimit = computed(() => props.maxLength !== undefined && length.value > props.maxLength)
const describedBy = computed(() => (props.error || props.hint ? messageId : undefined))
</script>

<template>
  <div class="field">
    <div class="label-row">
      <label :for="id" class="label">{{ label }}</label>
      <span
        v-if="maxLength !== undefined"
        :class="['counter', { 'counter--over': overLimit }]"
        aria-live="polite"
      >
        {{ length }}/{{ maxLength }}
      </span>
    </div>
    <input
      :id="id"
      v-model="model"
      v-bind="$attrs"
      class="input"
      type="text"
      :aria-invalid="Boolean(error) || undefined"
      :aria-describedby="describedBy"
    />
    <p v-if="error" :id="messageId" class="message message--error" role="alert">
      <BaseIcon name="alert" :size="18" />
      <span>{{ error }}</span>
    </p>
    <p v-else-if="hint" :id="messageId" class="message">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
}

.label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.counter {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.counter--over {
  color: var(--color-danger-text);
  font-weight: var(--font-weight-heavy);
}

.input {
  width: 100%;
  min-height: var(--size-touch);
  padding: 0 var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
}

.input[aria-invalid='true'] {
  border-color: var(--color-danger);
  background: var(--color-danger-surface);
}

.message {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: break-word;
}

.message--error {
  color: var(--color-danger-text);
  font-weight: var(--font-weight-bold);
}
</style>
