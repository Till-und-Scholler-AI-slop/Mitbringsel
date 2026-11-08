import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { listsService, type ListsService } from '@/services/api/lists'
import { useAuthStore } from '@/stores/auth'
import type { List } from '@/types/api'

/** idle: not loaded yet. error: the last load failed (lists may still be shown). */
export type ListsStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The lists of one group and how loading them went. */
interface GroupLists {
  lists: List[]
  status: ListsStatus
  errorCode: string | null
}

/**
 * Builds the store around a service and a getter for the ID of the signed-in
 * user, like defineGroupsStore. The store forgets everything when that ID
 * changes (logout, expired session, another user), so nobody ever sees the
 * lists of the previous user.
 *
 * The store keeps the lists of each group apart, as a screen shows one group
 * at a time. It always loads archived lists, too, and tells them apart
 * locally (activeLists, archivedLists): one request serves both views.
 *
 * Reading never throws: load() sets the status and error code of the group.
 * The writing actions reject with the ApiError instead, so the dialog that
 * started them can show the message next to its form.
 */
export function defineListsStore(service: ListsService, currentUserId: () => string | null) {
  return defineStore('lists', () => {
    const byGroup = ref<Record<string, GroupLists>>({})

    // Bumped by reset(). A load that started before it is outdated when it
    // answers and must not put the old user's lists back.
    let generation = 0

    function reset() {
      generation++
      byGroup.value = {}
    }

    watch(currentUserId, reset)

    // The entry of a group, created on first use. Reading functions below do
    // not create one, so looking at a group does not change the state.
    function ensure(groupId: string): GroupLists {
      byGroup.value[groupId] ??= { lists: [], status: 'idle', errorCode: null }
      return byGroup.value[groupId]
    }

    /** All lists of the group, archived ones included, oldest first. */
    function listsOf(groupId: string): List[] {
      return byGroup.value[groupId]?.lists ?? []
    }

    /** The lists of the group that are not archived, oldest first. */
    function activeLists(groupId: string): List[] {
      return listsOf(groupId).filter((list) => list.archivedAt === null)
    }

    /** The archived lists of the group, oldest first. */
    function archivedLists(groupId: string): List[] {
      return listsOf(groupId).filter((list) => list.archivedAt !== null)
    }

    function statusOf(groupId: string): ListsStatus {
      return byGroup.value[groupId]?.status ?? 'idle'
    }

    function errorCodeOf(groupId: string): string | null {
      return byGroup.value[groupId]?.errorCode ?? null
    }

    /** Finds a list in any group that was loaded. */
    function byId(listId: string): List | undefined {
      for (const entry of Object.values(byGroup.value)) {
        const found = entry.lists.find((list) => list.id === listId)
        if (found) {
          return found
        }
      }
      return undefined
    }

    /**
     * Loads the lists of a group, archived ones included. If this fails, the
     * lists loaded before stay: an unreachable server should not empty the
     * screen.
     */
    async function load(groupId: string) {
      const started = generation
      const entry = ensure(groupId)
      entry.status = 'loading'
      entry.errorCode = null
      try {
        const loaded = await service.list(groupId, { includeArchived: true })
        if (started !== generation) {
          return
        }
        entry.lists = loaded
        entry.status = 'ready'
      } catch (err) {
        if (started !== generation) {
          return
        }
        entry.status = 'error'
        entry.errorCode = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    /** Creates a list and returns it, so the caller can open it. */
    async function create(groupId: string, name: string): Promise<List> {
      const list = await service.create(groupId, name)
      ensure(groupId).lists.push(list)
      return list
    }

    async function rename(listId: string, name: string) {
      replace(await service.rename(listId, name))
    }

    async function archive(listId: string) {
      replace(await service.setArchived(listId, true))
    }

    async function unarchive(listId: string) {
      replace(await service.setArchived(listId, false))
    }

    async function remove(listId: string) {
      // Looked up first: the list is gone from the answer, and the group is
      // needed to drop it from the right place.
      const groupId = byId(listId)?.groupId
      await service.remove(listId)
      if (groupId !== undefined) {
        const entry = ensure(groupId)
        entry.lists = entry.lists.filter((list) => list.id !== listId)
      }
    }

    // The answer of the server is the truth, so it replaces the local copy.
    function replace(list: List) {
      const entry = byGroup.value[list.groupId]
      const index = entry?.lists.findIndex((l) => l.id === list.id) ?? -1
      if (entry && index !== -1) {
        entry.lists[index] = list
      }
    }

    return {
      listsOf,
      activeLists,
      archivedLists,
      statusOf,
      errorCodeOf,
      byId,
      load,
      create,
      rename,
      archive,
      unarchive,
      remove,
    }
  })
}

export const useListsStore = defineListsStore(listsService, () => useAuthStore().user?.id ?? null)
