import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'

/**
 * Counts open items per list and per household from the local stores. Lists
 * and items of all households are preloaded (services/sync/preload.ts), so
 * the sidebar can show counts for every household without extra requests.
 *
 * Unknown counts return `null` instead of `0` so the UI shows nothing rather
 * than a flashing "0" before data arrives:
 * - A list's count is known once its items finished loading (`status === 'ready'`)
 *   or the store already holds items for it (e.g. restored from local storage
 *   while offline or reloading, where status is `'loading'` or `'error'`).
 * - A household's count is known once its lists are known (same rule on
 *   `lists.statusOf` and `lists.listsOf`) and every active list in it has a
 *   known item count. Archived lists do not count and never block the sum.
 */
export function useOpenCounts() {
  const lists = useListsStore()
  const items = useItemsStore()

  /** Open items in a list (hidden items being removed are already excluded), or null while unknown. */
  function openInList(listId: string): number | null {
    if (items.statusOf(listId) !== 'ready' && items.itemsOf(listId).length === 0) {
      return null
    }
    return items.openItems(listId).length
  }

  /** Sum of open items across all active lists of a household, or null while unknown. */
  function openInGroup(groupId: string): number | null {
    if (lists.statusOf(groupId) !== 'ready' && lists.listsOf(groupId).length === 0) {
      return null
    }
    let total = 0
    for (const list of lists.activeLists(groupId)) {
      const count = openInList(list.id)
      if (count === null) {
        return null
      }
      total += count
    }
    return total
  }

  return { openInList, openInGroup }
}
