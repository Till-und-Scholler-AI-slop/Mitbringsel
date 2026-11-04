import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { groupInvitesService, type GroupInvitesService } from '@/services/api/groupInvites'
import { useAuthStore } from '@/stores/auth'
import type { Invite, InviteCreated } from '@/types/api'

/** idle: nothing loaded. error: `errorCode` says why (e.g. FORBIDDEN). */
export type GroupInvitesStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The link just created: the only time the server tells its token. */
export interface FreshInvite {
  id: string
  token: string
}

/**
 * Builds the store around a service and a getter for the ID of the signed-in
 * user. Setup stores cannot take parameters, so this factory is how tests
 * inject fakes.
 *
 * It holds the open invite links of one group at a time, the one the user
 * is managing. The token of a new link stays in memory only and is gone when
 * another group is loaded, the user changes or clear() runs: it cannot be
 * asked for again.
 *
 * Reading never throws: load() sets `status` and `errorCode`. create() and
 * revoke() reject with the ApiError so the page can show it next to the button.
 */
export function defineGroupInvitesStore(
  service: GroupInvitesService,
  currentUserId: () => string | null,
) {
  return defineStore('groupInvites', () => {
    const groupId = ref<string | null>(null)
    const invites = ref<Invite[]>([])
    const status = ref<GroupInvitesStatus>('idle')
    const errorCode = ref<string | null>(null)
    const fresh = ref<FreshInvite | null>(null)

    // A newer load or a clear() makes a load that is still running outdated.
    let generation = 0

    function clear() {
      generation++
      groupId.value = null
      invites.value = []
      status.value = 'idle'
      errorCode.value = null
      fresh.value = null
    }

    watch(currentUserId, clear)

    /**
     * Loads the open links of a group. Another group than before starts from
     * nothing; reloading the same group keeps the new link on screen.
     */
    async function load(forGroupId: string) {
      if (groupId.value !== forGroupId) {
        clear()
        groupId.value = forGroupId
      }
      const started = ++generation
      status.value = 'loading'
      errorCode.value = null
      try {
        const loaded = await service.list(forGroupId)
        if (started !== generation) return
        invites.value = loaded
        status.value = 'ready'
      } catch (err) {
        if (started !== generation) return
        status.value = 'error'
        errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    /** Creates a link; it is the first of the list and the `fresh` one. */
    async function create(forGroupId: string): Promise<InviteCreated> {
      const created = await service.create(forGroupId)
      // The user may have moved on to another group while the request ran.
      if (groupId.value === forGroupId) {
        const { token, ...invite } = created
        invites.value.unshift(invite)
        fresh.value = { id: invite.id, token }
      }
      return created
    }

    async function revoke(forGroupId: string, inviteId: string) {
      await service.revoke(forGroupId, inviteId)
      if (groupId.value !== forGroupId) return
      invites.value = invites.value.filter((invite) => invite.id !== inviteId)
      if (fresh.value?.id === inviteId) fresh.value = null
    }

    return { groupId, invites, status, errorCode, fresh, load, create, revoke, clear }
  })
}

export const useGroupInvitesStore = defineGroupInvitesStore(
  groupInvitesService,
  () => useAuthStore().user?.id ?? null,
)
