<script setup lang="ts">
import ContextColumn from '@/components/list/ContextColumn.vue'
import ItemFormCard from '@/components/list/ItemFormCard.vue'
import ItemFormDialog from '@/components/list/ItemFormDialog.vue'
import OverviewCard from '@/components/list/OverviewCard.vue'
import { useContextOverview } from '@/composables/useContextOverview'
import {
  useItemFormControl,
  type ItemFormCardHandle,
  type OverviewCardHandle,
} from '@/composables/useItemFormControl'
import type { GroupMember, Item, List } from '@/types/api'

// Shows the item form of the control (useItemFormControl): as a dialog, or on
// a wide screen as a card in the context column, which ListView places as the
// second column of its grid. The card is always there; without a form opened
// it offers an empty one for a new item. Above it sits the overview card with
// the pinned list (if the household has a second list); one of the two cards
// is collapsed to a bar.
const props = defineProps<{ list: List; members: GroupMember[] }>()

// Destructured, so the template unwraps the refs: only refs at the top level
// of <script setup> lose their .value there.
const {
  columnMode,
  card,
  overviewCard,
  newItemOpen,
  newItemName,
  newItemKey,
  editing,
  formExpanded,
  close,
  removeEditing,
  expandForm,
  expandOverview,
} = useItemFormControl()
const { available: overviewAvailable } = useContextOverview()

// Who added the item; null if unknown (left the household).
function creatorOf(item: Item) {
  return props.members.find((m) => m.userId === item.createdBy)?.displayName ?? null
}

// A function ref, because the card is handed to the control, not kept here.
function setCard(instance: unknown) {
  card.value = (instance as ItemFormCardHandle | null) ?? null
}

function setOverviewCard(instance: unknown) {
  overviewCard.value = (instance as OverviewCardHandle | null) ?? null
}
</script>

<template>
  <template v-if="!columnMode">
    <ItemFormDialog
      :open="newItemOpen"
      :list-id="list.id"
      :list-name="list.name"
      :initial-name="newItemName"
      @update:open="!$event && close()"
    />
    <ItemFormDialog
      v-if="editing"
      :open="true"
      :list-id="list.id"
      :list-name="list.name"
      :item="editing"
      :creator-name="creatorOf(editing)"
      @update:open="close()"
      @remove="removeEditing"
    />
  </template>
  <ContextColumn v-else>
    <OverviewCard
      v-if="overviewAvailable"
      :ref="setOverviewCard"
      :collapsed="formExpanded"
      @expand="expandOverview"
      @collapse="expandForm"
    />
    <!-- The key starts a new form for another item or after closing; a live
         change of the same item keeps what was typed. -->
    <ItemFormCard
      :ref="setCard"
      :key="editing ? editing.id : `new-${newItemKey}`"
      :list="list"
      :item="editing"
      :initial-name="editing ? undefined : newItemName"
      :creator-name="editing ? creatorOf(editing) : undefined"
      :focus-on-mount="newItemOpen || editing !== undefined"
      :collapsed="!formExpanded"
      :collapsible="overviewAvailable"
      @close="close"
      @remove="removeEditing"
      @expand="expandForm"
      @collapse="expandOverview"
    />
  </ContextColumn>
</template>
