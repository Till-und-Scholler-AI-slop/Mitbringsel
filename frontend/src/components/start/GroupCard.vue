<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSticker from '@/components/base/BaseSticker.vue'
import type { Group, List } from '@/types/api'

// More members than this show as the first few only; the count is in the text.
const MAX_AVATARS = 4
const AVATAR_SIZE = 26
// The art of a 36 px sticker is about as large as the 28 px dot in the design.
const STICKER_SIZE = 36

// A household on the start page. The whole card is one link to the
// household, which opens its last or first list. Screen readers hear one
// summary instead of the parts.
//
// lists: the active lists of the household, empty while they load.
const props = defineProps<{ group: Group; lists: List[] }>()

const { t } = useI18n()
const avatars = computed(() => props.group.members.slice(0, MAX_AVATARS))
const membersText = computed(() => t('start.groups.members', props.group.members.length))

const label = computed(() => {
  const head = `${props.group.name}, ${membersText.value}`
  if (props.lists.length === 0) return head
  const names = props.lists.map((list) => list.name).join(', ')
  return `${head}. ${t('start.groups.cardLists', { lists: names })}`
})
</script>

<template>
  <RouterLink
    class="card press-sticker"
    :to="{ name: 'group', params: { groupId: group.id } }"
    :aria-label="label"
  >
    <span class="head" aria-hidden="true">
      <span class="house"><BaseIcon name="home" :size="22" /></span>
      <span class="text">
        <span class="name">{{ group.name }}</span>
        <span class="members">{{ membersText }}</span>
      </span>
      <span class="avatars">
        <BaseAvatar
          v-for="member in avatars"
          :key="member.userId"
          class="avatar"
          :name="member.displayName"
          :src="member.avatarUrl"
          :size="AVATAR_SIZE"
        />
      </span>
      <BaseIcon class="chevron" name="chevronRight" :size="22" :stroke-width="2.75" />
    </span>

    <span v-if="lists.length > 0" class="lists" aria-hidden="true">
      <span v-for="list in lists" :key="list.id" class="list">
        <BaseSticker :icon="list.icon" :size="STICKER_SIZE" />
        <span class="list-name">{{ list.name }}</span>
      </span>
    </span>
  </RouterLink>
</template>

<style scoped>
/* Lifts under the mouse and sinks onto its shadow when pressed
   (press-sticker). */
.card {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: 1.375rem;
  background: var(--color-surface);
  color: var(--color-text);
  text-decoration: none;
  box-shadow: var(--shadow-sticker);
}

.card:hover {
  transform: translateY(-2px);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.house {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-full);
  background: var(--color-house-bg);
  color: var(--color-house-text);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.name {
  font-size: 1.25rem;
  font-weight: var(--font-weight-black);
  line-height: 1.5625rem;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.members {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1875rem;
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
  margin-left: -7px;
}

.chevron {
  flex: none;
}

.lists {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* The sticker sits close to the left edge, like on the list chips. */
.list {
  max-width: 100%;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  min-height: 2.25rem;
  padding: 0 var(--space-3) 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-bg);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

/* A block box of its own: "…" for a long name works on block boxes only. */
.list-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Desktop: a little larger, as the cards stand in a grid with more room. */
@media (min-width: 48rem) {
  .card {
    padding: 1.125rem;
  }

  .house {
    width: var(--size-touch);
    height: var(--size-touch);
  }

  .name {
    font-size: 1.375rem;
    line-height: 1.6875rem;
  }

  .list {
    min-height: 2.375rem;
    font-size: var(--font-size-sm);
  }
}
</style>
