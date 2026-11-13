<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import { UNITS } from '@/services/itemForm'
import type { Unit } from '@/types/api'

// The unit as six toggle buttons in three columns (design "markt2-sheet").
// At most one is pressed; pressing it again picks no unit.
defineProps<{ label: string }>()
const model = defineModel<Unit | null>({ required: true })

const { t } = useI18n()

function pick(unit: Unit) {
  model.value = model.value === unit ? null : unit
}
</script>

<template>
  <fieldset class="units">
    <legend class="label">{{ label }}</legend>
    <div class="grid">
      <button
        v-for="unit in UNITS"
        :key="unit"
        type="button"
        :class="['unit', { 'unit--on': model === unit }]"
        :aria-pressed="model === unit"
        @click="pick(unit)"
      >
        <BaseIcon v-if="model === unit" name="check" :size="16" :stroke-width="3.5" />
        <!-- The name of one: "Packung", not "Packungen". -->
        {{ t(`units.${unit}`, 1) }}
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.units {
  margin: 0;
  padding: 0;
  border: 0;
}

.label {
  margin-bottom: var(--space-1-5);
  padding: 0;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

.unit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1-5);
  min-height: 2.875rem;
  box-sizing: border-box;
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  cursor: pointer;
}

.unit--on {
  border-width: var(--border-width-md);
  border-color: var(--color-primary-contrast);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  font-weight: var(--font-weight-black);
  box-shadow: var(--shadow-sticker);
}
</style>
