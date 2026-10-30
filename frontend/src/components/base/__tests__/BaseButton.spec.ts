import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseButton from '../BaseButton.vue'

describe('BaseButton', () => {
  it('is a plain primary button by default, so it never submits a form by accident', () => {
    const wrapper = mount(BaseButton, { slots: { default: 'Save' } })

    const button = wrapper.get('button')
    expect(button.text()).toBe('Save')
    expect(button.attributes('type')).toBe('button')
    expect(button.classes()).toContain('base-button--primary')
  })

  it('emits clicks', async () => {
    const wrapper = mount(BaseButton)

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('cannot be clicked while loading and tells screen readers it is busy', async () => {
    const wrapper = mount(BaseButton, { props: { loading: true } })

    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    expect(wrapper.find('.spinner').exists()).toBe(true)
  })

  it('applies the variant', () => {
    const wrapper = mount(BaseButton, { props: { variant: 'ghost' } })

    expect(wrapper.get('button').classes()).toContain('base-button--ghost')
  })
})
