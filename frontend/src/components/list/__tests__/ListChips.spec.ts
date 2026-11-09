import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import { LONG_PRESS_MS } from '@/composables/useLongPress'
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

interface Options {
  openCount?: number
  archivedCount?: number
  currentArchived?: boolean
}

async function mountChips({
  openCount = 3,
  archivedCount = 0,
  currentArchived = false,
}: Options = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/groups/:groupId/lists/:listId', name: 'list', component: {} }],
  })
  await router.push('/groups/g1/lists/l1')
  const wrapper = mount(ListChips, {
    props: {
      groupId: 'g1',
      lists: [list('l1', 'Supermarkt'), list('l2', 'Baumarkt')],
      currentId: 'l1',
      openCount,
      archivedCount,
      currentArchived,
    },
    global: { plugins: [createAppI18n(['en'], null), router] },
  })
  return { wrapper, router }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ListChips', () => {
  it('shows every list as a button, not as a link', async () => {
    const { wrapper } = await mountChips()

    // A held link opens the browser's own menu on phones.
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.findAll('.chip--list .chip-name').map((b) => b.text())).toEqual([
      'Supermarkt',
      'Baumarkt',
    ])
  })

  it('marks the current list and shows how many items are open', async () => {
    const { wrapper } = await mountChips({ openCount: 3 })

    const [current, other] = wrapper.findAll('.chip--list')
    expect(current!.classes()).toContain('chip--current')
    expect(current!.attributes('aria-current')).toBe('page')
    expect(current!.find('.count').text()).toBe('3')
    expect(other!.classes()).not.toContain('chip--current')
    expect(other!.find('.count').exists()).toBe(false)
  })

  it('shows no count when nothing is open', async () => {
    const { wrapper } = await mountChips({ openCount: 0 })

    expect(wrapper.find('.count').exists()).toBe(false)
  })

  it('asks for a new list with the plus button', async () => {
    const { wrapper } = await mountChips()

    await wrapper.get('button[aria-label="New list"]').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('goes to another list on a plain click', async () => {
    const { wrapper, router } = await mountChips()

    await wrapper.findAll('.chip--list')[1]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.params.listId).toBe('l2')
    expect(wrapper.emitted('actions')).toBeUndefined()
  })

  it('opens the actions when the current list is chosen again', async () => {
    const { wrapper, router } = await mountChips()

    await wrapper.findAll('.chip--list')[0]!.trigger('click')

    expect(wrapper.emitted('actions')).toEqual([[expect.objectContaining({ id: 'l1' })]])
    expect(router.currentRoute.value.params.listId).toBe('l1')
  })

  it('tells screen readers about that on the current chip', async () => {
    const { wrapper } = await mountChips()

    const [current, other] = wrapper.findAll('.chip--list')
    const hint = wrapper.get(`#${current!.attributes('aria-describedby')}`)
    expect(hint.text()).toBe('Select again to rename, archive or delete')
    expect(other!.attributes('aria-describedby')).toBeUndefined()
  })

  it('opens the actions of any list on a right click', async () => {
    const { wrapper } = await mountChips()

    await wrapper.findAll('.chip--list')[1]!.trigger('contextmenu')

    expect(wrapper.emitted('actions')).toEqual([[expect.objectContaining({ id: 'l2' })]])
  })

  it('opens the actions when a held finger lifts and stays on the list', async () => {
    vi.useFakeTimers()
    const { wrapper, router } = await mountChips()
    const other = wrapper.findAll('.chip--list')[1]!

    await other.trigger('pointerdown', { pointerType: 'touch' })
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(wrapper.emitted('actions')).toBeUndefined()

    await other.trigger('pointerup', { pointerType: 'touch' })
    const touchend = new Event('touchend', { bubbles: true, cancelable: true })
    other.element.dispatchEvent(touchend)
    await flushPromises()

    expect(wrapper.emitted('actions')).toEqual([[expect.objectContaining({ id: 'l2' })]])
    // The browser sends no click after a canceled touchend.
    expect(touchend.defaultPrevented).toBe(true)
    expect(router.currentRoute.value.params.listId).toBe('l1')
  })

  it('shows the archive chip only when there are archived lists', async () => {
    const { wrapper } = await mountChips()

    expect(wrapper.find('.chip--archive').exists()).toBe(false)
  })

  it('asks for the archived lists with the archive chip', async () => {
    const { wrapper } = await mountChips({ archivedCount: 2 })

    const chip = wrapper.get('.chip--archive')
    expect(chip.text()).toBe('Archive (2)')
    expect(chip.classes()).not.toContain('chip--current')
    await chip.trigger('click')

    expect(wrapper.emitted('archive')).toHaveLength(1)
  })

  it('presses the archive chip in while an archived list is open', async () => {
    const { wrapper } = await mountChips({ archivedCount: 1, currentArchived: true })

    expect(wrapper.get('.chip--archive').classes()).toContain('chip--current')
  })
})
