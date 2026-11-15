<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseTextarea from '@/components/base/BaseTextarea.vue'
import QuantityStepper from '@/components/list/QuantityStepper.vue'
import UnitPicker from '@/components/list/UnitPicker.vue'
import { useItemForm } from '@/composables/useItemForm'
import type { Item } from '@/types/api'

// Form fields and actions for adding or editing an item (shared by the modal
// dialog and the desktop panel). Without `item` it adds a new one;
// `initialName` fills the name field, e.g. with what was typed into the
// quick-add bar. With `item` it edits that item; `creatorName` says who
// added it (null if unknown). `open` defaults to true for callers that mount
// and unmount the form via v-if.
const props = withDefaults(
  defineProps<{
    listId: string
    listName: string
    initialName?: string
    item?: Item
    creatorName?: string | null
    open?: boolean
  }>(),
  { open: true },
)
// fromKeyboard: Delete was pressed with Enter or Space (see DoneSection).
const emit = defineEmits<{
  close: []
  remove: [fromKeyboard: boolean]
}>()

const { t } = useI18n()

const {
  name,
  quantity,
  unit,
  note,
  nameError,
  quantityError,
  noteError,
  formError,
  submitting,
  submit,
} = useItemForm({
  open: () => props.open,
  listId: () => props.listId,
  initialName: () => props.initialName,
  item: () => props.item,
})

const meta = computed(() => {
  if (!props.item) return t('list.itemForm.newIn', { list: props.listName })
  return props.creatorName
    ? t('list.itemForm.by', { name: props.creatorName, list: props.listName })
    : props.listName
})

// Deleting needs no valid form: it closes, and the list offers undo.
function onRemove(event: MouseEvent) {
  emit('remove', event.detail === 0)
}

async function onSubmit() {
  if (await submit()) emit('close')
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="onSubmit">
    <p class="meta">{{ meta }}</p>
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
    <div v-if="item" class="actions">
      <BaseButton variant="danger" class="remove" @click="onRemove">
        <BaseIcon name="trash" :size="18" />
        {{ t('list.itemForm.remove') }}
      </BaseButton>
      <BaseButton type="submit" class="submit" :loading="submitting">
        {{ t('list.itemForm.save') }}
      </BaseButton>
    </div>
    <div v-else class="actions">
      <BaseButton variant="secondary" class="cancel" @click="emit('close')">
        {{ t('list.itemForm.cancel') }}
      </BaseButton>
      <BaseButton type="submit" class="submit" :loading="submitting">
        {{ t('list.itemForm.add') }}
      </BaseButton>
    </div>
  </form>
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

/* As wide as its word; saving takes the rest, as in the design. */
.remove {
  flex: none;
}

.remove + .submit {
  flex: 1;
}
</style>
