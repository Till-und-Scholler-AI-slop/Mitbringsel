import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { InvitePreview } from '@/types/api'

import InviteCard from '../InviteCard.vue'

function preview(overrides: Partial<InvitePreview> = {}): InvitePreview {
  return {
    groupName: 'WG Kaiserstraße',
    invitedByName: 'Lena',
    invitedByAvatarUrl: null,
    expiresAt: '2026-12-01T10:00:00Z',
    memberCount: 2,
    members: [
      { firstName: 'Lena', avatarUrl: null },
      { firstName: 'Jonas', avatarUrl: null },
    ],
    ...overrides,
  }
}

function mountCard(p: InvitePreview) {
  return mount(InviteCard, {
    props: { preview: p },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('InviteCard', () => {
  it('says who invites to which household', () => {
    const wrapper = mountCard(preview())

    expect(wrapper.get('.inviter-text').text()).toBe('Lena invites you to')
    expect(wrapper.get('.inviter-text strong').text()).toBe('Lena')
    expect(wrapper.get('h2').text()).toBe('WG Kaiserstraße')
  })

  it('does not name the inviter when they deleted their account', () => {
    const wrapper = mountCard(preview({ invitedByName: null }))

    expect(wrapper.get('.inviter-text').text()).toBe('You are invited to')
    expect(wrapper.find('.inviter-avatar').exists()).toBe(false)
  })

  it('lists the members by first name with their count', () => {
    const wrapper = mountCard(preview())

    expect(wrapper.findAll('.member-name').map((n) => n.text())).toEqual(['Lena', 'Jonas'])
    expect(wrapper.get('.members-count').text()).toBe('2')
    expect(wrapper.find('.more').exists()).toBe(false)
  })

  it('counts the members that are not listed', () => {
    const wrapper = mountCard(preview({ memberCount: 6 }))

    expect(wrapper.get('.more').text()).toBe('+ 4 more')
  })
})
