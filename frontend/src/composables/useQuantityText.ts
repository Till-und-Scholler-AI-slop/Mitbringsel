import { useI18n } from 'vue-i18n'

import type { Item } from '@/types/api'

// A quantity like 0.333 is shown as typed; more digits are noise.
const MAX_FRACTION_DIGITS = 3

/**
 * Turns the quantity and unit of an item into text for the current
 * language: "2,5 kg", "6 Stück", "1 Packung". Numbers follow the language
 * (decimal comma in German), unit names come from the translations and get
 * their plural from the quantity. A unit without a quantity says nothing,
 * so the function returns null then.
 */
export function useQuantityText() {
  const { t, n } = useI18n()

  return (item: Pick<Item, 'quantity' | 'unit'>): string | null => {
    if (item.quantity === null) return null
    const amount = n(item.quantity, { maximumFractionDigits: MAX_FRACTION_DIGITS })
    if (item.unit === null) return amount
    return `${amount} ${t(`units.${item.unit}`, item.quantity)}`
  }
}
