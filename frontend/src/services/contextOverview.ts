/**
 * Remembers per household which list is pinned beside the current one in the
 * context column, on this device only (not synced, ADR 0008). The stored
 * object is per household so more settings can join it (the overview tab,
 * #185).
 */
const OVERVIEW_STORAGE_KEY = 'mitbringsel.overview'

export interface OverviewPrefs {
  pinnedListId?: string
}

type StoredOverviews = Record<string, OverviewPrefs>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// localStorage can throw (blocked site data, some private modes). Without it
// the first other list is pinned.
function read(): StoredOverviews {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OVERVIEW_STORAGE_KEY) ?? '{}')
    return isRecord(parsed) ? (parsed as StoredOverviews) : {}
  } catch {
    return {}
  }
}

function write(overviews: StoredOverviews) {
  try {
    localStorage.setItem(OVERVIEW_STORAGE_KEY, JSON.stringify(overviews))
  } catch {
    // Not remembered; see read().
  }
}

/** The remembered settings of a household; only valid values are kept. */
export function readOverview(groupId: string): OverviewPrefs {
  const stored: unknown = read()[groupId]
  if (!isRecord(stored)) return {}
  return typeof stored.pinnedListId === 'string' ? { pinnedListId: stored.pinnedListId } : {}
}

/** Remembers the pinned list of a household; `null` forgets it. */
export function rememberPinnedList(groupId: string, listId: string | null) {
  const overviews = read()
  const prefs = readOverview(groupId)
  if ((prefs.pinnedListId ?? null) === listId) return
  if (listId === null) delete prefs.pinnedListId
  else prefs.pinnedListId = listId
  overviews[groupId] = prefs
  write(overviews)
}

/**
 * The list to pin: `pinnedId` (the remembered one) if it is among `lists` and not the
 * current list, else the first list that is not the current one.
 */
export function pinnedListFor<T extends { id: string }>(
  pinnedId: string | undefined,
  lists: T[],
  currentId: string | undefined,
): T | undefined {
  const others = lists.filter((list) => list.id !== currentId)
  return others.find((list) => list.id === pinnedId) ?? others[0]
}
