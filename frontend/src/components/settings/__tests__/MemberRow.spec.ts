import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { GroupMember } from '@/types/api'

import MemberRow from '../MemberRow.vue'

const MEMBER: GroupMember = {
  userId: 'u1',
  displayName: 'Lena',
  avatarUrl: null,
  role: 'admin',
  joinedAt: '2026-01-01T10:00:00Z',
}

function mountRow(props: { isMe?: boolean; canAct?: boolean; offline?: boolean } = {}) {
  return mount(MemberRow, {
    props: { member: MEMBER, isMe: false, canAct: false, ...props },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('MemberRow', () => {
  it('shows the name and the role', () => {
    const wrapper = mountRow()

    expect(wrapper.get('.name').text()).toBe('Lena')
    expect(wrapper.get('.role').text()).toBe('Admin')
    expect(wrapper.get('.role').classes()).toContain('role--admin')
  })

  it('marks the signed-in user', () => {
    expect(mountRow({ isMe: true }).get('.name').text()).toBe('Lena (You)')
  })

  it('has an actions button only when the viewer can act, and tells the parent', async () => {
    expect(mountRow().find('button').exists()).toBe(false)

    const wrapper = mountRow({ canAct: true })
    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Actions for Lena')

    await button.trigger('click')

    expect(wrapper.emitted('act')).toHaveLength(1)
  })

  it('disables the actions button while offline', async () => {
    const wrapper = mountRow({ canAct: true, offline: true })
    const button = wrapper.get('button')

    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')

    expect(wrapper.emitted('act')).toBeUndefined()
  })
})
