import type { ListIcon } from '@/types/api'

/** What a new list gets unless someone picks another icon; the backend's default too. */
export const DEFAULT_LIST_ICON: ListIcon = 'general'

export type ListIconGroup = 'food' | 'household' | 'other'

/**
 * The icons in the groups and order of the design ("icons3-sticker"). Every
 * icon of the API contract appears exactly once; a test checks that.
 */
export const LIST_ICON_GROUPS: { key: ListIconGroup; icons: ListIcon[] }[] = [
  { key: 'food', icons: ['supermarket', 'market', 'bakery', 'butcher', 'drinks', 'organic'] },
  { key: 'household', icons: ['drugstore', 'pharmacy', 'baby', 'pets', 'hardware', 'garden'] },
  {
    key: 'other',
    icons: ['furniture', 'electronics', 'stationery', 'clothing', 'online', 'general'],
  },
]
