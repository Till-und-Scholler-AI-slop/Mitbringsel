import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import InviteNotice from '../InviteNotice.vue'

describe('InviteNotice', () => {
  it('shows title and text and is named by its title', () => {
    const wrapper = mount(InviteNotice, {
      props: { icon: 'clock', title: 'Too many requests', body: 'Wait a moment.' },
      slots: { default: '<p class="extra">42 s</p>' },
    })

    expect(wrapper.get('h2').text()).toBe('Too many requests')
    expect(wrapper.get('.body').text()).toBe('Wait a moment.')
    expect(wrapper.get('.extra').text()).toBe('42 s')
    expect(wrapper.attributes('aria-label')).toBe('Too many requests')
  })
})
