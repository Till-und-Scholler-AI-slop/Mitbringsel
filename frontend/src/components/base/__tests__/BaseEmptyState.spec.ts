import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseEmptyState from '../BaseEmptyState.vue'

describe('BaseEmptyState', () => {
  it('shows the title only by default', () => {
    const wrapper = mount(BaseEmptyState, { props: { title: 'Nothing here' } })

    expect(wrapper.get('h2').text()).toBe('Nothing here')
    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.find('.actions').exists()).toBe(false)
    expect(wrapper.find('.icon').exists()).toBe(false)
  })

  it('shows description, icon and actions when given', () => {
    const wrapper = mount(BaseEmptyState, {
      props: { title: 'Nothing here', description: 'Start one.' },
      slots: { icon: '<i>icon</i>', default: '<button>Create</button>' },
    })

    expect(wrapper.get('p').text()).toBe('Start one.')
    expect(wrapper.get('.icon').text()).toBe('icon')
    expect(wrapper.get('.actions button').text()).toBe('Create')
  })
})
