<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import DoneSection from '@/components/list/DoneSection.vue'
import ItemFormDialog from '@/components/list/ItemFormDialog.vue'
import ItemFormPanel from '@/components/list/ItemFormPanel.vue'
import { ITEM_PANEL_QUERY, ITEM_PANEL_TARGET } from '@/components/list/itemPanel'
import ItemRow from '@/components/list/ItemRow.vue'
import QuickAddBar from '@/components/list/QuickAddBar.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useRemoveItems } from '@/composables/useRemoveItems'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import { useRecentChangesStore } from '@/stores/recentChanges'
import { useToastsStore } from '@/stores/toasts'
import type { GroupMember, Item, List } from '@/types/api'

// The items of the open list: quick-add bar, open and done items, and the
// item form to add details or edit: a dialog, or on a wide screen a panel
// next to the list. Switching lists closes the form while keeping typed
// quick-add text and the folded state.
const props = defineProps<{ list: List; members: GroupMember[] }>()

const { t } = useI18n()
const groups = useGroupsStore()
const items = useItemsStore()
const lists = useListsStore()
const recentChanges = useRecentChangesStore()
const toasts = useToastsStore()
const { removeChecked, removeItem } = useRemoveItems()

const panelMode = useMediaQuery(ITEM_PANEL_QUERY)
const panel = ref<InstanceType<typeof ItemFormPanel> | null>(null)
// Where the focus goes back to when the panel closes. A dialog does that
// itself; the panel is no dialog.
let opener: HTMLElement | null = null

// The item form for a new item, with the name typed into the quick-add bar.
// The key changes with every opening, so the panel starts afresh even if it
// was open already.
const newItemOpen = ref(false)
const newItemName = ref('')
const newItemKey = ref(0)
// The item whose form is open, and its name for the case that someone else
// deletes it meanwhile.
const editingId = ref<string | null>(null)
let editingName = ''
const editing = computed(() => (editingId.value ? items.byId(editingId.value) : undefined))
const itemsError = useErrorMessage(() => items.errorCodeOf(props.list.id))

const open = computed(() => items.openItems(props.list.id))
const done = computed(() => items.checkedItems(props.list.id))
const itemsLoading = computed(
  () =>
    ['idle', 'loading'].includes(items.statusOf(props.list.id)) &&
    items.itemsOf(props.list.id).length === 0,
)
const itemsFailed = computed(
  () => items.statusOf(props.list.id) === 'error' && items.itemsOf(props.list.id).length === 0,
)
const isEmpty = computed(
  () => items.statusOf(props.list.id) === 'ready' && items.itemsOf(props.list.id).length === 0,
)

// Who added an open item, who checked a done one; null if unknown.
function personOf(item: Item) {
  const id = item.checked ? item.checkedBy : item.createdBy
  const member = props.members.find((m) => m.userId === id)
  return member ? { name: member.displayName, avatarUrl: member.avatarUrl } : null
}

// Who else just changed an item; the name is null for a member we do not
// know yet (joined after the household was loaded).
function recentOf(item: Item) {
  const id = recentChanges.changedBy(item.id)
  if (!id) return null
  return { name: props.members.find((m) => m.userId === id)?.displayName ?? null }
}

function toggle(item: Item) {
  void items.setChecked(item.id, !item.checked)
}

// Who added the item; null if unknown (left the household).
function creatorOf(item: Item) {
  return props.members.find((m) => m.userId === item.createdBy)?.displayName ?? null
}

// The panel stays open while the list is used beside it, so opening the form
// for something else just switches it.
function rememberOpener() {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) opener = active
}

function startEdit(item: Item) {
  rememberOpener()
  newItemOpen.value = false
  if (editingId.value === item.id) {
    panel.value?.focusName()
    return
  }
  editingName = item.name
  editingId.value = item.id
}

