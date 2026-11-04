<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { timeAgo, timeLeft } from '@/services/relativeTime'
import type { Invite } from '@/types/api'

// busy: the revoke request of this link is running. error: its message, if it failed.
const props = defineProps<{ invite: Invite; busy: boolean; error: string | null }>()
defineEmits<{ revoke: [] }>()

const { t, locale } = useI18n()

// Taken when the row is drawn; the text does not tick on its own.
const now = new Date()

const createdBy = computed(() =>
  props.invite.createdByName === null
    ? t('settings.invites.open.createdByUnknown')
    : t('settings.invites.open.createdBy', { name: props.invite.createdByName }),
)

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
    <span class="icon" aria-hidden="true"><BaseIcon name="link" /></span>
    <span class="text">
      <span class="created-by">{{ createdBy }}</span>
      <span class="details">{{ details }}</span>
    </span>
    <BaseButton
      variant="ghost"
      class="revoke"
      :loading="busy"
      :aria-label="revokeLabel"
      @click="$emit('revoke')"
    >
      {{ t('settings.invites.open.revoke') }}
    </BaseButton>
    <p v-if="error" class="problem" role="alert"><BaseIcon name="alert" /> {{ error }}</p>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.row + .row {
  border-top: var(--border-width-sm) dashed var(--color-text-muted);
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-full);
  background: var(--color-bg);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.created-by {
  font-weight: var(--font-weight-black);
  overflow-wrap: anywhere;
}

.details {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.revoke {
  flex: none;
  min-height: var(--size-touch);
  color: var(--color-danger-text);
  font-size: var(--font-size-sm);
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
