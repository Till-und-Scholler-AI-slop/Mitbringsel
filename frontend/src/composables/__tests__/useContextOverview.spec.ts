import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'

import type { ItemsService } from '@/services/api/items'
import type { ListsService } from '@/services/api/lists'
import { readOverview, rememberPinnedList } from '@/services/contextOverview'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

import {
  provideContextOverview,
  useContextOverview,
  type ContextOverview,
} from '../useContextOverview'

const { listsService, itemsService } = vi.hoisted(() => ({
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
}))

const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)
const outbox = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeOutbox')).createFakeOutbox(),
)

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(listsService, () => 'u1') }
})
vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return {
    ...original,
    useItemsStore: original.defineItemsStore(itemsService, () => 'u1', serverEvents, undefined, {
      openOutbox: outbox.open,
    }),
  }
})

function list(id: string, groupId = 'g1', archivedAt: string | null = null): List {
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

// matchMedia decides between narrow (false) and column mode (true); jsdom has none.
function stubColumnMode(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} })),
  )
}

// A view that provides the overview, with a child that takes it, as ListView
// and the overview card do.
function setup(currentId = 'l1', groupId = 'g1') {
  const group = ref(groupId)
  const current = ref<List | undefined>(list(currentId, groupId))
  let injected: ContextOverview | undefined
  const Child = defineComponent({
    setup() {
      injected = useContextOverview()
      return () => h('p')
    },
  })
  const View = defineComponent({
    setup() {
      provideContextOverview(
        () => group.value,
        () => current.value,
      )
      return () => h(Child)
    },
  })
  const wrapper = mount(View)
  return { overview: injected!, group, current, wrapper }
}

