import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseTextarea from '../BaseTextarea.vue'

function mountTextarea(props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) {
  return mount(BaseTextarea, { props: { label: 'Note', modelValue: '', ...props }, attrs })
}

describe('BaseTextarea', () => {
  it('connects the label to the textarea', () => {
    const wrapper = mountTextarea({ aside: 'optional' })

    const textarea = wrapper.get('textarea')
    expect(wrapper.get('label').attributes('for')).toBe(textarea.attributes('id'))
    expect(wrapper.get('label').text()).toBe('Note')
    expect(wrapper.get('.aside').text()).toBe('optional')
  })

  it('updates v-model while typing', async () => {
    const wrapper = mountTextarea()

    await wrapper.get('textarea').setValue('die kleinen')

    expect(wrapper.emitted('update:modelValue')).toEqual([['die kleinen']])
  })

  it('puts other attributes on the textarea', () => {
    const wrapper = mountTextarea({}, { placeholder: 'e.g. small ones' })

    expect(wrapper.get('textarea').attributes('placeholder')).toBe('e.g. small ones')
    expect(wrapper.attributes('placeholder')).toBeUndefined()
  })

  it('marks itself invalid and tells the error', () => {
    const wrapper = mountTextarea({ error: 'Too long' })

    const textarea = wrapper.get('textarea')
    const message = wrapper.get('[role="alert"]')
    expect(textarea.attributes('aria-invalid')).toBe('true')
    expect(textarea.attributes('aria-describedby')).toBe(message.attributes('id'))
    expect(message.text()).toBe('Too long')
  })
})
