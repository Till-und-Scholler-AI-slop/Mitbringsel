import { onScopeDispose, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN, HTTP_STATUS_UNAUTHORIZED } from '@/services/api/client'
import { groupsService, type GroupsService } from '@/services/api/groups'
import { localData, type LocalData } from '@/services/storage/localData'
import { createPersistQueue } from '@/services/storage/persistQueue'
import { liveSocket, type ServerEvents } from '@/services/sync/socket'
import { useAuthStore } from '@/stores/auth'
import { useListsStore } from '@/stores/lists'
import type { Group, Role } from '@/types/api'

/** idle: not loaded yet. error: the last load failed (groups may still be shown). */
export type GroupsStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Builds the store around a service, a getter for the ID of the signed-in
 * user, the source of server events (the live socket; tests pass a fake) and
 * a function that drops the lists of a group the user is no longer in, like
 * defineListsStore. Setup stores cannot take parameters, so this factory is
 * how tests inject fakes.
 *
 * The store forgets everything when that ID changes (logout, expired session,
 * another user), so nobody ever sees the groups of the previous user.
 *
 * Reading never throws: load() sets `status` and `errorCode`. The writing
 * actions reject with the ApiError instead, so the dialog that started them
 * can show the message next to its form.
 *
 * Other members' changes arrive as events. `groupChanged` is only a hint to
 * reload (a Group contains the role of the user, which the event cannot
 * carry), `groupRemoved` drops the group at once. Groups have no serverSeq,
 * so a logical clock decides which state is newer, as in the lists store.
 * After every (re)connect of the socket the preload
 * (services/sync/preload.ts) loads the groups again. See docs/sync.md.
 *
 * The groups are kept on the device (`storage`, ADR 0006), so the app can show
 * them right after a start without a network. The first load reads the
 * stored groups next to the request; they only fill what the store does not
 * hold, and the server answer stays the truth (it drops a stored group the
 * user is no longer in). The status stays `loading` until the server
 * answers, so a stored state never counts as the server's. The store writes
 * its groups back whenever a state from the server changed them.
 */

/** The part of the local storage the groups store uses. */
export type GroupsLocal = Pick<LocalData, 'readGroups' | 'writeGroups'>
/**
 * Why the user is no longer in a group: another member removed them or
 * deleted it, they left or deleted it themselves (also in another tab), or
 * a load no longer listed it, e.g. after an event missed while offline.
 */
export type DepartureCause = 'removed' | 'deleted' | 'self' | 'unknown'

/** A group the user is no longer in, with its last known name. */
export interface Departure {
  name: string
  cause: DepartureCause
}

