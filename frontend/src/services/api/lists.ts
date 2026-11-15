import type {
  List,
  ListIcon,
  ListListResponse,
  ListRequest,
  SetListArchivedRequest,
} from '@/types/api'

import { apiDelete, apiGet, apiPatchJson, apiPostJson, apiPutJson } from './client'

/** What the lists store needs from the backend; tests replace it with a fake. */
export interface ListsService {
  /** The lists of a group, oldest first. Archived ones only if asked for. */
  list(groupId: string, options: { includeArchived: boolean }): Promise<List[]>
  /** Every member may do this. */
  create(groupId: string, name: string, icon: ListIcon): Promise<List>
  /** Name and icon at once. Every member may do this. Answers the updated list. */
  update(listId: string, name: string, icon: ListIcon): Promise<List>
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
  create: (groupId, name, icon) =>
    apiPostJson<List>(groupListsPath(groupId), { name, icon } satisfies ListRequest),
  update: (listId, name, icon) =>
    apiPatchJson<List>(listPath(listId), { name, icon } satisfies ListRequest),
  setArchived: (listId, archived) =>
    apiPutJson<List>(`${listPath(listId)}/archived`, { archived } satisfies SetListArchivedRequest),
  remove: (listId) => apiDelete(listPath(listId)),
}
