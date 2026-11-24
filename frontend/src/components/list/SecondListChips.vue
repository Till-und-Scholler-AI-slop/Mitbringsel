<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseSticker from '@/components/base/BaseSticker.vue'
import { useContextOverview } from '@/composables/useContextOverview'

// The choice of the list to pin beside the open one (design
// "markt2-kontext-wqhd-zweite-hell"): one toggle chip per other active list,
// the pinned one pressed. Not navigation like ListChips: it only changes
// what the overview card shows.
const { t } = useI18n()
const { others, pinnedList, pin } = useContextOverview()
</script>

<template>
  <div class="chips" role="group" :aria-label="t('list.context.second.choose')">
    <button
      v-for="list in others"
      :key="list.id"
      type="button"
      :class="['chip', 'press-sticker', { 'chip--pinned': list.id === pinnedList?.id }]"
      :aria-pressed="list.id === pinnedList?.id"
      @click="pin(list.id)"
    >
      <BaseSticker :icon="list.icon" :size="32" />
      <span class="chip-name">{{ list.name }}</span>
    </button>
  </div>
</template>

<style scoped>
.chips {
  flex: 1;
  align-self: stretch;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2.75rem;
  padding: 0 0.875rem 0 var(--space-1);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-heavy);
  cursor: pointer;
}

/* Pressed in = the pinned list, in the look of the current chip of ListChips. */
.chip--pinned {
  border-color: var(--color-on-accent);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}

.chip-name {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
