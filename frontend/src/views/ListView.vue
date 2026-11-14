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
import DoneSection from '@/components/list/DoneSection.vue'
import ItemFormDialog from '@/components/list/ItemFormDialog.vue'
import ItemRow from '@/components/list/ItemRow.vue'
import ListActionsDialog from '@/components/list/ListActionsDialog.vue'
import ListChips from '@/components/list/ListChips.vue'
import ListHeader from '@/components/list/ListHeader.vue'
import ListNameDialog from '@/components/list/ListNameDialog.vue'
import QuickAddBar from '@/components/list/QuickAddBar.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useLeaveRemovedGroup } from '@/composables/useLeaveRemovedGroup'
import { useRemoveItems } from '@/composables/useRemoveItems'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { canManage } from '@/services/groupRoles'
import { listToOpen, rememberLastList } from '@/services/lastList'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import { useRecentChangesStore } from '@/stores/recentChanges'
import { useToastsStore } from '@/stores/toasts'
import type { Item, List } from '@/types/api'

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
const recentChanges = useRecentChangesStore()
const toasts = useToastsStore()
const { removeChecked, removeItem } = useRemoveItems()

const createOpen = ref(false)
const archiveOpen = ref(false)
// The item form for a new item, with the name typed into the quick-add bar.
const newItemOpen = ref(false)
const newItemName = ref('')
// The item whose form is open, and its name for the case that someone else
// deletes it meanwhile.
const editingId = ref<string | null>(null)
let editingName = ''
const editing = computed(() => (editingId.value ? items.byId(editingId.value) : undefined))
// The list whose actions are open, and the one being renamed; at most one
// of the two is set.
const actionsId = ref<string | null>(null)
const renamingId = ref<string | null>(null)
// The error of the last tap on a checkbox that failed; the tap itself has
// been undone by the store.
const checkErrorCode = ref<string | null>(null)
const checkError = useErrorMessage(checkErrorCode)
const listsError = useErrorMessage(() => lists.errorCodeOf(props.groupId))
// The items below belong to no list while there is none.
const listKey = computed(() => props.listId ?? '')
const itemsError = useErrorMessage(() => items.errorCodeOf(listKey.value))

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

const open = computed(() => items.openItems(listKey.value))
const done = computed(() => items.checkedItems(listKey.value))
const itemsLoading = computed(
  () =>
    ['idle', 'loading'].includes(items.statusOf(listKey.value)) &&
    items.itemsOf(listKey.value).length === 0,
)
const itemsFailed = computed(
  () => items.statusOf(listKey.value) === 'error' && items.itemsOf(listKey.value).length === 0,
)
const isEmpty = computed(
  () => items.statusOf(listKey.value) === 'ready' && items.itemsOf(listKey.value).length === 0,
)

const members = computed(() => group.value?.members ?? [])

// Who added an open item, who checked a done one; null if unknown.
function personOf(item: Item) {
  const id = item.checked ? item.checkedBy : item.createdBy
  const member = members.value.find((m) => m.userId === id)
  return member ? { name: member.displayName, avatarUrl: member.avatarUrl } : null
}

// Who else just changed an item; the name is null for a member we do not
// know yet (joined after the household was loaded).
function recentOf(item: Item) {
  const id = recentChanges.changedBy(item.id)
  if (!id) return null
  return { name: members.value.find((m) => m.userId === id)?.displayName ?? null }
}

