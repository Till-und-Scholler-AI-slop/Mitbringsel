import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { Group, Role } from '@/types/api'

import GroupSettingsView from '../GroupSettingsView.vue'

const service = vi.hoisted(() => ({
  list: vi.fn<GroupsService['list']>(),
  create: vi.fn<GroupsService['create']>(),
  rename: vi.fn<GroupsService['rename']>(),
  remove: vi.fn<GroupsService['remove']>(),
  removeMember: vi.fn<GroupsService['removeMember']>(),
  setMemberRole: vi.fn<GroupsService['setMemberRole']>(),
}))

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return { ...original, useGroupsStore: original.defineGroupsStore(service, () => 'user-1') }
})

function group(role: Role, name = 'WG Kaiserstraße'): Group {
  return {
    id: 'g1',
    name,
    role,
    members: [],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

async function mountView(groupId = 'g1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<p />' } },
      { path: '/groups/:groupId/settings', name: 'group-settings', component: {} },
    ],
  })
  await router.push(`/groups/${groupId}/settings`)
  const wrapper = mount(GroupSettingsView, {
    props: { groupId },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

describe('GroupSettingsView', () => {
  it('loads the households when it is opened directly and shows the name', async () => {
    service.list.mockResolvedValue([group('owner')])

    const { wrapper } = await mountView()

    expect(service.list).toHaveBeenCalledTimes(1)
    expect(wrapper.get('h1').text()).toBe('Manage household')
    expect(wrapper.get('.name').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('shows a spinner while loading', async () => {
    service.list.mockReturnValue(new Promise(() => undefined))

    const { wrapper } = await mountView()

    expect(wrapper.get('[role="status"]').text()).toBe('Loading household …')
    wrapper.unmount()
  })

  it('says so and offers a retry when the households cannot be loaded', async () => {
    service.list.mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = await mountView()

    expect(wrapper.get('[role="alert"]').text()).toContain('The household could not be loaded.')
    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')

    service.list.mockResolvedValueOnce([group('member')])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.get('.name').text()).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('says that the household is not found when it is not among the loaded ones', async () => {
    service.list.mockResolvedValue([group('owner')])

    const { wrapper, router } = await mountView('other')

    expect(wrapper.get('h2').text()).toBe('Household not found')
    await wrapper.get('main button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ] as const)('%s may rename: %s', async (role, mayRename) => {
    service.list.mockResolvedValue([group(role)])

    const { wrapper } = await mountView()

    const rename = wrapper.findAll('main button').find((b) => b.text() === 'Rename')
    expect(rename !== undefined).toBe(mayRename)
    wrapper.unmount()
  })

  it('renames the household and shows the new name', async () => {
    service.list.mockResolvedValue([group('owner')])
    service.rename.mockResolvedValue(group('owner', 'WG Süd'))
    const { wrapper } = await mountView()

    await wrapper
      .findAll('main button')
      .find((b) => b.text() === 'Rename')!
      .trigger('click')
    await wrapper.get('dialog input').setValue('WG Süd')
    await wrapper.get('dialog form').trigger('submit')
    await flushPromises()

    expect(service.rename).toHaveBeenCalledWith('g1', 'WG Süd')
    expect(wrapper.get('.name').text()).toBe('WG Süd')
    wrapper.unmount()
  })

  it('goes back to the start page', async () => {
    service.list.mockResolvedValue([group('owner')])
    const { wrapper, router } = await mountView()

    await wrapper.get('button[aria-label="Back to the start page"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
  })
})
