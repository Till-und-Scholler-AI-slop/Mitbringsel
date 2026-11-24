import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import ContextCard from '../ContextCard.vue'

function mountCard(props: Record<string, unknown> = {}) {
  return mount(ContextCard, {
    props: {
      label: 'Create',
      barTitle: 'New item',
      barSummary: 'In Supermarket',
      barChevron: 'up',
      ...props,
    },
    slots: {
      head: '<h2>Head</h2>',
      'bar-icon': '<span class="icon" />',
      default: '<input class="field" />',
    },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('ContextCard', () => {
  it('is a section named by its label with head and content when open', () => {
    const wrapper = mountCard()

    expect(wrapper.get('section').attributes('aria-label')).toBe('Create')
    expect(wrapper.get('.head').text()).toBe('Head')
    expect(wrapper.find('.bar').exists()).toBe(false)
    expect(wrapper.get('.body').attributes('inert')).toBeUndefined()
  })

  it('has a collapse button only if collapsible', async () => {
    const plain = mountCard()
    expect(plain.find('.collapse').exists()).toBe(false)

    const wrapper = mountCard({ collapsible: true, collapseLabel: 'Collapse create' })
    const button = wrapper.get('.collapse')
    expect(button.attributes('aria-label')).toBe('Collapse create')
    expect(button.attributes('title')).toBe('Collapse')

    await button.trigger('click')

    expect(wrapper.emitted('collapse')).toHaveLength(1)
  })

  it('is a bar with title and summary when collapsed, and the content is inert', async () => {
    const wrapper = mountCard({ collapsed: true })

    const bar = wrapper.get('.bar')
    expect(bar.attributes('aria-expanded')).toBe('false')
    expect(bar.attributes('aria-controls')).toBe(wrapper.get('.body').attributes('id'))
    expect(bar.text()).toBe('New itemIn Supermarket')
    expect(bar.find('.icon').exists()).toBe(true)
    expect(wrapper.find('.head').exists()).toBe(false)
    expect(wrapper.get('.body').attributes('inert')).toBeDefined()
    // The content stays mounted: what was typed is still there.
    expect(wrapper.find('.field').exists()).toBe(true)

    await bar.trigger('click')

    expect(wrapper.emitted('expand')).toHaveLength(1)
  })
})
