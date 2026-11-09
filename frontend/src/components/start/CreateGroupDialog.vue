<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { GROUP_NAME_MAX_LENGTH, validateGroupName } from '@/services/groupName'
import { useGroupsStore } from '@/stores/groups'
import type { Group } from '@/types/api'

const emit = defineEmits<{ created: [group: Group] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const groups = useGroupsStore()

const name = ref('')
const submitting = ref(false)
// The error code of the last failed request; null while there is none.
const errorCode = ref<string | null>(null)
const serverError = useErrorMessage(errorCode)

const problem = computed(() => validateGroupName(name.value))

// "Too long" is shown while typing. An empty name is not an error, the
// button just waits. A server error is shown until the name changes.
const error = computed(() => {
  if (problem.value === 'tooLong') return t('errors.GROUP_NAME_INVALID')
  return errorCode.value ? serverError.value : null
})

// Every opening starts with an empty form.
watch(open, (isOpen) => {
  if (isOpen) {
    name.value = ''
    errorCode.value = null
  }
})

watch(name, () => {
  errorCode.value = null
})

async function submit() {
  if (problem.value || submitting.value) return
  submitting.value = true
  try {
    const group = await groups.create(name.value.trim())
    open.value = false
    emit('created', group)
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog v-model:open="open" :title="t('start.create.title')">
    <form class="form" novalidate @submit.prevent="submit">
      <BaseInput
        v-model="name"
        :label="t('start.create.nameLabel')"
        :placeholder="t('start.create.namePlaceholder')"
        :hint="t('start.create.hint')"
        :error="error"
        :max-length="GROUP_NAME_MAX_LENGTH"
        autocomplete="off"
        autofocus
      />
      <div class="actions">
        <BaseButton variant="secondary" class="cancel" @click="open = false">
          {{ t('start.create.cancel') }}
        </BaseButton>
        <BaseButton type="submit" class="submit" :loading="submitting" :disabled="problem !== null">
          {{ t('start.create.submit') }}
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
