import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { Group, GroupMember, Role } from '@/types/api'

import MemberActionsDialog from '../MemberActionsDialog.vue'

// See CreateGroupDialog.spec.ts: the store is built around a fake service.
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

function member(role: Role): GroupMember {
  return {
    userId: 'u2',
    displayName: 'Mehmet',
    avatarUrl: null,
    role,
    joinedAt: '2026-01-01T10:00:00Z',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  service.removeMember.mockResolvedValue(undefined)
  service.setMemberRole.mockResolvedValue(undefined)
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

function mountDialog(viewer: Role, target: Role) {
  const group: Group = {
    id: 'g1',
    name: 'WG Kaiserstraße',
    role: viewer,
    members: [member(target)],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
  const wrapper = mount(MemberActionsDialog, {
    props: {
      group,
      member: member(target),
      open: true,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  return wrapper
}

function actionTitles(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.findAll('.action-title').map((e) => e.text())
}

describe('MemberActionsDialog', () => {
  it('is named after the member and shows their role', () => {
    const wrapper = mountDialog('owner', 'admin')

    expect(wrapper.get('h2').text()).toBe('Mehmet')
    expect(wrapper.get('.heading .role').text()).toBe('Admin')
    wrapper.unmount()
  })

  it.each([
    ['owner', 'member', ['Make admin', 'Remove from household']],
    ['owner', 'admin', ['Remove admin rights', 'Remove from household']],
    ['admin', 'member', ['Remove from household']],
  ] as const)('offers a %s the right actions for a %s', (viewer, target, titles) => {
    const wrapper = mountDialog(viewer, target)

    expect(wrapper.get('.question').text()).toBe('What should happen to Mehmet?')
    expect(actionTitles(wrapper)).toEqual(titles)
    wrapper.unmount()
  })

  it('makes a member admin and closes', async () => {
    const wrapper = mountDialog('owner', 'member')

    await wrapper.findAll('.action')[0]!.trigger('click')
    await flushPromises()

    expect(service.setMemberRole).toHaveBeenCalledWith('g1', 'u2', 'admin')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('takes the admin rights away', async () => {
    const wrapper = mountDialog('owner', 'admin')

    await wrapper.findAll('.action')[0]!.trigger('click')
    await flushPromises()

    expect(service.setMemberRole).toHaveBeenCalledWith('g1', 'u2', 'member')
    wrapper.unmount()
  })

  it('asks again before removing, and goes back without removing', async () => {
    const wrapper = mountDialog('admin', 'member')

    await wrapper.get('.action').trigger('click')

    expect(service.removeMember).not.toHaveBeenCalled()
    // The final "yes" is the filled red button.
    expect(wrapper.get('.remove').classes()).toContain('base-button--danger-solid')
    expect(wrapper.get('.confirm').text()).toContain(
      'Mehmet loses access to all lists of “WG Kaiserstraße”.',
    )

    await wrapper.get('.back').trigger('click')

    expect(wrapper.find('.confirm').exists()).toBe(false)
    expect(wrapper.find('.action').exists()).toBe(true)
    wrapper.unmount()
  })

  it('removes the member after the confirmation and closes', async () => {
    const wrapper = mountDialog('admin', 'member')

    await wrapper.get('.action').trigger('click')
    await wrapper.get('.remove').trigger('click')
    await flushPromises()

    expect(service.removeMember).toHaveBeenCalledWith('g1', 'u2')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('disables back while removing is in flight and re-enables it afterwards', async () => {
    let rejectRemove!: (err: Error) => void
    service.removeMember.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectRemove = reject
        }),
    )
    const wrapper = mountDialog('admin', 'member')

    await wrapper.get('.action').trigger('click')
    await wrapper.get('.remove').trigger('click')

    expect(wrapper.get('.back').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.remove').attributes('aria-busy')).toBe('true')

    rejectRemove(new ApiError('NETWORK'))
    await flushPromises()

    expect(wrapper.get('.back').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.confirm').exists()).toBe(true)
    expect(wrapper.props('open')).toBe(true)
    wrapper.unmount()
  })

  it('shows the message of a server error and stays open', async () => {
    service.setMemberRole.mockRejectedValue(new ApiError('FORBIDDEN', 403))
    const wrapper = mountDialog('owner', 'member')

    await wrapper.findAll('.action')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('You are not allowed to do this.')
    expect(wrapper.props('open')).toBe(true)
    wrapper.unmount()
  })

  it('disables all actions with a hint while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const wrapper = mountDialog('owner', 'member')

    expect(wrapper.get('[role="status"]').text()).toBe('Requires an internet connection.')
    const buttons = wrapper.findAll('.action')
    expect(buttons.map((b) => b.attributes('disabled'))).toEqual(['', ''])

    await buttons[0]!.trigger('click')
    expect(service.setMemberRole).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('disables confirming removal if the connection drops, keeping back active', async () => {
    const wrapper = mountDialog('admin', 'member')
    await wrapper.get('.action').trigger('click')

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toBe('Requires an internet connection.')
    expect(wrapper.get('.remove').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.back').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
