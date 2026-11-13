import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Unit } from '@/types/api'

import UnitPicker from '../UnitPicker.vue'

function mountPicker(modelValue: Unit | null, locale: 'de' | 'en' = 'de') {
  return mount(UnitPicker, {
    props: { label: 'Einheit', modelValue },
    global: { plugins: [createAppI18n([locale], null)] },
  })
}

const labels = (w: ReturnType<typeof mountPicker>) => w.findAll('button').map((b) => b.text())

describe('UnitPicker', () => {
  it('shows the six units in the language of the user', () => {
    expect(labels(mountPicker(null))).toEqual(['Stück', 'g', 'kg', 'ml', 'l', 'Packung'])
    expect(labels(mountPicker(null, 'en'))).toEqual(['piece', 'g', 'kg', 'ml', 'l', 'pack'])
  })

  it('groups them under a legend and presses the picked one', () => {
    const wrapper = mountPicker('kg')

    expect(wrapper.get('legend').text()).toBe('Einheit')
    expect(wrapper.findAll('button').map((b) => b.attributes('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
      'false',
      'false',
      'false',
    ])
  })

  it('picks a unit', async () => {
    const wrapper = mountPicker('piece')

    await wrapper.findAll('button')[4]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['l']])
  })

  it('picks no unit when the picked one is pressed again', async () => {
    const wrapper = mountPicker('piece')

    await wrapper.findAll('button')[0]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })
})
