<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import SyncStatus from '@/components/layout/SyncStatus.vue'
import HouseholdSwitcher from '@/components/list/HouseholdSwitcher.vue'
import CreateGroupDialog from '@/components/start/CreateGroupDialog.vue'
import JoinGroupDialog from '@/components/start/JoinGroupDialog.vue'
import { CONTEXT_COLUMN_QUERY } from '@/components/list/contextColumn'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useGroupsStore } from '@/stores/groups'
import type { Group } from '@/types/api'

const MAX_AVATARS = 4
const AVATAR_SIZE = 30
const AVATAR_SIZE_LARGE = 34

// The head of the list view: on the phone a green bar with the way home and
// the sync state; then the household with its members. The default slot
// holds the list chips, which the view wires to its own dialogs.
// Without `group` (still loading) only the top row shows.
const props = defineProps<{ group?: Group }>()

const { t } = useI18n()
// Larger avatars once the header spans the context column too.
const large = useMediaQuery(CONTEXT_COLUMN_QUERY)
const router = useRouter()
const groups = useGroupsStore()

const createGroupOpen = ref(false)
const joinOpen = ref(false)

const members = computed(() => props.group?.members ?? [])
const shownMembers = computed(() => members.value.slice(0, MAX_AVATARS))
const memberNames = computed(() => members.value.map((m) => m.displayName).join(', '))

function openCreatedGroup(created: Group) {
  return router.push({ name: 'group', params: { groupId: created.id } })
}
</script>

<template>
  <!-- On the phone a green header; on the desktop the plain top of the
     page, as the sidebar holds the way back to the start page. -->
  <header class="bar">
    <!-- Phone only: on the desktop the sidebar holds both. -->
    <div class="top">
      <RouterLink class="home" :to="{ name: 'home' }" :aria-label="t('list.home')">
        <span class="home-icon" aria-hidden="true"><BaseIcon name="home" :size="20" /></span>
        <BrandLogo small aria-hidden="true" />
      </RouterLink>
      <SyncStatus />
    </div>

    <div v-if="group" class="household">
      <HouseholdSwitcher
        :current="group"
        :groups="groups.groups"
        @create="createGroupOpen = true"
        @join="joinOpen = true"
      />
      <span class="members" role="img" :aria-label="t('list.membersLabel', { names: memberNames })">
        <BaseAvatar
          v-for="member in shownMembers"
          :key="member.userId"
          class="member"
          :name="member.displayName"
          :src="member.avatarUrl"
          :size="large ? AVATAR_SIZE_LARGE : AVATAR_SIZE"
        />
      </span>
    </div>

    <slot />

    <CreateGroupDialog v-model:open="createGroupOpen" @created="openCreatedGroup" />
    <JoinGroupDialog v-model:open="joinOpen" />
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.home {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--size-touch);
  color: inherit;
  text-decoration: none;
}

.home-icon {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  box-sizing: border-box;
  border: var(--border-width-sm) solid currentColor;
  border-radius: var(--radius-full);
}

.household {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.members {
  flex: none;
  display: flex;
}

/* Overlapping, each with a ring in the bar color to tell them apart. */
.member {
  box-shadow: 0 0 0 2.5px var(--color-brand);
}

.member + .member {
  margin-left: calc(-1 * var(--space-2));
}

/* Desktop: no green header; the household name stands large on the page,
   above the chips, at most 820px wide like the items below. */
@media (min-width: 48rem) {
  .bar {
    gap: var(--space-5);
    width: 100%;
    max-width: 51.25rem;
    box-sizing: border-box;
    margin: 0 auto;
    padding: 2.25rem var(--space-6) 0;
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
  }

  .top {
    display: none;
  }

  .member {
    box-shadow: 0 0 0 2.5px var(--color-bg);
  }
}

/* Large screens: across the list and the context column; ListView's grid
   sets the width and the space around (80rem: CONTEXT_COLUMN_QUERY). */
@media (min-width: 80rem) {
  .bar {
    max-width: none;
    padding: 0;
  }
}
</style>
