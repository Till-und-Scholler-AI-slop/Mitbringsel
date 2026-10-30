import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import LoginNotice from '../LoginNotice.vue'

describe('LoginNotice', () => {
  it.each([
    { kind: 'error', role: 'alert' },
    { kind: 'session', role: 'status' },
    { kind: 'offline', role: 'status' },
  ] as const)('announces $kind as $role', ({ kind, role }) => {
    const wrapper = mount(LoginNotice, {
      props: { kind, title: 'Title' },
      slots: { default: 'Body' },
    })

    const notice = wrapper.get(`[role="${role}"]`)
    expect(notice.text()).toContain('Title')
    expect(notice.text()).toContain('Body')
  })

  it('shows actions only when given', () => {
    const without = mount(LoginNotice, { props: { kind: 'session', title: 'Title' } })
    const withActions = mount(LoginNotice, {
      props: { kind: 'error', title: 'Title' },
      slots: { actions: '<button>Retry</button>' },
    })

    expect(without.find('.actions').exists()).toBe(false)
    expect(withActions.get('.actions button').text()).toBe('Retry')
  })
})
