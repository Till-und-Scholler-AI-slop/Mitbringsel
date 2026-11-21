import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n, type Locale } from '@/i18n'
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

function mountCard(p: InvitePreview, locale: Locale = 'en') {
  return mount(InviteCard, {
    props: { preview: p },
    global: { plugins: [createAppI18n([locale], null)] },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

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

  it('shows the expiry date and remaining time in German with a datetime attribute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'))

    const expiresAt = '2026-11-27T12:00:00Z'
    const wrapper = mountCard(preview({ expiresAt }), 'de')

    expect(wrapper.get('.expiry').text()).toBe('Link gültig bis Fr., 27. Nov. · noch 6 Tage')
    const time = wrapper.get('.expiry time')
    expect(time.text()).toBe('Fr., 27. Nov.')
    expect(time.attributes('datetime')).toBe(expiresAt)
  })

  it('formats the expiry date and remaining time in English', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z'))

    const expiresAt = '2026-11-27T12:00:00Z'
    const wrapper = mountCard(preview({ expiresAt }), 'en')

    expect(wrapper.get('.expiry').text()).toBe('Link valid until Fri, Nov 27 · 2 hours left')
    const time = wrapper.get('.expiry time')
    expect(time.text()).toBe('Fri, Nov 27')
    expect(time.attributes('datetime')).toBe(expiresAt)
  })
})
