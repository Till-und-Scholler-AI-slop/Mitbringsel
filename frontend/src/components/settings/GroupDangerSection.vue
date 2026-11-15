<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import ConfirmDialog from '@/components/settings/ConfirmDialog.vue'
import SettingsCard from '@/components/settings/SettingsCard.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'
import type { Group } from '@/types/api'

const props = defineProps<{ group: Group }>()

const { t } = useI18n()
const router = useRouter()
const groups = useGroupsStore()
const lists = useListsStore()

// The founder cannot leave (OWNER_IMMUTABLE), only delete; everybody else
// can only leave.
const kind = computed(() => (props.group.role === 'owner' ? 'delete' : 'leave'))

// Deleting names what goes with it, like the design: "with all 3 lists …
// for all 6 members". Archived lists count, they go too. The lists are
// usually loaded already (start page, list view); opened directly, this
// loads them. Until they are there, the text just leaves the numbers out.
onMounted(() => {
  if (kind.value === 'delete' && lists.statusOf(props.group.id) === 'idle') {
    lists.load(props.group.id)
  }
})

const message = computed(() => {
  const name = props.group.name
  if (kind.value === 'leave') return t('settings.danger.leave.body', { name })
  if (lists.statusOf(props.group.id) !== 'ready') {
    return t('settings.danger.delete.body', { name })
  }
  const listCount = lists.listsOf(props.group.id).length
  const memberCount = props.group.members.length
  return t('settings.danger.delete.bodyCounted', {
    name,
    lists: t('settings.danger.delete.lists', listCount),
    members: t('settings.danger.delete.members', memberCount),
  })
})

const confirmOpen = ref(false)
const busy = ref(false)
const errorCode = ref<string | null>(null)
const errorMessage = useErrorMessage(errorCode)

function ask() {
  errorCode.value = null
  confirmOpen.value = true
}

async function confirm() {
  busy.value = true
  errorCode.value = null
  try {
    if (kind.value === 'delete') {
      await groups.remove(props.group.id)
    } else {
      await groups.leave(props.group.id)
    }
    confirmOpen.value = false
    await router.push({ name: 'home' })
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <SettingsCard class="danger" :title="t(`settings.danger.${kind}.title`)" danger>
    <p class="description">{{ t(`settings.danger.${kind}.description`) }}</p>
    <BaseButton variant="danger" class="open" @click="ask">
      <BaseIcon :name="kind === 'delete' ? 'trash' : 'logOut'" />
      {{ t(`settings.danger.${kind}.open`) }}
    </BaseButton>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="t(`settings.danger.${kind}.dialogTitle`, { name: group.name })"
      :message="message"
      :confirm-label="t(`settings.danger.${kind}.confirm`)"
      :cancel-label="t('settings.danger.cancel')"
      :loading="busy"
      :error="errorCode ? errorMessage : null"
      @confirm="confirm"
    />
  </SettingsCard>
</template>

<style scoped>
.danger {
  gap: var(--space-3);
}

.description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  line-height: 1.3125rem;
}

.open {
  min-height: 3.5rem;
  font-size: 1.0625rem;
}
</style>
