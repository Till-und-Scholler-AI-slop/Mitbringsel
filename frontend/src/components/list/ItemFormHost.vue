<script setup lang="ts">
import ItemFormDialog from '@/components/list/ItemFormDialog.vue'
import ItemFormPanel from '@/components/list/ItemFormPanel.vue'
import { useItemFormControl, type ItemFormPanelHandle } from '@/composables/useItemFormControl'
import type { GroupMember, Item, List } from '@/types/api'

// Shows the item form that the control has open (useItemFormControl): as a
// dialog, or on a wide screen as a panel. ListView places it next to the
// column of the list, so the panel becomes a column of its own.
const props = defineProps<{ list: List; members: GroupMember[] }>()

// Destructured, so the template unwraps the refs: only refs at the top level
// of <script setup> lose their .value there.
const { panelMode, panel, newItemOpen, newItemName, newItemKey, editing, close, removeEditing } =
  useItemFormControl()

// Who added the item; null if unknown (left the household).
function creatorOf(item: Item) {
  return props.members.find((m) => m.userId === item.createdBy)?.displayName ?? null
}

// A function ref, because the panel is handed to the control, not kept here.
function setPanel(instance: unknown) {
  panel.value = (instance as ItemFormPanelHandle | null) ?? null
}
</script>

<template>
  <template v-if="!panelMode">
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
  <!-- The key starts a new form for another item; a live change of the same
       item keeps what was typed. -->
  <ItemFormPanel
    v-else-if="newItemOpen || editing"
    :ref="setPanel"
    :key="editing ? editing.id : `new-${newItemKey}`"
    :list-id="list.id"
    :list-name="list.name"
    :initial-name="editing ? undefined : newItemName"
    :item="editing"
    :creator-name="editing ? creatorOf(editing) : undefined"
    @close="close"
    @remove="removeEditing"
  />
</template>
