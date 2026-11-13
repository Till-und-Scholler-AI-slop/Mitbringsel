<script setup lang="ts">
import { computed, useId } from 'vue'

import BaseIcon from './BaseIcon.vue'

// The multi-line sibling of BaseInput, with the same label, message and
// error. No native maxlength either: the error says what is too long.
const props = withDefaults(
  defineProps<{
    label: string
    /** Shown instead of the hint; also marks the field as invalid. */
    error?: string | null
    hint?: string
    /** A short word next to the label, e.g. "optional". */
    aside?: string
    rows?: number
  }>(),
  { error: null, hint: undefined, aside: undefined, rows: 2 },
)

const model = defineModel<string>({ required: true })

// Everything else (placeholder, autofocus, ...) belongs on the <textarea>.
defineOptions({ inheritAttrs: false })

const id = useId()
const messageId = `${id}-message`
const describedBy = computed(() => (props.error || props.hint ? messageId : undefined))
</script>

<template>
  <div class="field">
    <div class="label-row">
      <label :for="id" class="label">{{ label }}</label>
      <span v-if="aside" class="aside">{{ aside }}</span>
    </div>
    <textarea
      :id="id"
      v-model="model"
      v-bind="$attrs"
      class="textarea"
      :rows="rows"
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

.aside {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.textarea {
  width: 100%;
  min-height: 4.375rem;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-md);
  line-height: 1.375;
  font-weight: var(--font-weight-medium);
  resize: none;
}

.textarea[aria-invalid='true'] {
  border-color: var(--color-danger);
  background: var(--color-danger-surface);
}

.textarea::placeholder {
  color: var(--color-text-muted);
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
