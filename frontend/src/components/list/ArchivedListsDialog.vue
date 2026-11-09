<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { List } from '@/types/api'

// The archived lists of a household behind the archive chip. Choosing one
// opens it; it is restored from there through its actions.
defineProps<{ groupId: string; lists: List[]; currentId: string }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
</script>

<template>
  <BaseDialog v-model:open="open" :title="t('list.archive.title')">
    <div class="body">
      <p class="description">{{ t('list.archive.description') }}</p>
      <ul class="lists">
        <li v-for="list in lists" :key="list.id">
          <RouterLink
            class="list"
            :to="{ name: 'list', params: { groupId, listId: list.id } }"
            :aria-current="list.id === currentId ? 'page' : undefined"
            @click="open = false"
          >
            <BaseIcon name="archive" :size="20" />
            <span class="name">{{ list.name }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </BaseDialog>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.lists {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.list {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--size-touch);
  padding: var(--space-2) var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: var(--font-weight-heavy);
  text-decoration: none;
}

.list[aria-current='page'] {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}

.name {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
