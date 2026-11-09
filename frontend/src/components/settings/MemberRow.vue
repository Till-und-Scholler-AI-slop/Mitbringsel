<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { GroupMember } from '@/types/api'

const AVATAR_SIZE = 44

// canAct: the viewer may do something with this member; the button then
// opens the actions, which the parent shows.
defineProps<{ member: GroupMember; isMe: boolean; canAct: boolean }>()
defineEmits<{ act: [] }>()

const { t } = useI18n()
</script>

<template>
  <li :class="['member', { 'member--me': isMe }]">
    <BaseAvatar :name="member.displayName" :src="member.avatarUrl" :size="AVATAR_SIZE" />
    <div class="text">
      <span class="name">
        {{ member.displayName }}
        <span v-if="isMe" class="you">{{ t('settings.members.you') }}</span>
      </span>
      <span :class="['role', `role--${member.role}`]">{{
        t(`settings.roles.${member.role}`)
      }}</span>
    </div>
    <button
      v-if="canAct"
      type="button"
      class="act"
      :aria-label="t('settings.members.actionsFor', { name: member.displayName })"
      aria-haspopup="dialog"
      @click="$emit('act')"
    >
      <BaseIcon name="ellipsis" :size="22" :stroke-width="3" />
    </button>
  </li>
</template>

<style scoped>
.member {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 4.25rem;
  padding: var(--space-2);
  border-radius: var(--radius-md);
}

/* The own row stands out a little. */
.member--me {
  background: var(--color-bg);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.name {
  max-width: 100%;
  font-size: 1.0625rem;
  font-weight: var(--font-weight-heavy);
  line-height: 1.375rem;
  overflow-wrap: anywhere;
}

.you {
  margin-left: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.role {
  padding: 1px 0.625rem;
  border: var(--border-width-sm) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-heavy);
  line-height: 1.125rem;
}

.role--owner {
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
}

.role--admin {
  background: var(--color-accent-lilac);
  color: var(--color-on-accent);
}

.role--member {
  border-color: var(--color-divider);
  background: var(--color-bg);
  color: var(--color-text);
}

.act {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}
</style>
