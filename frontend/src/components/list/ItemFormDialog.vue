<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseTextarea from '@/components/base/BaseTextarea.vue'
import QuantityStepper from '@/components/list/QuantityStepper.vue'
import UnitPicker from '@/components/list/UnitPicker.vue'
import { useErrorText } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { isItemNoteTooLong, parseQuantity, validateItemName } from '@/services/itemForm'
import { useItemsStore } from '@/stores/items'
import type { Unit } from '@/types/api'

// A new item starts with this unit picked, as in the design.
const DEFAULT_UNIT: Unit = 'piece'

// Errors of the server that belong to one field; any other is shown above
// the buttons.
const FIELD_ERRORS = {
  name: 'ITEM_NAME_INVALID',
  quantity: 'ITEM_QUANTITY_INVALID',
  note: 'ITEM_NOTE_INVALID',
} as const

// A new item with all its details (design "markt2-sheet", as a bottom sheet
// on the phone). `initialName` fills the name field, e.g. with what was
// typed into the quick-add bar.
const props = defineProps<{ listId: string; listName: string; initialName?: string }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const errorText = useErrorText()
const items = useItemsStore()

const name = ref('')
const quantity = ref('')
const unit = ref<Unit | null>(DEFAULT_UNIT)
const note = ref('')
// An empty name is only an error once the user tried to save.
const tried = ref(false)
const submitting = ref(false)
// The error code of the last failed request; null while there is none.
const errorCode = ref<string | null>(null)

// Every opening starts afresh. immediate: the parent may render it open.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    name.value = props.initialName ?? ''
    quantity.value = ''
    unit.value = DEFAULT_UNIT
    note.value = ''
    tried.value = false
    errorCode.value = null
  },
  { immediate: true },
)

// A server error is about what was sent; it goes once the user changes it.
watch([name, quantity, unit, note], () => {
  errorCode.value = null
})

const nameProblem = computed(() => validateItemName(name.value))
const parsedQuantity = computed(() => parseQuantity(quantity.value))
const noteTooLong = computed(() => isItemNoteTooLong(note.value))

const serverError = (field: keyof typeof FIELD_ERRORS) =>
  errorCode.value === FIELD_ERRORS[field] ? errorText(errorCode.value) : null

// "Too long" and a number that does not parse show while typing.
const nameError = computed(() => {
  if (nameProblem.value === 'tooLong') return errorText(FIELD_ERRORS.name)
  if (nameProblem.value === 'empty' && tried.value) return t('list.itemForm.nameEmpty')
  return serverError('name')
})
const quantityError = computed(() => {
  const parsed = parsedQuantity.value
  if (!parsed.ok) {
    return parsed.problem === 'invalid'
      ? t('list.itemForm.quantityInvalid')
      : errorText(FIELD_ERRORS.quantity)
  }
  return serverError('quantity')
})
const noteError = computed(() =>
  noteTooLong.value ? errorText(FIELD_ERRORS.note) : serverError('note'),
)
const formError = computed(() => {
  const code = errorCode.value
  if (code === null || Object.values<string>(FIELD_ERRORS).includes(code)) return null
  return errorText(code)
})

const invalid = computed(
  () => nameProblem.value !== null || !parsedQuantity.value.ok || noteTooLong.value,
)

async function submit() {
  tried.value = true
  const parsed = parsedQuantity.value
  if (invalid.value || !parsed.ok || submitting.value) return
  submitting.value = true
  try {
    await items.create(props.listId, {
      name: name.value.trim(),
      quantity: parsed.value,
      // A unit without a quantity says nothing (useQuantityText shows none),
      // so it is not stored either.
      unit: parsed.value === null ? null : unit.value,
      note: note.value.trim() || null,
    })
    open.value = false
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog v-model:open="open" :title="t('list.itemForm.newTitle')">
    <form class="form" novalidate @submit.prevent="submit">
      <p class="meta">{{ t('list.itemForm.newIn', { list: listName }) }}</p>
      <BaseInput
        v-model="name"
        :label="t('list.itemForm.name')"
        :aside="t('list.itemForm.required')"
        :error="nameError"
        autocomplete="off"
        aria-required="true"
        autofocus
      />
      <QuantityStepper
        v-model="quantity"
        :label="t('list.itemForm.quantity')"
        :error="quantityError"
      />
      <UnitPicker v-model="unit" :label="t('list.itemForm.unit')" />
      <BaseTextarea
        v-model="note"
        :label="t('list.itemForm.note')"
        :aside="t('list.itemForm.optional')"
        :placeholder="t('list.itemForm.notePlaceholder')"
        :error="noteError"
      />
      <p v-if="formError" class="failed" role="alert">
        <BaseIcon name="alert" :size="18" />
        <span>{{ formError }}</span>
      </p>
      <div class="actions">
        <BaseButton variant="secondary" class="cancel" @click="open = false">
          {{ t('list.itemForm.cancel') }}
        </BaseButton>
        <BaseButton type="submit" class="submit" :loading="submitting">
          {{ t('list.itemForm.add') }}
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

/* Where the item goes, as a pill under the title. */
.meta {
  align-self: flex-start;
  margin: calc(-1 * var(--space-2)) 0 0;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-qty-bg);
  color: var(--color-qty-text);
  font-size: 0.8125rem;
  line-height: 1.125rem;
  font-weight: var(--font-weight-bold);
}

.failed {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-danger-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
}

.actions {
  display: flex;
  gap: var(--space-3);
  padding-top: var(--space-1);
}

.cancel {
  flex: 1;
}

.submit {
  flex: 1.5;
}
</style>
