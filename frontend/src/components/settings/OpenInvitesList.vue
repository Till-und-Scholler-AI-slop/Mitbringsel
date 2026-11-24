<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseOfflineNotice from '@/components/base/BaseOfflineNotice.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import OpenInviteRow from '@/components/settings/OpenInviteRow.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { MAX_OPEN_INVITES } from '@/services/inviteLink'
import { useAuthStore } from '@/stores/auth'
import { useGroupInvitesStore } from '@/stores/groupInvites'

// The parent loads the links; this shows them and revokes.
const props = defineProps<{ groupId: string }>()
// A revoked link frees a place, so an old "too many links" message is out of date.
const emit = defineEmits<{ revoked: [] }>()

const { t } = useI18n()
const invites = useGroupInvitesStore()
const auth = useAuthStore()
const { online } = useOnlineStatus()
const loadError = useErrorMessage(() => invites.errorCode)

const revoking = ref<string | null>(null)
const revokeFailed = ref<{ id: string; code: string } | null>(null)
const revokeFailedMessage = useErrorMessage(() => revokeFailed.value?.code ?? null)

const offlineEmpty = computed(() => !online.value && invites.invites.length === 0)
const loading = computed(() => invites.status === 'loading' && invites.invites.length === 0)
const failed = computed(() => invites.status === 'error' && invites.invites.length === 0)

async function revoke(inviteId: string) {
  if (!online.value) return
  revoking.value = inviteId
  revokeFailed.value = null
  try {
    await invites.revoke(props.groupId, inviteId)
    emit('revoked')
  } catch (err) {
    revokeFailed.value = {
      id: inviteId,
      code: err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN,
    }
  } finally {
    revoking.value = null
  }
}
</script>

<template>
  <div class="list">
    <div class="head">
      <h3 class="title">{{ t('settings.invites.open.title') }}</h3>
      <span v-if="!offlineEmpty" class="count">
        {{
          t('settings.invites.open.count', { count: invites.invites.length, max: MAX_OPEN_INVITES })
        }}
      </span>
    </div>

    <BaseOfflineNotice
      v-if="offlineEmpty"
      variant="inline"
      :text="t('settings.invites.open.offline')"
    />

    <p v-else-if="loading" class="status" role="status"><BaseSpinner /></p>

    <div v-else-if="failed" class="failed" role="alert">
      <p class="failed-title">{{ t('settings.invites.open.loadFailed') }}</p>
      <p>{{ loadError }}</p>
      <BaseButton variant="secondary" @click="invites.load(groupId)">
        <BaseIcon name="retry" /> {{ t('common.retry') }}
      </BaseButton>
    </div>

    <p v-else-if="invites.invites.length === 0" class="status">
      {{ t('settings.invites.open.empty') }}
    </p>

    <template v-else>
      <ul class="rows">
        <OpenInviteRow
          v-for="invite in invites.invites"
          :key="invite.id"
          :invite="invite"
          :is-mine="invite.createdBy !== null && invite.createdBy === auth.user?.id"
          :busy="revoking === invite.id"
          :disabled="!online"
          :error="revokeFailed?.id === invite.id ? revokeFailedMessage : null"
          @revoke="revoke(invite.id)"
        />
      </ul>
      <BaseOfflineNotice v-if="!online" variant="inline" :text="t('offline.actionHint')" />
    </template>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-1);
  border-top: 1.5px solid var(--color-divider);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: 0.625rem;
}

.title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-black);
  line-height: 1.3125rem;
}

.count {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-heavy);
  font-variant-numeric: tabular-nums;
}

.status {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.failed p {
  margin: 0;
}

.failed-title {
  font-weight: var(--font-weight-black);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
