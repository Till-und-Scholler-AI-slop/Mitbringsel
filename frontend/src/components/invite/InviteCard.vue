<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { timeLeft } from '@/services/relativeTime'
import type { InvitePreview } from '@/types/api'

const INVITER_AVATAR_SIZE = 52
const MEMBER_AVATAR_SIZE = 40
const EXPIRY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
}

const props = defineProps<{ preview: InvitePreview }>()

const { t, d } = useI18n()

// Taken when the card is drawn; the text does not tick on its own.
const now = new Date()

// The preview lists at most four members; the rest is only counted.
const others = computed(() => Math.max(0, props.preview.memberCount - props.preview.members.length))

const expiresAt = computed(() => new Date(props.preview.expiresAt))
const expiryDate = computed(() => d(expiresAt.value, EXPIRY_DATE_FORMAT))
const remaining = computed(() => {
  const left = timeLeft(expiresAt.value, now)
  return t(`invite.remaining.${left.unit}`, left.count)
})
</script>

<template>
  <section class="card" :aria-label="t('invite.card')">
    <div class="inviter">
      <BaseAvatar
        v-if="preview.invitedByName"
        class="inviter-avatar"
        :name="preview.invitedByName"
        :src="preview.invitedByAvatarUrl"
        :size="INVITER_AVATAR_SIZE"
      />
      <p class="inviter-text">
        <i18n-t v-if="preview.invitedByName" keypath="invite.invitedBy" tag="span">
          <template #name>
            <strong>{{ preview.invitedByName }}</strong>
          </template>
        </i18n-t>
        <template v-else>{{ t('invite.invitedByUnknown') }}</template>
      </p>
    </div>

    <div class="group">
      <span class="group-icon" aria-hidden="true"><BaseIcon name="home" :size="22" /></span>
      <h2 class="group-name">{{ preview.groupName }}</h2>
    </div>

    <div class="members">
      <div class="members-head">
        <h3 class="members-title">{{ t('invite.members') }}</h3>
        <span class="members-count" :aria-label="t('start.groups.members', preview.memberCount)">
          {{ preview.memberCount }}
        </span>
      </div>
      <ul class="members-list" :aria-label="t('invite.someMembers')">
        <li v-for="(member, index) in preview.members" :key="index" class="member">
          <BaseAvatar :name="member.firstName" :src="member.avatarUrl" :size="MEMBER_AVATAR_SIZE" />
          <span class="member-name">{{ member.firstName }}</span>
        </li>
      </ul>
      <span v-if="others > 0" class="more">{{ t('invite.more', { count: others }) }}</span>
    </div>

    <p class="expiry">
      <BaseIcon class="expiry-icon" name="clock" :size="18" />
      <i18n-t keypath="invite.validUntil" tag="span" class="expiry-text">
        <template #date>
          <time :datetime="preview.expiresAt">{{ expiryDate }}</time>
        </template>
        <template #remaining>{{ remaining }}</template>
      </i18n-t>
    </p>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
}

.inviter {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.inviter-avatar {
  box-shadow: 0 0 0 var(--border-width-md) var(--color-border);
  transform: rotate(-4deg);
}

.inviter-text {
  margin: 0;
  min-width: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: break-word;
}

.inviter-text strong {
  font-weight: var(--font-weight-black);
}

.group {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.group-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-full);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.group-name {
  margin: 0;
  min-width: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-display);
  line-height: var(--line-height-heading);
  letter-spacing: -0.025em;
  overflow-wrap: break-word;
}

.members {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.members-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.members-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.members-count {
  display: grid;
  place-items: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-selected-bg);
  color: var(--color-selected-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.members-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.member {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  min-height: 3.5rem;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}

.member-name {
  min-width: 0;
  font-weight: var(--font-weight-heavy);
  overflow-wrap: break-word;
}

.more {
  align-self: flex-start;
  padding: var(--space-1) var(--space-3);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.expiry {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding-top: 0.875rem;
  border-top: var(--border-width-sm) dashed var(--color-divider);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1875rem;
}

.expiry-icon {
  flex: none;
}

.expiry-text {
  min-width: 0;
  overflow-wrap: break-word;
}

.expiry time {
  color: var(--color-text);
  font-weight: var(--font-weight-black);
}

/* Desktop (design "markt2-einladung-desktop-*"): a little more room. */
@media (min-width: 48rem) {
  .card {
    padding: var(--space-6);
  }

  .group-name {
    font-size: 1.875rem;
    line-height: 2.1875rem;
  }
}
</style>
