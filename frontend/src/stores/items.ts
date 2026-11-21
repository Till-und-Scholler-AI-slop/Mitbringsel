import { computed, onScopeDispose, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { itemsService, MAX_REMOVE_CHECKED, type ItemsService } from '@/services/api/items'
import { localData, type LocalData } from '@/services/storage/localData'
import { createPersistQueue } from '@/services/storage/persistQueue'
import { createClock, type HLCClock } from '@/services/sync/hlc'
import {
  createOutbox,
  type Outbox,
  type OutboxAnswer,
  type OutboxChange,
  type OutboxEntry,
  type OutboxOptions,
} from '@/services/sync/outbox'
import { applyPending, foldPending, type QueuedChange } from '@/services/sync/pending'
import { liveSocket, type ServerEvents } from '@/services/sync/socket'
import { uuidv7 } from '@/services/sync/uuidv7'
import { useAuthStore } from '@/stores/auth'
import type { CreateItemRequest, GroupItemList, Item, UpdateItemRequest } from '@/types/api'

// The error code of the API for an item that does not exist (anymore).
const ITEM_NOT_FOUND = 'ITEM_NOT_FOUND'
// The error code of the API for a create whose ID belongs to another item,
// e.g. one deleted since: sending a create again after a delete.
const ITEM_ID_TAKEN = 'ITEM_ID_TAKEN'

/** idle: not loaded yet. error: the last load failed (items may still be shown). */
export type ItemsStatus = 'idle' | 'loading' | 'ready' | 'error'

/** A new item as the caller gives it; the store adds the ID and the clock. */
export type NewItem = Omit<CreateItemRequest, 'id' | 'clock'>

/** The fields an edit changes; the store adds the clock. */
export type ItemChange = Omit<UpdateItemRequest, 'clock'>

/** Which kind of own change the server refused. */
export type ItemRejectionKind = 'create' | 'update' | 'check' | 'remove'

/** An own change the server refused: the item shows its state again. */
export interface ItemRejection {
  kind: ItemRejectionKind
  /** The name of the item, as the user knows it. */
  name: string
  /** The error code of the API, or OUTBOX_EXPIRED. */
  code: string
}

/** What the store passes when it opens the outbox of a user. */
export type OutboxCallbacks = Required<Pick<OutboxOptions, 'userId' | 'onSent' | 'onRejected'>>

/** The parts of offline writing that tests replace. */
export interface ItemsOffline {
  openOutbox: (options: OutboxCallbacks) => Outbox
  // The HLC of this tab, which stamps every change.
  clock: HLCClock
  // The ID of a new item.
  newId: () => string
}

/**
 * Items hidden by startRemovingChecked() or startRemovingItem() until the
 * removal is sent or undone.
 */
export interface PendingRemoval {
  /** The hidden items as they were when hidden, oldest first. */
  items: Item[]
  /**
   * Sends the removal. Removing one item only puts it into the outbox: it
   * stays hidden as a pending change, and a refusal of the server reaches
   * onRejected(), not the caller. Removing the checked items still sends
   * at once (#133): what the server deleted is gone for good, the rest
   * (e.g. unchecked by someone meanwhile) shows again, and if a request
   * fails, every item the server did not confirm shows again and the
   * ApiError is thrown. Only the first call of commit() or undo() counts.
   */
  commit(): Promise<void>
  /** Shows the items again without sending anything. */
  undo(): void
}

/** The part of the local storage the items store uses. */
export type ItemsLocal = Pick<LocalData, 'readItems' | 'writeItems' | 'removeItems'>

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
 *
 * Writing goes through the outbox (services/sync/outbox.ts, ADR 0006): the
 * store stamps the change with the HLC of the tab (a new item also gets a
 * UUIDv7), puts it into the outbox and shows it at once, whatever the
 * network does. The writing actions never reject with an ApiError: the
 * outbox sends later, maybe after a reload. If the server refuses a change,
 * the item shows the state of the server again and onRejected() tells the
 * listeners (the toasts, useItemRejections). The store owns the outbox of
 * the signed-in user: it opens one at the sign-in and stops it when the
 * user changes.
 *
 * What the user sees is the state of the server with the pending changes
 * on top (services/sync/pending.ts): the changes in the outbox, including
 * those of other tabs, and those of this tab that are on their way into
 * it. The store itself keeps only what the server confirmed; an answer
 * replaces the item and its change leaves the overlay.
 *
 * Answers of the server arrive in any order and from several places (load,
 * the answer to a write). Each carries a serverSeq, which only grows, so the
 * store applies a state only if it is not older than what it has. A deleted
 * item stays deleted: the store remembers its ID and ignores every later
 * state of it.
 *
 * Removing waits the other way round: the items disappear at once, but the
 * removal only goes to the outbox (or, for the checked items, to the
 * server) when the caller commits, a few seconds later, so "undo" never has
 * to bring items back on the server (deleting wins,
 * docs/adr/0004-lww-pro-feld.md). Until then the items stay in the store
 * and are only hidden from the readers.
 *
 * Changes of other members arrive as events and go the same way as answers.
 * Events are best effort, so after every (re)connect of the socket the
 * preload (services/sync/preload.ts) loads the items of every household
 * with loadGroup() and the rest of what the store has loaded with
 * reloadLoaded(); see docs/sync.md.
 *
 * The items of each list are kept on the device (`storage`, ADR 0006), as in
 * the lists store: the first load of a list reads them next to the request,
 * they only fill what the store does not hold, the status stays `loading`
 * until the server answers, and the store writes the items of a list back
 * whenever a state from the server changed them. Only what the server
 * confirmed is stored; pending changes live in the outbox alone. Items
 * hidden by a pending removal are stored, as they still exist on the
 * server.
 */
export function defineItemsStore(
  service: ItemsService,
  currentUserId: () => string | null,
  events: ServerEvents = liveSocket,
  storage: ItemsLocal = localData,
  offline: Partial<ItemsOffline> = {},
) {
  const openOutbox =
    offline.openOutbox ??
    ((options: OutboxCallbacks) => createOutbox({ ...options, storage: localData, items: service }))
  const newId = offline.newId ?? (() => uuidv7())

  return defineStore('items', () => {
    // One clock per tab (per store), see hlc.ts. Named hlc, as `clock`
    // below is the logical clock of the loads.
    const hlc = offline.clock ?? createClock()

    // What the server confirmed, per list.
    const byList = ref<Record<string, ListItems>>({})

    // Everything below is bookkeeping for the rules above. What the readers
    // do not depend on lives in plain Maps and Sets next to the reactive
    // state, and reset() empties it.

    // Bumped by reset(). A load that started before it is outdated when it
    // answers and must not put the old user's items back.
    let generation = 0

    // IDs of items known to be deleted. Deleting wins over every edit, so a
    // late state of such an item is dropped whatever its serverSeq. Reactive:
    // an item that only a pending create shows disappears when its ID gets
    // a tombstone, without any change to byList.
    const tombstones = reactive(new Set<string>())

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
    // When forgetList() dropped a list. The answer of a household that
    // started before must not bring the list back: the list is gone.
    const forgottenAt = new Map<string, number>()

    // Items of a pending removal and how they hide. Read by the readers, so
    // reactive. 'whileChecked' (removing the checked items): one that
    // someone unchecks meanwhile shows up again among the open items, as the
    // server will skip it. 'always' (removing one item): it goes whatever
    // happens to it meanwhile, as deleting wins.
    const hidden = ref(new Map<string, 'whileChecked' | 'always'>())

    // Writes to the local storage, coalesced (see persistQueue).
    const persistQueue = createPersistQueue()
    // Lists whose items the store holds as the device or the server knows
    // them: the stored items were read, or a load answer was applied. Before
    // that, writing would replace the stored items with a partial state,
    // e.g. only an item created before the stored ones were read.
    const holdsState = new Set<string>()

    // The outbox of the signed-in user, null without one.
    let outbox: Outbox | null = null
    let unsubscribeOutbox: (() => void) | null = null
    // The pending changes, in three parts. The overlay is all of them; a
    // change in two parts at once counts once (foldPending).
    // - stored: the entries of the outbox at its newest read, those of other
    //   tabs too. Read again whenever the outbox changes.
    const stored = shallowRef<OutboxEntry[]>([])
    // - local: changes of this tab on their way into the outbox, so a tap
    //   shows before the outbox has stored it and been read again.
    const local = shallowRef<QueuedChange[]>([])
    // - settled: entries this tab got the answer or refusal of. A read that
    //   started before may still list them; their state is the server's now.
    const settled = shallowRef<ReadonlySet<number>>(new Set())
    // Reads of the outbox answer in any order: only the newest one counts.
    let readCounter = 0
    let appliedRead = 0

    const rejectionListeners = new Set<(rejection: ItemRejection) => void>()

    function reset() {
      generation++
      byList.value = {}
      tombstones.clear()
      touchedAt.clear()
      appliedLoadStart.clear()
      forgottenAt.clear()
      hidden.value = new Map()
      holdsState.clear()
      persistQueue.clear()
      stored.value = []
      local.value = []
      settled.value = new Set()
    }

    // The receive rule of the HLC: the next change of this tab must be
    // newer than every clock it has seen, even if the device time is
    // behind. Also for states that are dropped: the clock was real.
    function observeItem(item: Item) {
      for (const fieldClock of Object.values(item.clocks)) {
        hlc.observe(fieldClock)
      }
    }

    function observeChange(change: OutboxChange) {
      if (change.kind === 'create' && change.item.clock) hlc.observe(change.item.clock)
      if (change.kind === 'update' && change.change.clock) hlc.observe(change.change.clock)
    }

    // Writes the items of the list to the device once the current code is
    // done. The user is taken now: the storage ignores writes for another
    // owner. The state is read when the write runs, so a list dropped
    // meanwhile is not written (forgetList removed it). byList holds only
    // what the server confirmed, so it is written as it is.
    function persist(listId: string) {
      const userId = currentUserId()
      if (!holdsState.has(listId) || !userId) {
        return
      }
      persistQueue.schedule(listId, () => {
        const entry = byList.value[listId]
        if (entry) {
          return storage.writeItems(userId, listId, toRaw(entry.items))
        }
      })
    }

    // Reads the stored items of the list on its first load. Skipped if the
    // user changed meanwhile, the list was dropped, or a load answer was
    // applied already: that one is newer.
    async function restore(listId: string, started: number) {
      const userId = currentUserId()
      if (!userId) {
        return
      }
      const saved = await storage.readItems(userId, listId)
      const entry = byList.value[listId]
      if (started !== generation || !entry || appliedLoadStart.has(listId)) {
        return
      }
      holdsState.add(listId)
      if (saved) {
        mergeStored(entry, saved)
      }
    }

    // Adds the stored items the list does not hold. What it holds came from
    // the server since the start and is newer; a deleted item stays deleted.
    // They are not touched(): the answer of the server may still drop them.
    function mergeStored(entry: ListItems, saved: Item[]) {
      saved.forEach(observeItem)
      const held = new Set(entry.items.map((item) => item.id))
      const missing = saved.filter((item) => !held.has(item.id) && !tombstones.has(item.id))
      if (missing.length > 0) {
        entry.items = [...toRaw(entry.items), ...missing].sort(compareItems)
      }
    }

    // The entry of a list, created on first use. The reading functions below
    // do not create one, so looking at a list does not change the state.
    function ensure(listId: string): ListItems {
      byList.value[listId] ??= { items: [], status: 'idle', errorCode: null }
      return byList.value[listId]
    }

    // The pending changes per item. Entries this tab is done with no longer
    // count, even if the newest read still lists them.
    const pending = computed(() =>
      foldPending(
        [...stored.value.filter((entry) => !settled.value.has(entry.seq)), ...local.value],
        currentUserId(),
      ),
    )

    // What the readers show: per list the items of the server with their
    // pending changes, plus the items that only a pending create knows. An
    // item without pending changes is the server's own object, so a change
    // to one item does not hand new objects for all the others to the view.
    // A created item shows only in a list the store holds: a list that is
    // not loaded would show it alone, as if it had no other items.
    const shown = computed(() => {
      const changes = pending.value
      const createdIn = new Map<string, string[]>()
      for (const [itemId, change] of changes) {
        if (!change.created) continue
        const ids = createdIn.get(change.created.listId) ?? []
        ids.push(itemId)
        createdIn.set(change.created.listId, ids)
      }

      const perList: Record<string, Item[]> = {}
      const perId = new Map<string, Item>()
      for (const [listId, entry] of Object.entries(byList.value)) {
        const items: Item[] = []
        const onServer = new Set<string>()
        for (const server of entry.items) {
          onServer.add(server.id)
          const change = changes.get(server.id)
          const item = change ? applyPending(server, change) : server
          if (item) items.push(item)
        }
        let added = false
        for (const itemId of createdIn.get(listId) ?? []) {
          const change = changes.get(itemId)
          if (onServer.has(itemId) || !change) continue
          const item = applyPending(undefined, change, { tombstoned: tombstones.has(itemId) })
          if (item) {
            items.push(item)
            added = true
          }
        }
        if (added) items.sort(compareItems)
        perList[listId] = items
        for (const item of items) perId.set(item.id, item)
      }
      return { perList, perId }
    })

    function isHidden(item: Item): boolean {
      const how = hidden.value.get(item.id)
      return how === 'always' || (how === 'whileChecked' && item.checked)
    }

    /** All items of the list, oldest first, without those being removed. */
    function itemsOf(listId: string): Item[] {
      return (shown.value.perList[listId] ?? []).filter((item) => !isHidden(item))
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

    /**
     * Finds an item in any list that was loaded, as it shows: with its
     * pending changes. Change it only through the actions below.
     */
    function byId(itemId: string): Item | undefined {
      return shown.value.perId.get(itemId)
    }

    // The item as the server has it, in any list that was loaded.
    function serverItem(itemId: string): Item | undefined {
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
      observeItem(item)
      const entry = byList.value[item.listId]
      // A list we do not show: nothing to update, and loading it later gets
      // the current state anyway.
      if (!entry || tombstones.has(item.id)) {
        return
      }
      const index = entry.items.findIndex((i) => i.id === item.id)
      const held = entry.items[index]
      if (held) {
        const outdated =
          mode === 'event' ? item.serverSeq <= held.serverSeq : item.serverSeq < held.serverSeq
        if (outdated) {
          return
        }
      }
      touch(item.id)
      if (held) {
        entry.items[index] = item
      } else {
        insertSorted(entry, item)
      }
      persist(item.listId)
    }

    // Forgets an item for good, until reset(). `listId` is the list it was
    // in, if we know one.
    function forget(itemId: string, listId: string | undefined) {
      tombstones.add(itemId)
      const entry = listId === undefined ? undefined : byList.value[listId]
      if (entry) {
        entry.items = entry.items.filter((item) => item.id !== itemId)
      }
      if (listId !== undefined) {
        persist(listId)
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
      const held = entry.items.find((item) => item.id === itemId)
      // Cannot happen with the server's numbering (a deletion has a greater
      // serverSeq than any change before it), but costs one line to be sure.
      if (held && serverSeq !== null && held.serverSeq >= serverSeq) {
        return
      }
      forget(itemId, listId)
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

    // Puts the answer of a load into the list; see load(). An item that
    // only a pending create shows is not in byList, so the answer cannot
    // count it as deleted.
    function mergeLoaded(entry: ListItems, loaded: Item[], startedAt: number) {
      loaded.forEach(observeItem)
      // The raw array: its items are the plain objects, not the reactive
      // proxies around them, which must not end up inside the new array.
      const held = new Map(toRaw(entry.items).map((item) => [item.id, item]))
      const merged: Item[] = []

      for (const server of loaded) {
        if (tombstones.has(server.id)) {
          continue
        }
        const mine = held.get(server.id)
        held.delete(server.id)
        // The answer is older than what we have.
        merged.push(mine && mine.serverSeq > server.serverSeq ? mine : server)
      }

      // What the answer does not list is gone on the server, unless it came
      // to us after this load started: then the answer may predate it.
      for (const [id, mine] of held) {
        if ((touchedAt.get(id) ?? 0) > startedAt) {
          merged.push(mine)
        } else {
          tombstones.add(id)
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
     *
     * The first load of a list also reads its items stored on the device,
     * at the same time as the request.
     */
    async function load(listId: string) {
      const started = generation
      const startedAt = ++clock
      const entry = ensure(listId)
      const restoring = entry.status === 'idle' ? restore(listId, started) : null
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
        // Not for a list forgotten meanwhile: forgetList removed its stored
        // items, and this late answer must not bring them back.
        if (byList.value[listId] === entry) {
          holdsState.add(listId)
          persist(listId)
        }
        entry.status = 'ready'
      } catch (err) {
        // Offline the request fails at once: wait for the stored items, so
        // the screen does not show the error before they are there.
        await restoring
        if (!isCurrentLoad(started, listId, startedAt)) {
          return
        }
        entry.status = 'error'
        entry.errorCode = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      }
    }

    /**
     * Loads the items of every active list of a household with one request
     * and merges each list as load() does. A list the answer covers without
     * items is empty: what the store or the device held of it goes. Returns
     * the IDs of the lists the answer covers, or null if the request failed
     * or the user changed meanwhile.
     *
     * It runs in the background (the preload), so a failure changes nothing:
     * no list shows an error for a request no screen asked for.
     */
    async function loadGroup(groupId: string): Promise<string[] | null> {
      const started = generation
      const startedAt = ++clock
      let answer: GroupItemList
      try {
        answer = await service.listGroup(groupId)
      } catch {
        return null
      }
      if (started !== generation) {
        return null
      }

      const loaded = new Map<string, Item[]>(answer.listIds.map((listId) => [listId, []]))
      for (const item of answer.items) {
        loaded.get(item.listId)?.push(item)
      }
      for (const [listId, items] of loaded) {
        if (
          (forgottenAt.get(listId) ?? 0) > startedAt ||
          !isCurrentLoad(started, listId, startedAt)
        ) {
          continue
        }
        const entry = ensure(listId)
        mergeLoaded(entry, items, startedAt)
        holdsState.add(listId)
        persist(listId)
        entry.status = 'ready'
        entry.errorCode = null
      }
      return answer.listIds
    }

    /**
     * Loads again every list that was loaded (or is loading), except those
     * in `skip`, e.g. the lists a loadGroup() just covered. Lists never
     * loaded stay untouched; ListView loads them when opened.
     */
    function reloadLoaded(skip: ReadonlySet<string> = new Set()) {
      for (const [listId, entry] of Object.entries(byList.value)) {
        if (entry.status !== 'idle' && !skip.has(listId)) {
          void load(listId)
        }
      }
    }

    // Reads the outbox again. Every change of it calls this, in this tab or
    // another one; a read that answers after a newer one is dropped, and so
    // is one of the outbox of a previous user.
    async function refresh() {
      const box = outbox
      if (!box) return
      const id = ++readCounter
      let entries: OutboxEntry[]
      try {
        entries = await box.entries()
      } catch (err) {
        // The next change of the outbox reads it again.
        console.warn('items: reading the outbox failed', err)
        return
      }
      if (box !== outbox || id <= appliedRead) return
      appliedRead = id
      for (const entry of entries) observeChange(entry.change)
      stored.value = entries
      // Seqs are never used twice, so a settled entry that this read no
      // longer lists will not come back: no read that started earlier is
      // applied any more.
      const listed = new Set(entries.map((entry) => entry.seq))
      if ([...settled.value].some((seq) => !listed.has(seq))) {
        settled.value = new Set([...settled.value].filter((seq) => listed.has(seq)))
      }
    }

    // Puts a change into the outbox. It shows at once (local) and until the
    // read after storing it lists it (stored), so it never flickers.
    async function write(change: OutboxChange) {
      const box = outbox
      if (!box) return
      const started = generation
      const queued: QueuedChange = { change, queuedAt: Date.now() }
      local.value = [...local.value, queued]
      try {
        await box.enqueue(change)
        if (started === generation) await refresh()
      } finally {
        // After a reset, `local` belongs to the next user.
        if (started === generation) local.value = local.value.filter((q) => q !== queued)
      }
    }

    function settle(seq: number) {
      settled.value = new Set(settled.value).add(seq)
    }

    // onSent: the change left the outbox, the answer is the state of the
    // server now. Both happen in the same tick, so the item does not flash
    // back to the state before the change.
    function takeAnswer(entry: OutboxEntry, answer: OutboxAnswer) {
      settle(entry.seq)
      const change = entry.change
      if (answer.kind === 'create' || answer.kind === 'update') {
        takeServerItem(answer.item, 'answer')
      } else if (answer.kind === 'remove' && change.kind === 'remove') {
        forget(change.itemId, serverItem(change.itemId)?.listId)
      } else if (answer.kind === 'removeChecked' && change.kind === 'removeChecked') {
        for (const gone of answer.deleted) {
          takeDeletion(change.listId, gone.itemId, gone.serverSeq)
        }
      }
    }

    // What a refused change was, for the message. Only checked set:
    // the checkbox; any other field: an edit.
    function rejectionKindOf(change: OutboxChange): ItemRejectionKind | null {
      switch (change.kind) {
        case 'create':
          return 'create'
        case 'update': {
          const fields = Object.keys(change.change).filter((key) => key !== 'clock')
          return fields.length === 1 && fields[0] === 'checked' ? 'check' : 'update'
        }
        case 'remove':
          return 'remove'
        case 'removeChecked':
          // #133 decides how a refused "remove checked" is reported.
          return null
      }
    }

    // onRejected: the change left the outbox unsent or refused, so the item
    // shows the state of the server again, and the listeners say why.
    function takeRejection(entry: OutboxEntry, error: ApiError) {
      const change = entry.change
      const itemId =
        change.kind === 'create'
          ? change.item.id
          : change.kind === 'removeChecked'
            ? null
            : change.itemId
      // Looked up before settling: the server state is what shows again.
      const server = itemId ? serverItem(itemId) : undefined
      settle(entry.seq)

      // Someone else deleted the item (or its list) meanwhile: it goes
      // anyway, so there is nothing to report (ADR 0006, addendum #132).
      if (
        itemId &&
        (error.code === ITEM_NOT_FOUND ||
          (change.kind === 'create' && error.code === ITEM_ID_TAKEN))
      ) {
        forget(itemId, server?.listId ?? (change.kind === 'create' ? change.listId : undefined))
        return
      }
      // The server never stored the item: a create of the same ID that
      // another tab still lists must not show it.
      if (change.kind === 'create') tombstones.add(change.item.id)

      const kind = rejectionKindOf(change)
      const name = change.kind === 'create' ? change.item.name : server?.name
      if (kind === null || name === undefined) return
      for (const listener of [...rejectionListeners]) {
        listener({ kind, name, code: error.code })
      }
    }

    /**
     * Adds an item. It shows at once, with an ID and the time from this
     * device, in a list the store holds; the answer of the server replaces
     * it.
     */
    async function create(listId: string, item: NewItem): Promise<void> {
      await write({ kind: 'create', listId, item: { ...item, id: newId(), clock: hlc.next() } })
    }

    /** Changes name, quantity, unit or note; shows at once. */
    async function update(itemId: string, change: ItemChange): Promise<void> {
      await write({ kind: 'update', itemId, change: { ...change, clock: hlc.next() } })
    }

    /**
     * Checks or unchecks an item; shows at once, checked by the user now
     * until the answer of the server says by whom and when.
     */
    async function setChecked(itemId: string, checked: boolean): Promise<void> {
      await write({ kind: 'update', itemId, change: { checked, clock: hlc.next() } })
    }

    /** Deletes an item; it disappears at once. */
    async function remove(itemId: string): Promise<void> {
      await write({ kind: 'remove', itemId })
    }

    /**
     * Calls `listener` whenever the server refuses an own change of this
     * tab, with the name of the item; not when the item was deleted by
     * someone else meanwhile. Returns a function that ends this.
     */
    function onRejected(listener: (rejection: ItemRejection) => void): () => void {
      rejectionListeners.add(listener)
      return () => {
        rejectionListeners.delete(listener)
      }
    }

    /**
     * Hides `items` until the returned removal is committed or undone.
     * `send` does the requests and applies their answers; it is given a
     * check whether the user is still the same. Whatever it did not delete
     * shows again afterwards, also when it throws.
     */
    function startRemoval(
      items: Item[],
      how: 'whileChecked' | 'always',
      send: (current: () => boolean) => Promise<void>,
    ): PendingRemoval {
      const started = generation
      const current = () => started === generation
      const ids = items.map((item) => item.id)
      for (const id of ids) {
        hidden.value.set(id, how)
      }
      let done = false

      function show() {
        // After a reset the map belongs to the next user.
        if (!current()) return
        for (const id of ids) {
          hidden.value.delete(id)
        }
      }

      async function commit() {
        if (done) return
        done = true
        try {
          await send(current)
        } finally {
          show()
        }
      }

      function undo() {
        if (done) return
        done = true
        show()
      }

      return { items, commit, undo }
    }

    /**
     * Hides the checked items of the list at once and returns how to finish:
     * commit() sends the removal, undo() shows the items again. Null if the
     * list has no checked items. The IDs are taken now, so an item someone
     * checks meanwhile is not removed with them.
     */
    function startRemovingChecked(listId: string): PendingRemoval | null {
      const items = checkedItems(listId).map((item) => ({ ...toRaw(item) }))
      if (items.length === 0) {
        return null
      }
      const ids = items.map((item) => item.id)
      return startRemoval(items, 'whileChecked', async (current) => {
        // One request per block, as the server takes only so many IDs. Each
        // answer is applied at once, so a failing later block does not bring
        // back what an earlier one deleted.
        for (let start = 0; start < ids.length; start += MAX_REMOVE_CHECKED) {
          const block = ids.slice(start, start + MAX_REMOVE_CHECKED)
          const deleted = await service.removeChecked(listId, block)
          if (!current()) return
          for (const gone of deleted) {
            takeDeletion(listId, gone.itemId, gone.serverSeq)
          }
        }
      })
    }

    /**
     * Hides one item at once, checked or not, and returns how to finish, as
     * startRemovingChecked() does. Null if the store does not show the item
     * (anymore). commit() puts the removal into the outbox, where it keeps
     * the item hidden until the server deleted it; a tab closed before
     * commit() loses the removal.
     */
    function startRemovingItem(itemId: string): PendingRemoval | null {
      const item = byId(itemId)
      if (!item || isHidden(item)) {
        return null
      }
      return startRemoval([{ ...toRaw(item) }], 'always', async (current) => {
        // Not for the next user, whose outbox this would be.
        if (current()) await write({ kind: 'remove', itemId })
      })
    }

    /**
     * Drops a list that is gone for us: deleted, or its group was left. The
     * lists store calls this, as it knows which lists belong to a group.
     * Without the entry, reloadLoaded() does not load the list again and
     * events for it are dropped. A load still on its way writes into the
     * dropped entry, which nobody sees; the answer of a household that
     * started before does not bring it back.
     */
    function forgetList(listId: string) {
      // Also when the list was never loaded: the device may still hold its
      // items from an earlier visit.
      holdsState.delete(listId)
      const userId = currentUserId()
      if (userId) {
        persistQueue.schedule(listId, () => storage.removeItems(userId, listId))
      }
      delete byList.value[listId]
      appliedLoadStart.delete(listId)
      forgottenAt.set(listId, ++clock)
    }

    function closeOutbox() {
      unsubscribeOutbox?.()
      unsubscribeOutbox = null
      outbox?.stop()
      outbox = null
    }

    // Opens the outbox of the signed-in user and stops the one of the user
    // before. Its getter answers null once the user changed, so the old
    // outbox neither sends nor reports for the next user; callbacks that
    // still arrive are dropped by the generation. Placed after everything
    // it uses, as `immediate` runs it right here.
    watch(
      currentUserId,
      (userId) => {
        reset()
        closeOutbox()
        if (userId === null) return
        const opened = generation
        const box = openOutbox({
          userId: () => (currentUserId() === userId ? userId : null),
          onSent: (entry, answer) => {
            if (opened === generation) takeAnswer(entry, answer)
          },
          onRejected: (entry, error) => {
            if (opened === generation) takeRejection(entry, error)
          },
        })
        outbox = box
        unsubscribeOutbox = box.subscribe(() => void refresh())
        void refresh()
        // What is left from before (a reload, the last session) goes out now.
        box.trigger()
      },
      { immediate: true },
    )

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
    ]
    onScopeDispose(() => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
      closeOutbox()
    })

    return {
      itemsOf,
      openItems,
      checkedItems,
      statusOf,
      errorCodeOf,
      byId,
      load,
      loadGroup,
      reloadLoaded,
      create,
      update,
      setChecked,
      remove,
      onRejected,
      startRemovingChecked,
      startRemovingItem,
      forgetList,
    }
  })
}

export const useItemsStore = defineItemsStore(itemsService, () => useAuthStore().user?.id ?? null)
