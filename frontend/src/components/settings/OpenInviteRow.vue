<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import { timeAgo, timeLeft } from '@/services/relativeTime'
import type { Invite } from '@/types/api'

// isMine: the signed-in user made the link. busy: the revoke request of this
// link is running. error: its message, if it failed.
const props = defineProps<{
  invite: Invite
  isMine: boolean
  busy: boolean
  error: string | null
}>()
defineEmits<{ revoke: [] }>()

const { t, locale } = useI18n()

// Taken when the row is drawn; the text does not tick on its own.
const now = new Date()

const createdBy = computed(() => {
  if (props.isMine) return t('settings.invites.open.createdByYou')
  return props.invite.createdByName === null
    ? t('settings.invites.open.createdByUnknown')
    : t('settings.invites.open.createdBy', { name: props.invite.createdByName })
})

const details = computed(() => {
  const left = timeLeft(new Date(props.invite.expiresAt), now)
  return t('settings.invites.open.details', {
    age: timeAgo(new Date(props.invite.createdAt), now, locale.value),
    remaining: t(`settings.invites.open.remaining.${left.unit}`, left.count),
  })
})

const revokeLabel = computed(() =>
  props.invite.createdByName === null
    ? t('settings.invites.open.revokeAriaUnknown')
    : t('settings.invites.open.revokeAria', { name: props.invite.createdByName }),
)
</script>

<template>
  <li class="row">
    <span class="icon" aria-hidden="true"><BaseIcon name="link" :size="18" /></span>
    <span class="text">
      <span class="created-by">{{ createdBy }}</span>
      <span class="details">{{ details }}</span>
    </span>
    <button
      type="button"
      class="revoke"
      :disabled="busy"
      :aria-busy="busy || undefined"
      :aria-label="revokeLabel"
      @click="$emit('revoke')"
    >
      <BaseSpinner v-if="busy" :size="16" />
      {{ t('settings.invites.open.revoke') }}
    </button>
    <p v-if="error" class="problem" role="alert"><BaseIcon name="alert" /> {{ error }}</p>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.625rem;
  min-height: 3.75rem;
  padding: var(--space-1-5) var(--space-1-5) var(--space-1-5) 0.625rem;
  border-radius: var(--radius-md);
  background: var(--color-bg);
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-full);
  background: var(--color-muted-bg);
  color: var(--color-text);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.created-by {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-heavy);
  line-height: 1.25rem;
  overflow-wrap: anywhere;
}

.details {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-medium);
  line-height: 1.125rem;
}

.revoke {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  min-height: 2.75rem;
  padding: 0 var(--space-3);
  border: var(--border-width-sm) solid var(--color-danger);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-danger-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
  cursor: pointer;
}

.revoke:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.problem {
  display: flex;
  flex-basis: 100%;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-danger-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
}
</style>
