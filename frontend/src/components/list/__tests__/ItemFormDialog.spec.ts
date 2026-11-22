import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import type { ItemsService } from '@/services/api/items'
import type { Item } from '@/types/api'

import ItemFormDialog from '../ItemFormDialog.vue'

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
    updatedBy: 'user-1',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

function mountDialog(name = '', locale: 'de' | 'en' = 'de', extra: Record<string, unknown> = {}) {
  return mount(ItemFormDialog, {
    props: {
      open: true,
      listId: 'l1',
      listName: 'Supermarkt',
      initialName: name,
      ...extra,
      'onUpdate:open': (open: boolean) => wrapper.setProps({ open }),
    },
    global: { plugins: [createAppI18n([locale], null)] },
    attachTo: document.body,
  })
}
// Set by each test; the update handler above needs the mounted wrapper.
let wrapper: ReturnType<typeof mountDialog>

const field = (label: string) => {
  const id = wrapper
    .findAll('label')
    .find((l) => l.text().startsWith(label))
    ?.attributes('for')
  return wrapper.get(`#${id}`)
}
const submit = () => wrapper.get('form').trigger('submit')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  outbox.clear()
  outbox.auto(itemsService)
  itemsService.create.mockImplementation((_listId, request) =>
    Promise.resolve(item(request.id!, request.name)),
  )
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

describe('ItemFormDialog: new item', () => {
  it('starts with the given name, no quantity and "piece" picked', () => {
    wrapper = mountDialog('Tomaten')

    expect(wrapper.get('h2').text()).toBe('Neuer Artikel')
    expect(wrapper.get('.meta').text()).toBe('Neu in Supermarkt')
    expect((field('Name').element as HTMLInputElement).value).toBe('Tomaten')
    expect((field('Menge').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('[aria-pressed="true"]').text()).toBe('Stück')
    wrapper.unmount()
  })

  it('adds the item with all details and closes', async () => {
    wrapper = mountDialog('  Tomaten ')
    await field('Menge').setValue('2,5')
    await wrapper.findAll('.unit')[2]!.trigger('click')
    await field('Notiz').setValue(' die kleinen ')

    await submit()
    await flushPromises()

    expect(itemsService.create).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        id: expect.any(String),
        name: 'Tomaten',
        quantity: 2.5,
        unit: 'kg',
        note: 'die kleinen',
        clock: expect.any(String),
      }),
    )
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('sends no unit and no note without them', async () => {
    wrapper = mountDialog('Brot')

    await submit()
    await flushPromises()

    expect(itemsService.create).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        id: expect.any(String),
        name: 'Brot',
        quantity: null,
        unit: null,
        note: null,
        clock: expect.any(String),
      }),
    )
    wrapper.unmount()
  })

  it('asks for a name only after trying to save', async () => {
    wrapper = mountDialog()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await submit()

    expect(wrapper.get('[role="alert"]').text()).toBe('Bitte gib einen Namen ein.')
    expect(itemsService.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('says at once that a quantity is not a number, and does not send it', async () => {
    wrapper = mountDialog('Brot')

    await field('Menge').setValue('zwei')
    expect(wrapper.get('[role="alert"]').text()).toBe('Bitte gib eine Zahl ein, z. B. 2 oder 2,5.')
    await submit()

    expect(itemsService.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('starts afresh when opened again', async () => {
    wrapper = mountDialog('Brot')
    await field('Menge').setValue('3')
    await wrapper.setProps({ open: false })

    await wrapper.setProps({ open: true, initialName: 'Milch' })

    expect((field('Name').element as HTMLInputElement).value).toBe('Milch')
    expect((field('Menge').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})

describe('ItemFormDialog: editing', () => {
  const tomatoes = (): Item => ({
    ...item('i1', 'Tomaten'),
    quantity: 2.5,
    unit: 'kg',
    note: 'die kleinen',
  })
  const mountEdit = (edited: Item = tomatoes(), creatorName: string | null = 'Lena') =>
    mountDialog('', 'de', { item: edited, creatorName })

  beforeEach(() => {
    itemsService.update.mockImplementation((_id, change) =>
      Promise.resolve({ ...tomatoes(), ...change } as Item),
    )
  })

  it('fills the fields with the item and says who added it', () => {
    wrapper = mountEdit()

    expect(wrapper.get('h2').text()).toBe('Artikel bearbeiten')
    expect(wrapper.get('.meta').text()).toBe('Von Lena · Supermarkt')
    expect((field('Name').element as HTMLInputElement).value).toBe('Tomaten')
    expect((field('Menge').element as HTMLInputElement).value).toBe('2,5')
    expect(wrapper.get('[aria-pressed="true"]').text()).toBe('kg')
    expect((field('Notiz').element as HTMLTextAreaElement).value).toBe('die kleinen')
    expect(wrapper.get('.remove').text()).toBe('Löschen')
    expect(wrapper.get('.submit').text()).toBe('Speichern')
    wrapper.unmount()
  })

  it('names only the list if the creator is unknown', () => {
    wrapper = mountEdit(tomatoes(), null)

    expect(wrapper.get('.meta').text()).toBe('Supermarkt')
    wrapper.unmount()
  })

  it('sends only the fields the user changed', async () => {
    wrapper = mountEdit()

    await field('Notiz').setValue('die großen')
    await submit()
    await flushPromises()

    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      note: 'die großen',
      clock: expect.any(String),
    })
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('clears the unit with the quantity', async () => {
    wrapper = mountEdit()

    await field('Menge').setValue('')
    await submit()
    await flushPromises()

    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      quantity: null,
      unit: null,
      clock: expect.any(String),
    })
    wrapper.unmount()
  })

  it('closes without a request if nothing changed', async () => {
    wrapper = mountEdit()

    await submit()
    await flushPromises()

    expect(itemsService.update).not.toHaveBeenCalled()
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('keeps what is typed when the item changes meanwhile', async () => {
    wrapper = mountEdit()
    await field('Name').setValue('Cherrytomaten')

    await wrapper.setProps({ item: { ...tomatoes(), note: 'von Ben', serverSeq: 2 } })
    await submit()
    await flushPromises()

    expect((field('Notiz').element as HTMLTextAreaElement).value).toBe('die kleinen')
    expect(itemsService.update).toHaveBeenCalledWith('i1', {
      name: 'Cherrytomaten',
      clock: expect.any(String),
    })
    wrapper.unmount()
  })

  it.each([
    [1, false],
    [0, true],
  ])('asks to delete (click detail %s: from the keyboard %s)', (detail, fromKeyboard) => {
    wrapper = mountEdit()

    wrapper.get('.remove').element.dispatchEvent(new MouseEvent('click', { detail }))

    expect(wrapper.emitted('remove')).toEqual([[fromKeyboard]])
    expect(itemsService.remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
