import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { Group, Item, List, MeResponse } from '@/types/api'

/**
 * Keeps the data of the signed-in user in IndexedDB, so the app can start
 * and show households, lists and items without a network (ADR 0006).
 *
 * The storage belongs to one user at a time: the stored profile ("me") names
 * the owner. Claiming it for another user removes everything first, so the
 * data of two users never sits on one device side by side. Every read and
 * write names the user it is for and does nothing if that user is not the
 * owner (anymore), for example when a load of the previous user finishes
 * after a switch.
 *
 * It saves whole states, one per household (lists) or list (items), the
 * same way the stores merge whole responses.
 *
 * Like the signed-in marker, it never throws: without IndexedDB (blocked
 * site data, some private windows) the app keeps working online, it just
 * cannot start offline. Reads then return null.
 */
export interface LocalData {
  // The profile of the owner, or null if there is none. Needs no user: the
  // app reads it to start without a network, before it knows who is signed in.
  readMe(): Promise<MeResponse | null>
  // Makes me.id the owner and stores the profile. Removes all data first if
  // it belonged to another user.
  claim(me: MeResponse): Promise<void>

  readGroups(userId: string): Promise<Group[] | null>
  writeGroups(userId: string, groups: Group[]): Promise<void>

  // The lists of one household, archived ones included.
  readLists(userId: string, groupId: string): Promise<List[] | null>
  writeLists(userId: string, groupId: string, lists: List[]): Promise<void>
  removeLists(userId: string, groupId: string): Promise<void>

  readItems(userId: string, listId: string): Promise<Item[] | null>
  writeItems(userId: string, listId: string, items: Item[]): Promise<void>
  removeItems(userId: string, listId: string): Promise<void>

  // Removes everything, the owner too (explicit logout).
  clear(): Promise<void>
}

export const LOCAL_DATA_DB_NAME = 'mitbringsel'
const DB_VERSION = 1
const ME_KEY = 'me'
// The single key of the groups store: the user has one list of households.
const GROUPS_KEY = 'all'

// The object stores. Keys are out of line: a value is a whole array, its key
// the household or list it belongs to.
interface Schema extends DBSchema {
  meta: { key: typeof ME_KEY; value: MeResponse }
  groups: { key: typeof GROUPS_KEY; value: Group[] }
  lists: { key: string; value: List[] } // by group ID
  items: { key: string; value: Item[] } // by list ID
}

type DataStore = 'groups' | 'lists' | 'items'
const DATA_STORES: DataStore[] = ['groups', 'lists', 'items']

type DB = IDBPDatabase<Schema>

function warn(action: string, err: unknown) {
  console.warn(`local data: ${action} failed`, err)
}

// A plain copy of data from a store. IndexedDB cannot clone Vue's reactive
// proxies (DataCloneError); the data came as JSON, so JSON copies it fully.
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createLocalData(name = LOCAL_DATA_DB_NAME): LocalData {
  // The open connection, shared by all calls. null after a failure or when
  // the browser closed it, so the next call tries again.
  let opening: Promise<DB> | null = null

  function db(): Promise<DB> {
    if (opening) return opening
    const p = openDB<Schema>(name, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('meta')
        database.createObjectStore('groups')
        database.createObjectStore('lists')
        database.createObjectStore('items')
      },
      // Another tab wants a newer version (a new app version): close this
      // connection so it can upgrade. The next call opens the new version.
      blocking(_current, _blocked, event) {
        ;(event.target as IDBDatabase).close()
        if (opening === p) opening = null
      },
      terminated() {
        if (opening === p) opening = null
      },
    })
    p.catch(() => {
      if (opening === p) opening = null
    })
    opening = p
    return p
  }

  // Runs fn and turns every failure into a warning and the fallback.
  async function safely<T>(action: string, fallback: T, fn: (d: DB) => Promise<T>): Promise<T> {
    try {
      return await fn(await db())
    } catch (err) {
      warn(action, err)
      return fallback
    }
  }

  // Waits for fn and for the transaction to commit. Both promises get a
  // handler at once, so a failed request does not leave the rejected
  // tx.done unhandled.
  async function inTx<T>(tx: { done: Promise<void> }, fn: () => Promise<T>): Promise<T> {
    const [result] = await Promise.all([fn(), tx.done])
    return result
  }

  // Reads key from store if userId owns the storage. Owner and data are read
  // in one transaction, so a claim by another user cannot slip in between.
  function read<S extends DataStore>(
    store: S,
    userId: string,
    key: Schema[S]['key'],
  ): Promise<Schema[S]['value'] | null> {
    return safely(`read ${store}`, null, async (d) => {
      const tx = d.transaction(['meta', store])
      return inTx(tx, async () => {
        const me = await tx.objectStore('meta').get(ME_KEY)
        if (me?.id !== userId) return null
        return (await tx.objectStore(store).get(key)) ?? null
      })
    })
  }

  // Writes value under key (or deletes key for undefined) if userId owns
  // the storage, in the same transaction as the check.
  function write<S extends DataStore>(
    store: S,
    userId: string,
    key: Schema[S]['key'],
    value: Schema[S]['value'] | undefined,
  ): Promise<void> {
    const copy = value === undefined ? undefined : plain(value)
    return safely(`write ${store}`, undefined, async (d) => {
      const tx = d.transaction(['meta', store], 'readwrite')
      await inTx(tx, async () => {
        const me = await tx.objectStore('meta').get(ME_KEY)
        if (me?.id !== userId) return
        const target = tx.objectStore(store)
        await (copy === undefined ? target.delete(key) : target.put(copy, key))
      })
    })
  }

  return {
    readMe: () => safely('read me', null, async (d) => (await d.get('meta', ME_KEY)) ?? null),

    claim(me) {
      const copy = plain(me)
      return safely('claim', undefined, async (d) => {
        const tx = d.transaction(['meta', ...DATA_STORES], 'readwrite')
        await inTx(tx, async () => {
          const meta = tx.objectStore('meta')
          const previous = await meta.get(ME_KEY)
          if (previous && previous.id !== copy.id) {
            await Promise.all(DATA_STORES.map((s) => tx.objectStore(s).clear()))
          }
          await meta.put(copy, ME_KEY)
        })
      })
    },

    readGroups: (userId) => read('groups', userId, GROUPS_KEY),
    writeGroups: (userId, groups) => write('groups', userId, GROUPS_KEY, groups),

    readLists: (userId, groupId) => read('lists', userId, groupId),
    writeLists: (userId, groupId, lists) => write('lists', userId, groupId, lists),
    removeLists: (userId, groupId) => write('lists', userId, groupId, undefined),

    readItems: (userId, listId) => read('items', userId, listId),
    writeItems: (userId, listId, items) => write('items', userId, listId, items),
    removeItems: (userId, listId) => write('items', userId, listId, undefined),

    clear: () =>
      safely('clear', undefined, async (d) => {
        const tx = d.transaction(['meta', ...DATA_STORES], 'readwrite')
        await inTx(tx, () =>
          Promise.all([
            tx.objectStore('meta').clear(),
            ...DATA_STORES.map((s) => tx.objectStore(s).clear()),
          ]),
        )
      }),
  }
}

export const localData = createLocalData()
