import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import BaseToast from '../BaseToast.vue'

function mountToast(props: Partial<InstanceType<typeof BaseToast>['$props']> = {}) {
  return mount(BaseToast, {
    props: { kind: 'success', text: '3 Artikel entfernt', icon: 'trash', ...props },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
}

describe('BaseToast', () => {
  it('shows the text and the detail', () => {
    const wrapper = mountToast({ detail: 'The items are back on the list.' })

    expect(wrapper.get('.text').text()).toBe('3 Artikel entfernt')
    expect(wrapper.get('.detail').text()).toBe('The items are back on the list.')
    expect(mountToast().find('.detail').exists()).toBe(false)
  })

  it('is an alert only as an error', () => {
    expect(mountToast({ kind: 'error' }).get('.toast').attributes('role')).toBe('alert')
    expect(mountToast().get('.toast').attributes('role')).toBeUndefined()
  })

  it('emits action and close from its buttons', async () => {
    const wrapper = mountToast({ actionLabel: 'Undo' })

    await wrapper.get('.action').trigger('click')
    await wrapper.get('button[aria-label="Close message"]').trigger('click')

    expect(wrapper.get('.action').text()).toBe('Undo')
    expect(wrapper.emitted('action')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(mountToast().find('.action').exists()).toBe(false)
  })

  it('draws the bar only when timed, from where the clock is', () => {
    const wrapper = mountToast({ timed: true, durationMs: 5000, elapsedMs: 2000 })

    const style = wrapper.get('.bar-fill').attributes('style')
    expect(style).toContain('animation-duration: 5000ms')
    expect(style).toContain('animation-delay: -2000ms')
    expect(mountToast({ kind: 'error' }).find('.bar').exists()).toBe(false)
  })

  it('stops the bar while paused', () => {
    expect(mountToast({ timed: true, paused: true }).find('.toast--paused').exists()).toBe(true)
    expect(mountToast({ timed: true }).find('.toast--paused').exists()).toBe(false)
  })

  it('moves the focus to the action only when asked', () => {
    mountToast({ actionLabel: 'Undo', focusAction: true })
    expect(document.activeElement?.textContent?.trim()).toBe('Undo')

    ;(document.activeElement as HTMLElement).blur()
    mountToast({ actionLabel: 'Undo' })
    expect(document.activeElement).toBe(document.body)
  })
})
