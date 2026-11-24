import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import LogoutConfirmDialog from '../LogoutConfirmDialog.vue'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mountDialog(
  props: { pendingCount?: number; loading?: boolean; error?: string | null } = {},
) {
  const wrapper = mount(LogoutConfirmDialog, {
    props: {
      open: true,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
      pendingCount: 2,
      ...props,
    },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  return wrapper
}

describe('LogoutConfirmDialog', () => {
  it('blocks confirming offline with the logout offline hint', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const wrapper = mountDialog()

    expect(wrapper.get('[role="status"]').text()).toBe(
      'Signing out requires an internet connection so your session actually ends.',
    )
    expect(wrapper.get('.confirm').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.cancel').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows an inline error alert when passed', () => {
    const wrapper = mountDialog({ error: 'The server cannot be reached.' })

    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')
    wrapper.unmount()
  })
})