// A direct visit of the URL has to load what the screens before would have
// loaded. The lists of the household load once; the items for every list.
watch(
  [() => props.groupId, () => props.listId],
  ([groupId, listId]) => {
    checkErrorCode.value = null
    actionsId.value = null
    renamingId.value = null
    archiveOpen.value = false
    newItemOpen.value = false
    editingId.value = null
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

async function toggle(item: Item) {
  try {
    await items.setChecked(item.id, !item.checked)
    checkErrorCode.value = null
  } catch (err) {
    checkErrorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  }
}

// The open list was deleted: go on with the household, which opens the
// first active list or offers to create one. A new URL with an unknown list
// is not a deletion; that one shows "not found". If the household went with
// it, useLeaveRemovedGroup goes to the start page instead.
watch(
  [() => props.listId, list, group],
  ([listId, now, groupNow], [listIdBefore, before, groupBefore]) => {
    if (!before || now || listId !== listIdBefore) return
    if (groupBefore && !groupNow) return
    router.replace({ name: 'group', params: { groupId: props.groupId } })
  },
)

useLeaveRemovedGroup(() => props.groupId)

// Who added the item; null if unknown (left the household).
function creatorOf(item: Item) {
  return members.value.find((m) => m.userId === item.createdBy)?.displayName ?? null
}

function startEdit(item: Item) {
  editingName = item.name
  editingId.value = item.id
}

// Deleting closes the form; the list offers undo in a toast.
function removeEditing(fromKeyboard: boolean) {
  const id = editingId.value
  editingId.value = null
  if (id) removeItem(id, fromKeyboard)
}

// Someone else deleted the item while its form was open: the form has
// nothing left to save, so it closes and says why.
watch(editing, (now, before) => {
  if (before && !now && editingId.value) {
    editingId.value = null
    toasts.show({ kind: 'info', text: t('list.itemForm.deletedMeanwhile', { name: editingName }) })
  }
})

function openNewItem(name: string) {
  newItemName.value = name
  newItemOpen.value = true
}

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
      <ListHeader :group="group">
        <ListChips
          v-if="list || state === 'noLists'"
          :group-id="groupId"
          :lists="active"
          :current-id="listKey"
          :open-count="open.length"
          :archived-count="archived.length"
          :current-archived="list?.archivedAt != null"
          @create="createOpen = true"
          @actions="actionsId = $event.id"
          @archive="archiveOpen = true"
        />
      </ListHeader>

      <main class="content">
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

        <template v-else>
          <!-- First in the DOM and on the desktop, so it comes first for the
             keyboard; on the phone CSS moves it to the bottom of the screen. -->
          <QuickAddBar v-if="list" class="add-bar" :list-id="list.id" @details="openNewItem" />

          <p v-if="list?.archivedAt" class="archived">
            <BaseIcon name="archive" :size="18" /> {{ t('list.archivedBadge') }}
          </p>

          <p v-if="checkErrorCode" class="failed failed--inline" role="alert">
            <span class="failed-title">{{ t('list.checkFailed') }}</span>
            {{ checkError }}
          </p>

          <p v-if="itemsLoading" class="loading" role="status">
            <BaseSpinner /> {{ t('list.items.loading') }}
          </p>

          <div v-else-if="itemsFailed" class="failed" role="alert">
            <p class="failed-title">{{ t('list.items.loadFailed') }}</p>
            <p>{{ itemsError }}</p>
            <BaseButton variant="secondary" @click="items.load(listKey)">
              <BaseIcon name="retry" /> {{ t('common.retry') }}
            </BaseButton>
          </div>

          <BaseEmptyState
            v-else-if="isEmpty"
            :title="t('list.empty.title')"
            :description="t('list.empty.description')"
          >
            <template #icon><BaseIcon name="cart" :size="24" /></template>
          </BaseEmptyState>

          <template v-else>
            <ul v-if="open.length > 0" class="open">
              <ItemRow
                v-for="item in open"
                :key="item.id"
                :item="item"
                :person="personOf(item)"
                :recent="recentOf(item)"
                @toggle="toggle(item)"
                @edit="startEdit(item)"
              />
            </ul>

            <DoneSection
              v-if="done.length > 0"
              :items="done"
              :person-of="personOf"
              @toggle="toggle"
              @remove="removeChecked(listKey, $event)"
            />
          </template>
        </template>
      </main>

      <ItemFormDialog
        v-if="list"
        v-model:open="newItemOpen"
        :list-id="list.id"
        :list-name="list.name"
        :initial-name="newItemName"
      />
      <ItemFormDialog
        v-if="list && editing"
        :open="true"
        :list-id="list.id"
        :list-name="list.name"
        :item="editing"
        :creator-name="creatorOf(editing)"
        @update:open="editingId = null"
        @remove="removeEditing"
      />
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
.content:has(> .add-bar) {
  padding-bottom: 0;
}

/* Phone: at the bottom of the screen, near the thumb, over the items that
   scroll past below it; at the end of a short list it sits at the bottom
   anyway (margin-top: auto). */
.add-bar {
  order: 1;
  position: sticky;
  bottom: 0;
  z-index: 1;
  margin: auto calc(-1 * var(--space-3)) 0;
  padding: 10px var(--space-3) calc(var(--space-5) + env(safe-area-inset-bottom));
  background: var(--color-bg);
}

.open {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.archived {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-1) var(--space-3);
  border: var(--border-width-sm) dashed var(--color-border);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
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

.failed--inline {
  gap: var(--space-1);
}

.failed-title {
  font-weight: var(--font-weight-black);
}

/* Desktop: the items at most 820px wide, like the header above. */
@media (min-width: 48rem) {
  .content,
  .content:has(> .add-bar) {
    max-width: 51.25rem;
    padding: var(--space-5) var(--space-6) 3.5rem;
  }

  /* Above the list, where the design puts it. */
  .add-bar {
    order: 0;
    position: static;
    margin: 0;
    padding: 0;
    background: transparent;
  }
}
</style>
