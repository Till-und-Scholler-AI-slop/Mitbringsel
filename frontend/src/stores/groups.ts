import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN, HTTP_STATUS_UNAUTHORIZED } from '@/services/api/client'
import { groupsService, type GroupsService } from '@/services/api/groups'
import { useAuthStore } from '@/stores/auth'
import type { Group, Role } from '@/types/api'

/** idle: not loaded yet. error: the last load failed (groups may still be shown). */
export type GroupsStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Builds the store around a service and a getter for the ID of the signed-in
 * user. Setup stores cannot take parameters, so this factory is how tests
 * inject fakes.
 *
 * The store forgets everything when that ID changes (logout, expired session,
 * another user), so nobody ever sees the groups of the previous user.
 *
 * Reading never throws: load() sets `status` and `errorCode`. The writing
 * actions reject with the ApiError instead, so the dialog that started them
 * can show the message next to its form.
 */
export function defineGroupsStore(service: GroupsService, currentUserId: () => string | null) {
  return defineStore('groups', () => {
    const groups = ref<Group[]>([])
    const status = ref<GroupsStatus>('idle')
    const errorCode = ref<string | null>(null)

    // Bumped by reset(). A load that started before it is outdated when it
    // answers and must not put the old user's groups back.
    let generation = 0

    function reset() {
      generation++
      groups.value = []
      status.value = 'idle'
      errorCode.value = null
    }

    watch(currentUserId, reset)

    function byId(groupId: string): Group | undefined {
      return groups.value.find((group) => group.id === groupId)
    }

    /**
     * Loads all groups of the user. If this fails, the groups loaded before
     * stay: an unreachable server should not empty the screen.
     */
    async function load() {
      const started = generation
      status.value = 'loading'
      errorCode.value = null
      try {
        const loaded = await service.list()
        if (started !== generation) {
          return
        }
        groups.value = loaded
        status.value = 'ready'
      } catch (err) {
        if (started !== generation) {
          return
        }
        status.value = 'error'
        errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    /** Creates a group and returns it, so the caller can open it. */
    async function create(name: string): Promise<Group> {
      const group = await service.create(name)
      groups.value.push(group)
      return group
    }

    async function rename(groupId: string, name: string) {
      const updated = await service.rename(groupId, name)
      replace(updated)
    }

    async function remove(groupId: string) {
      await service.remove(groupId)
      drop(groupId)
    }

    /** The signed-in user leaves the group; the owner cannot (OWNER_IMMUTABLE). */
    async function leave(groupId: string) {
      const userId = currentUserId()
      if (!userId) {
        throw new ApiError('UNAUTHENTICATED', HTTP_STATUS_UNAUTHORIZED)
      }
      await service.removeMember(groupId, userId)
      drop(groupId)
    }

    async function removeMember(groupId: string, userId: string) {
      await service.removeMember(groupId, userId)
      const group = byId(groupId)
      if (group) {
        group.members = group.members.filter((member) => member.userId !== userId)
      }
    }

    async function setMemberRole(groupId: string, userId: string, role: Role) {
      await service.setMemberRole(groupId, userId, role)
      const member = byId(groupId)?.members.find((m) => m.userId === userId)
      if (member) {
        member.role = role
      }
    }

    // The answer of the server is the truth, so it replaces the local copy.
    function replace(group: Group) {
      const index = groups.value.findIndex((g) => g.id === group.id)
      if (index !== -1) {
        groups.value[index] = group
      }
    }

    function drop(groupId: string) {
      groups.value = groups.value.filter((group) => group.id !== groupId)
    }

    return {
      groups,
      status,
      errorCode,
      byId,
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
