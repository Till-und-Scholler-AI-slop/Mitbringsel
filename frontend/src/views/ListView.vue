<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import AppFrame from '@/components/layout/AppFrame.vue'
import ArchivedListsDialog from '@/components/list/ArchivedListsDialog.vue'
import ListActionsDialog from '@/components/list/ListActionsDialog.vue'
import ListChips from '@/components/list/ListChips.vue'
import ListHeader from '@/components/list/ListHeader.vue'
import ListItems from '@/components/list/ListItems.vue'
import ListNameDialog from '@/components/list/ListNameDialog.vue'
import { ITEM_PANEL_TARGET } from '@/components/list/itemPanel'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useLeaveDeletedList } from '@/composables/useLeaveDeletedList'
import { useLeaveRemovedGroup } from '@/composables/useLeaveRemovedGroup'
import { canManage } from '@/services/groupRoles'
import { listToOpen, rememberLastList } from '@/services/lastList'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

// noLists: the household has no active list to open.
type ViewState = 'loading' | 'failed' | 'missing' | 'noLists' | 'ready'

// Without listId (the route of the household) the view opens the last or
// first active list, or offers to create one.
const props = defineProps<{ groupId: string; listId?: string }>()

const { t } = useI18n()
const router = useRouter()
const groups = useGroupsStore()
const lists = useListsStore()
const items = useItemsStore()

const createOpen = ref(false)
const archiveOpen = ref(false)
// The list whose actions are open, and the one being renamed; at most one
// of the two is set.
const actionsId = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const listsError = useErrorMessage(() => lists.errorCodeOf(props.groupId))
// Empty while there is no listId in the URL.
const listKey = computed(() => props.listId ?? '')

const group = computed(() => groups.byId(props.groupId))
// A list of another household under this URL counts as not found.
const list = computed<List | undefined>(() => {
  if (!props.listId) return undefined
  const found = lists.byId(props.listId)
  return found?.groupId === props.groupId ? found : undefined
})

const actionsFor = computed(() => lists.byId(actionsId.value ?? ''))
const renaming = computed(() => lists.byId(renamingId.value ?? ''))
const canDelete = computed(() => group.value !== undefined && canManage(group.value.role))
const active = computed(() => lists.activeLists(props.groupId))
const archived = computed(() => lists.archivedLists(props.groupId))

const state = computed<ViewState>(() => {
  if (list.value) return 'ready'
  // Without a list the view moves on as soon as there is one to open.
  if (!props.listId && active.value.length > 0) return 'loading'
  const status = lists.statusOf(props.groupId)
  if (status === 'error') return 'failed'
  if (status !== 'ready') return 'loading'
  return props.listId ? 'missing' : 'noLists'
})

const openCount = computed(() => items.openItems(listKey.value).length)
const members = computed(() => group.value?.members ?? [])

// A direct visit of the URL has to load what the screens before would have
// loaded. The lists of the household load once; the items for every list.
watch(
  [() => props.groupId, () => props.listId],
  ([groupId, listId]) => {
    actionsId.value = null
    renamingId.value = null
    archiveOpen.value = false
    if (groups.status === 'idle') groups.load()
    if (lists.statusOf(groupId) === 'idle') lists.load(groupId)
    if (listId) items.load(listId)
  },
  { immediate: true },
)

// The household without a list in the URL: open the last or first active
// list. replace, so the back button does not land here and bounce again.
watch(
  [() => props.listId, active],
  ([listId, activeLists]) => {
    if (listId) return
    const next = listToOpen(props.groupId, activeLists)
    if (next) router.replace({ name: 'list', params: { groupId: props.groupId, listId: next.id } })
  },
  { immediate: true },
)

watch(list, (now) => {
  if (now) rememberLastList(props.groupId, now.id)
})

useLeaveDeletedList(
  () => props.groupId,
  () => props.listId,
  list,
  group,
)
useLeaveRemovedGroup(() => props.groupId)

function startRename(listId: string) {
  actionsId.value = null
  renamingId.value = listId
}

function openCreated(created: List) {
  return router.push({ name: 'list', params: { groupId: props.groupId, listId: created.id } })
}
</script>