export function defineGroupsStore(
  service: GroupsService,
  currentUserId: () => string | null,
  events: ServerEvents = liveSocket,
  forgetLists: (groupId: string) => void = (groupId) => useListsStore().forgetGroup(groupId),
  storage: GroupsLocal = localData,
) {
  return defineStore('groups', () => {
    const groups = ref<Group[]>([])
    const status = ref<GroupsStatus>('idle')
    const errorCode = ref<string | null>(null)

    // Bumped by reset(). A load or write that started before it is outdated
    // when it answers and must not put the old user's groups back.
    let generation = 0

    // Writes to the local storage, coalesced (see persistQueue).
    const persistQueue = createPersistQueue()
    // True once the store holds what the device or the server knows: the
    // stored groups were read, or a load answer was applied. Before that,
    // writing would replace the stored groups with a partial state, e.g.
    // only a group created before the stored ones were read.
    let holdsState = false

    // A logical clock (a counter, not a time): touchedAt says when a group
    // last got a state from an answer to a write, removedAt when the user
    // left it, and a load remembers the clock at its start. Not shown, so
    // plain Maps next to the reactive state; reset() empties them.
    let clock = 0
    const touchedAt = new Map<string, number>()
    const removedAt = new Map<string, number>()
    // The start of the newest load whose answer was applied.
    let appliedLoadStart = 0
    // Why each group went, read once by the screen that was showing it.
    // Read only right after the group went, so not reactive.
    const departures = new Map<string, Departure>()

    function reset() {
      generation++
      groups.value = []
      status.value = 'idle'
      errorCode.value = null
      touchedAt.clear()
      removedAt.clear()
      departures.clear()
      appliedLoadStart = 0
      holdsState = false
      persistQueue.clear()
    }

    watch(currentUserId, reset)

    // Writes the groups to the device once the current code is done. The
    // user is taken now: the storage ignores writes for another owner.
    function persist() {
      const userId = currentUserId()
      if (!holdsState || !userId) {
        return
      }
      persistQueue.schedule('groups', () => storage.writeGroups(userId, groups.value))
    }

    // Reads the stored groups on the first load. Skipped if the user changed
    // meanwhile or a load answer was applied already: that one is newer.
    async function restore(started: number) {
      const userId = currentUserId()
      if (!userId) {
        return
      }
      const stored = await storage.readGroups(userId)
      if (started !== generation || appliedLoadStart > 0) {
        return
      }
      holdsState = true
      if (stored) {
        mergeStored(stored)
      }
    }

    // Adds the stored groups the store does not hold. What it holds came
    // from the server since the start (an answer or an event) and is newer;
    // a group the user left since then stays gone.
    function mergeStored(stored: Group[]) {
      for (const group of stored) {
        if (!byId(group.id) && !removedAt.has(group.id)) {
          groups.value.push(group)
        }
      }
    }

    function byId(groupId: string): Group | undefined {
      return groups.value.find((group) => group.id === groupId)
    }

    /** Why the user is no longer in the group; undefined if they still are. */
    function departureOf(groupId: string): Departure | undefined {
      return byId(groupId) ? undefined : departures.get(groupId)
    }

    // Remembers why a group we show is going. A group that is gone already
    // keeps its first cause: our own leave is followed by our own event.
    function rememberDeparture(groupId: string, cause: DepartureCause) {
      const group = byId(groupId)
      if (group) {
        departures.set(groupId, { name: group.name, cause })
      }
    }

    // False if the user changed since `started`, or if the answer of a load
    // that started later was applied already. Otherwise this load is now the
    // newest one applied.
    function isCurrentLoad(started: number, startedAt: number): boolean {
      if (started !== generation || startedAt < appliedLoadStart) {
        return false
      }
      appliedLoadStart = startedAt
      return true
    }

    // Puts the answer of a load into the store. The answer is the truth,
    // except for what changed after the load started: a group left since
    // then stays gone, a group from a write answer since then stays as it
    // is. Every other group the answer does not list is gone on the server.
    function mergeLoaded(loaded: Group[], startedAt: number) {
      // The raw array: its groups are the plain objects, not the reactive
      // proxies around them, which must not end up inside the new array.
      const local = new Map(toRaw(groups.value).map((group) => [group.id, group]))
      const merged: Group[] = []

      for (const server of loaded) {
        if ((removedAt.get(server.id) ?? 0) > startedAt) {
          continue
        }
        const held = local.get(server.id)
        local.delete(server.id)
        merged.push(held && (touchedAt.get(server.id) ?? 0) > startedAt ? held : server)
      }

      for (const [id, held] of local) {
        if ((touchedAt.get(id) ?? 0) > startedAt) {
          merged.push(held)
        } else {
          departures.set(id, { name: held.name, cause: 'unknown' })
          forgetLists(id)
        }
      }

      groups.value = merged
    }

    /**
     * Loads all groups of the user and merges them into what the store has.
     * Loaded groups keep the status `ready` meanwhile, so reloading shows no
     * spinner. If this fails, the groups loaded before stay: an unreachable
     * server should not empty the screen.
     *
     * The first load also reads the groups stored on the device, at the
     * same time as the request.
     */
    async function load() {
      const started = generation
      const startedAt = ++clock
      const restoring = status.value === 'idle' ? restore(started) : null
      if (status.value !== 'ready') {
        status.value = 'loading'
      }
      errorCode.value = null
      try {
        const loaded = await service.list()
        if (!isCurrentLoad(started, startedAt)) {
          return
        }
        mergeLoaded(loaded, startedAt)
        holdsState = true
        persist()
        status.value = 'ready'
      } catch (err) {
        // Offline the request fails at once: wait for the stored groups, so
        // the screen does not show the error before they are there.
        await restoring
        if (!isCurrentLoad(started, startedAt)) {
          return
        }
        status.value = 'error'
        errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    // The answer of the server to our own write is the truth for this group.
    // A group that is there already (e.g. a reload after our own
    // groupChanged was faster than the answer to create) is replaced, not
    // added twice.
    function takeAnswer(group: Group) {
      touchedAt.set(group.id, ++clock)
      removedAt.delete(group.id)
      const index = groups.value.findIndex((g) => g.id === group.id)
      if (index === -1) {
        groups.value.push(group)
      } else {
        groups.value[index] = group
      }
      persist()
    }

    // The user is no longer in the group: left, removed, or it was deleted.
    // Its lists (and through them their items) go with it.
    function takeRemoval(groupId: string, cause: DepartureCause) {
      rememberDeparture(groupId, cause)
      removedAt.set(groupId, ++clock)
      touchedAt.delete(groupId)
      groups.value = groups.value.filter((group) => group.id !== groupId)
      forgetLists(groupId)
      persist()
    }

    /** Creates a group and returns it, so the caller can open it. */
    async function create(name: string): Promise<Group> {
      const started = generation
      const group = await service.create(name)
      if (started === generation) {
        takeAnswer(group)
      }
      return group
    }

    async function rename(groupId: string, name: string) {
      const started = generation
      const updated = await service.rename(groupId, name)
      // Only a group we still show: the user may have been removed meanwhile.
      if (started === generation && byId(groupId)) {
        takeAnswer(updated)
      }
    }

    async function remove(groupId: string) {
      const started = generation
      await service.remove(groupId)
      if (started === generation) {
        takeRemoval(groupId, 'self')
      }
    }

    /** The signed-in user leaves the group; the owner cannot (OWNER_IMMUTABLE). */
    async function leave(groupId: string) {
      const userId = currentUserId()
      if (!userId) {
        throw new ApiError('UNAUTHENTICATED', HTTP_STATUS_UNAUTHORIZED)
      }
      const started = generation
      await service.removeMember(groupId, userId)
      if (started === generation) {
        takeRemoval(groupId, 'self')
      }
    }

    // The two member actions answer without the group. They change the
    // local copy; the groupChanged that follows reloads the real state.
    async function removeMember(groupId: string, userId: string) {
      await service.removeMember(groupId, userId)
      const group = byId(groupId)
      if (group) {
        group.members = group.members.filter((member) => member.userId !== userId)
        persist()
      }
    }

    async function setMemberRole(groupId: string, userId: string, role: Role) {
      await service.setMemberRole(groupId, userId, role)
      const member = byId(groupId)?.members.find((m) => m.userId === userId)
      if (member) {
        member.role = role
        persist()
      }
    }

    // Only reload what was loaded: a screen that needs the groups loads
    // them itself and then gets the current state anyway.
    function reloadIfLoaded() {
      if (status.value !== 'idle') {
        void load()
      }
    }

    // The setup function runs in the effect scope of the store, so
    // onScopeDispose() runs at $dispose(): the handlers must not outlive the
    // store, as the socket outlives it.
    const unsubscribes = [
      events.on('groupChanged', reloadIfLoaded),
      events.on('groupRemoved', ({ payload }) =>
        takeRemoval(payload.groupId, payload.actorId === currentUserId() ? 'self' : payload.reason),
      ),
    ]
    onScopeDispose(() => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    })

    return {
      groups,
      status,
      errorCode,
      byId,
      departureOf,
      load,
      create,
      rename,
      remove,
      leave,
      removeMember,
      setMemberRole,
    }
  })
}

export const useGroupsStore = defineGroupsStore(
  groupsService,
  () => useAuthStore().user?.id ?? null,
)
