<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSticker from '@/components/base/BaseSticker.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import LogoutConfirmDialog from '@/components/layout/LogoutConfirmDialog.vue'
import ProfileMenu from '@/components/start/ProfileMenu.vue'
import SyncStatus from '@/components/layout/SyncStatus.vue'
import { useLogout } from '@/composables/useLogout'
import { useOpenCounts } from '@/composables/useOpenCounts'
import { useAuthStore } from '@/stores/auth'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

// The green navigation on the left of the desktop layout: start, the
// households, the lists of the open household, founding one, the profile.
//
// groupId, listId: what is open; neither on the start page. The dialogs for
// founding and list actions belong to the parents, so they stay open when the
// sidebar is hidden. List actions open on right click or the context menu key
// (ContextMenu / Shift+F10) on a list entry; normal clicks navigate as usual.
const props = defineProps<{ groupId?: string; listId?: string }>()
const emit = defineEmits<{ create: []; listActions: [list: List] }>()

const { t } = useI18n()
const auth = useAuthStore()
const groups = useGroupsStore()
const lists = useListsStore()
const { openInGroup, openInList } = useOpenCounts()
const {
  logout,
  confirmOpen: logoutConfirmOpen,
  pendingCount,
  busy: loggingOut,
  confirmLogout,
} = useLogout()
const listHintId = useId()

const current = computed(() => (props.groupId ? groups.byId(props.groupId) : undefined))
const currentLists = computed(() => (props.groupId ? lists.activeLists(props.groupId) : []))
const householdEntries = computed(() =>
  groups.groups.map((group) => ({ group, openCount: openInGroup(group.id) })),
)
const currentListEntries = computed(() =>
  currentLists.value.map((list) => ({ list, openCount: openInList(list.id) })),
)

function onListKeydown(event: KeyboardEvent, list: List) {
  if (event.ctrlKey || event.altKey || event.metaKey) return
  const isContextKey =
    (event.key === 'ContextMenu' && !event.shiftKey) || (event.key === 'F10' && event.shiftKey)
  if (!isContextKey) return
  event.preventDefault()
  emit('listActions', list)
}
</script>

<template>
  <nav class="sidebar" :aria-label="t('nav.label')">
    <BrandLogo class="logo" small flat />

    <RouterLink
      :class="['entry', { 'entry--current': !groupId }]"
      :to="{ name: 'home' }"
      :aria-current="groupId ? undefined : 'page'"
    >
      <span class="dot dot--start" aria-hidden="true"><BaseIcon name="grid" :size="20" /></span>
      <span class="entry-name">{{ t('nav.start') }}</span>
    </RouterLink>

    <div class="households">
      <h2 class="label">{{ t('nav.households') }}</h2>
      <ul class="groups">
        <li v-for="{ group, openCount } in householdEntries" :key="group.id" class="group">
          <!-- "true", not "page": the page is the list below it. -->
          <RouterLink
            :class="['entry', { 'entry--current': group.id === current?.id }]"
            :to="{ name: 'group', params: { groupId: group.id } }"
            :aria-current="group.id === current?.id ? 'true' : undefined"
          >
            <span class="dot dot--house" aria-hidden="true"
              ><BaseIcon name="home" :size="20"
            /></span>
            <span class="entry-name">{{ group.name }}</span>
            <template v-if="openCount !== null">
              <span class="entry-count" aria-hidden="true">{{ openCount }}</span>
              <span class="sr-only">, {{ t('nav.openItems', { count: openCount }) }}</span>
            </template>
          </RouterLink>

          <ul
            v-if="group.id === current?.id && currentListEntries.length > 0"
            class="lists"
            :aria-label="t('nav.lists', { name: group.name })"
          >
            <li v-for="{ list, openCount: listOpenCount } in currentListEntries" :key="list.id">
              <RouterLink
                :class="['list', { 'list--current': list.id === listId }]"
                :to="{ name: 'list', params: { groupId: group.id, listId: list.id } }"
                :aria-current="list.id === listId ? 'page' : undefined"
                :aria-describedby="listHintId"
                @contextmenu.prevent="emit('listActions', list)"
                @keydown="onListKeydown($event, list)"
              >
                <!-- 40 px: its art is about as large as the 32 px dot in the design. -->
                <BaseSticker :icon="list.icon" :size="40" />
                <span class="list-name">{{ list.name }}</span>
                <template v-if="listOpenCount !== null">
                  <span class="list-count" aria-hidden="true">{{ listOpenCount }}</span>
                  <span class="sr-only">, {{ t('nav.openItems', { count: listOpenCount }) }}</span>
                </template>
              </RouterLink>
            </li>
          </ul>
        </li>
      </ul>
      <span v-if="currentLists.length > 0" :id="listHintId" class="sr-only">{{
        t('nav.listActionsHint')
      }}</span>

      <button type="button" class="create" aria-haspopup="dialog" @click="emit('create')">
        <BaseIcon name="plus" :size="18" :stroke-width="2.75" /> {{ t('start.create.open') }}
      </button>
    </div>

    <span class="spacer" aria-hidden="true" />

    <SyncStatus class="sync" size="lg" hint :household-name="current?.name" />

    <div v-if="auth.user" class="profile">
      <ProfileMenu
        row
        :name="auth.user.displayName"
        :avatar-url="auth.user.avatarUrl"
        @logout="logout"
      />
    </div>

    <LogoutConfirmDialog
      v-model:open="logoutConfirmOpen"
      :pending-count="pendingCount"
      :loading="loggingOut"
      @confirm="confirmLogout"
    />
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  padding: var(--space-5) var(--space-4) 1.125rem;
  border-radius: var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.logo {
  align-self: flex-start;
  font-size: var(--font-size-lg);
}

