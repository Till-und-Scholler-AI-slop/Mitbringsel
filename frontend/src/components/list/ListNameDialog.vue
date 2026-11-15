<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseNameDialog from '@/components/base/BaseNameDialog.vue'
import ListIconPicker from '@/components/list/ListIconPicker.vue'
import { DEFAULT_LIST_ICON } from '@/services/listIcons'
import { LIST_NAME_MAX_LENGTH, validateListName } from '@/services/listName'
import { useListsStore } from '@/stores/lists'
import type { List, ListIcon } from '@/types/api'

// One form for both cases: with `list` it edits name and icon of that list,
// without it creates a new list in the group.
const props = defineProps<{ groupId: string; list?: List }>()
const emit = defineEmits<{ created: [list: List] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const lists = useListsStore()

const startIcon = computed(() => props.list?.icon ?? DEFAULT_LIST_ICON)
const icon = ref<ListIcon>(startIcon.value)

// Every opening starts with the list's icon (or the default when creating),
// like BaseNameDialog does with the name.
watch(open, (isOpen) => {
  if (isOpen) icon.value = startIcon.value
})

async function save(trimmed: string) {
  if (props.list) {
    await lists.update(props.list.id, trimmed, icon.value)
    return
  }
  emit('created', await lists.create(props.groupId, trimmed, icon.value))
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
    :changed="icon !== startIcon"
    :validate="validateListName"
    :save="save"
  >
    <ListIconPicker v-model="icon" />
  </BaseNameDialog>
</template>
