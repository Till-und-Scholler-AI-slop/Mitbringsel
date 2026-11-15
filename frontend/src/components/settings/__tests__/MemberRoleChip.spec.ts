import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import MemberRoleChip from '../MemberRoleChip.vue'

describe('MemberRoleChip', () => {
  it.each([
    ['owner', 'Founder'],
    ['admin', 'Admin'],
    ['member', 'Member'],
  ] as const)('names the role %s and colors it by role', (role, text) => {
    const wrapper = mount(MemberRoleChip, {
      props: { role },
      global: { plugins: [createAppI18n(['en'], null)] },
    })

    expect(wrapper.text()).toBe(text)
    expect(wrapper.classes()).toContain(`role--${role}`)
  })
})
