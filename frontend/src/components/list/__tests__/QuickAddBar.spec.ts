import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import type { ItemsService } from '@/services/api/items'
import type { Item } from '@/types/api'

import QuickAddBar from '../QuickAddBar.vue'

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
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

function mountBar(locale: 'de' | 'en' = 'en', opensDialog?: boolean) {
  return mount(QuickAddBar, {
    props: { listId: 'l1', opensDialog },
    global: { plugins: [createAppI18n([locale], null)] },
    attachTo: document.body,
  })
}

/** Types into the field and presses Enter. */
async function type(wrapper: ReturnType<typeof mountBar>, text: string) {
  await wrapper.get('input').setValue(text)
  await wrapper.get('form').trigger('submit')
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  outbox.clear()
  outbox.auto(itemsService)
  itemsService.create.mockImplementation((_listId, request) =>
    Promise.resolve(item(request.id!, request.name)),
  )
})

describe('QuickAddBar', () => {
  it('labels the field and limits it to what the API takes', () => {
    const wrapper = mountBar()
    const input = wrapper.get('input')

    expect(input.attributes('aria-label')).toBe('Add item')
    expect(input.attributes('placeholder')).toBe('What do we need?')
    expect(input.attributes('maxlength')).toBe('100')
    wrapper.unmount()
  })

  it('adds the trimmed name through the outbox and empties the field at once', async () => {
    const wrapper = mountBar()

    await type(wrapper, '  Hafermilch ')
    await flushPromises()

    expect(itemsService.create).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        id: expect.any(String),
        name: 'Hafermilch',
        clock: expect.any(String),
      }),
    )
    expect(wrapper.get('input').element.value).toBe('')
    wrapper.unmount()
  })

  it('keeps the focus in the field for the next item', async () => {
    const wrapper = mountBar()
    wrapper.get('input').element.focus()

    await type(wrapper, 'Hafermilch')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('input').element)
    wrapper.unmount()
  })

  it('sends nothing for a blank name', async () => {
    const wrapper = mountBar()

    await type(wrapper, '   ')

    expect(itemsService.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('hands what was typed to the form with details', async () => {
    const wrapper = mountBar()
    await wrapper.get('input').setValue(' Tomaten ')

    await wrapper.get('.details').trigger('click')

    expect(wrapper.emitted('details')).toEqual([['Tomaten']])
    expect(wrapper.get('input').element.value).toBe('')
    expect(itemsService.create).not.toHaveBeenCalled()
    expect(wrapper.get('.details').attributes('aria-label')).toBe('Add with details')
    wrapper.unmount()
  })

  it('announces a dialog only when the form with details is one', () => {
    const dialog = mountBar()
    const panel = mountBar('en', false)

    expect(dialog.get('.details').attributes('aria-haspopup')).toBe('dialog')
    expect(panel.get('.details').attributes('aria-haspopup')).toBeUndefined()
    dialog.unmount()
    panel.unmount()
  })
})
