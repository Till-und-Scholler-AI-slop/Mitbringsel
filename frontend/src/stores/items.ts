import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { itemsService, type ItemsService } from '@/services/api/items'
import { useAuthStore } from '@/stores/auth'
import type { CreateItemRequest, Item, UpdateItemRequest } from '@/types/api'

/** idle: not loaded yet. error: the last load failed (items may still be shown). */
export type ItemsStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The items of one list and how loading them went. */
interface ListItems {
  items: Item[]
  status: ItemsStatus
  errorCode: string | null
}

/**
 * Builds the store around a service and a getter for the ID of the signed-in
 * user, like defineListsStore. The store forgets everything when that ID
 * changes (logout, expired session, another user).
 *
 * The store keeps the items of each list apart, in the order of the server
 * (oldest first). Open and checked items are told apart locally.
 *
 * Reading never throws: load() sets the status and error code of the list.
 * The writing actions reject with the ApiError instead, so the form or the
 * view that started them can show the message.
 *
 * Checking is the one action that does not wait for the server: it happens
 * in the shop, on a bad connection, and a checkbox that reacts late feels
 * broken. setChecked() changes the item at once and takes the answer of the
 * server afterwards; if the request fails, it puts the old state back.
 * Everything else waits for the server, as the user presses a button in a
 * form anyway.
 */
export function defineItemsStore(service: ItemsService, currentUserId: () => string | null) {
  return defineStore('items', () => {
    const byList = ref<Record<string, ListItems>>({})

    // Bumped by reset(). A load that started before it is outdated when it
    // answers and must not put the old user's items back.
    let generation = 0

    // The newest setChecked() per item. Only the request that is still the
    // newest when it answers may touch the item: otherwise the late answer
    // to a first tap would overwrite a second tap.
    const latestCheck = new Map<string, number>()
    let checkCounter = 0

    function reset() {
      generation++
      byList.value = {}
      latestCheck.clear()
    }

    watch(currentUserId, reset)

    // The entry of a list, created on first use. The reading functions below
    // do not create one, so looking at a list does not change the state.
    function ensure(listId: string): ListItems {
      byList.value[listId] ??= { items: [], status: 'idle', errorCode: null }
      return byList.value[listId]
    }

    /** All items of the list, oldest first. */
    function itemsOf(listId: string): Item[] {
      return byList.value[listId]?.items ?? []
    }

    /** The items of the list that are not checked yet, oldest first. */
    function openItems(listId: string): Item[] {
      return itemsOf(listId).filter((item) => !item.checked)
    }

    /** The checked items of the list, oldest first. */
    function checkedItems(listId: string): Item[] {
      return itemsOf(listId).filter((item) => item.checked)
    }

    function statusOf(listId: string): ItemsStatus {
      return byList.value[listId]?.status ?? 'idle'
    }

    function errorCodeOf(listId: string): string | null {
      return byList.value[listId]?.errorCode ?? null
    }

    /** Finds an item in any list that was loaded. */
    function byId(itemId: string): Item | undefined {
      for (const entry of Object.values(byList.value)) {
        const found = entry.items.find((item) => item.id === itemId)
        if (found) {
          return found
        }
      }
      return undefined
    }

    /**
     * Loads the items of a list. If this fails, the items loaded before stay:
     * an unreachable server should not empty the screen.
     */
    async function load(listId: string) {
      const started = generation
      const entry = ensure(listId)
      entry.status = 'loading'
      entry.errorCode = null
      try {
        const loaded = await service.list(listId)
        if (started !== generation) {
          return
        }
        entry.items = loaded
        entry.status = 'ready'
      } catch (err) {
        if (started !== generation) {
          return
        }
        entry.status = 'error'
        entry.errorCode = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    /** Adds an item at the end and returns it. */
    async function create(listId: string, request: CreateItemRequest): Promise<Item> {
      const item = await service.create(listId, request)
      const entry = ensure(listId)
      // Sending the same ID twice answers the stored item again; do not list it twice.
      const index = entry.items.findIndex((i) => i.id === item.id)
      if (index === -1) {
        entry.items.push(item)
      } else {
        entry.items[index] = item
      }
      return item
    }

    /**
     * Changes name, quantity, unit or note and takes the item as the server
     * stored it. Waits for the server; use setChecked() for the checkbox.
     */
    async function update(itemId: string, change: UpdateItemRequest) {
      replace(await service.update(itemId, change))
    }

    /**
     * Checks or unchecks an item at once and confirms with the server. If
     * the request fails, the old state comes back and the error is thrown.
     */
    async function setChecked(itemId: string, checked: boolean) {
      const item = byId(itemId)
      if (!item) {
        // Not in the store (anymore): nothing to show early, just send it.
        replace(await service.update(itemId, { checked }))
        return
      }

      const before = {
        checked: item.checked,
        checkedBy: item.checkedBy,
        checkedAt: item.checkedAt,
      }
      // The same fields the server sets; its answer replaces them below.
      item.checked = checked
      item.checkedBy = checked ? currentUserId() : null
      item.checkedAt = checked ? new Date().toISOString() : null

      const mine = ++checkCounter
      latestCheck.set(itemId, mine)
      try {
        const stored = await service.update(itemId, { checked })
        if (latestCheck.get(itemId) === mine) {
          replace(stored)
        }
      } catch (err) {
        if (latestCheck.get(itemId) === mine) {
          // Only roll back the item we changed. If a reload has replaced it
          // meanwhile, it holds fresher data from the server than `before`.
          const current = byId(itemId)
          if (current === item) {
            Object.assign(current, before)
          }
        }
        throw err
      } finally {
        if (latestCheck.get(itemId) === mine) {
          latestCheck.delete(itemId)
        }
      }
    }

    async function remove(itemId: string) {
      // Looked up first: the item is gone from the answer, and the list is
      // needed to drop it from the right place.
      const listId = byId(itemId)?.listId
      await service.remove(itemId)
      if (listId !== undefined) {
        const entry = ensure(listId)
        entry.items = entry.items.filter((item) => item.id !== itemId)
      }
    }

    // The answer of the server is the truth, so it replaces the local copy.
    function replace(item: Item) {
      const entry = byList.value[item.listId]
      const index = entry?.items.findIndex((i) => i.id === item.id) ?? -1
      if (entry && index !== -1) {
        entry.items[index] = item
      }
    }

    return {
      itemsOf,
      openItems,
      checkedItems,
      statusOf,
      errorCodeOf,
      byId,
      load,
      create,
      update,
      setChecked,
      remove,
    }
  })
}

export const useItemsStore = defineItemsStore(itemsService, () => useAuthStore().user?.id ?? null)
