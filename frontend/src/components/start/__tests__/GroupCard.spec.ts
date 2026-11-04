import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Group, GroupMember } from '@/types/api'

import GroupCard from '../GroupCard.vue'

function member(index: number): GroupMember {
  return {
    userId: `user-${index}`,
    displayName: `Member ${index}`,
    avatarUrl: null,
    role: index === 0 ? 'owner' : 'member',
    joinedAt: '2026-01-01T10:00:00Z',
  }
}

function group(name: string, memberCount: number): Group {
  return {
    id: 'g1',
    name,
    role: 'owner',
    members: Array.from({ length: memberCount }, (_, i) => member(i)),
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

function mountCard(g: Group) {
  return mount(GroupCard, {
    props: { group: g },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('GroupCard', () => {
  it('shows the name, with the full name as tooltip for long ones', () => {
    const wrapper = mountCard(group('WG Kaiserstraße', 2))

    const name = wrapper.get('h3')
    expect(name.text()).toBe('WG Kaiserstraße')
    expect(name.attributes('title')).toBe('WG Kaiserstraße')
  })

  it.each([
    [1, '1 member'],
    [6, '6 members'],
  ])('says how many members there are (%i)', (count, text) => {
    expect(mountCard(group('WG', count)).get('.members').text()).toBe(text)
  })

  it('shows at most four avatars', () => {
    const wrapper = mountCard(group('WG', 6))

    expect(wrapper.findAll('.avatar')).toHaveLength(4)
  })
})
