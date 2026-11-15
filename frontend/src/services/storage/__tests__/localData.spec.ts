// Sets the IndexedDB globals (IDBDatabase, IDBTransaction, ...) that idb
// checks against. Each test then swaps in a fresh, empty factory.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { Group, Item, List, MeResponse } from '@/types/api'

import { createLocalData, type LocalData } from '../localData'

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

// Stores something in every store for Anna.
async function fillForAnna() {
  await data.claim(me(ANNA))
  await data.writeGroups(ANNA, [group('Home')])
  await data.writeLists(ANNA, GROUP, [list('Weekly')])
  await data.writeItems(ANNA, LIST, [item('Milk')])
}

describe('localData', () => {
  it('starts empty', async () => {
    expect(await data.readMe()).toBeNull()
    expect(await data.readGroups(ANNA)).toBeNull()
    expect(await data.readLists(ANNA, GROUP)).toBeNull()
    expect(await data.readItems(ANNA, LIST)).toBeNull()
  })

  it('gives back what it stored for the owner', async () => {
    await fillForAnna()

    expect(await data.readMe()).toEqual(me(ANNA))
    expect(await data.readGroups(ANNA)).toEqual([group('Home')])
    expect(await data.readLists(ANNA, GROUP)).toEqual([list('Weekly')])
    expect(await data.readItems(ANNA, LIST)).toEqual([item('Milk')])
  })

  it('keeps it across connections, like after a reload', async () => {
    await fillForAnna()

    const later = createLocalData()
    expect(await later.readMe()).toEqual(me(ANNA))
    expect(await later.readItems(ANNA, LIST)).toEqual([item('Milk')])
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
  })

  it('closes its connection when a newer version waits, and opens again', async () => {
    await fillForAnna()

    // Another tab with a newer app opens version 2. It only gets through
    // if this connection closes.
    const newer = indexedDB.open('mitbringsel', 2)
    await new Promise<void>((resolve, reject) => {
      newer.onsuccess = () => {
        newer.result.close()
        resolve()
      }
      newer.onerror = () => reject(newer.error)
    })

    // The next call opens a new connection instead of using the closed one.
    // Version 1 is older than the database now, so this fails and warns.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await data.readMe()).toBeNull()
    expect(warn).toHaveBeenCalledWith('local data: read me failed', expect.anything())
  })

  describe('without IndexedDB', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('reads null and never throws', async () => {
      vi.stubGlobal('indexedDB', undefined)

      await expect(data.claim(me(ANNA))).resolves.toBeUndefined()
      await expect(data.writeItems(ANNA, LIST, [item('Milk')])).resolves.toBeUndefined()
      await expect(data.removeItems(ANNA, LIST)).resolves.toBeUndefined()
      await expect(data.clear()).resolves.toBeUndefined()
      expect(await data.readMe()).toBeNull()
      expect(await data.readItems(ANNA, LIST)).toBeNull()
      expect(console.warn).toHaveBeenCalled()
    })

    it('tries again on the next call', async () => {
      vi.stubGlobal('indexedDB', undefined)
      expect(await data.readMe()).toBeNull()

      vi.stubGlobal('indexedDB', new IDBFactory())
      await data.claim(me(ANNA))

      expect(await data.readMe()).toEqual(me(ANNA))
    })
  })
})
