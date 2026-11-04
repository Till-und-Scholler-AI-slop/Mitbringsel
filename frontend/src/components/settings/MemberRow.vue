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
  <li class="member">
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
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.member + .member {
  border-top: var(--border-width-sm) dashed var(--color-text-muted);
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
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-black);
  overflow-wrap: anywhere;
}

.you {
  color: var(--color-text-muted);
  font-weight: var(--font-weight-semibold);
}

.role {
  padding: 0 var(--space-2);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
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
