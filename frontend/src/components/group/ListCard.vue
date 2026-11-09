<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseIcon from '@/components/base/BaseIcon.vue'
import type { List } from '@/types/api'

// The card links to the list and reports the click on "more"; what happens
// then is the parent's business.
defineProps<{ list: List }>()
defineEmits<{ act: [] }>()

const { t } = useI18n()
</script>

<template>
  <article :class="['card', { 'card--archived': list.archivedAt !== null }]">
    <span class="icon" aria-hidden="true"><BaseIcon name="list" :size="20" /></span>
    <!-- title: the full name for names too long for the line -->
    <h3 class="name" :title="list.name">
      <!-- The link covers the whole card (see .link::after); the menu button stays above it. -->
      <RouterLink
        class="link"
        :to="{ name: 'list', params: { groupId: list.groupId, listId: list.id } }"
        >{{ list.name }}</RouterLink
      >
    </h3>
    <button
      type="button"
      class="act"
      :aria-label="t('group.lists.actionsFor', { name: list.name })"
      aria-haspopup="dialog"
      @click="$emit('act')"
    >
      <BaseIcon name="ellipsis" :size="22" :stroke-width="3" />
    </button>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
}

.card--archived {
  box-shadow: none;
  color: var(--color-text-muted);
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-full);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.card--archived .icon {
  background: var(--color-border);
  color: var(--color-text-muted);
}

/* One line with "…" instead of wrapping: the name can be up to 50 characters. */
.name {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link {
  color: inherit;
  text-decoration: none;
}

.link::after {
  content: '';
  position: absolute;
  inset: 0;
}

.act {
  position: relative;
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
</style>
