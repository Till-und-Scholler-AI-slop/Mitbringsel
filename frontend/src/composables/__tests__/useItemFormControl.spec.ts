import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'

import { createAppI18n } from '@/i18n'
import type { ItemsService } from '@/services/api/items'
import { useItemsStore } from '@/stores/items'
import { useToastsStore } from '@/stores/toasts'
import type { Item, List } from '@/types/api'

import {
  provideItemFormControl,
  useItemFormControl,
  type ItemFormControl,
} from '../useItemFormControl'

const itemsService = vi.hoisted(() => ({
  list: vi.fn<ItemsService['list']>(),
  listGroup: vi.fn<ItemsService['listGroup']>(),
  create: vi.fn<ItemsService['create']>(),
  update: vi.fn<ItemsService['update']>(),
  remove: vi.fn<ItemsService['remove']>(),
  removeChecked: vi.fn<ItemsService['removeChecked']>(),
}))

// vi.hoisted runs before the imports, so the fakes have to be imported by hand.
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
      { openOutbox: outbox.open },
    ),
  }
})

function list(id: string): List {
  return {
    id,
    groupId: 'g1',
    name: id === 'l1' ? 'Supermarkt' : 'Baumarkt',
    icon: 'general',
    archivedAt: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

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
    updatedBy: 'user-1',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

// matchMedia decides between dialog (false) and card (true); jsdom has none.
function stubPanelMode(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} })),
  )
}

// A view that provides the control, with a child that takes it, as ListView
// and ListItems do. The opener is a button that keeps the focus to return to.
function setup(hasOverview = false) {
  const current = ref<List | undefined>(list('l1'))
  let provided: ItemFormControl | undefined
  let injected: ItemFormControl | undefined
  const Child = defineComponent({
    setup() {
      injected = useItemFormControl()
      return () => h('button', { class: 'opener' }, 'Milch')
    },
  })
  const View = defineComponent({
    setup() {
      provided = provideItemFormControl(
        () => current.value,
        () => hasOverview,
      )
      return () => h(Child)
    },
  })
  const wrapper = mount(View, {
    attachTo: document.body,
    global: { plugins: [createAppI18n(['en'], null)] },
  })
  const opener = wrapper.get('.opener').element as HTMLButtonElement
  return { form: injected!, provided: provided!, current, wrapper, opener }
}

