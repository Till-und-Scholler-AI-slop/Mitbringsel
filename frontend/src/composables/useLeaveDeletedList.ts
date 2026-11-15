import type { Ref } from 'vue'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useListsStore } from '@/stores/lists'
import { useToastsStore } from '@/stores/toasts'
import type { Group, List } from '@/types/api'

/**
 * Leaves an open list when it disappears from the lists store (deleted by
 * another member, caught by a reload, or deleted by the user themselves).
 * Moves back to the household route (which opens the next active list or
 * offers to create one) and shows a toast with the list's name unless the
 * user deleted it themselves.
 *
 * Skips when the household itself went away at the same time: then
 * `useLeaveRemovedGroup` takes the user to the start page instead.
 */
export function useLeaveDeletedList(
  groupId: () => string,
  listId: () => string | undefined,
  list: Ref<List | undefined>,
  group: Ref<Group | undefined>,
) {
  const { t } = useI18n()
  const router = useRouter()
  const lists = useListsStore()
  const toasts = useToastsStore()

  watch([listId, list, group], ([currentId, now, groupNow], [idBefore, before, groupBefore]) => {
    if (!before || now || currentId !== idBefore) return
    if (groupBefore && !groupNow) return
    const deletion = currentId ? lists.deletionOf(currentId) : undefined
    if (deletion && deletion.cause !== 'self') {
      toasts.show({
        kind: 'info',
        text: t('list.deletedMeanwhile', { name: deletion.name }),
      })
    }
    // replace: the back button must not return to the deleted list.
    void router.replace({ name: 'group', params: { groupId: groupId() } })
  })
}
