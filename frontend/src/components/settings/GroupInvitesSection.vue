<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseOfflineNotice from '@/components/base/BaseOfflineNotice.vue'
import OpenInvitesList from '@/components/settings/OpenInvitesList.vue'
import InviteLinkBox from '@/components/settings/InviteLinkBox.vue'
import SettingsCard from '@/components/settings/SettingsCard.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { buildInviteLink } from '@/services/inviteLink'
import { useGroupInvitesStore } from '@/stores/groupInvites'
import type { Group } from '@/types/api'

const ERROR_TOO_MANY_INVITES = 'TOO_MANY_INVITES'

const props = defineProps<{ group: Group }>()

const { t } = useI18n()
const invites = useGroupInvitesStore()
const { online } = useOnlineStatus()

const creating = ref(false)
const errorCode = ref<string | null>(null)
const errorMessage = useErrorMessage(errorCode)

// The link of this visit, if there is one for this group.
const link = computed(() =>
  invites.fresh && invites.groupId === props.group.id
    ? buildInviteLink(window.location.origin, invites.fresh.token)
    : null,
)

onMounted(() => {
  if (online.value) invites.load(props.group.id)
})

// Open invites are not stored locally, so load them once the connection is back.
watch(online, (isOnline) => {
  if (
    isOnline &&
    (invites.groupId !== props.group.id || invites.status === 'error' || invites.status === 'idle')
  ) {
    invites.load(props.group.id)
  }
})

async function create() {
  if (!online.value) return
  creating.value = true
  errorCode.value = null
  try {
    await invites.create(props.group.id)
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <SettingsCard class="invites" :title="t('settings.invites.title')">
    <p class="description">{{ t('settings.invites.description') }}</p>

    <InviteLinkBox v-if="link" :link="link" :group-name="group.name" />
    <template v-else>
      <BaseButton class="create" :loading="creating" :disabled="!online" @click="create">
        <BaseIcon name="plus" /> {{ t('settings.invites.create') }}
      </BaseButton>
      <BaseOfflineNotice v-if="!online" variant="inline" :text="t('offline.actionHint')" />
    </template>

    <p v-if="errorCode" class="problem" role="alert">
      <BaseIcon name="alert" />
      {{ errorCode === ERROR_TOO_MANY_INVITES ? t('settings.invites.limit') : errorMessage }}
    </p>

    <OpenInvitesList :group-id="group.id" @revoked="errorCode = null" />
  </SettingsCard>
</template>

<style scoped>
.invites {
  gap: 0.875rem;
}

/* Pulled up to the heading, as one block with it. */
.description {
  margin: calc(-1 * var(--space-2)) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  line-height: 1.3125rem;
}

.create {
  min-height: 3.5rem;
  font-size: 1.0625rem;
}

.problem {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  margin: 0;
  padding: var(--space-3);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-md);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  line-height: 1.3125rem;
}

.problem :deep(svg) {
  flex: none;
}
</style>
