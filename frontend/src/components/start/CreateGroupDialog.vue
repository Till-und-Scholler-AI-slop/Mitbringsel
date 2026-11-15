<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseNameDialog from '@/components/base/BaseNameDialog.vue'
import { GROUP_NAME_MAX_LENGTH, validateGroupName } from '@/services/groupName'
import { useGroupsStore } from '@/stores/groups'
import type { Group } from '@/types/api'

const emit = defineEmits<{ created: [group: Group] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const groups = useGroupsStore()

// Says by how much to shorten (design "verwalten-umbenennen-zulang").
const tooLong = (excess: number) =>
  t('common.groupNameTooLong', { max: GROUP_NAME_MAX_LENGTH, n: excess }, excess)

async function save(trimmed: string) {
  emit('created', await groups.create(trimmed))
}
</script>

<template>
  <BaseNameDialog
    v-model:open="open"
    :title="t('start.create.title')"
    :label="t('start.create.nameLabel')"
    :placeholder="t('start.create.namePlaceholder')"
    :hint="t('start.create.hint')"
    :cancel-label="t('start.create.cancel')"
    :submit-label="t('start.create.submit')"
    :max-length="GROUP_NAME_MAX_LENGTH"
    :too-long-error="tooLong"
    :empty-error="t('common.groupNameEmpty')"
    :validate="validateGroupName"
    :save="save"
  />
</template>
