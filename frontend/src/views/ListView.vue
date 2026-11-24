<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppFrame from '@/components/layout/AppFrame.vue'
import ItemFormHost from '@/components/list/ItemFormHost.vue'
import ListChips from '@/components/list/ListChips.vue'
import ListDialogs from '@/components/list/ListDialogs.vue'
import ListHeader from '@/components/list/ListHeader.vue'
import ListItems from '@/components/list/ListItems.vue'
import ListStateNotice, { type ListNoticeState } from '@/components/list/ListStateNotice.vue'
import { provideContextOverview } from '@/composables/useContextOverview'
import { provideItemFormControl } from '@/composables/useItemFormControl'
import { useLeaveDeletedList } from '@/composables/useLeaveDeletedList'
import { useLeaveRemovedGroup } from '@/composables/useLeaveRemovedGroup'
import { listToOpen, rememberLastList } from '@/services/lastList'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

// ready: a list is open; otherwise ListStateNotice says why not.
type ViewState = ListNoticeState | 'ready'

// Without listId (the route of the household) the view opens the last or
// first active list, or offers to create one.
const props = defineProps<{ groupId: string; listId?: string }>()

const router = useRouter()
const groups = useGroupsStore()
const lists = useListsStore()
const items = useItemsStore()

// The list dialogs; opened through their exposed functions.
const dialogs = ref<InstanceType<typeof ListDialogs> | null>(null)
// Empty while there is no listId in the URL.
const listKey = computed(() => props.listId ?? '')

const group = computed(() => groups.byId(props.groupId))
// A list of another household under this URL counts as not found.
const list = computed<List | undefined>(() => {
  if (!props.listId) return undefined
  const found = lists.byId(props.listId)
  return found?.groupId === props.groupId ? found : undefined
})

// The overview card of the context column; its pinned list is marked in the
// sidebar.
const overview = provideContextOverview(
  () => props.groupId,
  () => list.value,
)

// The item form of this screen; ListItems opens it, ItemFormHost shows it.
// columnMode: from the width of the context column on, the chips sit in the
// list column instead of the header.
// There is no overview card to show yet, so the form card is always open.
const { columnMode } = provideItemFormControl(
  () => list.value,
  () => false,
)

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

// The chips render in the header or, in column mode, at the top of the list
// column; one instance at a time, so both places share these bindings.
const chipsShown = computed(() => list.value !== undefined || state.value === 'noLists')
const chipProps = computed(() => ({
  groupId: props.groupId,
  lists: active.value,
  currentId: listKey.value,
  openCount: openCount.value,
  archivedCount: archived.value.length,
  currentArchived: list.value?.archivedAt != null,
}))
const chipListeners = {
  create: () => dialogs.value?.openCreate(),
  actions: (target: List) => dialogs.value?.openActions(target.id),
  archive: () => dialogs.value?.openArchive(),
}
const members = computed(() => group.value?.members ?? [])

// A direct visit of the URL has to load what the screens before would have
// loaded. The lists of the household load once; the items for every list.
watch(
  [() => props.groupId, () => props.listId],
  ([groupId, listId]) => {
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
</script>

<template>
  <AppFrame
    :group-id="groupId"
    :list-id="listId"
    :pinned-list-id="overview.sidebarPinId.value"
    :bottom-bar="list !== undefined"
    @list-actions="dialogs?.openActions($event.id)"
  >
    <div class="page">
      <ListHeader class="header" :group="group">
        <ListChips v-if="chipsShown && !columnMode" v-bind="chipProps" v-on="chipListeners" />
      </ListHeader>

      <main class="content" :class="{ 'content--bar': list }">
        <h1 v-if="list" class="sr-only">{{ list.name }}</h1>
        <h1 v-else-if="group" class="sr-only">{{ group.name }}</h1>

        <ListChips v-if="chipsShown && columnMode" v-bind="chipProps" v-on="chipListeners" />

        <ListItems v-if="list" :list="list" :members="members" />
        <ListStateNotice
          v-else-if="state !== 'ready'"
          :state="state"
          :group-id="groupId"
          @create="dialogs?.openCreate()"
        />
      </main>
      <!-- On a wide screen the context column next to the list. -->
      <ItemFormHost v-if="list" :list="list" :members="members" />

      <ListDialogs ref="dialogs" :group-id="groupId" :current-id="listKey" />
    </div>
  </AppFrame>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
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

/* Desktop: the items at most 820px wide, like the header above. */
@media (min-width: 48rem) {
  .content,
  .content--bar {
    max-width: 51.25rem;
    padding: var(--space-5) var(--space-6) 3.5rem;
  }
}

/* Large screens (design "markt2-kontext-*", ADR 0008): the header across
   the list and the context column (ItemFormHost) next to the list. 80rem is
   CONTEXT_COLUMN_QUERY in contextColumn.ts. */
@media (min-width: 80rem) {
  .page {
    display: grid;
    grid-template-columns: minmax(0, 51.25rem) 27.5rem;
    grid-template-rows: auto 1fr;
    justify-content: center;
    align-content: start;
    column-gap: var(--space-8);
    row-gap: 1.375rem;
    padding: 2.5rem var(--space-8) 3.5rem;
  }

  .header {
    grid-column: 1 / -1;
  }

  .content,
  .content--bar {
    grid-column: 1;
    grid-row: 2;
    max-width: none;
    margin: 0;
    padding: 0;
    gap: 1.375rem;
  }
}

/* WQHD: wider columns; base.css scales everything by 1.1 from here. */
@media (min-width: 137.5rem) {
  .page {
    grid-template-columns: minmax(0, 53.75rem) 30rem;
  }
}
</style>
