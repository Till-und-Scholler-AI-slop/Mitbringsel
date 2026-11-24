import { computed, inject, provide, ref, watch, type InjectionKey } from 'vue'

import { CONTEXT_COLUMN_QUERY } from '@/components/list/contextColumn'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { pinnedListFor, readOverview, rememberPinnedList } from '@/services/contextOverview'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import type { List } from '@/types/api'

/**
 * The overview card of the context column: the second list pinned beside the
 * open one. Which list is pinned is remembered per household on this device
 * (services/contextOverview); the card is only there from CONTEXT_COLUMN_QUERY
 * on and while the household has a second active list. Below that width
 * nothing here reads items or writes the stored pin.
 *
 * ListView creates it with provideContextOverview; the sidebar pin (through
 * ListView) and the overview card take it with useContextOverview.
 *
 * `list` is the open list.
 */
function createContextOverview(groupId: () => string, list: () => List | undefined) {
  const lists = useListsStore()
  const items = useItemsStore()

  const columnMode = useMediaQuery(CONTEXT_COLUMN_QUERY)
  const prefs = ref(readOverview(groupId()))

  // The lists of the household that can be pinned: all but the open one.
  const others = computed(() => lists.activeLists(groupId()).filter((l) => l.id !== list()?.id))
  const pinnedList = computed(() =>
    pinnedListFor(prefs.value.pinnedListId, others.value, list()?.id),
  )
  // With one active list there is nothing to show beside it.
  const available = computed(() => columnMode.value && others.value.length > 0)
  // The pin in the sidebar shows what the card shows.
  const sidebarPinId = computed(() => (available.value ? pinnedList.value?.id : undefined))

  function setPinned(listId: string | null) {
    rememberPinnedList(groupId(), listId)
    prefs.value = readOverview(groupId())
  }

  function pin(listId: string) {
    if (others.value.some((l) => l.id === listId)) setPinned(listId)
  }

  // Another household has its own pin.
  watch(groupId, (id) => {
    prefs.value = readOverview(id)
  })

  // The open list becomes the pinned one (chip, sidebar, URL): the list that
  // was open takes its place, so going back and forth swaps the two.
  watch(
    () => list()?.id,
    (now, before) => {
      if (!columnMode.value || !now) return
      if (readOverview(groupId()).pinnedListId !== now) return
      const stillActive = before && lists.activeLists(groupId()).some((l) => l.id === before)
      setPinned(stillActive ? before : null)
    },
  )

  // An archived or deleted list is forgotten, but only once the lists are
  // known: while they load (offline start) the stored pin may still be valid.
  watch(
    [columnMode, () => lists.statusOf(groupId()), () => lists.activeLists(groupId())],
    ([wide, status, active]) => {
      const pinnedId = prefs.value.pinnedListId
      if (!wide || status !== 'ready' || !pinnedId) return
      if (!active.some((l) => l.id === pinnedId)) setPinned(null)
    },
    { immediate: true },
  )

  // Preloading normally has the items already; without it (offline start,
  // list added meanwhile) the pinned list loads like the open one does.
  watch(
    [columnMode, () => pinnedList.value?.id],
    ([wide, id]) => {
      if (wide && id && items.statusOf(id) === 'idle') void items.load(id)
    },
    { immediate: true },
  )

  return { columnMode, others, pinnedList, available, sidebarPinId, pin }
}

export type ContextOverview = ReturnType<typeof createContextOverview>

// An InjectionKey is a unique Symbol that carries the type, so inject()
// returns a ContextOverview and not `unknown`.
const CONTEXT_OVERVIEW: InjectionKey<ContextOverview> = Symbol('contextOverview')

/** Creates the overview state and hands it to all components below the caller. */
export function provideContextOverview(
  groupId: () => string,
  list: () => List | undefined,
): ContextOverview {
  const overview = createContextOverview(groupId, list)
  provide(CONTEXT_OVERVIEW, overview)
  return overview
}

/** The overview state of the surrounding list view. */
export function useContextOverview(): ContextOverview {
  const overview = inject(CONTEXT_OVERVIEW)
  if (!overview) throw new Error('useContextOverview() needs provideContextOverview() in a parent')
  return overview
}
