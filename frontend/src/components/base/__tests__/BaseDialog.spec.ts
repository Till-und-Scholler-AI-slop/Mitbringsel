import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import BaseDialog from '../BaseDialog.vue'

// jsdom does not implement the modal methods of <dialog>; this stand-in
// does what the browser does: set `open`, and fire "close" when closing.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mountDialog(open: boolean) {
  return mount(BaseDialog, {
    props: { open, title: 'Create household', 'onUpdate:open': vi.fn() },
    slots: { default: '<p class="content">Hello</p>' },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
}

describe('BaseDialog', () => {
  it('shows a subtitle below the title', () => {
    const wrapper = mount(BaseDialog, {
      props: { open: true, title: 'Mehmet', 'onUpdate:open': vi.fn() },
      slots: { subtitle: '<span class="chip">Admin</span>' },
      global: { plugins: [createAppI18n(['en'], null)] },
      attachTo: document.body,
    })

    expect(wrapper.get('.heading h2 + .chip').text()).toBe('Admin')
    wrapper.unmount()
  })

  it('is closed while open is false', () => {
    const wrapper = mountDialog(false)

    expect(wrapper.get('dialog').attributes('open')).toBeUndefined()
    wrapper.unmount()
  })

  it('opens as a modal when mounted open', () => {
    const wrapper = mountDialog(true)

    expect(wrapper.get('dialog').attributes('open')).toBeDefined()
    expect(wrapper.get('.content').text()).toBe('Hello')
    wrapper.unmount()
  })

  it('opens and closes with the open prop', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })
    expect(wrapper.get('dialog').attributes('open')).toBeDefined()

    await wrapper.setProps({ open: false })
    expect(wrapper.get('dialog').attributes('open')).toBeUndefined()
    wrapper.unmount()
  })

  it('is named by its title', () => {
    const wrapper = mountDialog(true)

    const title = wrapper.get('h2')
    expect(title.text()).toBe('Create household')
    expect(wrapper.get('dialog').attributes('aria-labelledby')).toBe(title.attributes('id'))
    wrapper.unmount()
  })

  it('reports false when the close button is used', async () => {
    const wrapper = mountDialog(true)

    await wrapper.get('button[aria-label="Close"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })

  it('reports false when the browser closes it (Escape)', async () => {
    const wrapper = mountDialog(true)

    await wrapper.get('dialog').trigger('close')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })

  it('closes on a click on the dimmed area but not on the panel', async () => {
    const wrapper = mountDialog(true)

    await wrapper.get('.panel').trigger('click')
    expect(wrapper.emitted('update:open')).toBeUndefined()

    await wrapper.get('dialog').trigger('click')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })
})
