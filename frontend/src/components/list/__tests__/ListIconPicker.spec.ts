import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { STICKERS } from '@/components/base/stickers'
import { createAppI18n } from '@/i18n'
import { LIST_ICON_GROUPS } from '@/services/listIcons'
import type { ListIcon } from '@/types/api'

import ListIconPicker from '../ListIconPicker.vue'

function mountPicker(modelValue: ListIcon = 'general') {
  const wrapper = mount(ListIconPicker, {
    props: {
      modelValue,
      'onUpdate:modelValue': (value: ListIcon) => wrapper.setProps({ modelValue: value }),
    },
    global: { plugins: [createAppI18n(['de'], null)] },
  })
  return wrapper
}

describe('LIST_ICON_GROUPS', () => {
  it('holds every icon exactly once', () => {
    // STICKERS is a Record<ListIcon, …>, so its keys are the full set.
    const grouped = LIST_ICON_GROUPS.flatMap((g) => g.icons)
    expect([...grouped].sort()).toEqual(Object.keys(STICKERS).sort())
  })
})

describe('ListIconPicker', () => {
  it('shows the three groups of the design with their icons', () => {
    const wrapper = mountPicker()

    expect(wrapper.get('legend').text()).toBe('Symbol')
    const groups = wrapper.findAll('[role="group"]')
    expect(groups.map((g) => g.get('.group-title').text())).toEqual([
      'Lebensmittel',
      'Haushalt, Pflege & Heimwerken',
      'Sonstiges',
    ])
    expect(groups[0]!.findAll('.tile-name').map((n) => n.text())).toEqual([
      'Supermarkt',
      'Wochenmarkt',
      'Bäckerei',
      'Metzgerei',
      'Getränke',
      'Bioladen',
    ])
    // Each group is named by its title for screen readers.
    const titleId = groups[0]!.get('.group-title').attributes('id')
    expect(groups[0]!.attributes('aria-labelledby')).toBe(titleId)
  })

  it('is one radio group: one name for all 18, the current icon checked', () => {
    const wrapper = mountPicker('bakery')

    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(18)
    expect(new Set(radios.map((r) => r.attributes('name'))).size).toBe(1)
    expect(radios.filter((r) => r.element.checked).map((r) => r.element.value)).toEqual(['bakery'])
    expect(wrapper.get('.tile--on .tile-name').text()).toBe('Bäckerei')
  })

  it('picks the icon of a chosen tile', async () => {
    const wrapper = mountPicker()

    await wrapper.get('input[value="pets"]').setValue(true)

    expect(wrapper.emitted('update:modelValue')).toEqual([['pets']])
    expect(wrapper.get('.tile--on .tile-name').text()).toBe('Tierbedarf')
  })

  it('names the tile through its label, the sticker stays decoration', () => {
    const wrapper = mountPicker()

    const tile = wrapper.get('label.tile')
    expect(tile.find('input').exists()).toBe(true)
    expect(tile.get('svg').attributes('aria-hidden')).toBe('true')
  })
})
