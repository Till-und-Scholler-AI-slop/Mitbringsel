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
  update: vi.fn<ListsService['update']>(),
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
  icon: 'general',
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

/** The value of the checked icon radio. */
const picked = (wrapper: Awaited<ReturnType<typeof mountDialog>>) =>
  (wrapper.get('input[type="radio"]:checked').element as HTMLInputElement).value

describe('ListNameDialog: new list', () => {
  it('starts empty and cannot be sent', async () => {
    const wrapper = await mountDialog()

    expect(wrapper.get('h2').text()).toBe('New list')
    expect(input(wrapper).value).toBe('')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('creates the list with the trimmed name and closes', async () => {
    service.create.mockResolvedValue({ ...LIST, name: 'Urlaub' })
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('  Urlaub  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.create).toHaveBeenCalledWith('g1', 'Urlaub', 'general')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('suggests an icon from the name and follows changes until picked by hand', async () => {
    service.create.mockResolvedValue({ ...LIST, name: 'Bäcker', icon: 'bakery' })
    const wrapper = await mountDialog()

    expect(picked(wrapper)).toBe('general')

    await wrapper.get('input').setValue('Drogerie')
    expect(picked(wrapper)).toBe('drugstore')

    // Falls back to general when the name no longer matches any icon.
    await wrapper.get('input').setValue('Urlaub')
    expect(picked(wrapper)).toBe('general')

    await wrapper.get('input').setValue('Bäcker')
    expect(picked(wrapper)).toBe('bakery')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.create).toHaveBeenCalledWith('g1', 'Bäcker', 'bakery')
    wrapper.unmount()
  })

  it('keeps the manually picked icon even when the name changes afterwards', async () => {
    service.create.mockResolvedValue({ ...LIST, name: 'Drogerie', icon: 'garden' })
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('Baumarkt')
    expect(picked(wrapper)).toBe('hardware')

    await wrapper.get('input[value="garden"]').setValue(true)
    expect(picked(wrapper)).toBe('garden')

    await wrapper.get('input').setValue('Drogerie')
    expect(picked(wrapper)).toBe('garden')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.create).toHaveBeenCalledWith('g1', 'Drogerie', 'garden')
    wrapper.unmount()
  })

  it('keeps general when the user picks it back by hand', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('Drogerie')
    expect(picked(wrapper)).toBe('drugstore')

    await wrapper.get('input[value="general"]').setValue(true)
    await wrapper.get('input').setValue('Baumarkt')
    expect(picked(wrapper)).toBe('general')
    wrapper.unmount()
  })

  it('creates the list with the picked icon', async () => {
    service.create.mockResolvedValue({ ...LIST, name: 'Urlaub', icon: 'hardware' })
    const wrapper = await mountDialog()

    expect(picked(wrapper)).toBe('general')
    await wrapper.get('input').setValue('Urlaub')
    await wrapper.get('input[value="hardware"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.create).toHaveBeenCalledWith('g1', 'Urlaub', 'hardware')
    wrapper.unmount()
  })

  it('says so while typing when the name is too long', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('a'.repeat(51))

    expect(wrapper.text()).toContain('The list name must be 1 to 50 characters long.')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('asks for a name when the field is left empty', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('Market')
    await wrapper.get('input').setValue('')
    await wrapper.get('input').trigger('blur')

    expect(wrapper.get('[role="alert"]').text()).toContain('Give the list a name.')
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

  it('says when the household has too many lists', async () => {
    service.create.mockRejectedValue(new ApiError('TOO_MANY_LISTS', 409))
    const wrapper = await mountDialog()

    await wrapper.get('input').setValue('Baumarkt')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'This household already has 100 lists, archived ones included.',
    )
    wrapper.unmount()
  })

  it('starts empty again and suggests again when it is opened a second time', async () => {
    const wrapper = await mountDialog()
    await wrapper.get('input').setValue('Baumarkt')
    await wrapper.get('input[value="garden"]').setValue(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(input(wrapper).value).toBe('')
    expect(picked(wrapper)).toBe('general')

    await wrapper.get('input').setValue('Drogerie')
    expect(picked(wrapper)).toBe('drugstore')
    wrapper.unmount()
  })
})

describe('ListNameDialog: edit', () => {
  it('starts with the current name and icon', async () => {
    const wrapper = await mountDialog({ ...LIST, icon: 'bakery' })

    expect(wrapper.get('h2').text()).toBe('Edit list')
    expect(input(wrapper).value).toBe('Supermarkt')
    expect(picked(wrapper)).toBe('bakery')
    wrapper.unmount()
  })

  it('does not suggest a new icon when renaming an existing list', async () => {
    const wrapper = await mountDialog({ ...LIST, icon: 'bakery' })

    await wrapper.get('input').setValue('Drogerie')
    expect(picked(wrapper)).toBe('bakery')
    wrapper.unmount()
  })

  it('renames with the trimmed name and closes', async () => {
    service.update.mockResolvedValue({ ...LIST, name: 'Drogerie' })
    const wrapper = await mountDialog(LIST)

    await wrapper.get('input').setValue('  Drogerie  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.update).toHaveBeenCalledWith('l1', 'Drogerie', 'general')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('sends nothing when name and icon did not change', async () => {
    const wrapper = await mountDialog(LIST)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.update).not.toHaveBeenCalled()
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('saves a new icon even when the name stays', async () => {
    service.update.mockResolvedValue({ ...LIST, icon: 'supermarket' })
    const wrapper = await mountDialog(LIST)

    await wrapper.get('input[value="supermarket"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(service.update).toHaveBeenCalledWith('l1', 'Supermarkt', 'supermarket')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('shows the error of the server and keeps the dialog open', async () => {
    service.update.mockRejectedValue(new ApiError('LIST_NOT_FOUND', 404))
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
