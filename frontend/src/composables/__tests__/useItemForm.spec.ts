import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref } from 'vue'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ItemsService } from '@/services/api/items'
import { ITEM_NAME_MAX_LENGTH, ITEM_NOTE_MAX_LENGTH, ITEM_QUANTITY_MAX } from '@/services/itemForm'
import type { Item } from '@/types/api'

import { useItemForm } from '../useItemForm'

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

vi.mock('@/stores/items', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/items')>()
  return {
    ...original,
    useItemsStore: original.defineItemsStore(itemsService, () => 'user-1', serverEvents),
  }
})

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    listId: 'l1',
    name: 'Tomaten',
    quantity: 2.5,
    unit: 'kg',
    note: 'die kleinen',
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
    ...overrides,
  }
}

function setupForm(options?: {
  open?: boolean
  initialName?: string
  item?: Item
  locale?: 'de' | 'en'
}) {
  const open = ref(options?.open ?? true)
  const initialName = ref(options?.initialName)
  const item = ref(options?.item)
  let form!: ReturnType<typeof useItemForm>

  const Harness = defineComponent({
    setup() {
      form = useItemForm({
        open: () => open.value,
        listId: () => 'l1',
        initialName: () => initialName.value,
        item: () => item.value,
      })
      return () => null
    },
  })

  const wrapper = mount(Harness, {
    global: { plugins: [createAppI18n([options?.locale ?? 'de'], null)] },
  })

  return { form, open, initialName, item, wrapper }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  itemsService.create.mockImplementation((_listId, req) =>
    Promise.resolve(
      makeItem({ name: req.name, quantity: req.quantity, unit: req.unit, note: req.note }),
    ),
  )
  itemsService.update.mockImplementation((_id, change) =>
    Promise.resolve(makeItem(change as Partial<Item>)),
  )
})

describe('useItemForm', () => {
  it('initializes defaults for a new item and resets on reopen', async () => {
    const { form, open, initialName } = setupForm({ initialName: 'Brot' })

    expect(form.name.value).toBe('Brot')
    expect(form.quantity.value).toBe('')
    expect(form.unit.value).toBe('piece')
    expect(form.note.value).toBe('')

    form.quantity.value = '3'
    form.note.value = 'frisch'
    open.value = false
    await flushPromises()

    initialName.value = 'Milch'
    open.value = true
    await flushPromises()

    expect(form.name.value).toBe('Milch')
    expect(form.quantity.value).toBe('')
    expect(form.note.value).toBe('')
  })

  it('formats an edited item for the active locale', () => {
    const { form } = setupForm({ item: makeItem() })

    expect(form.name.value).toBe('Tomaten')
    expect(form.quantity.value).toBe('2,5')
    expect(form.unit.value).toBe('kg')
    expect(form.note.value).toBe('die kleinen')
  })

  it('validates empty name on submit and length/number errors immediately', async () => {
    const { form } = setupForm({ initialName: '' })

    expect(form.nameError.value).toBeNull()
    expect(await form.submit()).toBe(false)
    expect(form.nameError.value).toBe('Bitte gib einen Namen ein.')
    expect(itemsService.create).not.toHaveBeenCalled()

    form.name.value = 'a'.repeat(ITEM_NAME_MAX_LENGTH + 1)
    expect(form.nameError.value).not.toBeNull()

    form.name.value = 'Brot'
    form.quantity.value = 'abc'
    expect(form.quantityError.value).toBe('Bitte gib eine Zahl ein, z. B. 2 oder 2,5.')

    form.quantity.value = String(ITEM_QUANTITY_MAX + 1)
    expect(form.quantityError.value).not.toBeNull()

    form.quantity.value = ''
    form.note.value = 'a'.repeat(ITEM_NOTE_MAX_LENGTH + 1)
    expect(form.noteError.value).not.toBeNull()
  })

  it.each([
    ['ITEM_NAME_INVALID', 'nameError'],
    ['ITEM_QUANTITY_INVALID', 'quantityError'],
    ['ITEM_NOTE_INVALID', 'noteError'],
  ] as const)('maps %s to %s and clears it when any field changes', async (code, target) => {
    itemsService.create.mockRejectedValueOnce(new ApiError(code, 400))
    const { form } = setupForm({ initialName: 'Brot' })

    expect(await form.submit()).toBe(false)
    expect(form[target].value).not.toBeNull()
    expect(form.formError.value).toBeNull()

    form.name.value = 'Vollkornbrot'
    await flushPromises()
    expect(form[target].value).toBeNull()
  })

  it('puts non-field server errors in formError', async () => {
    itemsService.create.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { form } = setupForm({ initialName: 'Brot', locale: 'en' })

    expect(await form.submit()).toBe(false)
    expect(form.formError.value).not.toBeNull()
    expect(form.nameError.value).toBeNull()
  })

  it('sends only changed fields on edit, clears unit with quantity, and skips no-op saves', async () => {
    const { form, item } = setupForm({ item: makeItem() })

    expect(await form.submit()).toBe(true)
    expect(itemsService.update).not.toHaveBeenCalled()

    // External update while open does not overwrite form fields or diff baseline.
    item.value = makeItem({ note: 'von Ben', serverSeq: 2 })
    form.name.value = '  Cherrytomaten  '
    form.note.value = '   '

    expect(await form.submit()).toBe(true)
    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      name: 'Cherrytomaten',
      note: null,
    })

    itemsService.update.mockClear()
    const cleared = setupForm({ item: makeItem() }).form
    cleared.quantity.value = ''
    expect(await cleared.submit()).toBe(true)
    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      quantity: null,
      unit: null,
    })
  })
})
