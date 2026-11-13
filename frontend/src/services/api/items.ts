import type {
  CreateItemRequest,
  DeletedItem,
  Item,
  ItemListResponse,
  RemoveCheckedItemsRequest,
  RemovedItems,
  UpdateItemRequest,
} from '@/types/api'

import { apiDelete, apiGet, apiPatchJson, apiPostJson } from './client'

/** What the items store needs from the backend; tests replace it with a fake. */
export interface ItemsService {
  /** The items of a list, oldest first. Deleted items are not sent. */
  list(listId: string): Promise<Item[]>
  /** Every member may do this, also in an archived list. */
  create(listId: string, item: CreateItemRequest): Promise<Item>
  /**
   * Every member may do this. Only the fields in `change` are changed;
   * `null` removes a quantity, unit or note. Answers the item as stored now.
   */
  update(itemId: string, change: UpdateItemRequest): Promise<Item>
  /** Every member may do this. Deleting twice is fine. */
  remove(itemId: string): Promise<void>
  /**
   * Every member may do this, also in an archived list. Deletes those of
   * `itemIds` (at most MAX_REMOVE_CHECKED) that belong to the list and are
   * still checked; answers what was deleted, in no particular order.
   */
  removeChecked(listId: string, itemIds: string[]): Promise<DeletedItem[]>
}

/** The most item IDs one removeChecked() call may send (api/openapi.yaml). */
export const MAX_REMOVE_CHECKED = 500

const listItemsPath = (listId: string) => `/lists/${listId}/items`
const itemPath = (itemId: string) => `/items/${itemId}`
const removeCheckedPath = (listId: string) => `/lists/${listId}/items/remove-checked`

export const itemsService: ItemsService = {
  list: async (listId) => (await apiGet<ItemListResponse>(listItemsPath(listId))).items,
  create: (listId, item) => apiPostJson<Item>(listItemsPath(listId), item),
  update: (itemId, change) => apiPatchJson<Item>(itemPath(itemId), change),
  remove: (itemId) => apiDelete(itemPath(itemId)),
  removeChecked: async (listId, itemIds) => {
    const body: RemoveCheckedItemsRequest = { itemIds }
    return (await apiPostJson<RemovedItems>(removeCheckedPath(listId), body)).items
  },
}
