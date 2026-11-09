import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ListsService } from '@/services/api/lists'
import type { List } from '@/types/api'

import ListNameDialog from '../ListNameDialog.vue'

// The store is built around a fake service, like in the group dialogs.
const service = vi.hoisted(() => ({
  list: vi.fn<ListsService['list']>(),
  create: vi.fn<ListsService['create']>(),
  rename: vi.fn<ListsService['rename']>(),
  setArchived: vi.fn<ListsService['setArchived']>(),
  remove: vi.fn<ListsService['remove']>(),
}))

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return { ...original, useListsStore: original.defineListsStore(service, () => 'user-1') }
})

const LIST: List = {
  id: 'l1',
  groupId: 'g1',
  name: 'Supermarkt',
  archivedAt: null,
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
  serverSeq: 1,
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

async function mountDialog(list?: List) {
  const wrapper = mount(ListNameDialog, {
    props: {
      groupId: 'g1',
      list,
      open: false,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  return wrapper
}

const input = (wrapper: Awaited<ReturnType<typeof mountDialog>>) =>
  wrapper.get('input').element as HTMLInputElement

describe('ListNameDialog: new list', () => {
  it('starts empty and cannot be sent', async () => {
    const wrapper = await mountDialog()

    expect(wrapper.get('h2').text()).toBe('New list')
    expect(input(wrapper).value).toBe('')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('creates the list with the trimmed name and closes', async () => {
    service.create.mockResolvedValue({ ...LIST, name: 'Baumarkt' })
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('  Baumarkt  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.create).toHaveBeenCalledWith('g1', 'Baumarkt')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('says so while typing when the name is too long', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('a'.repeat(51))

    expect(wrapper.text()).toContain('The list name must be 1 to 50 characters long.')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('shows the error of the server and stays open', async () => {
    service.create.mockRejectedValue(new ApiError('NETWORK'))
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('Baumarkt')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('The server cannot be reached.')
    expect(wrapper.props('open')).toBe(true)
    wrapper.unmount()
  })

  it('starts empty again when it is opened a second time', async () => {
    const wrapper = await mountDialog()
    await wrapper.get('input').setValue('Baumarkt')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(input(wrapper).value).toBe('')
    wrapper.unmount()
  })
})

describe('ListNameDialog: rename', () => {
  it('starts with the current name', async () => {
    const wrapper = await mountDialog(LIST)

    expect(wrapper.get('h2').text()).toBe('Rename list')
    expect(input(wrapper).value).toBe('Supermarkt')
    wrapper.unmount()
  })

  it('renames with the trimmed name and closes', async () => {
    service.rename.mockResolvedValue({ ...LIST, name: 'Drogerie' })
    const wrapper = await mountDialog(LIST)

    await wrapper.get('input').setValue('  Drogerie  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.rename).toHaveBeenCalledWith('l1', 'Drogerie')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('sends nothing when the name did not change', async () => {
    const wrapper = await mountDialog(LIST)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.rename).not.toHaveBeenCalled()
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('shows the error of the server and keeps the dialog open', async () => {
    service.rename.mockRejectedValue(new ApiError('LIST_NOT_FOUND', 404))
    const wrapper = await mountDialog(LIST)

    await wrapper.get('input').setValue('Drogerie')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('This list does not exist')
    expect(wrapper.props('open')).toBe(true)
    wrapper.unmount()
  })
})

describe('ListNameDialog: already open when mounted', () => {
  it('fills in the name of the list', () => {
    const wrapper = mount(ListNameDialog, {
      props: { groupId: 'g1', list: LIST, open: true },
      global: { plugins: [createAppI18n(['en'], null)] },
      attachTo: document.body,
    })

    expect(input(wrapper as never).value).toBe('Supermarkt')
    wrapper.unmount()
  })
})
