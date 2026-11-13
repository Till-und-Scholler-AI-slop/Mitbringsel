import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import QuantityStepper from '../QuantityStepper.vue'

function mountStepper(modelValue: string, locale: 'de' | 'en' = 'de', error: string | null = null) {
  return mount(QuantityStepper, {
    props: { label: 'Menge', modelValue, error },
    global: { plugins: [createAppI18n([locale], null)] },
  })
}

// The newest value the stepper emitted, if any.
const lastEmitted = (wrapper: ReturnType<typeof mountStepper>) =>
  wrapper.emitted<[string]>('update:modelValue')?.slice(-1)[0]

describe('QuantityStepper', () => {
  it('is a text field for decimals with a label', () => {
    const wrapper = mountStepper('')
    const input = wrapper.get('input')

    expect(input.attributes('type')).toBe('text')
    expect(input.attributes('inputmode')).toBe('decimal')
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
  })

  it.each([
    ['', 'plus', '1'],
    ['2', 'plus', '3'],
    ['2,5', 'plus', '3,5'],
    ['2', 'minus', '1'],
    ['1', 'minus', ''],
    ['', 'minus', ''],
    ['abc', 'plus', '1'],
  ] as const)('de: %j with %s gives %j', async (start, button, want) => {
    const wrapper = mountStepper(start)

    await wrapper.get(button === 'plus' ? '.step--up' : '.step--down').trigger('click')

    // An unchanged value is not emitted.
    expect(lastEmitted(wrapper) ?? [start]).toEqual([want])
  })

  it('writes the number in the language of the user', async () => {
    const wrapper = mountStepper('2.5', 'en')

    await wrapper.get('.step--up').trigger('click')

    expect(lastEmitted(wrapper)).toEqual(['3.5'])
  })

  it('names its buttons and tells the error', () => {
    const wrapper = mountStepper('x', 'de', 'Bitte gib eine Zahl ein.')

    expect(wrapper.get('.step--down').attributes('aria-label')).toBe('Menge verringern')
    expect(wrapper.get('.step--up').attributes('aria-label')).toBe('Menge erhöhen')
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[role="alert"]').text()).toBe('Bitte gib eine Zahl ein.')
  })
})
