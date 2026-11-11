import { onScopeDispose, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { itemsService, type ItemsService } from '@/services/api/items'
import { liveSocket, type ServerEvents } from '@/services/sync/socket'
import { useAuthStore } from '@/stores/auth'
import type { CreateItemRequest, Item, UpdateItemRequest } from '@/types/api'

// The error code of the API for an item that does not exist (anymore).
const ITEM_NOT_FOUND = 'ITEM_NOT_FOUND'

/** idle: not loaded yet. error: the last load failed (items may still be shown). */
export type ItemsStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The items of one list and how loading them went. */
interface ListItems {
  items: Item[]
  status: ItemsStatus
  errorCode: string | null
}

/**
 * Builds the store around a service, a getter for the ID of the signed-in
 * user and the source of server events (the live socket; tests pass a fake),
 * like defineListsStore. The store forgets everything when that ID
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
 * server afterwards; if the request fails, it goes back to the newest state
 * the server has sent. Everything else waits for the server, as the user
 * presses a button in a form anyway.
 *
 * Answers of the server arrive in any order and from several places (load,
 * the answer to a write). Each carries a serverSeq, which only grows, so the
 * store applies a state only if it is not older than what it has. A deleted
 * item stays deleted: the store remembers its ID and ignores every later
 * state of it.
 *
 * Changes of other members arrive as events and go the same way as answers.
 * Events are best effort, so after every (re)connect of the socket the store
 * loads again what it has loaded; see docs/sync.md.
 */
export function defineItemsStore(
  service: ItemsService,
  currentUserId: () => string | null,
  events: ServerEvents = liveSocket,
) {
  return defineStore('items', () => {
    const byList = ref<Record<string, ListItems>>({})

    // Everything below is bookkeeping for the rules above. It is not shown,
    // so it lives in plain Maps and Sets next to the reactive state, and
    // reset() empties it.

    // Bumped by reset(). A load that started before it is outdated when it
    // answers and must not put the old user's items back.
    let generation = 0

    // The newest setChecked() per item. Only the request that is still the
    // newest when it answers may touch the item: otherwise the late answer
    // to a first tap would overwrite a second tap.
    const latestCheck = new Map<string, number>()
    let checkCounter = 0

    // While a setChecked() runs, the item on screen shows the tap. This holds
    // the newest state the server has told us about, which is what the item
    // becomes when the request ends, whichever way.
    const checkBase = new Map<string, Item>()

    // IDs of items known to be deleted. Deleting wins over every edit, so a
    // late state of such an item is dropped whatever its serverSeq.
    const tombstones = new Set<string>()

    // A logical clock instead of timestamps: it only counts, so it cannot go
    // backwards or tie. touchedAt says when an item last got a state from the
    // server; a load remembers the clock at its start. An item that was
    // touched after that start may be missing from the answer only because
    // the answer is older than the item.
    let clock = 0
    const touchedAt = new Map<string, number>()
    // The start of the newest load whose answer was applied, per list. An
    // answer of a load that started before it is outdated.
    const appliedLoadStart = new Map<string, number>()

    function reset() {
      generation++
      byList.value = {}
      latestCheck.clear()
      checkBase.clear()
      tombstones.clear()
      touchedAt.clear()
      appliedLoadStart.clear()
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

    // The order of the server: oldest first, ties by ID. Dates are compared
    // as instants, not as text: the server drops trailing zeros of the
    // fraction, so "…:00.5Z" and "…:00.25Z" do not sort as strings.
    function compareItems(a: Item, b: Item): number {
      const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt)
      if (byTime !== 0) {
        return byTime
      }
      if (a.id === b.id) {
        return 0
      }
      return a.id < b.id ? -1 : 1
    }

    function insertSorted(entry: ListItems, item: Item) {
      const index = entry.items.findIndex((other) => compareItems(other, item) > 0)
      if (index === -1) {
        entry.items.push(item)
      } else {
        entry.items.splice(index, 0, item)
      }
    }

    // The state with the higher serverSeq. At a tie `a` wins: callers pass
    // the one that arrived later.
    function newer(a: Item, b: Item): Item {
      return a.serverSeq >= b.serverSeq ? a : b
    }

    // The server's item, with the checked fields of the tap on screen.
    function withCheckOf(server: Item, shown: Item): Item {
      return {
        ...server,
        checked: shown.checked,
        checkedBy: shown.checkedBy,
        checkedAt: shown.checkedAt,
      }
    }

    function touch(itemId: string) {
      touchedAt.set(itemId, ++clock)
    }

    /**
     * The one place where a state from the server (event or answer) enters
     * the store. An event must have a greater serverSeq than the item we
     * hold; an answer may be equal, because it can be the very state we hold
     * (e.g. the answer to create after the event of the same create).
     */
    function takeServerItem(item: Item, mode: 'event' | 'answer') {
      const entry = byList.value[item.listId]
      // A list we do not show: nothing to update, and loading it later gets
      // the current state anyway.
      if (!entry || tombstones.has(item.id)) {
        return
      }
      const index = entry.items.findIndex((i) => i.id === item.id)
      const local = entry.items[index]
      if (local) {
        const outdated =
          mode === 'event' ? item.serverSeq <= local.serverSeq : item.serverSeq < local.serverSeq
        if (outdated) {
          return
        }
      }
      touch(item.id)

      let shown = item
      if (local && latestCheck.has(item.id)) {
        // A tap is waiting for its answer: keep what the user sees, but
        // remember the server's state for when the request ends.
        const base = checkBase.get(item.id)
        checkBase.set(item.id, base ? newer(item, base) : item)
        shown = withCheckOf(item, local)
      }
      if (local) {
        entry.items[index] = shown
      } else {
        insertSorted(entry, shown)
      }
    }

    // Forgets an item for good, until reset(). `entry` is the list it was in,
    // if we know one.
    function forget(itemId: string, entry: ListItems | undefined) {
      tombstones.add(itemId)
      checkBase.delete(itemId)
      if (entry) {
        entry.items = entry.items.filter((item) => item.id !== itemId)
      }
    }

    /**
     * A deletion announced by the server. `serverSeq` is null when we only
     * know that the item is gone, not when.
     */
    function takeDeletion(listId: string, itemId: string, serverSeq: number | null) {
      const entry = byList.value[listId]
      if (!entry || tombstones.has(itemId)) {
        return
      }
      const local = entry.items.find((item) => item.id === itemId)
      // Cannot happen with the server's numbering (a deletion has a greater
      // serverSeq than any change before it), but costs one line to be sure.
      if (local && serverSeq !== null && local.serverSeq >= serverSeq) {
        return
      }
      forget(itemId, entry)
    }

    // The request of the newest tap ended: `stored` is its answer, or null if
    // it failed. The item becomes the newest state the server told us about.
    function settleCheck(itemId: string, stored: Item | null) {
      const base = checkBase.get(itemId)
      checkBase.delete(itemId)
      latestCheck.delete(itemId)
      const final = stored && base ? newer(stored, base) : (stored ?? base)
      if (final) {
        takeServerItem(final, 'answer')
      }
    }

    // False if the user changed since `started`, or if the answer of a load
    // that started later was applied already. Otherwise this load is now the
    // newest one applied.
    function isCurrentLoad(started: number, listId: string, startedAt: number): boolean {
      if (started !== generation || startedAt < (appliedLoadStart.get(listId) ?? 0)) {
        return false
      }
      appliedLoadStart.set(listId, startedAt)
      return true
    }

    // Puts the answer of a load into the list; see load().
    function mergeLoaded(entry: ListItems, loaded: Item[], startedAt: number) {
      // The raw array: its items are the plain objects, not the reactive
      // proxies around them, which must not end up inside the new array.
      const local = new Map(toRaw(entry.items).map((item) => [item.id, item]))
      const merged: Item[] = []

      for (const server of loaded) {
        if (tombstones.has(server.id)) {
          continue
        }
        const held = local.get(server.id)
        local.delete(server.id)
        if (!held) {
          merged.push(server)
        } else if (held.serverSeq > server.serverSeq) {
          // The answer is older than what we have.
          merged.push(held)
        } else if (latestCheck.has(server.id)) {
          const base = checkBase.get(server.id)
          const newest = base ? newer(server, base) : server
          checkBase.set(server.id, newest)
          merged.push(withCheckOf(newest, held))
        } else {
          merged.push(server)
        }
      }

      // What the answer does not list is gone on the server, unless it came
      // to us after this load started: then the answer may predate it.
      for (const [id, held] of local) {
        if ((touchedAt.get(id) ?? 0) > startedAt) {
          merged.push(held)
        } else {
          tombstones.add(id)
          checkBase.delete(id)
        }
      }

      entry.items = merged.sort(compareItems)
    }

    /**
     * Loads the items of a list and merges them into what the store has,
     * instead of replacing it: the answer may be older than a write that
     * finished while the request was on its way. A list that is loaded
     * already keeps its status `ready` meanwhile, so reloading shows no
     * spinner. If this fails, the items loaded before stay: an unreachable
     * server should not empty the screen.
     */
    async function load(listId: string) {
      const started = generation
      const startedAt = ++clock
      const entry = ensure(listId)
      if (entry.status !== 'ready') {
        entry.status = 'loading'
      }
      entry.errorCode = null
      try {
        const loaded = await service.list(listId)
        if (!isCurrentLoad(started, listId, startedAt)) {
          return
        }
        mergeLoaded(entry, loaded, startedAt)
        entry.status = 'ready'
      } catch (err) {
        if (!isCurrentLoad(started, listId, startedAt)) {
          return
        }
        entry.status = 'error'
        entry.errorCode = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    /**
     * Adds an item and returns it. The item comes from the answer of the
     * server; if it is in the store already, it is not added twice.
     */
    async function create(listId: string, request: CreateItemRequest): Promise<Item> {
      const started = generation
      const item = await service.create(listId, request)
      // After a reset the old user's item must not come back: ensure() would
      // create the list anew.
      if (started === generation) {
        ensure(listId)
        takeServerItem(item, 'answer')
      }
      return item
    }

    /**
     * Changes name, quantity, unit or note and takes the item as the server
     * stored it. Waits for the server; use setChecked() for the checkbox.
     */
    async function update(itemId: string, change: UpdateItemRequest) {
      const started = generation
      const stored = await service.update(itemId, change)
      if (started === generation) {
        takeServerItem(stored, 'answer')
      }
    }

    /**
     * Checks or unchecks an item at once and confirms with the server. If
     * the request fails, the item goes back to the newest state the server
     * has sent and the error is thrown, unless the item was deleted by
     * someone else meanwhile.
     */
    async function setChecked(itemId: string, checked: boolean) {
      const started = generation
      const item = byId(itemId)
      if (!item) {
        // Not in the store (anymore): nothing to show early, just send it.
        const stored = await service.update(itemId, { checked })
        if (started === generation) {
          takeServerItem(stored, 'answer')
        }
        return
      }

      // The first tap of a series: the item still shows the server's state.
      if (!latestCheck.has(itemId)) {
        checkBase.set(itemId, { ...toRaw(item) })
      }
      // The same fields the server sets; its answer replaces them below.
      item.checked = checked
      item.checkedBy = checked ? currentUserId() : null
      item.checkedAt = checked ? new Date().toISOString() : null

      const mine = ++checkCounter
      latestCheck.set(itemId, mine)
      try {
        const stored = await service.update(itemId, { checked })
        if (started !== generation) {
          return
        }
        if (latestCheck.get(itemId) === mine) {
          settleCheck(itemId, stored)
        } else {
          // An older tap, answered after a newer one. While the newer one
          // runs, this is one more state to remember; once it has ended,
          // this counts as an event and is dropped unless it is newer.
          takeServerItem(stored, 'event')
        }
      } catch (err) {
        if (started !== generation) {
          throw err
        }
        if (err instanceof ApiError && err.code === ITEM_NOT_FOUND) {
          // Someone else deleted the item; their event may not be here yet.
          forget(itemId, byList.value[item.listId])
        }
        if (latestCheck.get(itemId) === mine) {
          settleCheck(itemId, null)
        }
        if (tombstones.has(itemId)) {
          // Deleted by another member: the item disappears anyway, so there
          // is nothing to report.
          return
        }
        throw err
      }
    }

    async function remove(itemId: string) {
      const started = generation
      // Looked up first: the item is gone from the answer, and the list is
      // needed to drop it from the right place.
      const listId = byId(itemId)?.listId
      await service.remove(itemId)
      if (started === generation) {
        forget(itemId, listId === undefined ? undefined : byList.value[listId])
      }
    }

    // The setup function runs in the effect scope of the store, so
    // onScopeDispose() runs at $dispose(): the handlers must not outlive the
    // store, as the socket outlives it.
    const unsubscribes = [
      events.on('itemChanged', ({ payload }) => takeServerItem(payload.item, 'event')),
      events.on('itemDeleted', ({ payload }) =>
        takeDeletion(payload.listId, payload.itemId, payload.serverSeq),
      ),
      events.on('itemsDeleted', ({ payload }) => {
        for (const deleted of payload.items) {
          takeDeletion(payload.listId, deleted.itemId, deleted.serverSeq)
        }
      }),
      // Events are best effort and the connection may have been down:
      // everything we have loaded (or are loading) may be outdated. Lists
      // never loaded stay untouched; ListView loads them when opened.
      events.on('ready', () => {
        for (const [listId, entry] of Object.entries(byList.value)) {
          if (entry.status !== 'idle') {
            void load(listId)
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
