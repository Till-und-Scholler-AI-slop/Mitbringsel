import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { Group, GroupMember, List } from '@/types/api'

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

function list(id: string, name: string): List {
  return {
    id,
    groupId: 'g1',
    name,
    icon: 'general',
    archivedAt: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

function mountCard(g: Group, lists: List[] = []) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/groups/:groupId', name: 'group', component: {} }],
  })
  return mount(GroupCard, {
    props: { group: g, lists },
    global: { plugins: [createAppI18n(['en'], null), router] },
  })
}

describe('GroupCard', () => {
  it('is one link to the household, without a settings link', () => {
    const wrapper = mountCard(group('WG Kaiserstraße', 2))

    expect(wrapper.element.tagName).toBe('A')
    expect(wrapper.attributes('href')).toBe('/groups/g1')
    // findAll includes the card itself.
    expect(wrapper.findAll('a')).toHaveLength(1)
  })

  it('shows the name and the member count', () => {
    const wrapper = mountCard(group('WG Kaiserstraße', 2))

    expect(wrapper.get('.name').text()).toBe('WG Kaiserstraße')
    expect(wrapper.get('.members').text()).toBe('2 members')
  })

  it('shows at most four avatars', () => {
    const wrapper = mountCard(group('WG', 6))

    expect(wrapper.findAll('.avatar')).toHaveLength(4)
  })

  it('shows the lists of the household as chips', () => {
    const wrapper = mountCard(group('WG', 2), [list('l1', 'Supermarkt'), list('l2', 'Drogerie')])

    expect(wrapper.findAll('.list').map((c) => c.text())).toEqual(['Supermarkt', 'Drogerie'])
  })

  it('has no chip row without lists', () => {
    expect(mountCard(group('WG', 2)).find('.lists').exists()).toBe(false)
  })

  it('reads as one summary to screen readers', () => {
    const wrapper = mountCard(group('WG Kaiserstraße', 1), [
      list('l1', 'Supermarkt'),
      list('l2', 'Drogerie'),
    ])

    expect(wrapper.attributes('aria-label')).toBe(
      'WG Kaiserstraße, 1 member. Lists: Supermarkt, Drogerie',
    )
    expect(wrapper.get('.head').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.lists').attributes('aria-hidden')).toBe('true')
  })

  it('leaves the lists out of the summary while there are none', () => {
    const wrapper = mountCard(group('WG Kaiserstraße', 3))

    expect(wrapper.attributes('aria-label')).toBe('WG Kaiserstraße, 3 members')
  })
})
