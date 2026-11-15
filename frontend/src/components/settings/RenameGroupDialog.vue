<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseNameDialog from '@/components/base/BaseNameDialog.vue'
import { GROUP_NAME_MAX_LENGTH, validateGroupName } from '@/services/groupName'
import { useGroupsStore } from '@/stores/groups'
import type { Group } from '@/types/api'

const props = defineProps<{ group: Group }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const groups = useGroupsStore()

async function save(trimmed: string) {
  await groups.rename(props.group.id, trimmed)
}
</script>

<template>
  <BaseNameDialog
    v-model:open="open"
    :title="t('settings.rename.title')"
    :label="t('settings.rename.nameLabel')"
    :cancel-label="t('settings.rename.cancel')"
    :submit-label="t('settings.rename.submit')"
    :max-length="GROUP_NAME_MAX_LENGTH"
    :too-long-error="t('errors.GROUP_NAME_INVALID')"
    :initial-name="group.name"
    :validate="validateGroupName"
    :save="save"
  />
</template>
