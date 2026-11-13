<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import { parseQuantity, stepQuantity } from '@/services/itemForm'

// More digits than this are noise (as in useQuantityText).
const MAX_FRACTION_DIGITS = 3

// The quantity as text, as typed: a text field and not type="number", which
// reads the decimal comma differently in each browser and changes the value
// on the mouse wheel. The form parses it with parseQuantity().
const props = defineProps<{ label: string; error?: string | null }>()
const model = defineModel<string>({ required: true })

const { t, n } = useI18n()
const id = useId()
const messageId = `${id}-message`
const describedBy = computed(() => (props.error ? messageId : undefined))

// A field that does not parse counts as empty, so plus starts at 1.
function step(direction: -1 | 1) {
  const parsed = parseQuantity(model.value)
  const next = stepQuantity(parsed.ok ? parsed.value : null, direction)
  model.value =
    next === null ? '' : n(next, { maximumFractionDigits: MAX_FRACTION_DIGITS, useGrouping: false })
}
</script>

<template>
  <div class="field">
    <label :for="id" class="label">{{ label }}</label>
    <div class="stepper">
      <button
        type="button"
        class="step step--down"
        :aria-label="t('list.itemForm.decrease')"
        @click="step(-1)"
      >
        <BaseIcon name="minus" :size="22" :stroke-width="2.75" />
      </button>
      <input
        :id="id"
        v-model="model"
        class="input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :aria-invalid="Boolean(error) || undefined"
        :aria-describedby="describedBy"
      />
      <button
        type="button"
        class="step step--up"
        :aria-label="t('list.itemForm.increase')"
        @click="step(1)"
      >
        <BaseIcon name="plus" :size="22" :stroke-width="2.75" />
      </button>
    </div>
    <p v-if="error" :id="messageId" class="message" role="alert">
      <BaseIcon name="alert" :size="18" />
      <span>{{ error }}</span>
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
}

.label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.stepper {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size-stepper);
  height: var(--size-stepper);
  box-sizing: border-box;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

/* Plus is the step people take most: the sticker look of a primary button. */
.step--up {
  border-color: var(--color-primary-contrast);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  box-shadow: var(--shadow-sticker);
  transition:
    transform var(--duration-press) var(--easing-bounce),
    box-shadow var(--duration-press);
}

.step--up:active {
  transform: translateY(3px);
  box-shadow: none;
}

.input {
  width: 6.25rem;
  height: var(--size-stepper);
  box-sizing: border-box;
  padding: 0 10px;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  font-variant-numeric: tabular-nums;
  text-align: center;
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
  color: var(--color-danger-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
}

@media (prefers-reduced-motion: reduce) {
  .step--up {
    transition: none;
  }
}
</style>
