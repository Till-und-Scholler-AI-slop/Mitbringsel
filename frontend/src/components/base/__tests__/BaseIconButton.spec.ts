import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseIconButton from '../BaseIconButton.vue'

describe('BaseIconButton', () => {
  it('is named for screen readers by its label', () => {
    const wrapper = mount(BaseIconButton, { props: { icon: 'close', label: 'Close' } })

    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Close')
    expect(button.attributes('type')).toBe('button')
  })

  it('emits clicks', async () => {
    const wrapper = mount(BaseIconButton, { props: { icon: 'plus', label: 'Add' } })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('cannot be clicked while disabled', () => {
    const wrapper = mount(BaseIconButton, { props: { icon: 'plus', label: 'Add', disabled: true } })

    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })
})
