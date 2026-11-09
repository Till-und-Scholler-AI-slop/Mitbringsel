import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { Unit } from '@/types/api'

import { useQuantityText } from '../useQuantityText'

// The composable needs a component to find the i18n instance.
function quantityText(locale: 'de' | 'en', quantity: number | null, unit: Unit | null) {
  let result: string | null = null
  const Probe = defineComponent({
    setup() {
      result = useQuantityText()({ quantity, unit })
      return () => null
    },
  })
  mount(Probe, { global: { plugins: [createAppI18n([locale], null)] } })
  return result
}

describe('useQuantityText', () => {
  it.each([
    ['de', 2, 'l', '2 l'],
    ['de', 2.5, 'kg', '2,5 kg'],
    ['de', 6, 'piece', '6 Stück'],
    ['de', 1, 'pack', '1 Packung'],
    ['de', 3, 'pack', '3 Packungen'],
    ['de', 500, 'g', '500 g'],
    ['de', 0.333333, 'l', '0,333 l'],
    ['de', 4, null, '4'],
    ['en', 2.5, 'kg', '2.5 kg'],
    ['en', 1, 'piece', '1 piece'],
    ['en', 6, 'piece', '6 pieces'],
    ['en', 1, 'pack', '1 pack'],
    ['en', 3, 'pack', '3 packs'],
  ] as const)('%s: %s %s is shown as "%s"', (locale, quantity, unit, want) => {
    expect(quantityText(locale, quantity, unit)).toBe(want)
  })

  it('says nothing without a quantity, also when a unit is set', () => {
    expect(quantityText('de', null, null)).toBeNull()
    expect(quantityText('de', null, 'kg')).toBeNull()
  })
})
