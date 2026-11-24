import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed } from 'vue'

import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import type { ListsService } from '@/services/api/lists'
import type { ItemsLocal } from '@/stores/items'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import type { Item, List } from '@/types/api'

import { useOpenCounts } from '../useOpenCounts'

const { listsService, itemsService, itemsStorage } = vi.hoisted(() => ({
  listsService: {
    list: vi.fn<ListsService['list']>(),
    create: vi.fn<ListsService['create']>(),
    update: vi.fn<ListsService['update']>(),
    setArchived: vi.fn<ListsService['setArchived']>(),
    remove: vi.fn<ListsService['remove']>(),
  },
  itemsService: {
    list: vi.fn<ItemsService['list']>(),
    listGroup: vi.fn<ItemsService['listGroup']>(),
    create: vi.fn<ItemsService['create']>(),
    update: vi.fn<ItemsService['update']>(),
    remove: vi.fn<ItemsService['remove']>(),
    removeChecked: vi.fn<ItemsService['removeChecked']>(),
  },
  itemsStorage: {
    readItems: vi.fn<ItemsLocal['readItems']>(),
    writeItems: vi.fn<ItemsLocal['writeItems']>(),
    removeItems: vi.fn<ItemsLocal['removeItems']>(),
  },
}))

const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)
const outbox = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeOutbox')).createFakeOutbox(),
)

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return {
    ...original,
    useListsStore: original.defineListsStore(listsService, () => 'u1', serverEvents),
  }
})

vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return {
    ...original,
    useItemsStore: original.defineItemsStore(itemsService, () => 'u1', serverEvents, itemsStorage, {
      openOutbox: outbox.open,
    }),
  }
})