function openNewItem(name: string) {
  rememberOpener()
  editingId.value = null
  newItemName.value = name
  newItemKey.value++
  newItemOpen.value = true
}

// Only for the panel: the focus goes back to where the form was opened from,
// if that is still there (a deleted item takes its row along).
async function closePanel() {
  newItemOpen.value = false
  editingId.value = null
  const target = opener
  opener = null
  await nextTick()
  if (target?.isConnected) target.focus()
}

// Deleting closes the form; the list offers undo in a toast.
function removeEditing(fromKeyboard: boolean) {
  const id = editingId.value
  if (panelMode.value) void closePanel()
  else editingId.value = null
  if (id) removeItem(id, fromKeyboard)
}

// Registered before watch(editing) so switching lists clears editingId
// before editing becomes undefined and would show the deleted toast.
watch(
  () => props.list.id,
  () => {
    newItemOpen.value = false
    editingId.value = null
  },
)

// Someone else deleted the item while its form was open: the form has
// nothing left to save, so it closes and says why. If the list or household
// itself went away, their own toast explains it instead.
watch(editing, (now, before) => {
  if (
    before &&
    !now &&
    editingId.value &&
    !lists.deletionOf(props.list.id) &&
    !groups.departureOf(props.list.groupId)
  ) {
    editingId.value = null
    toasts.show({ kind: 'info', text: t('list.itemForm.deletedMeanwhile', { name: editingName }) })
  }
})
</script>

<template>
  <div class="list-items">
    <!-- First in the DOM and on the desktop, so it comes first for the
       keyboard; on the phone CSS moves it to the bottom of the screen. -->
    <QuickAddBar
      class="add-bar"
      :list-id="list.id"
      :opens-dialog="!panelMode"
      @details="openNewItem"
    />

    <p v-if="list.archivedAt" class="archived">
      <BaseIcon name="archive" :size="18" /> {{ t('list.archivedBadge') }}
    </p>

    <p v-if="itemsLoading" class="loading" role="status">
      <BaseSpinner /> {{ t('list.items.loading') }}
    </p>

    <div v-else-if="itemsFailed" class="failed" role="alert">
      <p class="failed-title">{{ t('list.items.loadFailed') }}</p>
      <p>{{ itemsError }}</p>
      <BaseButton variant="secondary" @click="items.load(list.id)">
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
          :editing="panelMode && editingId === item.id"
          :opens-dialog="!panelMode"
          @toggle="toggle(item)"
          @edit="startEdit(item)"
        />
      </ul>

      <DoneSection
        v-if="done.length > 0"
        :items="done"
        :person-of="personOf"
        @toggle="toggle"
        @remove="removeChecked(list.id, $event)"
      />
    </template>

    <template v-if="!panelMode">
      <ItemFormDialog
        v-model:open="newItemOpen"
        :list-id="list.id"
        :list-name="list.name"
        :initial-name="newItemName"
      />
      <ItemFormDialog
        v-if="editing"
        :open="true"
        :list-id="list.id"
        :list-name="list.name"
        :item="editing"
        :creator-name="creatorOf(editing)"
        @update:open="editingId = null"
        @remove="removeEditing"
      />
    </template>
    <!-- defer: the target is rendered by ListView in the same pass. The key
       starts a new form for another item; a live change of the same item
       keeps what was typed. -->
    <Teleport v-else-if="newItemOpen || editing" defer :to="`#${ITEM_PANEL_TARGET}`">
      <ItemFormPanel
        ref="panel"
        :key="editing ? editing.id : `new-${newItemKey}`"
        :list-id="list.id"
        :list-name="list.name"
        :initial-name="editing ? undefined : newItemName"
        :item="editing"
        :creator-name="editing ? creatorOf(editing) : undefined"
        @close="closePanel"
        @remove="removeEditing"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.list-items {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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

.failed-title {
  font-weight: var(--font-weight-black);
}

@media (min-width: 48rem) {
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
