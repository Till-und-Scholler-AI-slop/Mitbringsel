import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { List } from '@/types/api'

import ListChips from '../ListChips.vue'

function list(id: string, name: string): List {
  return {
    id,
    groupId: 'g1',
    name,
    archivedAt: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

async function mountChips(openCount = 3) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/groups/:groupId/lists/:listId', name: 'list', component: {} }],
  })
  await router.push('/groups/g1/lists/l1')
  return mount(ListChips, {
    props: {
      groupId: 'g1',
      lists: [list('l1', 'Supermarkt'), list('l2', 'Baumarkt')],
      currentId: 'l1',
      openCount,
    },
    global: { plugins: [createAppI18n(['en'], null), router] },
  })
}

describe('ListChips', () => {
  it('links every list', async () => {
    const wrapper = await mountChips()

    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toEqual([
      '/groups/g1/lists/l1',
      '/groups/g1/lists/l2',
    ])
  })

  it('marks the current list and shows how many items are open', async () => {
    const wrapper = await mountChips(3)

    const [current, other] = wrapper.findAll('a')
    expect(current!.classes()).toContain('chip--current')
    expect(current!.attributes('aria-current')).toBe('page')
    expect(current!.find('.count').text()).toBe('3')
    expect(other!.classes()).not.toContain('chip--current')
    expect(other!.find('.count').exists()).toBe(false)
  })

  it('shows no count when nothing is open', async () => {
    const wrapper = await mountChips(0)

    expect(wrapper.find('.count').exists()).toBe(false)
  })

  it('asks for a new list with the plus button', async () => {
    const wrapper = await mountChips()

    await wrapper.get('button[aria-label="New list"]').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
  })
})
