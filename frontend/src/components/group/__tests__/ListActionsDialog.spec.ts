import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ListsService } from '@/services/api/lists'
import type { List } from '@/types/api'

import ListActionsDialog from '../ListActionsDialog.vue'

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

function list(archivedAt: string | null = null): List {
  return {
    id: 'l1',
    groupId: 'g1',
    name: 'Supermarkt',
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
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

function mountDialog(l: List, canDelete = true) {
  const wrapper = mount(ListActionsDialog, {
    props: {
      list: l,
      canDelete,
      open: true,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  return wrapper
}

const titles = (wrapper: ReturnType<typeof mountDialog>) =>
  wrapper.findAll('.action-title').map((e) => e.text())

describe('ListActionsDialog', () => {
  it('names the list in the question', () => {
    const wrapper = mountDialog(list())

    expect(wrapper.get('.question').text()).toBe('What should happen to “Supermarkt”?')
    wrapper.unmount()
  })

  it('offers rename, archive and delete for an active list', () => {
    const wrapper = mountDialog(list())

    expect(titles(wrapper)).toEqual(['Rename', 'Archive', 'Delete'])
    wrapper.unmount()
  })

  it('offers restore instead of archive for an archived list', () => {
    const wrapper = mountDialog(list('2026-02-01T10:00:00Z'))

    expect(titles(wrapper)).toEqual(['Rename', 'Restore', 'Delete'])
    wrapper.unmount()
  })

  it('hides delete from members who may not delete', () => {
    const wrapper = mountDialog(list(), false)

    expect(titles(wrapper)).toEqual(['Rename', 'Archive'])
    wrapper.unmount()
  })

  it('hands over to the name form on rename, without a request', async () => {
    const wrapper = mountDialog(list())

    await wrapper.findAll('.action')[0]!.trigger('click')

    expect(wrapper.emitted('rename')).toHaveLength(1)
    expect(service.rename).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('archives right away and closes', async () => {
    service.setArchived.mockResolvedValue(list('2026-02-01T10:00:00Z'))
    const wrapper = mountDialog(list())

    await wrapper.findAll('.action')[1]!.trigger('click')
    await flushPromises()

    expect(service.setArchived).toHaveBeenCalledWith('l1', true)
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('restores an archived list', async () => {
    service.setArchived.mockResolvedValue(list())
    const wrapper = mountDialog(list('2026-02-01T10:00:00Z'))

    await wrapper.findAll('.action')[1]!.trigger('click')
    await flushPromises()

    expect(service.setArchived).toHaveBeenCalledWith('l1', false)
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('shows the error and stays open when archiving fails', async () => {
    service.setArchived.mockRejectedValue(new ApiError('NETWORK'))
    const wrapper = mountDialog(list())

    await wrapper.findAll('.action')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')
    expect(wrapper.props('open')).toBe(true)
    wrapper.unmount()
  })

  it('asks again before deleting, and the first click deletes nothing', async () => {
    const wrapper = mountDialog(list())

    await wrapper.findAll('.action')[2]!.trigger('click')

    expect(service.remove).not.toHaveBeenCalled()
    expect(wrapper.get('.confirm').text()).toContain('“Supermarkt” is deleted')
    expect(wrapper.findAll('.action')).toHaveLength(0)
    wrapper.unmount()
  })

  it('goes back from the question without deleting', async () => {
    const wrapper = mountDialog(list())
    await wrapper.findAll('.action')[2]!.trigger('click')

    await wrapper.get('.back').trigger('click')

    expect(service.remove).not.toHaveBeenCalled()
    expect(titles(wrapper)).toEqual(['Rename', 'Archive', 'Delete'])
    wrapper.unmount()
  })

  it('deletes after the confirmation and closes', async () => {
    service.remove.mockResolvedValue()
    const wrapper = mountDialog(list())
    await wrapper.findAll('.action')[2]!.trigger('click')

    await wrapper.get('.delete').trigger('click')
    await flushPromises()

    expect(service.remove).toHaveBeenCalledWith('l1')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('shows the error and stays on the question when deleting is refused', async () => {
    service.remove.mockRejectedValue(new ApiError('FORBIDDEN', 403))
    const wrapper = mountDialog(list())
    await wrapper.findAll('.action')[2]!.trigger('click')

    await wrapper.get('.delete').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('You are not allowed to do this.')
    expect(wrapper.find('.confirm').exists()).toBe(true)
    expect(wrapper.props('open')).toBe(true)
    wrapper.unmount()
  })
})
