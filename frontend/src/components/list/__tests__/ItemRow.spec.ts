import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Item } from '@/types/api'

import ItemRow from '../ItemRow.vue'

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    listId: 'l1',
    name: 'Milch',
    quantity: null,
    unit: null,
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
    ...overrides,
  }
}

const JONAS = { name: 'Jonas', avatarUrl: null }

function mountRow(i: Item, person: { name: string; avatarUrl: string | null } | null = JONAS) {
  return mount(ItemRow, {
    props: { item: i, person },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('ItemRow: open item', () => {
  it('shows the name, and no pill, note or checkmark without them', () => {
    const wrapper = mountRow(item())

    expect(wrapper.get('.name').text()).toBe('Milch')
    expect(wrapper.find('.quantity').exists()).toBe(false)
    expect(wrapper.find('.note').exists()).toBe(false)
    expect(wrapper.find('.box svg').exists()).toBe(false)
  })

  it('shows quantity with unit as a pill and the note below the name', () => {
    const wrapper = mountRow(item({ quantity: 2, unit: 'l', note: 'Hafer' }))

    expect(wrapper.get('.quantity').text()).toBe('2 l')
    expect(wrapper.get('.note').text()).toBe('Hafer')
  })

  it('names everything in the label of the button and says who added it', () => {
    const wrapper = mountRow(item({ quantity: 2, unit: 'l', note: 'Hafer' }))

    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Milch, 2 l, Hafer, by Jonas – check off',
    )
  })

  it('leaves out the person when unknown', () => {
    const wrapper = mountRow(item(), null)

    expect(wrapper.get('button').attributes('aria-label')).toBe('Milch – check off')
    expect(wrapper.find('.quantity').exists()).toBe(false)
  })

  it('asks the parent to toggle on a click on the row', async () => {
    const wrapper = mountRow(item())

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})

describe('ItemRow: checked item', () => {
  const done = item({ checked: true, checkedBy: 'u2', note: 'Hafer', quantity: 2, unit: 'l' })

  it('shows a checkmark and hides the note', () => {
    const wrapper = mountRow(done)

    expect(wrapper.classes()).toContain('row--done')
    expect(wrapper.find('.box svg').exists()).toBe(true)
    expect(wrapper.find('.note').exists()).toBe(false)
  })

  it('says who checked it and offers to bring it back', () => {
    const wrapper = mountRow(done)

    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Milch, 2 l, checked by Jonas – bring back',
    )
  })
})

describe('ItemRow: just changed by another member', () => {
  function mountRecent(i: Item, recent: { name: string | null } | null) {
    return mount(ItemRow, {
      props: { item: i, person: JONAS, recent },
      global: { plugins: [createAppI18n(['en'], null)] },
    })
  }

  it('is highlighted with the name of the member, also in the label', () => {
    const wrapper = mountRecent(item(), { name: 'Ben' })

    expect(wrapper.get('li').classes()).toContain('row--recent')
    expect(wrapper.get('.recent').text()).toBe('Ben · just changed')
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Milch, by Jonas, just changed by Ben – check off',
    )
  })

  it('says only "just changed" when the member is unknown', () => {
    const wrapper = mountRecent(item(), { name: null })

    expect(wrapper.get('.recent').text()).toBe('Just changed')
  })

  it('is not highlighted without a recent change or once checked off', () => {
    expect(mountRecent(item(), null).find('.recent').exists()).toBe(false)

    const done = mountRecent(item({ checked: true }), { name: 'Ben' })
    expect(done.find('.recent').exists()).toBe(false)
    expect(done.get('li').classes()).not.toContain('row--recent')
  })
})
