<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import { useQuantityText } from '@/composables/useQuantityText'
import type { Item } from '@/types/api'

// An open item of the list pinned in the context column (design
// "markt2-kontext-wqhd-zweite-hell"): check box, name, note and quantity.
// Only the check box does something; the item is not edited from here.
// pending: the item has an unsynced change in the outbox.
const props = defineProps<{ item: Item; pending?: boolean }>()
defineEmits<{ toggle: [] }>()

const { t } = useI18n()
const quantityText = useQuantityText()
const quantity = computed(() => quantityText(props.item))
</script>

<template>
  <li class="row">
    <!-- The box is 24px; the button around it is the 44px hit area. -->
    <button
      type="button"
      class="check"
      :aria-label="t('list.row.checkItem', { name: item.name })"
      @click="$emit('toggle')"
    >
      <span class="box" aria-hidden="true" />
    </button>
    <span class="text">
      <span class="name-row">
        <span class="name" lang="de">{{ item.name }}</span>
        <span
          v-if="pending"
          class="pending"
          role="img"
          :aria-label="t('list.row.pending')"
          :title="t('list.row.pending')"
        >
          <BaseIcon name="clock" :size="16" />
        </span>
      </span>
      <span v-if="item.note" class="note">{{ item.note }}</span>
    </span>
    <span v-if="quantity" class="quantity">{{ quantity }}</span>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 3.375rem;
  padding: var(--space-1-5) var(--space-3) var(--space-1-5) var(--space-1);
  border-radius: 0.875rem;
  background: var(--color-bg);
}

.check {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}

.box {
  width: 1.5rem;
  height: 1.5rem;
  box-sizing: border-box;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-surface);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.name-row {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  max-width: 100%;
}

.name {
  min-width: 0;
  font-size: var(--font-size-md);
  line-height: 1.3125rem;
  font-weight: var(--font-weight-bold);
  overflow-wrap: anywhere;
  hyphens: auto;
}

.pending {
  flex: none;
  display: inline-flex;
  color: var(--color-pending-icon);
}

.note {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  line-height: 1.0625rem;
  font-weight: var(--font-weight-medium);
  overflow-wrap: anywhere;
}

.quantity {
  flex: none;
  padding: 2px var(--space-2);
  border: var(--border-width-sm) solid var(--color-qty-border);
  border-radius: var(--radius-full);
  background: var(--color-qty-bg);
  color: var(--color-qty-text);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-heavy);
  line-height: 1.0625rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
