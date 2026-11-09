import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { List } from '@/types/api'

import ListCard from '../ListCard.vue'

function list(name: string, archivedAt: string | null = null): List {
  return {
    id: 'l1',
    groupId: 'g1',
    name,
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

function mountCard(l: List) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/groups/:groupId/lists/:listId', name: 'list', component: {} }],
  })
  return mount(ListCard, {
    props: { list: l },
    global: { plugins: [createAppI18n(['en'], null), router] },
  })
}

describe('ListCard', () => {
  it('shows the name, with the full name as tooltip', () => {
    const name = mountCard(list('Weekly shopping')).get('h3')

    expect(name.text()).toBe('Weekly shopping')
    expect(name.attributes('title')).toBe('Weekly shopping')
  })

  it('links the name to the list', () => {
    expect(mountCard(list('Weekly shopping')).get('h3 a').attributes('href')).toBe(
      '/groups/g1/lists/l1',
    )
  })

  it('asks for the actions with a button named after the list', async () => {
    const wrapper = mountCard(list('Weekly shopping'))

    await wrapper.get('button[aria-label="Actions for Weekly shopping"]').trigger('click')

    expect(wrapper.emitted('act')).toHaveLength(1)
  })

  it('marks an archived list', () => {
    expect(mountCard(list('Old')).classes()).not.toContain('card--archived')
    expect(mountCard(list('Old', '2026-02-01T10:00:00Z')).classes()).toContain('card--archived')
  })
})
