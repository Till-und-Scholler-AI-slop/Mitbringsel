<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useListsStore } from '@/stores/lists'

/** What the list view shows when it shows no list. */
export type ListNoticeState = 'loading' | 'failed' | 'missing' | 'noLists'

// The list view without an open list: the lists of the household are still
// loading or failed to load, the list of the URL does not exist (any more),
// or the household has no active list yet (noLists).
const props = defineProps<{ state: ListNoticeState; groupId: string }>()
const emit = defineEmits<{ create: [] }>()

const { t } = useI18n()
const router = useRouter()
const lists = useListsStore()
const listsError = useErrorMessage(() => lists.errorCodeOf(props.groupId))
</script>

<template>
  <p v-if="state === 'loading'" class="loading" role="status">
    <BaseSpinner /> {{ t('list.loading') }}
  </p>

  <div v-else-if="state === 'failed'" class="failed" role="alert">
    <p class="failed-title">{{ t('list.loadFailed') }}</p>
    <p>{{ listsError }}</p>
    <BaseButton variant="secondary" @click="lists.load(groupId)">
      <BaseIcon name="retry" /> {{ t('common.retry') }}
    </BaseButton>
  </div>

  <BaseEmptyState
    v-else-if="state === 'missing'"
    :title="t('list.missing.title')"
    :description="t('list.missing.description')"
  >
    <template #icon><BaseIcon name="linkOff" :size="24" /></template>
    <BaseButton @click="router.push({ name: 'group', params: { groupId } })">
      {{ t('list.missing.home') }}
    </BaseButton>
  </BaseEmptyState>

  <BaseEmptyState
    v-else
    :title="t('list.noLists.title')"
    :description="t('list.noLists.description')"
  >
    <template #icon><BaseIcon name="list" :size="24" /></template>
    <BaseButton aria-haspopup="dialog" @click="emit('create')">
      <BaseIcon name="plus" /> {{ t('list.noLists.create') }}
    </BaseButton>
  </BaseEmptyState>
</template>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
}

.failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.failed p {
  margin: 0;
}

.failed-title {
  font-weight: var(--font-weight-black);
}
</style>
