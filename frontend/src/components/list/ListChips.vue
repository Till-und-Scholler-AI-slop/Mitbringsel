<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseIcon from '@/components/base/BaseIcon.vue'
import type { List } from '@/types/api'

// The lists of a household as chips in the green bar; the current one looks
// pressed in and shows how many items are still open.
defineProps<{ groupId: string; lists: List[]; currentId: string; openCount: number }>()
defineEmits<{ create: [] }>()

const { t } = useI18n()
</script>

<template>
  <nav class="chips" :aria-label="t('list.chips')">
    <RouterLink
      v-for="list in lists"
      :key="list.id"
      :to="{ name: 'list', params: { groupId, listId: list.id } }"
      :class="['chip', { 'chip--current': list.id === currentId }]"
    >
      <span class="chip-name">{{ list.name }}</span>
      <span v-if="list.id === currentId && openCount > 0" class="count">{{ openCount }}</span>
    </RouterLink>
    <button type="button" class="add" :aria-label="t('list.newList')" @click="$emit('create')">
      <BaseIcon name="plus" :size="20" :stroke-width="2.5" />
    </button>
  </nav>
</template>

<style scoped>
.chips {
  display: flex;
  gap: var(--space-2);
  margin: var(--space-1) calc(-1 * var(--space-4)) 0;
  padding: var(--space-1-5) var(--space-4) var(--space-1);
  overflow-x: auto;
  scrollbar-width: none;
}

.chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--size-touch);
  padding: 0 var(--space-4);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  text-decoration: none;
  transition:
    transform var(--duration-press) var(--easing-bounce),
    box-shadow var(--duration-press) var(--easing-bounce);
}

/* Pressed in = the list that is open. */
.chip--current {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  box-shadow: none;
  transform: translateY(3px);
}

.chip-name {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  display: grid;
  place-items: center;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-full);
  background: var(--color-selected-bg);
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: var(--font-weight-heavy);
}

.add {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  border: var(--border-width-sm) dashed var(--color-on-brand);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-on-brand);
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .chip {
    transition: none;
  }
}
</style>
