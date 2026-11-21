import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Invite } from '@/types/api'

import OpenInviteRow from '../OpenInviteRow.vue'

// "Now" is 2026-11-04 12:00; the link was made two days ago and ends in five.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

const INVITE: Invite = {
  id: 'i1',
  createdAt: '2026-11-02T12:00:00Z',
  expiresAt: '2026-11-09T12:00:00Z',
  createdBy: 'u-lena',
  createdByName: 'Lena',
}

function mountRow(
  props: { invite?: Invite; isMine?: boolean; busy?: boolean; error?: string | null } = {},
) {
  return mount(OpenInviteRow, {
    props: { invite: INVITE, isMine: false, busy: false, error: null, ...props },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('OpenInviteRow', () => {
  it('says who made the link, how long ago and how long it still works', () => {
    const wrapper = mountRow()

    expect(wrapper.get('.created-by').text()).toBe('Created by Lena')
    expect(wrapper.get('.details').text()).toBe('2 days ago · 5 days left')
  })

  it('says "you" for a link of the signed-in user, but names them to screen readers', () => {
    const wrapper = mountRow({ isMine: true })

    expect(wrapper.get('.created-by').text()).toBe('Created by you')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Revoke the link of Lena')
  })

  it('copes with a creator who deleted their account', () => {
    const wrapper = mountRow({ invite: { ...INVITE, createdBy: null, createdByName: null } })

    expect(wrapper.get('.created-by').text()).toBe('Created by a deleted account')
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Revoke the link of a deleted account',
    )
  })

  it('has a revoke button that names whose link it is, and tells the parent', async () => {
    const wrapper = mountRow()
    const button = wrapper.get('button')

    expect(button.text()).toBe('Revoke')
    expect(button.attributes('aria-label')).toBe('Revoke the link of Lena')

    await button.trigger('click')

    expect(wrapper.emitted('revoke')).toHaveLength(1)
  })

  it('shows that it is working and its error', () => {
    const wrapper = mountRow({ busy: true, error: 'The server cannot be reached.' })

    expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')
  })
})
