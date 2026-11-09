import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { Group, GroupMember } from '@/types/api'

import HouseholdSwitcher from '../HouseholdSwitcher.vue'

function member(userId: string): GroupMember {
  return {
    userId,
    displayName: userId,
    avatarUrl: null,
    role: 'member',
    joinedAt: '2026-01-01T10:00:00Z',
  }
}

function group(id: string, name: string, memberCount: number): Group {
  return {
    id,
    name,
    role: 'member',
    members: Array.from({ length: memberCount }, (_, i) => member(`u${i}`)),
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

const KAISER = group('g1', 'WG Kaiserstraße', 4)
const FAMILY = group('g2', 'Familie', 1)

async function mountSwitcher() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/groups/:groupId', name: 'group', component: { template: '<p />' } },
      {
        path: '/groups/:groupId/settings',
        name: 'group-settings',
        component: { template: '<p />' },
      },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: { template: '<p />' } },
    ],
  })
  await router.push('/groups/g1/lists/l1')
  const wrapper = mount(HouseholdSwitcher, {
    props: { current: KAISER, groups: [KAISER, FAMILY] },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  return { wrapper, router }
}

type Mounted = Awaited<ReturnType<typeof mountSwitcher>>['wrapper']
const toggle = (w: Mounted) => w.get('button.toggle')
const panel = (w: Mounted) => w.find('.panel')

describe('HouseholdSwitcher', () => {
  it('shows the household name and opens and closes the panel', async () => {
    const { wrapper } = await mountSwitcher()

    expect(toggle(wrapper).text()).toBe('WG Kaiserstraße')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false')
    expect(panel(wrapper).exists()).toBe(false)

    await toggle(wrapper).trigger('click')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('true')
    expect(toggle(wrapper).attributes('aria-controls')).toBe(panel(wrapper).attributes('id'))

    await toggle(wrapper).trigger('click')
    expect(panel(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('lists the households with their members and marks the current one', async () => {
    const { wrapper } = await mountSwitcher()
    await toggle(wrapper).trigger('click')

    const entries = wrapper.findAll('.group')
    expect(entries.map((e) => e.find('.group-name').text())).toEqual(['WG Kaiserstraße', 'Familie'])
    expect(entries.map((e) => e.find('.group-members').text())).toEqual(['4 members', '1 member'])
    expect(entries.map((e) => e.attributes('aria-current'))).toEqual(['page', undefined])
    expect(entries.map((e) => e.attributes('href'))).toEqual(['/groups/g1', '/groups/g2'])
    wrapper.unmount()
  })

  it('switches to another household and closes', async () => {
    const { wrapper, router } = await mountSwitcher()
    await toggle(wrapper).trigger('click')

    await wrapper.findAll('.group')[1]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/groups/g2')
    expect(panel(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('links to managing the household and to the start page', async () => {
    const { wrapper } = await mountSwitcher()
    await toggle(wrapper).trigger('click')

    const links = wrapper.findAll('a.action')
    expect(links.map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['Manage household', '/groups/g1/settings'],
      ['All households (start)', '/'],
    ])
    wrapper.unmount()
  })

  it('asks the parent to found or join a household and closes', async () => {
    const { wrapper } = await mountSwitcher()

    await toggle(wrapper).trigger('click')
    await wrapper.get('button.action[aria-haspopup="dialog"]').trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(panel(wrapper).exists()).toBe(false)

    await toggle(wrapper).trigger('click')
    await wrapper.findAll('button.action')[1]!.trigger('click')
    expect(wrapper.emitted('join')).toHaveLength(1)
    expect(panel(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes on Escape and gives the focus back to the name', async () => {
    const { wrapper } = await mountSwitcher()
    await toggle(wrapper).trigger('click')

    await wrapper.get('.panel a').trigger('keydown', { key: 'Escape' })

    expect(panel(wrapper).exists()).toBe(false)
    expect(document.activeElement).toBe(toggle(wrapper).element)
    wrapper.unmount()
  })

  it('closes on a tap next to the panel', async () => {
    const { wrapper } = await mountSwitcher()
    await toggle(wrapper).trigger('click')

    await wrapper.get('.scrim').trigger('click')

    expect(panel(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })
})
