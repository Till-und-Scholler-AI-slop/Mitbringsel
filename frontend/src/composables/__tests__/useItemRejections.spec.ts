import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import { ERROR_CODE_OUTBOX_EXPIRED } from '@/services/sync/outbox'
import { useItemsStore } from '@/stores/items'
import { useToastsStore } from '@/stores/toasts'
import type { Item } from '@/types/api'

import { useItemRejections } from '../useItemRejections'

const itemsService = vi.hoisted(() => ({
  list: vi.fn<ItemsService['list']>(),
  listGroup: vi.fn<ItemsService['listGroup']>(),
  create: vi.fn<ItemsService['create']>(),
  update: vi.fn<ItemsService['update']>(),
  remove: vi.fn<ItemsService['remove']>(),
  removeChecked: vi.fn<ItemsService['removeChecked']>(),
}))

const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)
const outbox = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeOutbox')).createFakeOutbox(),
)

vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return {
    ...original,
    useItemsStore: original.defineItemsStore(
      itemsService,
      () => 'user-1',
      serverEvents,
      undefined,
      {
        openOutbox: outbox.open,
      },
    ),
  }
})

function item(id: string, name: string): Item {
  return {
    id,
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

function setup(locale: 'de' | 'en' = 'de') {
  const Probe = defineComponent({
    setup() {
      useItemRejections()
      return () => null
    },
  })
  const wrapper = mount(Probe, { global: { plugins: [createAppI18n([locale], null)] } })
  return { wrapper, items: useItemsStore(), toasts: useToastsStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  outbox.clear()
  itemsService.list.mockResolvedValue([item('i1', 'Milch')])
})

describe('useItemRejections', () => {
  it.each([
    [
      'create',
      async (items: ReturnType<typeof useItemsStore>) => items.create('l1', { name: 'Käse' }),
      new ApiError(ERROR_CODE_OUTBOX_EXPIRED),
      '„Käse“ konnte nicht hinzugefügt werden.',
      'Diese Änderung lag über 30 Tage ungesendet und wurde verworfen.',
    ],
    [
      'update',
      async (items: ReturnType<typeof useItemsStore>) => items.update('i1', { name: 'Hafermilch' }),
      new ApiError('ITEM_NAME_INVALID', 400),
      'Die Änderung an „Milch“ wurde nicht gespeichert.',
      'Der Name des Artikels muss 1 bis 100 Zeichen lang sein.',
    ],
    [
      'check',
      async (items: ReturnType<typeof useItemsStore>) => items.setChecked('i1', true),
      new ApiError('FORBIDDEN', 403),
      'Der Haken bei „Milch“ wurde nicht gespeichert.',
      'Dafür fehlt dir die Berechtigung.',
    ],
    [
      'remove',
      async (items: ReturnType<typeof useItemsStore>) => items.remove('i1'),
      new ApiError('FORBIDDEN', 403),
      '„Milch“ konnte nicht gelöscht werden.',
      'Dafür fehlt dir die Berechtigung.',
    ],
  ] as const)(
    'shows a translated error toast for a refused %s',
    async (_kind, act, error, text, detail) => {
      const { wrapper, items, toasts } = setup('de')
      await items.load('l1')

      await act(items)
      outbox.reject(error)
      await flushPromises()

      expect(toasts.toasts).toMatchObject([{ kind: 'error', text, detail }])
      wrapper.unmount()
    },
  )

  it('shows English rejection messages when the locale is English', async () => {
    const { wrapper, items, toasts } = setup('en')
    await items.load('l1')

    await items.setChecked('i1', true)
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()

    expect(toasts.toasts).toMatchObject([
      {
        kind: 'error',
        text: 'The check mark on “Milch” was not saved.',
        detail: 'You are not allowed to do this.',
      },
    ])
    wrapper.unmount()
  })

  it('stops showing toasts after unmount', async () => {
    const { wrapper, items, toasts } = setup()
    await items.load('l1')
    wrapper.unmount()

    await items.setChecked('i1', true)
    outbox.reject(new ApiError('FORBIDDEN', 403))
    await flushPromises()

    expect(toasts.toasts).toEqual([])
  })
})
