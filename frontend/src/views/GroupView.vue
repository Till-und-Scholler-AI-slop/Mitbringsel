<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import ListActionsDialog from '@/components/group/ListActionsDialog.vue'
import ListCard from '@/components/group/ListCard.vue'
import ListNameDialog from '@/components/group/ListNameDialog.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { canManage } from '@/services/groupRoles'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'

type ViewState = 'loading' | 'failed' | 'missing' | 'ready'

const props = defineProps<{ groupId: string }>()

const { t } = useI18n()
const router = useRouter()
const groups = useGroupsStore()
const lists = useListsStore()
const groupsError = useErrorMessage(() => groups.errorCode)
const listsError = useErrorMessage(() => lists.errorCodeOf(props.groupId))

const createOpen = ref(false)
const showArchived = ref(false)
// The list whose actions are open, and the list being renamed. Both are
// looked up again, so a list that is gone closes its dialog.
const selectedId = ref<string | null>(null)
const renamingId = ref<string | null>(null)

const group = computed(() => groups.byId(props.groupId))
const selected = computed(() => lists.byId(selectedId.value ?? ''))
const renaming = computed(() => lists.byId(renamingId.value ?? ''))
const canDelete = computed(() => group.value !== undefined && canManage(group.value.role))

const active = computed(() => lists.activeLists(props.groupId))
const archived = computed(() => lists.archivedLists(props.groupId))

// A group that is in the store is shown, even if the last reload failed.
// "missing": the groups loaded, and this one is not among them.
const state = computed<ViewState>(() => {
  if (group.value) return 'ready'
  if (groups.status === 'error') return 'failed'
  return groups.status === 'ready' ? 'missing' : 'loading'
})

const listsLoading = computed(
  () =>
    ['idle', 'loading'].includes(lists.statusOf(props.groupId)) &&
    lists.listsOf(props.groupId).length === 0,
)
const listsFailed = computed(
  () => lists.statusOf(props.groupId) === 'error' && lists.listsOf(props.groupId).length === 0,
)

// Coming from the start page the groups are there already; a direct visit
// of the URL has to load them first. The lists load for every visit, and
// again if the route switches to another household.
watch(
  () => props.groupId,
  (groupId) => {
    selectedId.value = null
    renamingId.value = null
    showArchived.value = false
    if (groups.status === 'idle') groups.load()
    lists.load(groupId)
  },
  { immediate: true },
)

function goHome() {
  return router.push({ name: 'home' })
}

// The actions dialog hands over to the name form.
function startRename(listId: string) {
  selectedId.value = null
  renamingId.value = listId
}
</script>

<template>
  <div class="group">
    <header class="bar">
      <div class="bar-top">
        <BaseIconButton icon="arrowLeft" :label="t('group.back')" @click="goHome" />
        <RouterLink
          class="settings"
          :to="{ name: 'group-settings', params: { groupId } }"
          :aria-label="t('group.settings')"
        >
          <BaseIcon name="settings" :size="22" />
        </RouterLink>
      </div>
      <h1 class="title">{{ group?.name ?? t('group.lists.title') }}</h1>
    </header>

    <main class="content">
      <p v-if="state === 'loading'" class="loading" role="status">
        <BaseSpinner /> {{ t('group.loading') }}
      </p>

      <div v-else-if="state === 'failed'" class="failed" role="alert">
        <p class="failed-title">{{ t('group.loadFailed') }}</p>
        <p>{{ groupsError }}</p>
        <BaseButton variant="secondary" @click="groups.load()">
          <BaseIcon name="retry" /> {{ t('common.retry') }}
        </BaseButton>
      </div>

      <BaseEmptyState
        v-else-if="state === 'missing'"
        :title="t('group.missing.title')"
        :description="t('group.missing.description')"
      >
        <template #icon><BaseIcon name="linkOff" :size="24" /></template>
        <BaseButton @click="goHome">{{ t('group.missing.home') }}</BaseButton>
      </BaseEmptyState>

      <section v-else class="lists" aria-labelledby="lists-title">
        <div class="section-head">
          <h2 id="lists-title" class="section-title">{{ t('group.lists.title') }}</h2>
          <BaseButton @click="createOpen = true">
            <BaseIcon name="plus" /> {{ t('group.lists.new') }}
          </BaseButton>
        </div>

        <p v-if="listsLoading" class="loading" role="status">
          <BaseSpinner /> {{ t('group.lists.loading') }}
        </p>

        <div v-else-if="listsFailed" class="failed" role="alert">
          <p class="failed-title">{{ t('group.lists.loadFailed') }}</p>
          <p>{{ listsError }}</p>
          <BaseButton variant="secondary" @click="lists.load(groupId)">
            <BaseIcon name="retry" /> {{ t('common.retry') }}
          </BaseButton>
        </div>

        <template v-else>
          <BaseEmptyState
            v-if="active.length === 0 && archived.length === 0"
            :title="t('group.lists.empty.title')"
            :description="t('group.lists.empty.description')"
          >
            <template #icon><BaseIcon name="list" :size="24" /></template>
          </BaseEmptyState>

          <ul v-if="active.length > 0" class="cards">
            <li v-for="list in active" :key="list.id">
              <ListCard :list="list" @act="selectedId = list.id" />
            </li>
          </ul>

          <div v-if="archived.length > 0" class="archived">
            <button
              type="button"
              class="archived-toggle"
              :aria-expanded="showArchived"
              aria-controls="archived-lists"
              @click="showArchived = !showArchived"
            >
              <BaseIcon :name="showArchived ? 'chevronDown' : 'chevronRight'" :size="18" />
              {{ t('group.lists.archived.toggle', { count: archived.length }) }}
            </button>
            <ul v-show="showArchived" id="archived-lists" class="cards">
              <li v-for="list in archived" :key="list.id">
                <ListCard :list="list" @act="selectedId = list.id" />
              </li>
            </ul>
          </div>
        </template>

        <ListNameDialog v-model:open="createOpen" :group-id="groupId" />
        <ListNameDialog
          v-if="renaming"
          :open="true"
          :group-id="groupId"
          :list="renaming"
          @update:open="renamingId = null"
        />
        <ListActionsDialog
          v-if="selected"
          :open="true"
          :list="selected"
          :can-delete="canDelete"
          @update:open="selectedId = null"
          @rename="startRename(selected.id)"
        />
      </section>
    </main>
  </div>
</template>

<style scoped>
.group {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4) var(--space-6);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.bar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Looks like BaseIconButton, but it is a link: it leads to another page. */
.settings {
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
}

.title {
  margin: 0;
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  letter-spacing: -0.03em;
  overflow-wrap: break-word;
}

.content {
  flex: 1;
  width: 100%;
  max-width: 56rem;
  margin: 0 auto;
  padding: var(--space-5) var(--space-4) var(--space-8);
}

.lists {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.section-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
}

.cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.archived {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.archived-toggle {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--space-2);
  min-height: var(--size-touch);
  padding: 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-weight: var(--font-weight-heavy);
  cursor: pointer;
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
</style>
