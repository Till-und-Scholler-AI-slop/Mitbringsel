<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { Group } from '@/types/api'

// More members than this show as the first few only; the count is in the text.
const MAX_AVATARS = 4
const AVATAR_SIZE = 26

const props = defineProps<{ group: Group }>()

const { t } = useI18n()
const avatars = computed(() => props.group.members.slice(0, MAX_AVATARS))
</script>

<template>
  <article class="card">
    <span class="icon" aria-hidden="true"><BaseIcon name="home" :size="22" /></span>
    <div class="text">
      <!-- title: the full name for names too long for the line -->
      <h3 class="name" :title="group.name">{{ group.name }}</h3>
      <p class="members">{{ t('start.groups.members', group.members.length) }}</p>
    </div>
    <span class="avatars" aria-hidden="true">
      <BaseAvatar
        v-for="member in avatars"
        :key="member.userId"
        class="avatar"
        :name="member.displayName"
        :src="member.avatarUrl"
        :size="AVATAR_SIZE"
      />
    </span>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-full);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.text {
  flex: 1;
  min-width: 0;
}

/* One line with "…" instead of wrapping: the name can be up to 30 characters. */
.name {
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.members {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.avatars {
  flex: none;
  display: flex;
}

/* Overlapping, each with a ring in the card color to tell them apart. */
.avatar {
  box-shadow: 0 0 0 2px var(--color-surface);
}

.avatar + .avatar {
  margin-left: calc(-1 * var(--space-2));
}
</style>
