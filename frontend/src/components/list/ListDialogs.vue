<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import ArchivedListsDialog from '@/components/list/ArchivedListsDialog.vue'
import ListActionsDialog from '@/components/list/ListActionsDialog.vue'
import ListNameDialog from '@/components/list/ListNameDialog.vue'
import { canManage } from '@/services/groupRoles'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

// The dialogs for the lists of a household: create, rename, the actions of a
// list and the archive. The view opens them through the functions below
// (defineExpose) and leaves the rest to this component. Switching the
// household or list closes all of them.
const props = defineProps<{ groupId: string; currentId: string }>()

const router = useRouter()
const groups = useGroupsStore()
const lists = useListsStore()

const createOpen = ref(false)
const archiveOpen = ref(false)
// The list whose actions are open, and the one being renamed; at most one
// of the two is set.
const actionsId = ref<string | null>(null)
const renamingId = ref<string | null>(null)

const actionsFor = computed(() => lists.byId(actionsId.value ?? ''))
const renaming = computed(() => lists.byId(renamingId.value ?? ''))
const archived = computed(() => lists.archivedLists(props.groupId))
const canDelete = computed(() => {
  const group = groups.byId(props.groupId)
  return group !== undefined && canManage(group.role)
})

watch([() => props.groupId, () => props.currentId], () => {
  actionsId.value = null
  renamingId.value = null
  archiveOpen.value = false
})

function startRename(listId: string) {
  actionsId.value = null
  renamingId.value = listId
}

function openCreated(created: List) {
  return router.push({ name: 'list', params: { groupId: props.groupId, listId: created.id } })
}

defineExpose({
  openCreate: () => {
    createOpen.value = true
  },
  openActions: (listId: string) => {
    actionsId.value = listId
  },
  openArchive: () => {
    archiveOpen.value = true
  },
})
</script>

<template>
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
    :current-id="currentId"
  />
</template>