function list(id: string, groupId: string, archivedAt: string | null = null): List {
  return {
    id,
    groupId,
    name: id,
    icon: 'general',
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

function item(id: string, listId: string, checked = false): Item {
  return {
    id,
    listId,
    name: id,
    quantity: null,
    unit: null,
    note: null,
    checked,
    checkedBy: checked ? 'u1' : null,
    checkedAt: checked ? '2026-01-02T10:00:00Z' : null,
    createdBy: 'u1',
    createdAt: '2026-01-01T10:00:00Z',
    updatedBy: 'u1',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  outbox.clear()
  itemsStorage.readItems.mockResolvedValue(null)
  itemsStorage.writeItems.mockResolvedValue()
  itemsStorage.removeItems.mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useOpenCounts', () => {
  it('returns null while lists or items have not been loaded yet', async () => {
    const lists = useListsStore()
    const items = useItemsStore()
    const { openInList, openInGroup } = useOpenCounts()

    expect(openInList('l1')).toBeNull()
    expect(openInGroup('g1')).toBeNull()

    listsService.list.mockResolvedValue([list('l1', 'g1'), list('l2', 'g1')])
    await lists.load('g1')
    expect(openInGroup('g1')).toBeNull()

    // One active list loaded, the other still idle: household total stays unknown.
    itemsService.list.mockResolvedValue([item('i1', 'l1')])
    await items.load('l1')
    expect(openInList('l1')).toBe(1)
    expect(openInList('l2')).toBeNull()
    expect(openInGroup('g1')).toBeNull()
  })

  it('returns null while loading or after a failed first load without stored items', async () => {
    const items = useItemsStore()
    const { openInList } = useOpenCounts()

    let resolveLoad!: (loaded: Item[]) => void
    itemsService.list.mockImplementationOnce(
      () =>
        new Promise<Item[]>((resolve) => {
          resolveLoad = resolve
        }),
    )
    const pending = items.load('l1')
    expect(openInList('l1')).toBeNull()

    resolveLoad([])
    await pending
    expect(openInList('l1')).toBe(0)

    itemsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    await items.load('l2')
    expect(openInList('l2')).toBeNull()
  })

  it('uses items restored from local storage when a load fails offline', async () => {
    const items = useItemsStore()
    const { openInList } = useOpenCounts()

    itemsStorage.readItems.mockResolvedValueOnce([item('i1', 'l1', false), item('i2', 'l1', true)])
    itemsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    await items.load('l1')

    expect(items.statusOf('l1')).toBe('error')
    expect(openInList('l1')).toBe(1)
  })

  it('counts open items per list and sums active lists per household', async () => {
    const lists = useListsStore()
    const items = useItemsStore()
    const { openInList, openInGroup } = useOpenCounts()

    listsService.list.mockResolvedValue([list('l1', 'g1'), list('l2', 'g1')])
    itemsService.listGroup.mockResolvedValue({
      listIds: ['l1', 'l2'],
      items: [item('i1', 'l1', false), item('i2', 'l1', false), item('i3', 'l1', true)],
    })
    await Promise.all([lists.load('g1'), items.loadGroup('g1')])

    expect(openInList('l1')).toBe(2)
    expect(openInList('l2')).toBe(0)
    expect(openInGroup('g1')).toBe(2)
  })

  it('leaves out archived lists even if they hold open items or were never loaded', async () => {
    const lists = useListsStore()
    const items = useItemsStore()
    const { openInGroup } = useOpenCounts()

    listsService.list.mockResolvedValue([
      list('l1', 'g1'),
      list('l-arch-loaded', 'g1', '2026-01-05T10:00:00Z'),
      list('l-arch-idle', 'g1', '2026-01-06T10:00:00Z'),
    ])
    itemsService.listGroup.mockResolvedValue({
      listIds: ['l1'],
      items: [item('i1', 'l1', false)],
    })
    itemsService.list.mockResolvedValue([item('i2', 'l-arch-loaded', false)])

    await Promise.all([lists.load('g1'), items.loadGroup('g1'), items.load('l-arch-loaded')])

    expect(openInGroup('g1')).toBe(1)
  })

  it('returns 0 for a loaded household without active lists', async () => {
    const lists = useListsStore()
    const { openInGroup } = useOpenCounts()

    listsService.list.mockResolvedValue([list('l-arch', 'g1', '2026-01-05T10:00:00Z')])
    await lists.load('g1')

    expect(openInGroup('g1')).toBe(0)
  })

  it('leaves out items hidden while being removed and brings them back on undo', async () => {
    const lists = useListsStore()
    const items = useItemsStore()
    const { openInList, openInGroup } = useOpenCounts()

    listsService.list.mockResolvedValue([list('l1', 'g1')])
    itemsService.listGroup.mockResolvedValue({
      listIds: ['l1'],
      items: [item('i1', 'l1', false), item('i2', 'l1', false)],
    })
    await Promise.all([lists.load('g1'), items.loadGroup('g1')])

    const removal = items.startRemovingItem('i1')
    expect(removal).not.toBeNull()
    expect(openInList('l1')).toBe(1)
    expect(openInGroup('g1')).toBe(1)

    removal!.undo()
    expect(openInList('l1')).toBe(2)
    expect(openInGroup('g1')).toBe(2)
  })

  it('updates reactively when an item is checked and unchecked', async () => {
    const lists = useListsStore()
    const items = useItemsStore()
    const { openInList, openInGroup } = useOpenCounts()

    listsService.list.mockResolvedValue([list('l1', 'g1')])
    itemsService.listGroup.mockResolvedValue({
      listIds: ['l1'],
      items: [item('i1', 'l1', false), item('i2', 'l1', false)],
    })
    await Promise.all([lists.load('g1'), items.loadGroup('g1')])

    const listCount = computed(() => openInList('l1'))
    const groupCount = computed(() => openInGroup('g1'))
    expect(listCount.value).toBe(2)
    expect(groupCount.value).toBe(2)

    await items.setChecked('i1', true)
    expect(listCount.value).toBe(1)
    expect(groupCount.value).toBe(1)

    await items.setChecked('i1', false)
    expect(listCount.value).toBe(2)
    expect(groupCount.value).toBe(2)
  })
})
