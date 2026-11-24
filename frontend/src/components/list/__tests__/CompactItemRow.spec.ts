import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Item } from '@/types/api'

import CompactItemRow from '../CompactItemRow.vue'

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    listId: 'l2',
    name: 'Brötchen',
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

function mountRow(props: { item: Item; pending?: boolean }, locale: 'de' | 'en' = 'de') {
  return mount(CompactItemRow, {
    props,
    global: { plugins: [createAppI18n([locale], null)] },
  })
}

describe('CompactItemRow', () => {
  it('shows name, note and quantity', () => {
    const wrapper = mountRow({
      item: item({ note: 'Vollkorn', quantity: 6, unit: 'piece' }),
    })

    expect(wrapper.get('.name').text()).toBe('Brötchen')
    expect(wrapper.get('.note').text()).toBe('Vollkorn')
    expect(wrapper.get('.quantity').text()).toBe('6 Stück')
  })

  it('shows only the name when there is no note or quantity', () => {
    const wrapper = mountRow({ item: item() })

    expect(wrapper.find('.note').exists()).toBe(false)
    expect(wrapper.find('.quantity').exists()).toBe(false)
  })

  it('checks off through a button named after the item, and nothing else does', async () => {
    const wrapper = mountRow({ item: item() })

    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.attributes('aria-label')).toBe('Brötchen abhaken')

    await wrapper.get('.text').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()

    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('shows the clock for a change that is not synced yet', () => {
    const wrapper = mountRow({ item: item(), pending: true })

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Noch nicht synchronisiert')
    expect(mountRow({ item: item() }).find('[role="img"]').exists()).toBe(false)
  })
})