async function loadLists(groupId: string, ...lists: List[]) {
  listsService.list.mockImplementation(async (id) => (id === groupId ? lists : []))
  await useListsStore().load(groupId)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  outbox.clear()
  outbox.auto(itemsService)
  itemsService.list.mockResolvedValue([])
  stubColumnMode(true)
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('useContextOverview', () => {
  it('pins the first other active list by default', async () => {
    await loadLists('g1', list('l1'), list('l2'), list('l3'))
    const { overview, wrapper } = setup('l1')

    expect(overview.others.value.map((l) => l.id)).toEqual(['l2', 'l3'])
    expect(overview.pinnedList.value?.id).toBe('l2')
    expect(overview.available.value).toBe(true)
    expect(overview.sidebarPinId.value).toBe('l2')
    wrapper.unmount()
  })

  it('restores the remembered pin and remembers a new one', async () => {
    rememberPinnedList('g1', 'l3')
    await loadLists('g1', list('l1'), list('l2'), list('l3'))
    const { overview, wrapper } = setup('l1')
    expect(overview.pinnedList.value?.id).toBe('l3')

    overview.pin('l2')

    expect(overview.pinnedList.value?.id).toBe('l2')
    expect(readOverview('g1')).toEqual({ pinnedListId: 'l2' })
    wrapper.unmount()
  })

  it('ignores pinning the open list or an unknown one', async () => {
    await loadLists('g1', list('l1'), list('l2'))
    const { overview, wrapper } = setup('l1')

    overview.pin('l1')
    overview.pin('l9')

    expect(readOverview('g1')).toEqual({})
    expect(overview.pinnedList.value?.id).toBe('l2')
    wrapper.unmount()
  })

  it('reads the pin of the other household when the household changes', async () => {
    rememberPinnedList('g2', 'l5')
    await loadLists('g1', list('l1'), list('l2'))
    await loadLists('g2', list('l4', 'g2'), list('l5', 'g2'), list('l6', 'g2'))
    const { overview, group, current, wrapper } = setup('l1')

    group.value = 'g2'
    current.value = list('l4', 'g2')
    await flushPromises()

    expect(overview.pinnedList.value?.id).toBe('l5')
    wrapper.unmount()
  })

  it('pins the list that was open when the open list becomes the pinned one', async () => {
    rememberPinnedList('g1', 'l2')
    await loadLists('g1', list('l1'), list('l2'), list('l3'))
    const { overview, current, wrapper } = setup('l1')

    current.value = list('l2')
    await flushPromises()

    expect(overview.pinnedList.value?.id).toBe('l1')
    expect(readOverview('g1')).toEqual({ pinnedListId: 'l1' })
    wrapper.unmount()
  })

  it('keeps the pin when another list than the pinned one opens', async () => {
    rememberPinnedList('g1', 'l2')
    await loadLists('g1', list('l1'), list('l2'), list('l3'))
    const { overview, current, wrapper } = setup('l1')

    current.value = list('l3')
    await flushPromises()

    expect(overview.pinnedList.value?.id).toBe('l2')
    expect(readOverview('g1')).toEqual({ pinnedListId: 'l2' })
    wrapper.unmount()
  })

  it('forgets a pin that was archived once the lists are loaded', async () => {
    rememberPinnedList('g1', 'l2')
    await loadLists('g1', list('l1'), list('l2', 'g1', '2026-01-02T10:00:00Z'), list('l3'))
    const { overview, wrapper } = setup('l1')
    await flushPromises()

    expect(readOverview('g1')).toEqual({})
    expect(overview.pinnedList.value?.id).toBe('l3')
    wrapper.unmount()
  })

  it('forgets a pin whose list was deleted', async () => {
    rememberPinnedList('g1', 'l2')
    await loadLists('g1', list('l1'), list('l2'), list('l3'))
    const { wrapper } = setup('l1')
    listsService.list.mockResolvedValue([list('l1'), list('l3')])

    await useListsStore().load('g1')
    await flushPromises()

    expect(readOverview('g1')).toEqual({})
    wrapper.unmount()
  })

  it('keeps the remembered pin while the lists are not loaded', async () => {
    rememberPinnedList('g1', 'l2')
    listsService.list.mockImplementation(() => new Promise(() => {}))
    void useListsStore().load('g1')
    const { overview, wrapper } = setup('l1')
    await flushPromises()

    expect(readOverview('g1')).toEqual({ pinnedListId: 'l2' })
    expect(overview.available.value).toBe(false)
    wrapper.unmount()
  })

  it('is not available with one active list', async () => {
    await loadLists('g1', list('l1'), list('l2', 'g1', '2026-01-02T10:00:00Z'))
    const { overview, wrapper } = setup('l1')

    expect(overview.pinnedList.value).toBeUndefined()
    expect(overview.available.value).toBe(false)
    expect(overview.sidebarPinId.value).toBeUndefined()
    wrapper.unmount()
  })

  it('loads the items of the pinned list when it has none yet, not when it has', async () => {
    await loadLists('g1', list('l1'), list('l2'))
    const items = useItemsStore()
    const { wrapper } = setup('l1')
    await flushPromises()
    expect(itemsService.list).toHaveBeenCalledWith('l2')
    expect(items.statusOf('l2')).toBe('ready')
    wrapper.unmount()

    itemsService.list.mockClear()
    const again = setup('l1')
    await flushPromises()
    expect(itemsService.list).not.toHaveBeenCalled()
    again.wrapper.unmount()
  })

  it('does nothing below the context column width', async () => {
    stubColumnMode(false)
    rememberPinnedList('g1', 'l7')
    await loadLists('g1', list('l1'), list('l2'))
    const { overview, current, wrapper } = setup('l1')
    await flushPromises()

    expect(overview.available.value).toBe(false)
    expect(overview.sidebarPinId.value).toBeUndefined()
    expect(itemsService.list).not.toHaveBeenCalled()
    expect(readOverview('g1')).toEqual({ pinnedListId: 'l7' })

    rememberPinnedList('g1', 'l2')
    current.value = list('l2')
    await flushPromises()
    expect(readOverview('g1')).toEqual({ pinnedListId: 'l2' })
    wrapper.unmount()
  })

  it('throws without a provider', () => {
    const Lonely = defineComponent({
      setup() {
        useContextOverview()
        return () => h('p')
      },
    })

    expect(() => mount(Lonely)).toThrow()
  })
})
