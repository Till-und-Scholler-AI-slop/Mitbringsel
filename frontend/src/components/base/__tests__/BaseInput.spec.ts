import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseInput from '../BaseInput.vue'

function mountInput(props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) {
  return mount(BaseInput, { props: { label: 'Name', modelValue: '', ...props }, attrs })
}

describe('BaseInput', () => {
  it('connects the label to the input', () => {
    const wrapper = mountInput()

    const input = wrapper.get('input')
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(wrapper.get('label').text()).toBe('Name')
  })

  it('updates v-model while typing', async () => {
    const wrapper = mountInput()

    await wrapper.get('input').setValue('WG')

    expect(wrapper.emitted('update:modelValue')).toEqual([['WG']])
  })

  it('puts other attributes on the input, not on the wrapper', () => {
    const wrapper = mountInput({}, { placeholder: 'e.g. WG', autocomplete: 'off' })

    expect(wrapper.get('input').attributes('placeholder')).toBe('e.g. WG')
    expect(wrapper.get('input').attributes('autocomplete')).toBe('off')
    expect(wrapper.attributes('placeholder')).toBeUndefined()
  })

  it('shows a hint, linked to the input', () => {
    const wrapper = mountInput({ hint: 'Up to 30 characters' })

    const hint = wrapper.get('.message')
    expect(hint.text()).toBe('Up to 30 characters')
    expect(wrapper.get('input').attributes('aria-describedby')).toBe(hint.attributes('id'))
    expect(wrapper.get('input').attributes('aria-invalid')).toBeUndefined()
  })

  it('shows an error instead of the hint and marks the input invalid', () => {
    const wrapper = mountInput({ hint: 'Up to 30 characters', error: 'Too long' })

    const message = wrapper.get('.message')
    expect(message.text()).toBe('Too long')
    expect(message.attributes('role')).toBe('alert')
    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('input').attributes('aria-describedby')).toBe(message.attributes('id'))
  })

  it('has no description without hint and error', () => {
    const wrapper = mountInput()

    expect(wrapper.get('input').attributes('aria-describedby')).toBeUndefined()
  })

  it('counts the characters against the limit', () => {
    const wrapper = mountInput({ modelValue: 'WG', maxLength: 30 })

    const counter = wrapper.get('.counter')
    expect(counter.text()).toBe('2/30')
    expect(counter.classes()).not.toContain('counter--over')
  })

  it('highlights the counter past the limit but still takes the input', async () => {
    const wrapper = mountInput({ modelValue: 'x'.repeat(31), maxLength: 30 })

    expect(wrapper.get('.counter').classes()).toContain('counter--over')
    expect(wrapper.get('input').attributes('maxlength')).toBeUndefined()
  })

  it('counts an emoji as one character', () => {
    const wrapper = mountInput({ modelValue: '😀😀', maxLength: 30 })

    expect(wrapper.get('.counter').text()).toBe('2/30')
  })

  it('shows the suffix slot next to the input', () => {
    const wrapper = mount(BaseInput, {
      props: { label: 'Link', modelValue: '' },
      slots: { suffix: '<button type="button">Paste</button>' },
    })

    expect(wrapper.get('.control button').text()).toBe('Paste')
    expect(wrapper.find('.control input').exists()).toBe(true)
  })

  it('has no counter without a limit', () => {
    expect(mountInput().find('.counter').exists()).toBe(false)
  })

  it('shows a word next to the label', () => {
    const wrapper = mountInput({ aside: 'required' })

    expect(wrapper.get('.aside').text()).toBe('required')
  })
})
