<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseNameDialog from '@/components/base/BaseNameDialog.vue'
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

async function save(trimmed: string) {
  if (props.list) {
    await lists.rename(props.list.id, trimmed)
    return
  }
  emit('created', await lists.create(props.groupId, trimmed))
}
</script>

<template>
  <BaseNameDialog
    v-model:open="open"
    :title="list ? t('list.name.renameTitle') : t('list.name.createTitle')"
    :label="t('list.name.label')"
    :placeholder="t('list.name.placeholder')"
    :cancel-label="t('list.name.cancel')"
    :submit-label="list ? t('list.name.save') : t('list.name.create')"
    :max-length="LIST_NAME_MAX_LENGTH"
    :too-long-error="t('errors.LIST_NAME_INVALID')"
    :initial-name="list?.name"
    :validate="validateListName"
    :save="save"
  />
</template>
