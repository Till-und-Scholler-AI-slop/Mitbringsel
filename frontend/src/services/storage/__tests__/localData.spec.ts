// Sets the IndexedDB globals (IDBDatabase, IDBTransaction, ...) that idb
// checks against. Each test then swaps in a fresh, empty factory.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { Group, Item, List, MeResponse } from '@/types/api'

import type { OutboxChange } from '@/services/sync/outbox'

import { createLocalData, LOCAL_DATA_DB_VERSION, type LocalData } from '../localData'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'
const GROUP = '0190a8c4-0000-7000-8000-0000000000a1'
const LIST = '0190a8c4-0000-7000-8000-0000000000b1'

function me(id: string): MeResponse {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id === ANNA ? 'Anna' : 'Ben',
    avatarUrl: null,
    locale: 'de',
    theme: 'system',
  }
}

function group(name: string): Group {
  return {
    id: GROUP,
    name,
    role: 'owner',
    members: [
      {
        userId: ANNA,
        displayName: 'Anna',
        avatarUrl: null,
        role: 'owner',
        joinedAt: '2026-01-01T10:00:00Z',
      },
    ],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

function list(name: string): List {
  return {
    id: LIST,
    groupId: GROUP,
    name,
    icon: 'general',
    archivedAt: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

function item(name: string): Item {
  return {
    id: '0190a8c4-0000-7000-8000-0000000000c1',
    listId: LIST,
    name,
    quantity: 2,
    unit: 'piece',
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: ANNA,
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 3,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

let data: LocalData

beforeEach(() => {
  // A new, empty IndexedDB, so no test sees what another one stored.
  vi.stubGlobal('indexedDB', new IDBFactory())
  data = createLocalData()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function removal(itemId: string): OutboxChange {
  return { kind: 'remove', itemId }
}

// Stores something in every store for Anna.
async function fillForAnna() {
  await data.claim(me(ANNA))
  await data.writeGroups(ANNA, [group('Home')])
  await data.writeLists(ANNA, GROUP, [list('Weekly')])
  await data.writeItems(ANNA, LIST, [item('Milk')])
  await data.addOutbox(ANNA, removal('a'), 1000)
}

describe('localData', () => {
  it('starts empty', async () => {
    expect(await data.readMe()).toBeNull()
    expect(await data.readGroups(ANNA)).toBeNull()
    expect(await data.readLists(ANNA, GROUP)).toBeNull()
    expect(await data.readItems(ANNA, LIST)).toBeNull()
    expect(await data.readOutbox(ANNA)).toBeNull()
  })

  it('gives back what it stored for the owner', async () => {
    await fillForAnna()

    expect(await data.readMe()).toEqual(me(ANNA))
    expect(await data.readGroups(ANNA)).toEqual([group('Home')])
    expect(await data.readLists(ANNA, GROUP)).toEqual([list('Weekly')])
    expect(await data.readItems(ANNA, LIST)).toEqual([item('Milk')])
    expect(await data.readOutbox(ANNA)).toEqual([
      { seq: expect.any(Number), change: removal('a'), queuedAt: 1000 },
    ])
  })

  it('keeps it across connections, like after a reload', async () => {
    await fillForAnna()

    const later = createLocalData()
    expect(await later.readMe()).toEqual(me(ANNA))
    expect(await later.readItems(ANNA, LIST)).toEqual([item('Milk')])
    expect((await later.readOutbox(ANNA))?.map((e) => e.change)).toEqual([removal('a')])
  })

  describe('outbox', () => {
    it('keeps the changes in the order they were added', async () => {
      await data.claim(me(ANNA))
      const first = await data.addOutbox(ANNA, removal('a'), 3000)
      const second = await data.addOutbox(ANNA, removal('b'), 1000)
      const third = await data.addOutbox(ANNA, removal('c'), 2000)

      expect(first).toBeLessThan(second!)
      expect(second).toBeLessThan(third!)
      expect((await data.readOutbox(ANNA))?.map((e) => e.change)).toEqual([
        removal('a'),
        removal('b'),
        removal('c'),
      ])
    })

    it('removes one change by its seq', async () => {
      await data.claim(me(ANNA))
      await data.addOutbox(ANNA, removal('a'), 1000)
      const seq = await data.addOutbox(ANNA, removal('b'), 1000)
      await data.addOutbox(ANNA, removal('c'), 1000)

      await data.removeOutbox(ANNA, seq!)

      expect((await data.readOutbox(ANNA))?.map((e) => e.change)).toEqual([
        removal('a'),
        removal('c'),
      ])
    })

    it('stores a reactive change as plain data', async () => {
      await data.claim(me(ANNA))
      const change = reactive<OutboxChange>({ kind: 'removeChecked', listId: LIST, itemIds: ['a'] })

      await data.addOutbox(ANNA, change, 1000)

      expect((await data.readOutbox(ANNA))?.[0]?.change).toEqual({
        kind: 'removeChecked',
        listId: LIST,
        itemIds: ['a'],
      })
    })

    it('adds, reads and removes nothing for a user who is not the owner', async () => {
      await fillForAnna()

      expect(await data.addOutbox(BEN, removal('b'), 1000)).toBeNull()
      expect(await data.readOutbox(BEN)).toBeNull()
      const [entry] = (await data.readOutbox(ANNA))!
      await data.removeOutbox(BEN, entry!.seq)

      expect((await data.readOutbox(ANNA))?.map((e) => e.change)).toEqual([removal('a')])
    })
  })

  it('replaces a whole state on write', async () => {
    await fillForAnna()
    await data.writeItems(ANNA, LIST, [item('Bread'), item('Eggs')])

    expect((await data.readItems(ANNA, LIST))?.map((i) => i.name)).toEqual(['Bread', 'Eggs'])
  })

  it('removes the lists of a household and the items of a list', async () => {
    await fillForAnna()
    await data.removeLists(ANNA, GROUP)
    await data.removeItems(ANNA, LIST)

    expect(await data.readLists(ANNA, GROUP)).toBeNull()
    expect(await data.readItems(ANNA, LIST)).toBeNull()
    expect(await data.readGroups(ANNA)).toEqual([group('Home')])
  })

  it('removes the items of the lists of a household with them', async () => {
    await fillForAnna()
    const other = { ...list('Drugstore'), id: 'other-list' }
    await data.writeLists(ANNA, GROUP, [list('Weekly'), other])
    await data.writeItems(ANNA, 'other-list', [{ ...item('Soap'), listId: 'other-list' }])
    // The items of a list of another household stay.
    await data.writeLists(ANNA, 'other-group', [
      { ...list('Work'), id: 'work', groupId: 'other-group' },
    ])
    await data.writeItems(ANNA, 'work', [{ ...item('Pens'), listId: 'work' }])

    await data.removeLists(ANNA, GROUP)

    expect(await data.readItems(ANNA, LIST)).toBeNull()
    expect(await data.readItems(ANNA, 'other-list')).toBeNull()
    expect((await data.readItems(ANNA, 'work'))?.map((i) => i.name)).toEqual(['Pens'])
  })

  it('removes the items of lists that are no longer among the written lists', async () => {
    await fillForAnna()
    const archived = { ...list('Barbecue'), id: 'archived', archivedAt: '2026-02-01T10:00:00Z' }
    const gone = { ...list('Drugstore'), id: 'gone' }
    await data.writeLists(ANNA, GROUP, [list('Weekly'), archived, gone])
    await data.writeItems(ANNA, 'archived', [{ ...item('Sausage'), listId: 'archived' }])
    await data.writeItems(ANNA, 'gone', [{ ...item('Soap'), listId: 'gone' }])

    await data.writeLists(ANNA, GROUP, [list('Weekly renamed'), archived])

    expect((await data.readItems(ANNA, LIST))?.map((i) => i.name)).toEqual(['Milk'])
    expect((await data.readItems(ANNA, 'archived'))?.map((i) => i.name)).toEqual(['Sausage'])
    expect(await data.readItems(ANNA, 'gone')).toBeNull()
  })

  it('stores reactive state as plain data', async () => {
    await data.claim(me(ANNA))
    const state = reactive({ items: [item('Milk')] })

    await data.writeItems(ANNA, LIST, state.items)

    expect(await data.readItems(ANNA, LIST)).toEqual([item('Milk')])
  })

  describe('owner', () => {
    it('keeps the data when the same user claims again', async () => {
      await fillForAnna()
      const renamed = { ...me(ANNA), displayName: 'Anna B.' }

      await data.claim(renamed)

      expect(await data.readMe()).toEqual(renamed)
      expect(await data.readItems(ANNA, LIST)).toEqual([item('Milk')])
    })

    it('removes everything when another user claims', async () => {
      await fillForAnna()

      await data.claim(me(BEN))

      expect(await data.readMe()).toEqual(me(BEN))
      expect(await data.readGroups(BEN)).toBeNull()
      expect(await data.readLists(BEN, GROUP)).toBeNull()
      expect(await data.readItems(BEN, LIST)).toBeNull()
      expect(await data.readOutbox(BEN)).toEqual([])
    })

    it('reads nothing for a user who is not the owner', async () => {
      await fillForAnna()

      expect(await data.readGroups(BEN)).toBeNull()
      expect(await data.readLists(BEN, GROUP)).toBeNull()
      expect(await data.readItems(BEN, LIST)).toBeNull()
    })

    it('writes nothing for a user who is not the owner', async () => {
      // A load of Anna that finishes after Ben signed in.
      await fillForAnna()
      await data.claim(me(BEN))

      await data.writeGroups(ANNA, [group('Home')])
      await data.writeItems(ANNA, LIST, [item('Milk')])
      await data.removeLists(ANNA, GROUP)

      expect(await data.readGroups(BEN)).toBeNull()
      expect(await data.readItems(BEN, LIST)).toBeNull()
    })

    it('writes nothing before anyone claimed', async () => {
      await data.writeGroups(ANNA, [group('Home')])
      await data.claim(me(ANNA))

      expect(await data.readGroups(ANNA)).toBeNull()
    })
  })

  it('clear removes everything, the owner too', async () => {
    await fillForAnna()

    await data.clear()

    expect(await data.readMe()).toBeNull()
    await data.claim(me(ANNA))
    expect(await data.readGroups(ANNA)).toBeNull()
    expect(await data.readLists(ANNA, GROUP)).toBeNull()
    expect(await data.readItems(ANNA, LIST)).toBeNull()
    expect(await data.readOutbox(ANNA)).toEqual([])
  })

  it('upgrades a database of version 1 and keeps its data', async () => {
    // What the app before the outbox stored.
    const old = indexedDB.open('mitbringsel', 1)
    old.onupgradeneeded = () => {
      for (const store of ['meta', 'groups', 'lists', 'items']) old.result.createObjectStore(store)
      const tx = old.transaction!
      tx.objectStore('meta').put(me(ANNA), 'me')
      tx.objectStore('items').put([item('Milk')], LIST)
    }
    await new Promise<void>((resolve, reject) => {
      old.onsuccess = () => {
        old.result.close()
        resolve()
      }
      old.onerror = () => reject(old.error)
    })

    expect(await data.readItems(ANNA, LIST)).toEqual([item('Milk')])
    expect(await data.readOutbox(ANNA)).toEqual([])
    await data.addOutbox(ANNA, removal('a'), 1000)
    expect((await data.readOutbox(ANNA))?.map((e) => e.change)).toEqual([removal('a')])
  })

  it('closes its connection when a newer version waits, and opens again', async () => {
    await fillForAnna()

    // Another tab with a newer app opens the next version. It only gets
    // through if this connection closes.
    const newer = indexedDB.open('mitbringsel', LOCAL_DATA_DB_VERSION + 1)
    await new Promise<void>((resolve, reject) => {
      newer.onsuccess = () => {
        newer.result.close()
        resolve()
      }
      newer.onerror = () => reject(newer.error)
    })

    // The next call opens a new connection instead of using the closed one.
    // Our version is older than the database now, so this fails and warns.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await data.readMe()).toBeNull()
    expect(warn).toHaveBeenCalledWith('local data: read me failed', expect.anything())
  })

  describe('without IndexedDB', () => {
    it('reads null, never throws and does not warn', async () => {
      const warn = vi.spyOn(console, 'warn')
      vi.stubGlobal('indexedDB', undefined)

      await expect(data.claim(me(ANNA))).resolves.toBeUndefined()
      await expect(data.writeItems(ANNA, LIST, [item('Milk')])).resolves.toBeUndefined()
      await expect(data.removeItems(ANNA, LIST)).resolves.toBeUndefined()
      await expect(data.clear()).resolves.toBeUndefined()
      expect(await data.readMe()).toBeNull()
      expect(await data.readItems(ANNA, LIST)).toBeNull()
      expect(warn).not.toHaveBeenCalled()
    })

    it('tries again on the next call', async () => {
      vi.stubGlobal('indexedDB', undefined)
      expect(await data.readMe()).toBeNull()

      vi.stubGlobal('indexedDB', new IDBFactory())
      await data.claim(me(ANNA))

      expect(await data.readMe()).toEqual(me(ANNA))
    })
  })

  describe('when IndexedDB fails', () => {
    it('warns, reads null and never throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })

      await expect(data.claim(me(ANNA))).resolves.toBeUndefined()
      expect(await data.readMe()).toBeNull()
      expect(warn).toHaveBeenCalledWith('local data: read me failed', expect.any(DOMException))
    })
  })
})
