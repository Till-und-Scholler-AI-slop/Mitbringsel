import { onScopeDispose, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { listsService, type ListsService } from '@/services/api/lists'
import { localData, type LocalData } from '@/services/storage/localData'
import { createPersistQueue } from '@/services/storage/persistQueue'
import { liveSocket, type ServerEvents } from '@/services/sync/socket'
import { useAuthStore } from '@/stores/auth'
import { useItemsStore } from '@/stores/items'
import type { List, ListIcon } from '@/types/api'

/** idle: not loaded yet. error: the last load failed (lists may still be shown). */
export type ListsStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Why a list disappeared from the store; self means the user deleted it. */
export type ListDeletionCause = 'self' | 'deleted' | 'unknown'

export interface ListDeletion {
  name: string
  cause: ListDeletionCause
}

/** The lists of one group and how loading them went. */
interface GroupLists {
  lists: List[]
  status: ListsStatus
  errorCode: string | null
}

/**
 * Builds the store around a service, a getter for the ID of the signed-in
 * user, the source of server events (the live socket; tests pass a fake) and
 * a function that drops the items of a list that is gone, like
 * defineItemsStore. The store forgets everything when that ID changes
 * (logout, expired session, another user), so nobody ever sees the lists of
 * the previous user.
 *
 * The store keeps the lists of each group apart, as a screen shows one group
 * at a time. It always loads archived lists, too, and tells them apart
 * locally (activeLists, archivedLists): one request serves both views.
 *
 * Reading never throws: load() sets the status and error code of the group.
 * The writing actions reject with the ApiError instead, so the dialog that
 * started them can show the message next to its form.
 *
 * States of a list arrive from several places (load, the answer to a write,
 * events of other members) and in any order. They follow the rules of the
 * items store: a state applies only if its serverSeq is not older than the
 * one we hold, and a deleted list stays deleted. This store knows which
 * lists belong to a group, so it is the one that tells the items store when
 * a list is gone (deleted, or its group left). See docs/sync.md.
 *
 * The lists of each group are kept on the device (`storage`, ADR 0006), as in
 * the groups store: the first load of a group reads them next to the
 * request, they only fill what the store does not hold, the status stays
 * `loading` until the server answers, and the store writes the lists of a
 * group back whenever a state from the server changed them.
 */

/** The part of the local storage the lists store uses. */
export type ListsLocal = Pick<LocalData, 'readLists' | 'writeLists' | 'removeLists'>

export function defineListsStore(
  service: ListsService,
  currentUserId: () => string | null,
  events: ServerEvents = liveSocket,
  forgetItems: (listId: string) => void = (listId) => useItemsStore().forgetList(listId),
  storage: ListsLocal = localData,
) {
  return defineStore('lists', () => {
    const byGroup = ref<Record<string, GroupLists>>({})

    // Bookkeeping for the rules above, not shown, so plain Maps and Sets next
    // to the reactive state; reset() empties them.

    // Bumped by reset(). A load that started before it is outdated when it
    // answers and must not put the old user's lists back.
    let generation = 0

    // IDs of lists known to be deleted. Lists are deleted for good, so a late
    // state of such a list (e.g. a rename event that overtook the deletion)
    // is dropped whatever its serverSeq.
    const tombstones = new Set<string>()

    // A logical clock, as in the items store: touchedAt says when a list last
    // got a state from the server, a load remembers the clock at its start.
    // A list touched after that start may be missing from the answer only
    // because the answer is older than the list.
    let clock = 0
    const touchedAt = new Map<string, number>()
    // The start of the newest load whose answer was applied, per group.
    const appliedLoadStart = new Map<string, number>()
    // Why each list disappeared, read once by the view that was showing it.
    const deletions = new Map<string, ListDeletion>()
    // Lists currently being deleted by this tab's remove() call, so an early
    // listDeleted event before the REST answer still counts as 'self'.
    const selfDeleting = new Set<string>()

    // Writes to the local storage, coalesced (see persistQueue).
    const persistQueue = createPersistQueue()
    // Groups whose lists the store holds as the device or the server knows
    // them: the stored lists were read, or a load answer was applied. Before
    // that, writing would replace the stored lists with a partial state.
    const holdsState = new Set<string>()

    function reset() {
      generation++
      byGroup.value = {}
      tombstones.clear()
      touchedAt.clear()
      appliedLoadStart.clear()
      deletions.clear()
      selfDeleting.clear()
      holdsState.clear()
      persistQueue.clear()
    }

    watch(currentUserId, reset)

    // Writes the lists of the group to the device once the current code is
    // done. The user is taken now: the storage ignores writes for another
    // owner. A group dropped meanwhile is not written (forgetGroup removed it).
    function persist(groupId: string) {
      const userId = currentUserId()
      if (!holdsState.has(groupId) || !userId) {
        return
      }
      persistQueue.schedule(groupId, () => {
        const entry = byGroup.value[groupId]
        if (entry) {
          return storage.writeLists(userId, groupId, entry.lists)
        }
      })
    }

    // Reads the stored lists of the group on its first load. Skipped if the
    // user changed meanwhile, the group was dropped, or a load answer was
    // applied already: that one is newer.
    async function restore(groupId: string, started: number) {
      const userId = currentUserId()
      if (!userId) {
        return
      }
      const stored = await storage.readLists(userId, groupId)
      const entry = byGroup.value[groupId]
      if (started !== generation || !entry || appliedLoadStart.has(groupId)) {
        return
      }
      holdsState.add(groupId)
      if (stored) {
        mergeStored(entry, stored)
      }
    }

    // Adds the stored lists the group does not hold. What it holds came from
    // the server since the start and is newer; a deleted list stays deleted.
    function mergeStored(entry: GroupLists, stored: List[]) {
      const held = new Set(entry.lists.map((list) => list.id))
      const missing = stored.filter((list) => !held.has(list.id) && !tombstones.has(list.id))
      if (missing.length > 0) {
        entry.lists = [...toRaw(entry.lists), ...missing].sort(compareLists)
      }
    }

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

    /** Why a list is gone; undefined while it is still in the store. */
    function deletionOf(listId: string): ListDeletion | undefined {
      return byId(listId) ? undefined : deletions.get(listId)
    }

    // The order of the server: oldest first, ties by ID. Dates are compared
    // as instants, not as text (see compareItems in the items store).
    function compareLists(a: List, b: List): number {
      const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt)
      if (byTime !== 0) {
        return byTime
      }
      if (a.id === b.id) {
        return 0
      }
      return a.id < b.id ? -1 : 1
    }

    /**
     * The one place where a state of a list from the server (event or
     * answer) enters the store. An event must have a greater serverSeq than
     * the list we hold; an answer may be equal, because it can be the very
     * state we hold (e.g. the answer to create after the event of the same
     * create).
     */
    function takeServerList(list: List, mode: 'event' | 'answer') {
      const entry = byGroup.value[list.groupId]
      // A group we do not show: loading it later gets the current state.
      if (!entry || tombstones.has(list.id)) {
        return
      }
      const index = entry.lists.findIndex((l) => l.id === list.id)
      const local = entry.lists[index]
      if (local) {
        const outdated =
          mode === 'event' ? list.serverSeq <= local.serverSeq : list.serverSeq < local.serverSeq
        if (outdated) {
          return
        }
      }
      touchedAt.set(list.id, ++clock)
      persist(list.groupId)

      if (local) {
        entry.lists[index] = list
        return
      }
      const after = entry.lists.findIndex((other) => compareLists(other, list) > 0)
      if (after === -1) {
        entry.lists.push(list)
      } else {
        entry.lists.splice(after, 0, list)
      }
    }

    // A list is deleted on the server, by us or someone else. Its items go
    // with it. Keeps the first cause if it is already gone (e.g. our own
    // delete followed by our own listDeleted event).
    function takeDeletion(groupId: string | undefined, listId: string, cause: ListDeletionCause) {
      tombstones.add(listId)
      const entry = groupId === undefined ? undefined : byGroup.value[groupId]
      if (entry) {
        const target = entry.lists.find((list) => list.id === listId)
        if (target) {
          deletions.set(listId, { name: target.name, cause })
          entry.lists = entry.lists.filter((list) => list.id !== listId)
          persist(target.groupId)
        }
      }
      forgetItems(listId)
    }

    /**
     * We are no longer in the group (left, removed, or it was deleted). No
     * tombstones: we may be invited again, and then its lists are back. The
     * groups store calls this too, e.g. when a reload no longer lists the
     * group after a missed groupRemoved.
     */
    function forgetGroup(groupId: string) {
      // Also when the group was never loaded: the device may still hold its
      // lists from an earlier visit.
      holdsState.delete(groupId)
      const userId = currentUserId()
      if (userId) {
        persistQueue.schedule(groupId, () => storage.removeLists(userId, groupId))
      }
      const entry = byGroup.value[groupId]
      if (!entry) {
        return
      }
      for (const list of entry.lists) {
        forgetItems(list.id)
      }
      delete byGroup.value[groupId]
      appliedLoadStart.delete(groupId)
    }

    // False if the user changed since `started`, or if the answer of a load
    // that started later was applied already. Otherwise this load is now the
    // newest one applied.
    function isCurrentLoad(started: number, groupId: string, startedAt: number): boolean {
      if (started !== generation || startedAt < (appliedLoadStart.get(groupId) ?? 0)) {
        return false
      }
      appliedLoadStart.set(groupId, startedAt)
      return true
    }

    // Puts the answer of a load into the group; see load().
    function mergeLoaded(entry: GroupLists, loaded: List[], startedAt: number) {
      // The raw array: its lists are the plain objects, not the reactive
      // proxies around them, which must not end up inside the new array.
      const local = new Map(toRaw(entry.lists).map((list) => [list.id, list]))
      const merged: List[] = []

      for (const server of loaded) {
        if (tombstones.has(server.id)) {
          continue
        }
        const held = local.get(server.id)
        local.delete(server.id)
        // The answer may be older than what we have.
        merged.push(held && held.serverSeq > server.serverSeq ? held : server)
      }

      // What the answer does not list is deleted on the server (it lists
      // archived lists too), unless it came to us after this load started:
      // then the answer may predate it.
      for (const [id, held] of local) {
        if ((touchedAt.get(id) ?? 0) > startedAt) {
          merged.push(held)
        } else {
          tombstones.add(id)
          deletions.set(id, { name: held.name, cause: 'unknown' })
          forgetItems(id)
        }
      }

      entry.lists = merged.sort(compareLists)
    }

    /**
     * Loads the lists of a group, archived ones included, and merges them
     * into what the store has, instead of replacing it: the answer may be
     * older than an event that came while the request was on its way. A group
     * that is loaded already keeps its status `ready` meanwhile, so reloading
     * shows no spinner. If this fails, the lists loaded before stay: an
     * unreachable server should not empty the screen.
     *
     * The first load of a group also reads its lists stored on the device,
     * at the same time as the request.
     */
    async function load(groupId: string) {
      const started = generation
      const startedAt = ++clock
      const entry = ensure(groupId)
      const restoring = entry.status === 'idle' ? restore(groupId, started) : null
      if (entry.status !== 'ready') {
        entry.status = 'loading'
      }
      entry.errorCode = null
      try {
        const loaded = await service.list(groupId, { includeArchived: true })
        if (!isCurrentLoad(started, groupId, startedAt)) {
          return
        }
        mergeLoaded(entry, loaded, startedAt)
        holdsState.add(groupId)
        persist(groupId)
        entry.status = 'ready'
      } catch (err) {
        // Offline the request fails at once: wait for the stored lists, so
        // the screen does not show the error before they are there.
        await restoring
        if (!isCurrentLoad(started, groupId, startedAt)) {
          return
        }
        entry.status = 'error'
        entry.errorCode = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    /** Creates a list and returns it, so the caller can open it. */
    async function create(groupId: string, name: string, icon: ListIcon): Promise<List> {
      const started = generation
      const list = await service.create(groupId, name, icon)
      // After a reset the old user's list must not come back: ensure() would
      // create the group anew.
      if (started === generation) {
        ensure(groupId)
        takeServerList(list, 'answer')
      }
      return list
    }

    /** Sets name and icon of a list. */
    async function update(listId: string, name: string, icon: ListIcon) {
      await takeAnswer(service.update(listId, name, icon))
    }

    async function archive(listId: string) {
      await takeAnswer(service.setArchived(listId, true))
    }

    async function unarchive(listId: string) {
      await takeAnswer(service.setArchived(listId, false))
    }

    // Waits for the answer to a write that was just sent and applies it,
    // unless the user changed meanwhile: the old user's list must not come
    // back after a reset (a later load of the same group would show it).
    async function takeAnswer(request: Promise<List>) {
      const started = generation
      const list = await request
      if (started === generation) {
        takeServerList(list, 'answer')
      }
    }

    async function remove(listId: string) {
      const started = generation
      // Looked up first: the list is gone from the answer, and the group is
      // needed to drop it from the right place.
      const groupId = byId(listId)?.groupId
      selfDeleting.add(listId)
      try {
        await service.remove(listId)
      } finally {
        if (started === generation) {
          selfDeleting.delete(listId)
        }
      }
      if (started === generation) {
        takeDeletion(groupId, listId, 'self')
      }
    }

    // The setup function runs in the effect scope of the store, so
    // onScopeDispose() runs at $dispose(): the handlers must not outlive the
    // store, as the socket outlives it.
    const unsubscribes = [
      events.on('listChanged', ({ payload }) => takeServerList(payload.list, 'event')),
      events.on('listDeleted', ({ payload }) =>
        takeDeletion(
          payload.groupId,
          payload.listId,
          selfDeleting.has(payload.listId) ? 'self' : 'deleted',
        ),
      ),
      events.on('groupRemoved', ({ payload }) => forgetGroup(payload.groupId)),
      // Events are best effort and the connection may have been down:
      // every group we have loaded (or are loading) may be outdated.
      events.on('ready', () => {
        for (const [groupId, entry] of Object.entries(byGroup.value)) {
          if (entry.status !== 'idle') {
            void load(groupId)
          }
        }
      }),
    ]
    onScopeDispose(() => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    })

    return {
      listsOf,
      activeLists,
      archivedLists,
      statusOf,
      errorCodeOf,
      byId,
      deletionOf,
      load,
      create,
      update,
      archive,
      unarchive,
      remove,
      forgetGroup,
    }
  })
}

export const useListsStore = defineListsStore(listsService, () => useAuthStore().user?.id ?? null)