/* Start and the households: sticker chips that sink in while current. */
.entry {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-height: 3.5rem;
  padding: 0 0.875rem 0 0.4375rem;
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  text-decoration: none;
  box-shadow: var(--shadow-sticker);
  transition:
    transform 0.32s var(--easing-bounce),
    box-shadow 0.32s var(--easing-bounce);
}

.entry:active {
  transform: translateY(3px) scale(0.98);
  box-shadow: inset 0 3px 0 color-mix(in srgb, var(--color-on-accent) 20%, transparent);
  transition-duration: 60ms;
}

.entry--current {
  border-color: var(--color-on-accent);
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
  transform: translateY(3px);
  box-shadow: inset 0 3px 0 color-mix(in srgb, var(--color-on-accent) 20%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .entry {
    transition: none;
  }
}

.dot {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-full);
}

.dot--start {
  background: var(--color-accent-sun);
  color: var(--color-on-accent);
}

.dot--house {
  background: var(--color-house-bg);
  color: var(--color-house-text);
}

.entry--current .dot {
  background: var(--color-accent-white);
  color: var(--color-on-accent);
}

.entry-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.entry-count {
  flex: none;
  font-size: 0.8125rem;
  font-weight: var(--font-weight-bold);
}

.households {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.label {
  margin: 0;
  padding: 0 var(--space-1);
  font-size: 0.75rem;
  font-weight: var(--font-weight-black);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.groups,
.lists {
  margin: 0;
  padding: 0;
  list-style: none;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
}

.lists {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: 1.625rem;
  padding-left: 0.625rem;
  border-left: var(--border-width-sm) solid
    color-mix(in srgb, var(--color-on-brand) 45%, transparent);
}

.list {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-height: var(--size-touch);
  padding: 0 var(--space-3) 0 var(--space-1-5);
  border-radius: var(--radius-full);
  color: var(--color-on-brand);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  text-decoration: none;
}

.list-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.list-count {
  flex: none;
  font-size: 0.8125rem;
  font-weight: var(--font-weight-heavy);
}

.list--current {
  background: var(--color-sidebar-current-bg);
  font-weight: var(--font-weight-black);
}

.create {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 3.25rem;
  border: var(--border-width-sm) dashed var(--color-on-brand);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-on-brand);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-heavy);
  cursor: pointer;
}

.spacer {
  flex: 1;
}

.sync {
  padding: 0 var(--space-1);
}

.profile {
  padding-top: var(--space-2);
  border-top: 1.5px solid color-mix(in srgb, var(--color-on-brand) 35%, transparent);
}
</style>
