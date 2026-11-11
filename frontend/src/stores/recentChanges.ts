import { onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { liveSocket, type ServerEvents } from '@/services/sync/socket'
import { useAuthStore } from '@/stores/auth'

/** How long an item another member changed stays highlighted. */
export const RECENT_CHANGE_MS = 5000

/**
 * Builds the store around a getter for the ID of the signed-in user and the
 * source of server events (the live socket; tests pass a fake).
 *
 * The store remembers which items another member changed just now, and who,
 * so the list can highlight them ("Ben · just changed"). It listens to the
 * events itself and leaves the items store alone: the highlight is a matter
 * of the screen, not of the data. Only events count, as only they say who
 * made the change; a reload after `ready` highlights nothing.
 */
export function defineRecentChangesStore(
  currentUserId: () => string | null,
  events: ServerEvents = liveSocket,
) {
  return defineStore('recentChanges', () => {
    // Item ID -> ID of the member who changed it.
    const actors = ref<Record<string, string>>({})
    // Not shown, so a plain Map next to the reactive state.
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    function forget(itemId: string) {
      clearTimeout(timers.get(itemId))
      timers.delete(itemId)
      delete actors.value[itemId]
    }

    function reset() {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      actors.value = {}
    }

    watch(currentUserId, reset)

    // A later change starts the time anew, and with the new member's name.
    // Our own change ends the highlight: the item is no news to us.
    function take(itemId: string, actorId: string) {
      forget(itemId)
      if (actorId === currentUserId()) {
        return
      }
      actors.value[itemId] = actorId
      timers.set(
        itemId,
        setTimeout(() => forget(itemId), RECENT_CHANGE_MS),
      )
    }

    /** The member who just changed the item, if it was someone else. */
    function changedBy(itemId: string): string | undefined {
      return actors.value[itemId]
    }

    // The setup function runs in the effect scope of the store, so
    // onScopeDispose() runs at $dispose(): the handlers and timers must not
    // outlive the store, as the socket outlives it.
    const unsubscribes = [
      events.on('itemChanged', ({ payload }) => take(payload.item.id, payload.actorId)),
      events.on('itemDeleted', ({ payload }) => forget(payload.itemId)),
      events.on('itemsDeleted', ({ payload }) => {
        for (const deleted of payload.items) {
          forget(deleted.itemId)
        }
      }),
    ]
    onScopeDispose(() => {
      reset()
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    })

    return { changedBy }
  })
}

export const useRecentChangesStore = defineRecentChangesStore(() => useAuthStore().user?.id ?? null)
