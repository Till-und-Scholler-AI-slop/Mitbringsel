<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'

export type NameProblem = 'empty' | 'tooLong'

// Shared dialog for creating or renaming a named entity (group, list).
// With `initialName` it starts prefilled and closes without calling `save`
// when the trimmed value is unchanged, unless `changed` says that a field in
// the default slot (below the name) differs from its start value.
const props = defineProps<{
  title: string
  label: string
  placeholder?: string
  hint?: string
  cancelLabel: string
  submitLabel: string
  maxLength: number
  /** A text, or one built from how many characters are too many. */
  tooLongError: string | ((excess: number) => string)
  /** Shown once the field was edited and then left empty. */
  emptyError: string
  initialName?: string
  changed?: boolean
  validate: (name: string) => NameProblem | null
  save: (trimmedName: string) => Promise<void>
}>()

const emit = defineEmits<{ 'update:name': [name: string] }>()
const open = defineModel<boolean>('open', { required: true })

const name = ref('')
const submitting = ref(false)
// The error code of the last failed request; null while there is none.
const errorCode = ref<string | null>(null)
const serverError = useErrorMessage(errorCode)

const problem = computed(() => props.validate(name.value))

// True once the user typed in the field and then left it. Only then is an
// empty name an error: whoever opens the dialog and cancels right away is
// not scolded, and the message does not push the buttons away under the
// pointer on the way to "Cancel".
const edited = ref(false)
const touched = ref(false)

function onBlur() {
  if (edited.value) touched.value = true
}

// "Too long" is shown while typing, "empty" after leaving the field (and
// then live, until a name is there again). A server error is shown until
// the name changes.
const error = computed(() => {
  if (problem.value === 'tooLong') {
    if (typeof props.tooLongError === 'string') return props.tooLongError
    return props.tooLongError(Array.from(name.value.trim()).length - props.maxLength)
  }
  if (problem.value === 'empty' && touched.value) return props.emptyError
  return errorCode.value ? serverError.value : null
})

// Every opening starts with `initialName` (or empty when creating).
// immediate: the parent may render the dialog already open.
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.initialName ?? ''
      errorCode.value = null
      edited.value = false
      touched.value = false
    }
  },
  { immediate: true },
)

watch(name, (value) => {
  errorCode.value = null
  emit('update:name', value)
})

async function submit() {
  if (problem.value || submitting.value) return
  const trimmed = name.value.trim()
  // Nothing to save; no request for the same name.
  if (props.initialName !== undefined && trimmed === props.initialName && !props.changed) {
    open.value = false
    return
  }
  submitting.value = true
  try {
    await props.save(trimmed)
    open.value = false
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog v-model:open="open" :title="title">
    <form class="form" novalidate @submit.prevent="submit">
      <BaseInput
        v-model="name"
        :label="label"
        :placeholder="placeholder"
        :hint="hint"
        :error="error"
        :max-length="maxLength"
        autocomplete="off"
        autofocus
        @input="edited = true"
        @blur="onBlur"
      />
      <slot />
      <div class="actions">
        <!-- mousedown.prevent: pressing "Cancel" must not take the focus from
             the field. Otherwise the field is left (maybe empty), the error
             appears, pushes the button down under the pointer, and the
             click is lost. -->
        <BaseButton variant="secondary" class="cancel" @mousedown.prevent @click="open = false">
          {{ cancelLabel }}
        </BaseButton>
        <BaseButton type="submit" class="submit" :loading="submitting" :disabled="problem !== null">
          {{ submitLabel }}
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
