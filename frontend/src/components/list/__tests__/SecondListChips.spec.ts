import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'

import { createAppI18n } from '@/i18n'
import type { ItemsService } from '@/services/api/items'
import type { ListsService } from '@/services/api/lists'
import { readOverview } from '@/services/contextOverview'
import { useListsStore } from '@/stores/lists'
import { provideContextOverview } from '@/composables/useContextOverview'
import type { List } from '@/types/api'

import SecondListChips from '../SecondListChips.vue'

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

function list(id: string, name: string): List {
  return {
    id,
    groupId: 'g1',
    name,
    icon: 'general',
    archivedAt: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

async function mountChips() {
  const Host = defineComponent({
    setup() {
      provideContextOverview(
        () => 'g1',
        () => list('l1', 'Supermarkt'),
      )
      return () => h(SecondListChips)
    },
  })
  const wrapper = mount(Host, { global: { plugins: [createAppI18n(['de'], null)] } })
  await flushPromises()
  return wrapper
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
  )
  serverEvents.clear()
  outbox.clear()
  outbox.auto(itemsService)
  localStorage.clear()
  listsService.list.mockResolvedValue([
    list('l1', 'Supermarkt'),
    list('l2', 'Bäcker'),
    list('l3', 'Apotheke'),
  ])
  itemsService.list.mockResolvedValue([])
  await useListsStore().load('g1')
})

describe('SecondListChips', () => {
  it('offers the other active lists as toggle buttons, the pinned one pressed', async () => {
    const wrapper = await mountChips()

    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Welche Liste daneben')
    const chips = wrapper.findAll('button')
    expect(chips.map((c) => [c.text(), c.attributes('aria-pressed')])).toEqual([
      ['Bäcker', 'true'],
      ['Apotheke', 'false'],
    ])
    wrapper.unmount()
  })

  it('pins the list of the chip that is pressed', async () => {
    const wrapper = await mountChips()

    await wrapper.findAll('button')[1]!.trigger('click')

    expect(wrapper.findAll('button').map((c) => c.attributes('aria-pressed'))).toEqual([
      'false',
      'true',
    ])
    expect(readOverview('g1')).toEqual({ pinnedListId: 'l3' })
    wrapper.unmount()
  })
})
