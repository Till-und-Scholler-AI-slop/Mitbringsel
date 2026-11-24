<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { Item } from '@/types/api'

// What an item row shows besides its checkbox: name, note, tags, quantity and
// person. The parent wraps it in the button that toggles or opens the item, so
// the root is `display: contents` and its children lay out in that button.
// recentShown/recentName/editing/pending are already resolved by the parent
// (they only apply to open items).
defineProps<{
  item: Item
  quantity: string | null
  person: { name: string; avatarUrl: string | null } | null
  recentName: string | null
  recentShown: boolean
  editing: boolean
  pending: boolean
  done: boolean
  avatarSize: number
}>()

const { t } = useI18n()
</script>

<template>
  <span :class="['body', { 'body--done': done }]">
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
      <span v-if="item.note && !done" class="note">{{ item.note }}</span>
      <!-- Only the name gets cut off when it is too long, so "just changed"
         always stays visible; the title shows the whole text. -->
      <span v-if="recentShown || editing" class="tags">
        <i18n-t
          v-if="recentName"
          keypath="list.row.justChanged"
          tag="span"
          class="recent"
          :title="t('list.row.justChanged', { name: recentName })"
        >
          <template #name>
            <span class="recent-name">{{ recentName }}</span>
          </template>
        </i18n-t>
        <span v-else-if="recentShown" class="recent">{{ t('list.row.justChangedAnon') }}</span>
        <span v-if="editing" class="editing">{{ t('list.row.editing') }}</span>
      </span>
    </span>
    <span v-if="quantity" class="quantity">{{ quantity }}</span>
    <BaseAvatar v-if="person" :name="person.name" :src="person.avatarUrl" :size="avatarSize" />
  </span>
</template>

<style scoped>
.body {
  display: contents;
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.name-row {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  max-width: 100%;
}

.pending {
  flex: none;
  display: inline-flex;
  color: var(--color-pending-icon);
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

.body--done .name {
  color: var(--color-done-text);
  font-size: 1.0625rem;
  line-height: 1.375rem;
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

/* A flex row, so the name alone can shrink; pre keeps the spaces around
   the name, which a flex item would drop at its edges. */
.recent {
  display: flex;
  max-width: 100%;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: var(--font-weight-heavy);
  white-space: pre;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
  min-width: 0;
  max-width: 100%;
}

.editing {
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-edit-tag-bg);
  color: var(--color-edit-tag-text);
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: var(--font-weight-heavy);
  white-space: nowrap;
}

.recent-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quantity {
  flex: none;
  padding: 3px 10px;
  border: var(--border-width-sm) solid var(--color-qty-border);
  border-radius: var(--radius-full);
  background: var(--color-qty-bg);
  color: var(--color-qty-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
  line-height: 1.125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.body--done .quantity {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-done-text);
  font-weight: var(--font-weight-bold);
}
</style>
