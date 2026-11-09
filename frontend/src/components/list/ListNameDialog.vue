<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { LIST_NAME_MAX_LENGTH, validateListName } from '@/services/listName'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

// One form for both cases: with `list` it renames that list, without it
// creates a new list in the group.
const props = defineProps<{ groupId: string; list?: List }>()
const emit = defineEmits<{ created: [list: List] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const lists = useListsStore()

const name = ref('')
const submitting = ref(false)
// The error code of the last failed request; null while there is none.
const errorCode = ref<string | null>(null)
const serverError = useErrorMessage(errorCode)

const problem = computed(() => validateListName(name.value))

// "Too long" is shown while typing. An empty name is not an error, the
// button just waits. A server error is shown until the name changes.
const error = computed(() => {
  if (problem.value === 'tooLong') return t('errors.LIST_NAME_INVALID')
  return errorCode.value ? serverError.value : null
})

// Every opening starts with the current name, or empty for a new list.
// immediate: the parent may render the dialog already open.
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.list?.name ?? ''
      errorCode.value = null
    }
  },
  { immediate: true },
)

watch(name, () => {
  errorCode.value = null
})

async function submit() {
  if (problem.value || submitting.value) return
  const trimmed = name.value.trim()
  // Nothing to save; no request for the same name.
  if (props.list && trimmed === props.list.name) {
    open.value = false
    return
  }
  submitting.value = true
  try {
    if (props.list) {
      await lists.rename(props.list.id, trimmed)
    } else {
      emit('created', await lists.create(props.groupId, trimmed))
    }
    open.value = false
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    :title="list ? t('group.name.renameTitle') : t('group.name.createTitle')"
  >
    <form class="form" novalidate @submit.prevent="submit">
      <BaseInput
        v-model="name"
        :label="t('group.name.label')"
        :placeholder="t('group.name.placeholder')"
        :error="error"
        :max-length="LIST_NAME_MAX_LENGTH"
        autocomplete="off"
        autofocus
      />
      <div class="actions">
        <BaseButton variant="secondary" class="cancel" @click="open = false">
          {{ t('group.name.cancel') }}
        </BaseButton>
        <BaseButton type="submit" class="submit" :loading="submitting" :disabled="problem !== null">
          {{ list ? t('group.name.save') : t('group.name.create') }}
        </BaseButton>
      </div>
    </form>
  </BaseDialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.actions {
  display: flex;
  gap: var(--space-3);
}

.cancel {
  flex: 1;
}

.submit {
  flex: 1.5;
}
</style>
