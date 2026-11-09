import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import SettingsCard from '../SettingsCard.vue'

describe('SettingsCard', () => {
  it('is a section named by its heading, with the content below', () => {
    const wrapper = mount(SettingsCard, {
      props: { title: 'Members' },
      slots: { default: '<p class="body">Lena</p>', aside: '<span class="count">3</span>' },
    })

    const heading = wrapper.get('h2')
    expect(heading.text()).toBe('Members')
    expect(wrapper.attributes('aria-labelledby')).toBe(heading.attributes('id'))
    expect(wrapper.get('.head .count').text()).toBe('3')
    expect(wrapper.get('.body').text()).toBe('Lena')
    expect(wrapper.classes()).not.toContain('card--danger')
  })

  it('has a red variant for leaving and deleting', () => {
    const wrapper = mount(SettingsCard, { props: { title: 'Leave household', danger: true } })

    expect(wrapper.classes()).toContain('card--danger')
  })
})
