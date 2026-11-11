import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useGroupsStore } from '@/stores/groups'

/**
 * Leaves a screen of a household that disappears from the groups store
 * while it is open: the user was removed, the household was deleted, or a
 * reload no longer lists it. The start page shows what is left.
 *
 * Only a household that was there and is gone counts. A URL with a household
 * the store does not know (yet) stays, so the screen can show "loading" or
 * "not found".
 */
export function useLeaveRemovedGroup(groupId: () => string) {
  const router = useRouter()
  const groups = useGroupsStore()
  const group = computed(() => groups.byId(groupId()))

  watch([groupId, group], ([id, now], [idBefore, before]) => {
    if (!before || now || id !== idBefore) return
    // replace: the back button must not lead to the household again.
    void router.replace({ name: 'home' })
  })
}
