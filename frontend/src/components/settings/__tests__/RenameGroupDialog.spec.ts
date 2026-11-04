import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { GroupsService } from '@/services/api/groups'
import type { Group } from '@/types/api'

import RenameGroupDialog from '../RenameGroupDialog.vue'

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

const GROUP: Group = {
  id: 'g1',
  name: 'WG Kaiserstraße',
  role: 'owner',
  members: [],
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
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
  const wrapper = mount(RenameGroupDialog, {
    props: {
      group: GROUP,
      open: false,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  return wrapper
}

describe('RenameGroupDialog', () => {
  it('starts with the current name', async () => {
    const wrapper = await mountDialog()

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })

  it('renames with the trimmed name and closes', async () => {
    service.rename.mockResolvedValue({ ...GROUP, name: 'WG Süd' })
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('  WG Süd  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.rename).toHaveBeenCalledWith('g1', 'WG Süd')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('closes without a request when the name did not change', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('form').trigger('submit')

    expect(service.rename).not.toHaveBeenCalled()
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('does not send an empty or a too long name', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('   ')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    await wrapper.get('input').setValue('x'.repeat(31))
    await wrapper.get('form').trigger('submit')

    expect(wrapper.get('[role="alert"]').text()).toContain('1 to 30 characters')
    expect(service.rename).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows the message of a server error and stays open, until the name changes', async () => {
    service.rename.mockRejectedValue(new ApiError('FORBIDDEN', 403))
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('WG Süd')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('You are not allowed to do this.')
    expect(wrapper.props('open')).toBe(true)

    await wrapper.get('input').setValue('WG Nord')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('starts again with the current name every time it is opened', async () => {
    const wrapper = await mountDialog()
    await wrapper.get('input').setValue('Draft')

    await wrapper.get('button[type="button"]:not([aria-label])').trigger('click')
    await wrapper.setProps({ open: true })

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('WG Kaiserstraße')
    wrapper.unmount()
  })
})
