import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import type { ListsService } from '@/services/api/lists'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import { provideContextOverview } from '@/composables/useContextOverview'
import type { Item, List } from '@/types/api'

import SecondListPanel from '../SecondListPanel.vue'

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
    icon: 'bakery',
    archivedAt: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

function item(id: string, name: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    listId: 'l2',
    name,
    quantity: null,
    unit: null,
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T10:00:00Z',
    updatedBy: 'u1',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
    ...overrides,
  }
}

// The panel needs the overview of a list view above it; l1 is the open list,
// so l2 is pinned.
async function mountPanel() {
  const Host = defineComponent({
    setup() {
      provideContextOverview(
        () => 'g1',
        () => list('l1', 'Supermarkt'),
      )
      return () => h(SecondListPanel)
    },
  })
  const wrapper = mount(Host, {
    global: { plugins: [createAppI18n(['de'], null)] },
    attachTo: document.body,
  })
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
  listsService.list.mockResolvedValue([list('l1', 'Supermarkt'), list('l2', 'Bäcker')])
  itemsService.list.mockResolvedValue([])
  await useListsStore().load('g1')
})

describe('SecondListPanel', () => {
  it('shows the name and the open count of the pinned list', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Brötchen'), item('i2', 'Kuchen')])

    const wrapper = await mountPanel()

    expect(wrapper.get('h2').text()).toBe('Bäcker')
    expect(wrapper.get('.count').text()).toBe('2 offen')
    wrapper.unmount()
  })

  it('shows only open items, with note and quantity', async () => {
    itemsService.list.mockResolvedValue([
      item('i1', 'Brötchen', { note: 'Vollkorn' }),
      item('i2', 'Kuchen', { quantity: 2, unit: 'piece' }),
      item('i3', 'Altes Brot', { checked: true, checkedBy: 'u1' }),
    ])

    const wrapper = await mountPanel()

    const rows = wrapper.get('ul[aria-label="Bäcker"]').findAll('li')
    expect(rows.map((r) => r.get('.name').text())).toEqual(['Brötchen', 'Kuchen'])
    expect(rows[0]!.get('.note').text()).toBe('Vollkorn')
    expect(rows[1]!.get('.quantity').text()).toBe('2 Stück')
    wrapper.unmount()
  })

  it('adds to the pinned list with a bar named after it', async () => {
    itemsService.create.mockImplementation(async (listId, req) =>
      item(req.id ?? 'i9', req.name, { listId }),
    )
    const wrapper = await mountPanel()
    const input = wrapper.get('input[aria-label="Artikel zu Bäcker hinzufügen"]')

    await input.setValue('Croissant')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(itemsService.create).toHaveBeenCalledWith(
      'l2',
      expect.objectContaining({ name: 'Croissant' }),
    )
    expect(wrapper.find('.details').exists()).toBe(false)
    wrapper.unmount()
  })

  it('checks an item off with its check button', async () => {
    itemsService.list.mockResolvedValue([item('i1', 'Brötchen')])
    itemsService.update.mockResolvedValue(
      item('i1', 'Brötchen', { checked: true, checkedBy: 'u1', serverSeq: 2 }),
    )
    const wrapper = await mountPanel()

    await wrapper.get('button[aria-label="Brötchen abhaken"]').trigger('click')
    await flushPromises()

    expect(itemsService.update).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ checked: true }),
    )
    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.get('.notice').text()).toBe('Hier ist nichts offen.')
    wrapper.unmount()
  })

  it('says so when nothing is open', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.get('.notice').text()).toBe('Hier ist nichts offen.')
    expect(wrapper.get('.count').text()).toBe('nichts offen')
    wrapper.unmount()
  })

  it('shows the clock on an item that is not synced yet', async () => {
    itemsService.create.mockReturnValue(new Promise(() => undefined))
    const wrapper = await mountPanel()

    await wrapper.get('input').setValue('Croissant')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('li [role="img"]').attributes('aria-label')).toBe(
      'Noch nicht synchronisiert',
    )
    wrapper.unmount()
  })

  it('shows a spinner while the items load, without a count', async () => {
    itemsService.list.mockReturnValue(new Promise(() => undefined))

    const wrapper = await mountPanel()

    expect(wrapper.get('[role="status"]').text()).toBe('Artikel werden geladen …')
    expect(wrapper.find('.count').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says so and offers a retry when the items cannot be loaded', async () => {
    itemsService.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const wrapper = await mountPanel()

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Die Artikel konnten nicht geladen werden.',
    )

    itemsService.list.mockResolvedValue([item('i1', 'Brötchen')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(useItemsStore().statusOf('l2')).toBe('ready')
    wrapper.unmount()
  })
})
