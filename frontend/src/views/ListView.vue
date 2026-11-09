<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import ArchivedListsDialog from '@/components/list/ArchivedListsDialog.vue'
import ItemRow from '@/components/list/ItemRow.vue'
import ListActionsDialog from '@/components/list/ListActionsDialog.vue'
import ListChips from '@/components/list/ListChips.vue'
import ListNameDialog from '@/components/list/ListNameDialog.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { canManage } from '@/services/groupRoles'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import type { Item, List } from '@/types/api'

type ViewState = 'loading' | 'failed' | 'missing' | 'ready'

const MAX_AVATARS = 4
const AVATAR_SIZE = 30

const props = defineProps<{ groupId: string; listId: string }>()

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
const doneOpen = ref(true)
// The error of the last tap on a checkbox that failed; the tap itself has
// been undone by the store.
const checkErrorCode = ref<string | null>(null)
const checkError = useErrorMessage(checkErrorCode)
const listsError = useErrorMessage(() => lists.errorCodeOf(props.groupId))
const itemsError = useErrorMessage(() => items.errorCodeOf(props.listId))

const group = computed(() => groups.byId(props.groupId))
// A list of another household under this URL counts as not found.
const list = computed<List | undefined>(() => {
  const found = lists.byId(props.listId)
  return found?.groupId === props.groupId ? found : undefined
})

const actionsFor = computed(() => lists.byId(actionsId.value ?? ''))
const renaming = computed(() => lists.byId(renamingId.value ?? ''))
const canDelete = computed(() => group.value !== undefined && canManage(group.value.role))
const archived = computed(() => lists.archivedLists(props.groupId))

const state = computed<ViewState>(() => {
  if (list.value) return 'ready'
  const status = lists.statusOf(props.groupId)
  if (status === 'error') return 'failed'
  return status === 'ready' ? 'missing' : 'loading'
})

const open = computed(() => items.openItems(props.listId))
const done = computed(() => items.checkedItems(props.listId))
const itemsLoading = computed(
  () =>
    ['idle', 'loading'].includes(items.statusOf(props.listId)) &&
    items.itemsOf(props.listId).length === 0,
)
const itemsFailed = computed(
  () => items.statusOf(props.listId) === 'error' && items.itemsOf(props.listId).length === 0,
)
const isEmpty = computed(
  () => items.statusOf(props.listId) === 'ready' && items.itemsOf(props.listId).length === 0,
)

const members = computed(() => group.value?.members ?? [])
const shownMembers = computed(() => members.value.slice(0, MAX_AVATARS))
const memberNames = computed(() => members.value.map((m) => m.displayName).join(', '))

// Who added an open item, who checked a done one; null if unknown.
function personOf(item: Item) {
  const id = item.checked ? item.checkedBy : item.createdBy
  const member = members.value.find((m) => m.userId === id)
  return member ? { name: member.displayName, avatarUrl: member.avatarUrl } : null
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
    if (groups.status === 'idle') groups.load()
    if (lists.statusOf(groupId) === 'idle') lists.load(groupId)
    items.load(listId)
  },
  { immediate: true },
)

async function toggle(item: Item) {
  try {
    await items.setChecked(item.id, !item.checked)
    checkErrorCode.value = null
  } catch (err) {
    checkErrorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  }
}

// The open list was deleted: go on with the first active list, or with the
// household if none is left. A new URL with an unknown list is not a
// deletion; that one shows "not found".
watch([() => props.listId, list], ([listId, now], [listIdBefore, before]) => {
  if (!before || now || listId !== listIdBefore) return
  const next = lists.activeLists(props.groupId)[0]
  router.replace(
    next
      ? { name: 'list', params: { groupId: props.groupId, listId: next.id } }
      : { name: 'group', params: { groupId: props.groupId } },
  )
})

function startRename(listId: string) {
  actionsId.value = null
  renamingId.value = listId
}

function openCreated(created: List) {
  return router.push({ name: 'list', params: { groupId: props.groupId, listId: created.id } })
}
</script>

<template>
  <div class="page">
    <header class="bar">
      <RouterLink class="home" :to="{ name: 'home' }"><BrandLogo /></RouterLink>

      <div v-if="group" class="household">
        <RouterLink
          class="group-link"
          :to="{ name: 'group', params: { groupId } }"
          :aria-label="t('list.groupLink', { name: group.name })"
        >
          <span class="group-name">{{ group.name }}</span>
          <BaseIcon name="chevronRight" :size="24" :stroke-width="2.5" />
        </RouterLink>
        <span
          class="members"
          role="img"
          :aria-label="t('list.membersLabel', { names: memberNames })"
        >
          <BaseAvatar
            v-for="member in shownMembers"
            :key="member.userId"
            class="member"
            :name="member.displayName"
            :src="member.avatarUrl"
            :size="AVATAR_SIZE"
          />
        </span>
      </div>

      <ListChips
        v-if="list"
        :group-id="groupId"
        :lists="lists.activeLists(groupId)"
        :current-id="listId"
        :open-count="open.length"
        :archived-count="archived.length"
        :current-archived="list.archivedAt !== null"
        @create="createOpen = true"
        @actions="actionsId = $event.id"
        @archive="archiveOpen = true"
      />
    </header>

    <main class="content">
      <h1 v-if="list" class="sr-only">{{ list.name }}</h1>

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

      <template v-else>
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
          <BaseButton variant="secondary" @click="items.load(listId)">
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
              @toggle="toggle(item)"
            />
          </ul>

          <section
            v-if="done.length > 0"
            class="done"
            :aria-label="t('list.done.title', { count: done.length })"
          >
            <button
              type="button"
              class="done-toggle"
              :aria-expanded="doneOpen"
              aria-controls="done-items"
              @click="doneOpen = !doneOpen"
            >
              <BaseIcon :name="doneOpen ? 'chevronUp' : 'chevronDown'" :size="20" />
              {{ t('list.done.title', { count: done.length }) }}
            </button>
            <ul v-show="doneOpen" id="done-items" class="done-items">
              <ItemRow
                v-for="item in done"
                :key="item.id"
                :item="item"
                :person="personOf(item)"
                @toggle="toggle(item)"
              />
            </ul>
          </section>
        </template>
      </template>
    </main>

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
      :current-id="listId"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.home {
  align-self: flex-start;
  display: flex;
  align-items: center;
  min-height: var(--size-touch);
  text-decoration: none;
}

.household {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.group-link {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--size-touch);
  color: inherit;
  text-decoration: none;
}

.group-name {
  min-width: 0;
  overflow: hidden;
  font-size: 1.6875rem;
  font-weight: var(--font-weight-display);
  line-height: 2rem;
  letter-spacing: -0.025em;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.open,
.done-items {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.open {
  gap: var(--space-1-5);
}

.done {
  padding: var(--space-1) 0 var(--space-2);
  border: var(--border-width-sm) solid var(--color-done-border);
  border-radius: var(--radius-lg);
  background: var(--color-done-bg);
}

.done-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-height: var(--size-touch);
  padding: 0 var(--space-3) 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  cursor: pointer;
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
</style>
