import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import ConfirmDialog from '../ConfirmDialog.vue'

beforeEach(() => {
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

function mountDialog(
  props: { loading?: boolean; error?: string | null; requireOnline?: boolean } = {},
) {
  const wrapper = mount(ConfirmDialog, {
    props: {
      open: true,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
      title: 'Delete household?',
      message: 'It cannot be undone.',
      confirmLabel: 'Delete for good',
      cancelLabel: 'Cancel',
      ...props,
    },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  return wrapper
}

describe('ConfirmDialog', () => {
  it('shows the question and asks for confirmation', async () => {
    const wrapper = mountDialog()

    expect(wrapper.get('h2').text()).toBe('Delete household?')
    expect(wrapper.get('.message').text()).toBe('It cannot be undone.')
    expect(wrapper.get('.message-icon').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.confirm').classes()).toContain('base-button--danger-solid')

    await wrapper.get('.confirm').trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('closes on cancel without confirming', async () => {
    const wrapper = mountDialog()

    await wrapper.get('.cancel').trigger('click')

    expect(wrapper.props('open')).toBe(false)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows an error and blocks the buttons while it is working', () => {
    const wrapper = mountDialog({ loading: true, error: 'Something went wrong.' })

    expect(wrapper.get('[role="alert"]').text()).toContain('Something went wrong.')
    expect(wrapper.get('.confirm').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('.cancel').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('disables confirm with an offline hint only when requireOnline is enabled', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    // Default (used by LogoutConfirmDialog, #111): stays enabled offline.
    const defaultDialog = mountDialog()
    expect(defaultDialog.find('[role="status"]').exists()).toBe(false)
    expect(defaultDialog.get('.confirm').attributes('disabled')).toBeUndefined()
    defaultDialog.unmount()

    const onlineOnly = mountDialog({ requireOnline: true })
    expect(onlineOnly.get('[role="status"]').text()).toBe('Requires an internet connection.')
    expect(onlineOnly.get('.confirm').attributes('disabled')).toBeDefined()
    expect(onlineOnly.get('.cancel').attributes('disabled')).toBeUndefined()
    onlineOnly.unmount()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