<template>
  <AppFrame :group-id="groupId" :list-id="listId" :bottom-bar="list !== undefined">
    <div class="page">
      <div class="column">
        <ListHeader :group="group">
          <ListChips
            v-if="list || state === 'noLists'"
            :group-id="groupId"
            :lists="active"
            :current-id="listKey"
            :open-count="openCount"
            :archived-count="archived.length"
            :current-archived="list?.archivedAt != null"
            @create="createOpen = true"
            @actions="actionsId = $event.id"
            @archive="archiveOpen = true"
          />
        </ListHeader>

        <main class="content" :class="{ 'content--bar': list }">
          <h1 v-if="list" class="sr-only">{{ list.name }}</h1>
          <h1 v-else-if="group" class="sr-only">{{ group.name }}</h1>

          <p v-if="state === 'loading'" class="loading" role="status">
            <BaseSpinner /> {{ t('list.loading') }}
          </p>

          <div v-else-if="state === 'failed'" class="failed" role="alert">
            <p class="failed-title">{{ t('list.loadFailed') }}</p>
            <p>{{ listsError }}</p>
            <BaseButton variant="secondary" @click="lists.load(groupId)">
              <BaseIcon name="retry" /> {{ t('common.retry') }}
            </BaseButton>
          </div>

          <BaseEmptyState
            v-else-if="state === 'missing'"
            :title="t('list.missing.title')"
            :description="t('list.missing.description')"
          >
            <template #icon><BaseIcon name="linkOff" :size="24" /></template>
            <BaseButton @click="router.push({ name: 'group', params: { groupId } })">
              {{ t('list.missing.home') }}
            </BaseButton>
          </BaseEmptyState>

          <BaseEmptyState
            v-else-if="state === 'noLists'"
            :title="t('list.noLists.title')"
            :description="t('list.noLists.description')"
          >
            <template #icon><BaseIcon name="list" :size="24" /></template>
            <BaseButton aria-haspopup="dialog" @click="createOpen = true">
              <BaseIcon name="plus" /> {{ t('list.noLists.create') }}
            </BaseButton>
          </BaseEmptyState>

          <ListItems v-else-if="list" :list="list" :members="members" />
        </main>
      </div>
      <!-- ListItems puts the item form here on a wide screen (itemPanel.ts). -->
      <div :id="ITEM_PANEL_TARGET" class="panel-slot" />

      <ListNameDialog v-model:open="createOpen" :group-id="groupId" @created="openCreated" />
      <ListNameDialog
        v-if="renaming"
        :open="true"
        :group-id="groupId"
        :list="renaming"
        @update:open="renamingId = null"
      />
      <ListActionsDialog
        v-if="actionsFor"
        :open="true"
        :list="actionsFor"
        :can-delete="canDelete"
        @update:open="actionsId = null"
        @rename="startRename(actionsFor.id)"
      />
      <ArchivedListsDialog
        v-model:open="archiveOpen"
        :group-id="groupId"
        :lists="archived"
        :current-id="listKey"
      />
    </div>
  </AppFrame>
</template>

<style scoped>
.page,
.column {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.column {
  flex: 1;
  min-width: 0;
}

/* The panel inside is the flex item, not this wrapper. */
.panel-slot {
  display: contents;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: var(--space-4) var(--space-3) var(--space-8);
}

/* The quick-add bar brings its own space below. */
.content--bar {
  padding-bottom: 0;
}

.loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
}

.failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.failed p {
  margin: 0;
}

.failed-title {
  font-weight: var(--font-weight-black);
}

/* Desktop: the items at most 820px wide, like the header above. */
@media (min-width: 48rem) {
  .content,
  .content--bar {
    max-width: 51.25rem;
    padding: var(--space-5) var(--space-6) 3.5rem;
  }
}

/* Header and list in one column, the item panel next to it (design
   "markt2-desktop"). 79rem is ITEM_PANEL_QUERY in itemPanel.ts. */
@media (min-width: 79rem) {
  .page {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .column {
    flex: 999 1 35rem;
    align-self: stretch;
  }
}
</style>
