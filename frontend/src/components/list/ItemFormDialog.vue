<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseDialog from '@/components/base/BaseDialog.vue'
import ItemForm from '@/components/list/ItemForm.vue'
import type { Item } from '@/types/api'

// An item with all its details (design "markt2-sheet", as a bottom sheet on
// the phone). Without `item` it adds a new one; `initialName` fills the name
// field, e.g. with what was typed into the quick-add bar. With `item` it
// edits that item; `creatorName` says who added it (null if unknown).
defineProps<{
  listId: string
  listName: string
  initialName?: string
  item?: Item
  creatorName?: string | null
}>()
// fromKeyboard: Delete was pressed with Enter or Space (see DoneSection).
const emit = defineEmits<{ remove: [fromKeyboard: boolean] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
</script>

<template>
  <BaseDialog
    v-model:open="open"
    :title="item ? t('list.itemForm.editTitle') : t('list.itemForm.newTitle')"
  >
    <ItemForm
      :open="open"
      :list-id="listId"
      :list-name="listName"
      :initial-name="initialName"
      :item="item"
      :creator-name="creatorName"
      @close="open = false"
      @remove="emit('remove', $event)"
    />
  </BaseDialog>
</template>
