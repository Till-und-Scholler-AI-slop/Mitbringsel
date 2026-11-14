import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import { useItemsStore } from '@/stores/items'
import { TOAST_DURATION_MS, useToastsStore } from '@/stores/toasts'
import type { Item } from '@/types/api'

import { useRemoveItems } from '../useRemoveItems'

const itemsService = vi.hoisted(() => ({
  list: vi.fn<ItemsService['list']>(),
  create: vi.fn<ItemsService['create']>(),
  update: vi.fn<ItemsService['update']>(),
  remove: vi.fn<ItemsService['remove']>(),
  removeChecked: vi.fn<ItemsService['removeChecked']>(),
}))

// vi.hoisted runs before the imports, so the fake has to be imported by hand.
const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)

vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return {
    ...original,
    useItemsStore: original.defineItemsStore(itemsService, () => 'user-1', serverEvents),
  }
})

function item(id: string, name: string, checked: boolean): Item {
  return {
    id,
    listId: 'l1',
    name,
    quantity: null,
    unit: null,
    note: null,
    checked,
    checkedBy: checked ? 'user-1' : null,
    checkedAt: checked ? '2026-02-01T10:00:00Z' : null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

// The composable needs a component to find the i18n instance.
function setup(locale: 'de' | 'en' = 'de') {
  let removal: ReturnType<typeof useRemoveItems> = {
    removeChecked: () => undefined,
    removeItem: () => undefined,
  }
  const Probe = defineComponent({
    setup() {
      removal = useRemoveItems()
      return () => null
    },
  })
  mount(Probe, { global: { plugins: [createAppI18n([locale], null)] } })
  return { ...removal, items: useItemsStore(), toasts: useToastsStore() }
}

async function loadList(...listItems: Item[]) {
  itemsService.list.mockResolvedValue(listItems)
  await useItemsStore().load('l1')
}

const names = (items: Item[]) => items.map((i) => i.name)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.clearAllMocks()
  serverEvents.clear()
  itemsService.removeChecked.mockImplementation((_listId, ids) =>
    Promise.resolve(ids.map((itemId) => ({ itemId, serverSeq: 10 }))),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRemoveItems: checked items', () => {
  it('hides the checked items and offers undo in a toast', async () => {
    const { removeChecked, items, toasts } = setup()
    await loadList(item('i1', 'Milch', false), item('i2', 'Brot', true), item('i3', 'Eier', true))

    removeChecked('l1')

    expect(names(items.itemsOf('l1'))).toEqual(['Milch'])
    expect(toasts.toasts).toMatchObject([
      {
        kind: 'success',
        icon: 'trash',
        text: '2 Artikel entfernt',
        actionLabel: 'Rückgängig',
        focusAction: false,
      },
    ])
    expect(itemsService.removeChecked).not.toHaveBeenCalled()
  })

  it('names a single item', async () => {
    const { removeChecked, toasts } = setup('en')
    await loadList(item('i2', 'Brot', true))

    removeChecked('l1')

    expect(toasts.toasts[0]?.text).toBe('“Brot” removed')
  })

  it('moves the focus to undo when started from the keyboard', async () => {
    const { removeChecked, toasts } = setup()
    await loadList(item('i2', 'Brot', true))

    removeChecked('l1', true)

    expect(toasts.toasts[0]?.focusAction).toBe(true)
  })

  it('sends the removal when the toast runs out', async () => {
    const { removeChecked, items } = setup()
    await loadList(item('i1', 'Milch', false), item('i2', 'Brot', true))

    removeChecked('l1')
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    await flushPromises()

    expect(itemsService.removeChecked).toHaveBeenCalledWith('l1', ['i2'])
    expect(names(items.itemsOf('l1'))).toEqual(['Milch'])
  })

  it('sends the removal at once when the toast is closed', async () => {
    const { removeChecked, toasts } = setup()
    await loadList(item('i2', 'Brot', true))

    removeChecked('l1')
    toasts.close(toasts.toasts[0]!.id)
    await flushPromises()

    expect(itemsService.removeChecked).toHaveBeenCalledOnce()
  })

  it('brings the items back on undo and sends nothing', async () => {
    const { removeChecked, items, toasts } = setup()
    await loadList(item('i2', 'Brot', true))

    removeChecked('l1')
    toasts.runAction(toasts.toasts[0]!.id)
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    await flushPromises()

    expect(names(items.checkedItems('l1'))).toEqual(['Brot'])
    expect(itemsService.removeChecked).not.toHaveBeenCalled()
  })

  it('shows an error toast and the items again if sending fails', async () => {
    itemsService.removeChecked.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { removeChecked, items, toasts } = setup()
    await loadList(item('i2', 'Brot', true))

    removeChecked('l1')
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    await flushPromises()

    expect(names(items.checkedItems('l1'))).toEqual(['Brot'])
    expect(toasts.toasts).toMatchObject([
      {
        kind: 'error',
        text: 'Die erledigten Artikel konnten nicht entfernt werden.',
        detail: expect.any(String),
      },
    ])
  })

  it('does nothing without checked items', async () => {
    const { removeChecked, toasts } = setup()
    await loadList(item('i1', 'Milch', false))

    removeChecked('l1')

    expect(toasts.toasts).toEqual([])
  })
})

describe('useRemoveItems: one item', () => {
  it('hides the item and names it in a toast with undo', async () => {
    const { removeItem, items, toasts } = setup()
    await loadList(item('i1', 'Milch', false), item('i2', 'Brot', false))

    removeItem('i1', true)

    expect(names(items.itemsOf('l1'))).toEqual(['Brot'])
    expect(toasts.toasts).toMatchObject([
      { kind: 'success', text: '„Milch“ entfernt', actionLabel: 'Rückgängig', focusAction: true },
    ])
    expect(itemsService.remove).not.toHaveBeenCalled()
  })

  it('deletes the item when the toast runs out', async () => {
    itemsService.remove.mockResolvedValue()
    const { removeItem, items } = setup()
    await loadList(item('i1', 'Milch', false))

    removeItem('i1')
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    await flushPromises()

    expect(itemsService.remove).toHaveBeenCalledWith('i1')
    expect(items.itemsOf('l1')).toEqual([])
  })

  it('names the item in the error toast if deleting fails', async () => {
    itemsService.remove.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { removeItem, items, toasts } = setup()
    await loadList(item('i1', 'Milch', false))

    removeItem('i1')
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    await flushPromises()

    expect(names(items.itemsOf('l1'))).toEqual(['Milch'])
    expect(toasts.toasts[0]).toMatchObject({
      kind: 'error',
      text: '„Milch“ konnte nicht gelöscht werden.',
    })
  })
})
