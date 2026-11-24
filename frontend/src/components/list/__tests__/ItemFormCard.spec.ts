import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Item, List } from '@/types/api'

import ItemFormCard from '../ItemFormCard.vue'

const list: List = {
  id: 'l1',
  groupId: 'g1',
  name: 'Supermarkt',
  icon: 'supermarket',
  archivedAt: null,
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
  serverSeq: 1,
}

const tomatoes: Item = {
  id: 'i1',
  listId: 'l1',
  name: 'Tomaten',
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
}

// The form inside is not under test here.
function mountCard(props: Record<string, unknown>, locale: 'de' | 'en' = 'de') {
  return mount(ItemFormCard, {
    props: { list, ...props },
    global: { plugins: [createAppI18n([locale], null)], stubs: { ItemForm: true } },
  })
}

describe('ItemFormCard', () => {
  it('shows the bar of a new item collapsed', async () => {
    const wrapper = mountCard({ collapsed: true })

    expect(wrapper.get('section').attributes('aria-label')).toBe('Erstellen')
    expect(wrapper.get('.bar-title').text()).toBe('Neuer Artikel')
    expect(wrapper.get('.bar-summary').text()).toBe('In Supermarkt · mit Menge, Einheit und Notiz')

    await wrapper.get('.bar').trigger('click')

    expect(wrapper.emitted('expand')).toHaveLength(1)
  })

  it('shows the bar of an edited item collapsed', () => {
    const wrapper = mountCard({ collapsed: true, item: tomatoes })

    expect(wrapper.get('section').attributes('aria-label')).toBe('Bearbeiten')
    expect(wrapper.get('.bar-title').text()).toBe('Tomaten bearbeiten')
    expect(wrapper.get('.bar-summary').text()).toBe('In Supermarkt')
  })

  it('has a collapse button named after what it collapses when collapsible', async () => {
    const wrapper = mountCard({ collapsible: true })

    expect(wrapper.get('h2').text()).toBe('Neuer Artikel')
    expect(wrapper.get('.collapse').attributes('aria-label')).toBe(
      'Erstellen einklappen und Überblick öffnen',
    )

    await wrapper.get('.collapse').trigger('click')
    expect(wrapper.emitted('collapse')).toHaveLength(1)

    await wrapper.setProps({ item: tomatoes })
    expect(wrapper.get('.collapse').attributes('aria-label')).toBe(
      'Bearbeiten einklappen und Überblick öffnen',
    )
  })

  it('has no collapse button without an overview', () => {
    expect(mountCard({}).find('.collapse').exists()).toBe(false)
  })
})
