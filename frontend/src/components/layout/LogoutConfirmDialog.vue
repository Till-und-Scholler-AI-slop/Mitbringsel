<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import ConfirmDialog from '@/components/settings/ConfirmDialog.vue'

// Thin wrapper around ConfirmDialog so the sidebar and start header share
// the logout warning without duplicating its texts. Rendered only while
// open so a closed dialog in the sidebar does not sit ahead of page dialogs.
defineProps<{
  pendingCount: number
  loading?: boolean
}>()
defineEmits<{ confirm: [] }>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
</script>

<template>
  <ConfirmDialog
    v-if="open"
    v-model:open="open"
    :title="t('logout.confirm.title')"
    :message="t('logout.confirm.body', pendingCount)"
    :confirm-label="t('logout.confirm.confirm')"
    :cancel-label="t('logout.confirm.cancel')"
    :loading="loading"
    @confirm="$emit('confirm')"
  />
</template>
