import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import type { Item } from '@/types/api'

import ItemForm from '../ItemForm.vue'

const itemsService = vi.hoisted(() => ({
  list: vi.fn<ItemsService['list']>(),
  create: vi.fn<ItemsService['create']>(),
  update: vi.fn<ItemsService['update']>(),
  remove: vi.fn<ItemsService['remove']>(),
  removeChecked: vi.fn<ItemsService['removeChecked']>(),
}))

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

function item(name: string): Item {
  return {
    id: 'i1',
    listId: 'l1',
    name,
    quantity: null,
    unit: null,
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

function mountForm(extra: Record<string, unknown> = {}) {
  return mount(ItemForm, {
    props: {
      listId: 'l1',
      listName: 'Supermarkt',
      ...extra,
    },
    global: { plugins: [createAppI18n(['de'], null)] },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  itemsService.create.mockImplementation((_listId, request) => Promise.resolve(item(request.name)))
})

describe('ItemForm', () => {
  it('opens by default when `open` is omitted', () => {
    const wrapper = mountForm({ initialName: 'Tomaten' })

    expect(wrapper.get('.meta').text()).toBe('Neu in Supermarkt')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Tomaten')
  })

  it('emits close on cancel without saving', async () => {
    const wrapper = mountForm({ initialName: 'Tomaten' })

    await wrapper.get('.cancel').trigger('click')

    expect(wrapper.emitted('close')).toEqual([[]])
    expect(itemsService.create).not.toHaveBeenCalled()
  })

  it('emits close only after saving succeeds', async () => {
    itemsService.create.mockRejectedValueOnce(new ApiError('NETWORK'))
    const wrapper = mountForm({ initialName: 'Brot' })

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it.each([
    [1, false],
    [0, true],
  ])('emits remove with keyboard flag (detail %s -> %s)', (detail, fromKeyboard) => {
    const wrapper = mountForm({ item: item('Brot'), creatorName: 'Lena' })

    wrapper.get('.remove').element.dispatchEvent(new MouseEvent('click', { detail }))

    expect(wrapper.emitted('remove')).toEqual([[fromKeyboard]])
  })
})
