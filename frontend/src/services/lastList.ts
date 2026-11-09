/**
 * Remembers per household which list was open last on this device, so
 * opening the household goes back to it.
 */
const LAST_LIST_STORAGE_KEY = 'mitbringsel.lastList'

type LastLists = Record<string, string>

// localStorage can throw (blocked site data, some private modes). Without it
// opening a household starts at its first list.
function read(): LastLists {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_LIST_STORAGE_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as LastLists) : {}
  } catch {
    return {}
  }
}

export function rememberLastList(groupId: string, listId: string) {
  const lastLists = read()
  if (lastLists[groupId] === listId) return
  lastLists[groupId] = listId
  try {
    localStorage.setItem(LAST_LIST_STORAGE_KEY, JSON.stringify(lastLists))
  } catch {
    // Not remembered; see read().
  }
}

/** The list to open in a household: the last one if it is still among `lists`, else the first. */
export function listToOpen<T extends { id: string }>(groupId: string, lists: T[]): T | undefined {
  const lastId = read()[groupId]
  return lists.find((list) => list.id === lastId) ?? lists[0]
}
