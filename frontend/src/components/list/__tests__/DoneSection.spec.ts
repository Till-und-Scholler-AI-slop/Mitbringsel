import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Item } from '@/types/api'

import DoneSection from '../DoneSection.vue'

function item(id: string, name: string): Item {
  return {
    id,
    listId: 'l1',
    name,
    quantity: null,
    unit: null,
    note: null,
    checked: true,
    checkedBy: 'u1',
    checkedAt: '2026-02-01T10:00:00Z',
    createdBy: 'u1',
    createdAt: '2026-01-01T10:00:00Z',
    updatedBy: 'u1',
    updatedAt: '2026-02-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

function mountSection(items: Item[], locale: 'de' | 'en' = 'en') {
  return mount(DoneSection, {
    props: { items, personOf: () => null },
    global: { plugins: [createAppI18n([locale], null)] },
  })
}

const names = (w: ReturnType<typeof mountSection>) =>
  w.findAll('.done-items .name').map((e) => e.text())

describe('DoneSection', () => {
  it('shows the checked items under a head with their number', () => {
    const wrapper = mountSection([item('i1', 'Milch'), item('i2', 'Brot')])

    expect(wrapper.get('.done-toggle').text()).toBe('Done (2)')
    expect(names(wrapper)).toEqual(['Milch', 'Brot'])
  })

  it('folds the items away and keeps "Remove" in reach', async () => {
    const wrapper = mountSection([item('i1', 'Milch')])

    await wrapper.get('.done-toggle').trigger('click')

    expect(wrapper.get('.done-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('#done-items').isVisible()).toBe(false)
    expect(wrapper.get('.remove').isVisible()).toBe(true)
  })

  it('tells the toggle of an item', async () => {
    const milch = item('i1', 'Milch')
    const wrapper = mountSection([milch])

    await wrapper.get('.done-items li button').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[milch]])
  })

  it.each([
    ['de', 1, '1 erledigten Artikel für alle entfernen'],
    ['de', 2, '2 erledigte Artikel für alle entfernen'],
    ['en', 1, 'Remove 1 done item for everyone'],
    ['en', 2, 'Remove 2 done items for everyone'],
  ] as const)('%s: names %s items to remove for a screen reader', (locale, count, label) => {
    const items = [item('i1', 'Milch'), item('i2', 'Brot')].slice(0, count)
    const wrapper = mountSection(items, locale)

    expect(wrapper.get('.remove').attributes('aria-label')).toBe(label)
  })

  it('says that a click came from a pointer', async () => {
    const wrapper = mountSection([item('i1', 'Milch')])

    // trigger() cannot set detail, so the event is built by hand.
    wrapper.get('.remove').element.dispatchEvent(new MouseEvent('click', { detail: 1 }))

    expect(wrapper.emitted('remove')).toEqual([[false]])
  })

  it('says that a click came from the keyboard', async () => {
    const wrapper = mountSection([item('i1', 'Milch')])

    // Enter and Space click with detail 0.
    wrapper.get('.remove').element.dispatchEvent(new MouseEvent('click', { detail: 0 }))

    expect(wrapper.emitted('remove')).toEqual([[true]])
  })
})
