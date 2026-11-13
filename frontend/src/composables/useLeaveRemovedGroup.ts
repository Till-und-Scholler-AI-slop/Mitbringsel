import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useGroupsStore } from '@/stores/groups'
import { useToastsStore } from '@/stores/toasts'

/**
 * Leaves a screen of a household that disappears from the groups store
 * while it is open: the user was removed, the household was deleted, or a
 * reload no longer lists it. The start page shows what is left, and a toast
 * says why (design "toast-*"), unless the user did it themselves: then they
 * know, and the screen that started it moves on by itself.
 *
 * Only a household that was there and is gone counts. A URL with a household
 * the store does not know (yet) stays, so the screen can show "loading" or
 * "not found".
 */
export function useLeaveRemovedGroup(groupId: () => string) {
  const { t } = useI18n()
  const router = useRouter()
  const groups = useGroupsStore()
  const toasts = useToastsStore()
  const group = computed(() => groups.byId(groupId()))

  watch([groupId, group], ([id, now], [idBefore, before]) => {
    if (!before || now || id !== idBefore) return
    const departure = groups.departureOf(id)
    if (departure && departure.cause !== 'self') {
      toasts.show({
        kind: 'info',
        text: t(`departed.${departure.cause}`, { name: departure.name }),
      })
    }
    // replace: the back button must not lead to the household again.
    void router.replace({ name: 'home' })
  })
}