async function loadItems(...listItems: Item[]) {
  itemsService.list.mockResolvedValue(listItems)
  await useItemsStore().load('l1')
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  outbox.clear()
  outbox.auto(itemsService)
  stubPanelMode(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useItemFormControl', () => {
  it('hands the same control to the components below', () => {
    const { form, provided } = setup()

    expect(form).toBe(provided)
  })

  it('throws without a provider', () => {
    const Lonely = defineComponent({
      setup() {
        useItemFormControl()
        return () => null
      },
    })

    // Vue logs the error of setup() as a warning before rethrowing it.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => mount(Lonely)).toThrow('provideItemFormControl')
  })

  it('opens a new item with the typed name, each time afresh', () => {
    const { form } = setup()

    form.openNew('Tomaten')
    const firstKey = form.newItemKey.value
    form.openNew('Gurken')

    expect(form.newItemOpen.value).toBe(true)
    expect(form.newItemName.value).toBe('Gurken')
    expect(form.newItemKey.value).not.toBe(firstKey)
  })

  it('keeps what was typed in the card when the new item button is pressed again', () => {
    stubPanelMode(true)
    const { form } = setup()
    const focusName = vi.fn()
    form.card.value = { focusName }

    form.openNew('')
    const key = form.newItemKey.value
    form.openNew('')

    expect(form.newItemKey.value).toBe(key)
    expect(form.newItemOpen.value).toBe(true)
    expect(focusName).toHaveBeenCalledTimes(2)
  })

  it('hands a typed name to the card even if it shows a new item already', () => {
    stubPanelMode(true)
    const { form } = setup()

    form.openNew('')
    const key = form.newItemKey.value
    form.openNew('Tomaten')

    expect(form.newItemKey.value).not.toBe(key)
    expect(form.newItemName.value).toBe('Tomaten')
  })

  it('starts the dialog afresh each time, even without a typed name', () => {
    const { form } = setup()

    form.openNew('')
    const key = form.newItemKey.value
    form.openNew('')

    expect(form.newItemKey.value).not.toBe(key)
  })

  it('switches between editing and a new item', async () => {
    const { form } = setup()
    await loadItems(item('i1', 'Milch'))

    form.openNew('Tomaten')
    form.startEdit(item('i1', 'Milch'))

    expect(form.newItemOpen.value).toBe(false)
    expect(form.editing.value?.name).toBe('Milch')

    form.openNew('')

    expect(form.editingId.value).toBeNull()
    expect(form.newItemOpen.value).toBe(true)
  })

  it('moves the focus into the card when the same item is edited again', async () => {
    const { form } = setup()
    await loadItems(item('i1', 'Milch'))
    const focusName = vi.fn()
    form.card.value = { focusName }

    form.startEdit(item('i1', 'Milch'))
    expect(focusName).not.toHaveBeenCalled()

    form.startEdit(item('i1', 'Milch'))
    expect(focusName).toHaveBeenCalledOnce()
  })

  it('gives the focus back to the opener when the form in the card closes', async () => {
    stubPanelMode(true)
    const { form, opener } = setup()
    await loadItems(item('i1', 'Milch'))

    opener.focus()
    form.startEdit(item('i1', 'Milch'))
    ;(document.activeElement as HTMLElement).blur()
    await form.close()

    expect(form.editingId.value).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('leaves the focus to the dialog when a dialog closes', async () => {
    const { form, opener } = setup()
    await loadItems(item('i1', 'Milch'))

    opener.focus()
    form.startEdit(item('i1', 'Milch'))
    opener.blur()
    await form.close()

    expect(document.activeElement).toBe(document.body)
  })

  it('starts a new empty form after closing, so the card does not keep the old input', async () => {
    const { form } = setup()

    form.openNew('Tomaten')
    const openKey = form.newItemKey.value
    await form.close()

    expect(form.newItemOpen.value).toBe(false)
    expect(form.newItemKey.value).not.toBe(openKey)
  })

  it('closes on switching lists without a deleted-meanwhile toast', async () => {
    const { form, current } = setup()
    await loadItems(item('i1', 'Milch'))

    form.startEdit(item('i1', 'Milch'))
    const keyBefore = form.newItemKey.value
    current.value = list('l2')
    await flushPromises()

    expect(form.editingId.value).toBeNull()
    expect(form.newItemKey.value).not.toBe(keyBefore)
    expect(useToastsStore().toasts).toEqual([])
  })

  it('closes and says why when someone else deletes the edited item', async () => {
    const { form } = setup()
    await loadItems(item('i1', 'Milch'))

    form.startEdit(item('i1', 'Milch'))
    // Watchers run before the next render, not at once.
    await flushPromises()
    serverEvents.emit({
      type: 'itemDeleted',
      payload: { groupId: 'g1', listId: 'l1', itemId: 'i1', serverSeq: 2, actorId: 'user-2' },
    })
    await flushPromises()

    expect(form.editingId.value).toBeNull()
    expect(useToastsStore().toasts).toMatchObject([{ kind: 'info', text: '“Milch” was deleted' }])
  })

  it('closes when the edited item is removed from the form, with undo', async () => {
    const { form } = setup()
    await loadItems(item('i1', 'Milch'), item('i2', 'Brot'))

    form.startEdit(item('i1', 'Milch'))
    form.removeEditing(false)
    await flushPromises()

    expect(form.editingId.value).toBeNull()
    expect(
      useItemsStore()
        .itemsOf('l1')
        .map((i) => i.name),
    ).toEqual(['Brot'])
    expect(useToastsStore().toasts).toMatchObject([{ text: '“Milch” removed' }])
  })

  describe('with an overview card', () => {
    it('has the overview open after loading, the form open without one', () => {
      const withOverview = setup(true)
      expect(withOverview.form.expanded.value).toBe('overview')
      expect(withOverview.form.formExpanded.value).toBe(false)

      const without = setup(false)
      expect(without.form.formExpanded.value).toBe(true)
    })

    it('opens the form for a new or an edited item', async () => {
      const { form } = setup(true)
      await loadItems(item('i1', 'Milch'))

      form.openNew('Tomaten')
      expect(form.formExpanded.value).toBe(true)

      await form.close()
      expect(form.formExpanded.value).toBe(false)

      form.startEdit(item('i1', 'Milch'))
      expect(form.formExpanded.value).toBe(true)
    })

    it('opens the overview again when the form closes and gives the focus back', async () => {
      stubPanelMode(true)
      const { form, opener } = setup(true)
      const focusStart = vi.fn()
      form.overviewCard.value = { focusStart }

      opener.focus()
      form.openNew('Tomaten')
      await form.close()

      expect(form.expanded.value).toBe('overview')
      expect(document.activeElement).toBe(opener)
      expect(focusStart).not.toHaveBeenCalled()
    })

    it('focuses the overview when the opener is gone', async () => {
      stubPanelMode(true)
      const { form, opener } = setup(true)
      const focusStart = vi.fn()
      form.overviewCard.value = { focusStart }

      opener.focus()
      form.openNew('Tomaten')
      opener.remove()
      await form.close()

      expect(focusStart).toHaveBeenCalledOnce()
    })

    it('keeps what was typed when the collapsed card is opened by the new item button', async () => {
      stubPanelMode(true)
      const { form } = setup(true)
      const focusName = vi.fn()
      form.card.value = { focusName }

      form.openNew('')
      const key = form.newItemKey.value
      form.expandOverview()
      await flushPromises()
      expect(form.formExpanded.value).toBe(false)

      form.openNew('')
      await flushPromises()

      expect(form.formExpanded.value).toBe(true)
      expect(form.newItemKey.value).toBe(key)
      expect(focusName).toHaveBeenCalledTimes(2)
    })

    it('expands the form with the focus in the name, and back to the overview', async () => {
      const { form } = setup(true)
      const focusName = vi.fn()
      const focusStart = vi.fn()
      form.card.value = { focusName }
      form.overviewCard.value = { focusStart }

      form.expandForm()
      await flushPromises()
      expect(form.formExpanded.value).toBe(true)
      expect(focusName).toHaveBeenCalledOnce()

      await form.expandOverview()
      expect(form.formExpanded.value).toBe(false)
      expect(focusStart).toHaveBeenCalledOnce()
    })

    it('does not reset the form when the cards switch', async () => {
      const { form } = setup(true)
      form.openNew('Tomaten')
      const key = form.newItemKey.value

      await form.expandOverview()
      form.expandForm()

      expect(form.newItemKey.value).toBe(key)
      expect(form.newItemName.value).toBe('Tomaten')
    })
  })
})
