<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { IconName } from '@/components/base/icons'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

type ListAction = 'rename' | 'archive' | 'unarchive' | 'delete'

const ACTION_ICONS: Record<ListAction, IconName> = {
  rename: 'pencil',
  archive: 'archive',
  unarchive: 'retry',
  delete: 'trash',
}

// The parent renders this dialog only while a list is selected, so every
// opening starts on the list of actions without an old error.
// canDelete: only owners and admins may delete; the backend decides again
// (FORBIDDEN), this only hides what would fail.
const props = defineProps<{ list: List; canDelete: boolean }>()
const emit = defineEmits<{ rename: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const lists = useListsStore()

// Deleting needs a second look; the other actions run right away.
const confirmingDelete = ref(false)
const busy = ref(false)
const errorCode = ref<string | null>(null)
const errorMessage = useErrorMessage(errorCode)

const actions = computed<ListAction[]>(() => {
  const result: ListAction[] = ['rename', props.list.archivedAt === null ? 'archive' : 'unarchive']
  if (props.canDelete) result.push('delete')
  return result
})

async function run(action: ListAction) {
  if (action === 'rename') {
    // The parent closes this dialog and opens the name form.
    emit('rename')
    return
  }
  if (action === 'delete' && !confirmingDelete.value) {
    confirmingDelete.value = true
    return
  }
  busy.value = true
  errorCode.value = null
  try {
    if (action === 'delete') {
      await lists.remove(props.list.id)
    } else if (action === 'archive') {
      await lists.archive(props.list.id)
    } else {
      await lists.unarchive(props.list.id)
    }
    open.value = false
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseDialog v-model:open="open" :title="t('group.actions.title')">
    <div class="body">
      <p class="question">{{ t('group.actions.question', { name: list.name }) }}</p>

      <p v-if="errorCode" class="problem" role="alert">
        <BaseIcon name="alert" /> {{ errorMessage }}
      </p>

      <template v-if="!confirmingDelete">
        <button
          v-for="action in actions"
          :key="action"
          type="button"
          :class="['action', { 'action--danger': action === 'delete' }]"
          :disabled="busy"
          @click="run(action)"
        >
          <span class="action-icon" aria-hidden="true">
            <BaseIcon :name="ACTION_ICONS[action]" :size="20" />
          </span>
          <span class="action-text">
            <span class="action-title">{{ t(`group.actions.${action}.title`) }}</span>
            <span class="action-description">{{ t(`group.actions.${action}.description`) }}</span>
          </span>
        </button>
      </template>

      <template v-else>
        <p class="confirm">{{ t('group.actions.confirm.body', { name: list.name }) }}</p>
        <div class="buttons">
          <BaseButton
            variant="secondary"
            class="back"
            :disabled="busy"
            @click="confirmingDelete = false"
          >
            {{ t('group.actions.confirm.back') }}
          </BaseButton>
          <BaseButton variant="danger" class="delete" :loading="busy" @click="run('delete')">
            {{ t('group.actions.confirm.delete') }}
          </BaseButton>
        </div>
      </template>
    </div>
  </BaseDialog>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.question {
  margin: 0;
  font-weight: var(--font-weight-bold);
  overflow-wrap: anywhere;
}

.problem {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-danger-text);
  font-weight: var(--font-weight-bold);
}

.action {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--size-touch);
  padding: var(--space-3) var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
}

.action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.action--danger {
  border-color: var(--color-danger);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.action-icon {
  flex: none;
  display: grid;
  place-items: center;
}

.action-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.action-title {
  font-weight: var(--font-weight-black);
}

.action-description {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.confirm {
  margin: 0;
  padding: var(--space-3);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.buttons {
  display: flex;
  gap: var(--space-3);
}

.back {
  flex: 1;
}

.delete {
  flex: 1.5;
}
</style>
