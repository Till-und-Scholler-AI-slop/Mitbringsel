import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { Group } from '@/types/api'

import CreateGroupDialog from '../CreateGroupDialog.vue'

// The dialog asks useGroupsStore(); replacing the module hands it a store
// built around a fake service. vi.hoisted makes the fake exist before the
// (hoisted) vi.mock factory runs.
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

function created(name: string): Group {
  return {
    id: 'g1',
    name,
    role: 'owner',
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

async function mountDialog() {
  const wrapper = mount(CreateGroupDialog, {
    props: { open: false, 'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }) },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  return wrapper
}

describe('CreateGroupDialog', () => {
  it('waits for a name: the button is disabled while the field is empty', async () => {
    const wrapper = await mountDialog()

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('creates the group with the trimmed name and closes', async () => {
    service.create.mockResolvedValue(created('WG'))
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('  WG  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.create).toHaveBeenCalledWith('WG')
    expect(wrapper.props('open')).toBe(false)
    expect(wrapper.emitted('created')).toEqual([[expect.objectContaining({ name: 'WG' })]])
    wrapper.unmount()
  })

  it('shows the error for a name that is too long and does not send it', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('x'.repeat(31))
    await wrapper.get('form').trigger('submit')

    expect(wrapper.get('[role="alert"]').text()).toContain('Please shorten it by one character.')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(service.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('asks for a name when the field is left empty', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('Home')
    await wrapper.get('input').setValue('')
    await wrapper.get('input').trigger('blur')

    expect(wrapper.get('[role="alert"]').text()).toContain('Give your household a name.')
    wrapper.unmount()
  })

  it('shows the message of a server error and stays open, until the name changes', async () => {
    service.create.mockRejectedValue(new ApiError('RATE_LIMITED', 429))
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('WG')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Too many requests')
    expect(wrapper.props('open')).toBe(true)

    await wrapper.get('input').setValue('WG 2')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says when the user has created too many households', async () => {
    service.create.mockRejectedValue(new ApiError('TOO_MANY_GROUPS', 409))
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('WG')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'You have already created 10 households. Delete one to create a new one.',
    )
    wrapper.unmount()
  })

  it('starts empty every time it is opened', async () => {
    const wrapper = await mountDialog()
    await wrapper.get('input').setValue('Draft')

    await wrapper.get('button[type="button"]:not([aria-label])').trigger('click')
    await wrapper.setProps({ open: true })

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})
