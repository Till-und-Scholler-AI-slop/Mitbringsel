import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import type { Item } from '@/types/api'

import ItemFormPanel from '../ItemFormPanel.vue'

const ITEM: Item = {
  id: 'i1',
  listId: 'l1',
  name: 'Milch',
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

function mountPanel(extra: Record<string, unknown> = {}) {
  return mount(ItemFormPanel, {
    props: { listId: 'l1', listName: 'Supermarkt', ...extra },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('ItemFormPanel', () => {
  it('is a labelled region with the title of a new item and the name in focus', () => {
    const wrapper = mountPanel({ initialName: 'Tomaten' })

    const title = wrapper.get('h2')
    expect(title.text()).toBe('New item')
    expect(wrapper.get('aside').attributes('aria-labelledby')).toBe(title.attributes('id'))
    expect(document.activeElement).toBe(wrapper.get('input').element)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Tomaten')
    wrapper.unmount()
  })

  it('says when it edits an item', () => {
    const wrapper = mountPanel({ item: ITEM, creatorName: 'Jonas' })

    expect(wrapper.get('h2').text()).toBe('Edit item')
    expect(wrapper.get('.meta').text()).toBe('By Jonas · Supermarkt')
    wrapper.unmount()
  })

  it('closes with the close button and with Escape', async () => {
    const wrapper = mountPanel()

    await wrapper.get('button[aria-label="Close"]').trigger('click')
    await wrapper.get('input').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('close')).toEqual([[], []])
    wrapper.unmount()
  })

  it('puts the focus back into the name field on request', () => {
    const wrapper = mountPanel()
    ;(document.activeElement as HTMLElement).blur()

    wrapper.vm.focusName()

    expect(document.activeElement).toBe(wrapper.get('input').element)
    wrapper.unmount()
  })
})
