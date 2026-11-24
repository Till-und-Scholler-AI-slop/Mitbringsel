import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import ProfileMenu from '../ProfileMenu.vue'

afterEach(() => {
  vi.restoreAllMocks()
})

function mountMenu(row = false) {
  return mount(ProfileMenu, {
    props: { name: 'Lena Müller', avatarUrl: null, row },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
}

describe('ProfileMenu', () => {
  it('shows the name in the row variant and is named by it', () => {
    const wrapper = mountMenu(true)

    const toggle = wrapper.get('.toggle')
    expect(toggle.get('.row-name').text()).toBe('Lena Müller')
    expect(toggle.get('.row-you').text()).toBe("That's you")
    expect(toggle.attributes('aria-label')).toBeUndefined()
    wrapper.unmount()
  })

  it('is closed at first and named after the user', () => {
    const wrapper = mountMenu()

    const toggle = wrapper.get('.toggle')
    expect(toggle.attributes('aria-label')).toBe('Profile of Lena Müller')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens and closes with the button', async () => {
    const wrapper = mountMenu()

    await wrapper.get('.toggle').trigger('click')
    expect(wrapper.get('.toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.panel').text()).toContain('Lena Müller')

    await wrapper.get('.toggle').trigger('click')
    expect(wrapper.find('.panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes on Escape and gives the focus back to the button', async () => {
    const wrapper = mountMenu()
    await wrapper.get('.toggle').trigger('click')

    await wrapper.get('.panel button').trigger('keydown.esc')

    expect(wrapper.find('.panel').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.toggle').element)
    wrapper.unmount()
  })

  it('closes on a press outside but not inside', async () => {
    const wrapper = mountMenu()
    await wrapper.get('.toggle').trigger('click')

    await wrapper.get('.panel').trigger('pointerdown')
    expect(wrapper.find('.panel').exists()).toBe(true)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reports the logout and closes', async () => {
    const wrapper = mountMenu()
    await wrapper.get('.toggle').trigger('click')

    await wrapper.get('.panel button').trigger('click')

    expect(wrapper.emitted('logout')).toHaveLength(1)
    expect(wrapper.find('.panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    { name: 'header variant', row: false },
    { name: 'sidebar row variant', row: true },
  ])('disables logout with an offline hint in the $name and re-enables online', async ({ row }) => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const wrapper = mountMenu(row)
    await wrapper.get('.toggle').trigger('click')

    const button = wrapper.get('.panel button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.panel [role="status"]').text()).toBe(
      'Signing out requires an internet connection so your session actually ends.',
    )

    await button.trigger('click')
    expect(wrapper.emitted('logout')).toBeUndefined()
    expect(wrapper.find('.panel').exists()).toBe(true)

    spy.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.panel button').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.panel [role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
