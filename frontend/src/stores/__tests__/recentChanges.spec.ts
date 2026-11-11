import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'

import { createFakeServerEvents } from '@/services/sync/__tests__/fakeServerEvents'
import type { Item, ServerMessage } from '@/types/api'

import { defineRecentChangesStore, RECENT_CHANGE_MS } from '../recentChanges'

const ANNA = '0190a8c4-0000-7000-8000-00000000000a'
const BEN = '0190a8c4-0000-7000-8000-00000000000b'
const CHLOE = '0190a8c4-0000-7000-8000-00000000000c'

function item(id: string): Item {
  return {
    id,
    listId: 'l1',
    name: 'Milch',
    quantity: null,
    unit: null,
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: ANNA,
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

const changedBy = (actorId: string, itemId = 'i1'): ServerMessage => ({
  type: 'itemChanged',
  payload: { groupId: 'g1', actorId, item: item(itemId) },
})

/** Anna is signed in; the events and the user can be changed by the test. */
function setup() {
  const user = ref<string | null>(ANNA)
  const events = createFakeServerEvents()
  const store = defineRecentChangesStore(() => user.value, events)()
  return { store, events, user }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('recent changes store', () => {
  it('remembers who else just changed an item, for a few seconds', () => {
    const { store, events } = setup()

    events.emit(changedBy(BEN))

    expect(store.changedBy('i1')).toBe(BEN)
    vi.advanceTimersByTime(RECENT_CHANGE_MS - 1)
    expect(store.changedBy('i1')).toBe(BEN)
    vi.advanceTimersByTime(1)
    expect(store.changedBy('i1')).toBeUndefined()
  })

  it('does not highlight own changes and ends a highlight with one', () => {
    const { store, events } = setup()

    events.emit(changedBy(ANNA, 'i2'))
    events.emit(changedBy(BEN))
    events.emit(changedBy(ANNA))

    expect(store.changedBy('i2')).toBeUndefined()
    expect(store.changedBy('i1')).toBeUndefined()
  })

  it('starts the time anew with the latest member', () => {
    const { store, events } = setup()
    events.emit(changedBy(BEN))
    vi.advanceTimersByTime(RECENT_CHANGE_MS - 1000)

    events.emit(changedBy(CHLOE))
    vi.advanceTimersByTime(RECENT_CHANGE_MS - 1)

    expect(store.changedBy('i1')).toBe(CHLOE)
  })

  it('forgets deleted items', () => {
    const { store, events } = setup()
    events.emit(changedBy(BEN, 'i1'))
    events.emit(changedBy(BEN, 'i2'))
    events.emit(changedBy(BEN, 'i3'))

    events.emit({
      type: 'itemDeleted',
      payload: { groupId: 'g1', listId: 'l1', itemId: 'i1', actorId: BEN, serverSeq: 2 },
    } as ServerMessage)
    events.emit({
      type: 'itemsDeleted',
      payload: {
        groupId: 'g1',
        listId: 'l1',
        actorId: BEN,
        items: [{ itemId: 'i2', serverSeq: 3 }],
      },
    } as ServerMessage)

    expect(store.changedBy('i1')).toBeUndefined()
    expect(store.changedBy('i2')).toBeUndefined()
    expect(store.changedBy('i3')).toBe(BEN)
  })

  it('forgets everything when the user changes', async () => {
    const { store, events, user } = setup()
    events.emit(changedBy(BEN))

    user.value = BEN
    await nextTick()

    expect(store.changedBy('i1')).toBeUndefined()
  })

  it('removes its handlers and timers on dispose', () => {
    const { store, events } = setup()
    events.emit(changedBy(BEN))

    store.$dispose()

    expect(events.count('itemChanged')).toBe(0)
    expect(events.count('itemDeleted')).toBe(0)
    expect(events.count('itemsDeleted')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
