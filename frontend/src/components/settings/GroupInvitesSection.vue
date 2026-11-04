<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import OpenInvitesList from '@/components/settings/OpenInvitesList.vue'
import InviteLinkBox from '@/components/settings/InviteLinkBox.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { buildInviteLink } from '@/services/inviteLink'
import { useGroupInvitesStore } from '@/stores/groupInvites'
import type { Group } from '@/types/api'

const ERROR_TOO_MANY_INVITES = 'TOO_MANY_INVITES'

const props = defineProps<{ group: Group }>()

const { t } = useI18n()
const invites = useGroupInvitesStore()

const creating = ref(false)
const errorCode = ref<string | null>(null)
const errorMessage = useErrorMessage(errorCode)

// The link of this visit, if there is one for this group.
const link = computed(() =>
  invites.fresh && invites.groupId === props.group.id
    ? buildInviteLink(window.location.origin, invites.fresh.token)
    : null,
)

onMounted(() => invites.load(props.group.id))

async function create() {
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
  <section class="section" aria-labelledby="invites-title">
    <div class="head">
      <h2 id="invites-title" class="title">{{ t('settings.invites.title') }}</h2>
      <p class="description">{{ t('settings.invites.description') }}</p>
    </div>

    <InviteLinkBox v-if="link" :link="link" :group-name="group.name" />
    <BaseButton v-else :loading="creating" @click="create">
      <BaseIcon name="plus" /> {{ t('settings.invites.create') }}
    </BaseButton>

    <p v-if="errorCode" class="problem" role="alert">
      <BaseIcon name="alert" />
      {{ errorCode === ERROR_TOO_MANY_INVITES ? t('settings.invites.limit') : errorMessage }}
    </p>

    <OpenInvitesList :group-id="group.id" @revoked="errorCode = null" />
  </section>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-black);
}

.description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.problem {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-danger-text);
  font-weight: var(--font-weight-bold);
}
</style>
