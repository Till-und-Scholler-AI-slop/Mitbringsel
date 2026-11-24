<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import DoneSection from '@/components/list/DoneSection.vue'
import ItemRow from '@/components/list/ItemRow.vue'
import QuickAddBar from '@/components/list/QuickAddBar.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useItemFormControl } from '@/composables/useItemFormControl'
import { useRemoveItems } from '@/composables/useRemoveItems'
import { useItemsStore } from '@/stores/items'
import { useRecentChangesStore } from '@/stores/recentChanges'
import type { GroupMember, Item, List } from '@/types/api'

// The items of the open list: quick-add bar, open and done items. The item
// form itself is ItemFormHost; this component only opens it through the
// control (useItemFormControl). Switching lists keeps typed quick-add text
// and the folded state.
const props = defineProps<{ list: List; members: GroupMember[] }>()

const { t } = useI18n()
const items = useItemsStore()
const recentChanges = useRecentChangesStore()
const { removeChecked } = useRemoveItems()
const { columnMode, editingId, formExpanded, startEdit, openNew } = useItemFormControl()

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
</script>

<template>
  <div class="list-items">
    <!-- First in the DOM and on the desktop, so it comes first for the
       keyboard; on the phone CSS moves it to the bottom of the screen. -->
    <QuickAddBar
      class="add-bar"
      :list-id="list.id"
      :opens-dialog="!columnMode"
      :pressed="columnMode ? formExpanded && editingId === null : undefined"
      @details="openNew"
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
          :editing="columnMode && editingId === item.id"
          :pending="items.isPending(item.id)"
          :opens-dialog="!columnMode"
          :selectable="columnMode"
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

/* Large screens: the gap between quick-add, list and done section, as between
   the chips above (80rem: CONTEXT_COLUMN_QUERY). */
@media (min-width: 80rem) {
  .list-items {
    gap: 1.375rem;
  }
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
