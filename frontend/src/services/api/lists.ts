import type { List, ListListResponse, ListNameRequest, SetListArchivedRequest } from '@/types/api'

import { apiDelete, apiGet, apiPatchJson, apiPostJson, apiPutJson } from './client'

/** What the lists store needs from the backend; tests replace it with a fake. */
export interface ListsService {
  /** The lists of a group, oldest first. Archived ones only if asked for. */
  list(groupId: string, options: { includeArchived: boolean }): Promise<List[]>
  /** Every member may do this. */
  create(groupId: string, name: string): Promise<List>
  /** Every member may do this. Answers the updated list. */
  rename(listId: string, name: string): Promise<List>
  /** Every member may do this. Answers the updated list. */
  setArchived(listId: string, archived: boolean): Promise<List>
  /** Owner and admins only. The items of the list go with it. */
  remove(listId: string): Promise<void>
}

const groupListsPath = (groupId: string) => `/groups/${groupId}/lists`
const listPath = (listId: string) => `/lists/${listId}`

export const listsService: ListsService = {
  list: async (groupId, { includeArchived }) => {
    const query = includeArchived ? '?includeArchived=true' : ''
    return (await apiGet<ListListResponse>(`${groupListsPath(groupId)}${query}`)).lists
  },
  create: (groupId, name) =>
    apiPostJson<List>(groupListsPath(groupId), { name } satisfies ListNameRequest),
  rename: (listId, name) =>
    apiPatchJson<List>(listPath(listId), { name } satisfies ListNameRequest),
  setArchived: (listId, archived) =>
    apiPutJson<List>(`${listPath(listId)}/archived`, { archived } satisfies SetListArchivedRequest),
  remove: (listId) => apiDelete(listPath(listId)),
}
