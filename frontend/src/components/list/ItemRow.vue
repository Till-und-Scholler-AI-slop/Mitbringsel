<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { useQuantityText } from '@/composables/useQuantityText'
import type { Item } from '@/types/api'

const AVATAR_SIZE = 26
const AVATAR_SIZE_DONE = 22

// person: who added the item (open) or checked it (done); null if that
// person left the household or deleted their account.
const props = defineProps<{
  item: Item
  person: { name: string; avatarUrl: string | null } | null
}>()
defineEmits<{ toggle: [] }>()

const { t } = useI18n()
const quantityText = useQuantityText()

const quantity = computed(() => quantityText(props.item))
const done = computed(() => props.item.checked)

// What a screen reader says: the whole row is one button, so everything the
// eye sees on it has to be in the label.
const label = computed(() => {
  const details = [props.item.name, quantity.value, done.value ? null : props.item.note]
  const by = props.person
    ? t(done.value ? 'list.row.checkedBy' : 'list.row.addedBy', { name: props.person.name })
    : null
  const action = t(done.value ? 'list.row.uncheck' : 'list.row.check')
  return `${[...details, by].filter(Boolean).join(', ')} – ${action}`
})
</script>

<template>
  <li :class="['row', { 'row--done': done }]">
    <button type="button" class="toggle" :aria-label="label" @click="$emit('toggle')">
      <span class="box" aria-hidden="true">
        <BaseIcon v-if="done" name="check" :size="16" :stroke-width="3.5" />
      </span>
      <span class="text">
        <span class="name" lang="de">{{ item.name }}</span>
        <span v-if="item.note && !done" class="note">{{ item.note }}</span>
      </span>
      <span v-if="quantity" class="quantity">{{ quantity }}</span>
      <BaseAvatar
        v-if="person"
        :name="person.name"
        :src="person.avatarUrl"
        :size="done ? AVATAR_SIZE_DONE : AVATAR_SIZE"
      />
    </button>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.row--done {
  background: transparent;
}

.toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 3.625rem;
  padding: var(--space-3);
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.row--done .toggle {
  min-height: var(--size-touch);
  padding-block: var(--space-1);
}

.box {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.row--done .box {
  border-color: var(--color-success);
  background: var(--color-success);
  color: var(--color-on-brand);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.name {
  min-width: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  line-height: 1.3;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
  hyphens: auto;
}

.row--done .name {
  color: var(--color-done-text);
  font-weight: var(--font-weight-semibold);
  text-decoration: line-through;
  text-decoration-thickness: 2px;
}

.note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.quantity {
  flex: none;
  padding: var(--space-1) var(--space-3);
  border: var(--border-width-sm) solid var(--color-qty-border);
  border-radius: var(--radius-full);
  background: var(--color-qty-bg);
  color: var(--color-qty-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.row--done .quantity {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-done-text);
  font-weight: var(--font-weight-bold);
}
</style>
