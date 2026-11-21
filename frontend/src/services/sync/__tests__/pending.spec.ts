import { describe, expect, it } from 'vitest'

import type { OutboxChange } from '../outbox'
import { applyPending, foldPending, type PendingItem, type QueuedChange } from '../pending'

import type { Item } from '@/types/api'

const ME = '11111111-1111-7111-8111-111111111111'
const OTHER = '22222222-2222-7222-8222-222222222222'
const LIST = '33333333-3333-7333-8333-333333333333'
const ID = '44444444-4444-7444-8444-444444444444'

// 2026-03-01T10:00:00Z and a minute later.
const t0 = Date.UTC(2026, 2, 1, 10)
const t1 = t0 + 60 * 1000

const CLOCK = '0000019a2b3c4d5e-0000-3f2a9c'

const create: OutboxChange = {
  kind: 'create',
  listId: LIST,
  item: { id: ID, name: 'Milk', quantity: 2, unit: 'l', clock: CLOCK },
}

function update(change: Extract<OutboxChange, { kind: 'update' }>['change']): OutboxChange {
  return { kind: 'update', itemId: ID, change }
}

function queued(change: OutboxChange, queuedAt = t0): QueuedChange {
  return { change, queuedAt }
}

function serverItem(overrides: Partial<Item> = {}): Item {
  const clock = '0000019a00000000-0000-aaaaaa'
  return {
    id: ID,
    listId: LIST,
    name: 'Oat milk',
    quantity: 1,
    unit: 'piece',
    note: 'organic',
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: OTHER,
    createdAt: '2026-02-01T08:00:00Z',
    serverSeq: 7,
    clocks: { name: clock, quantity: clock, unit: clock, note: clock, checked: clock },
    ...overrides,
  }
}

// The pending item of the changes, as a store would look it up.
function pendingOf(...changes: QueuedChange[]): PendingItem {
  const pending = foldPending(changes, ME).get(ID)
  if (!pending) throw new Error('no pending item')
  return pending
}

describe('create', () => {
  it('shows a synthesized item made by me, created when it was queued', () => {
    const item = applyPending(undefined, pendingOf(queued(create, t0)))
    expect(item).toEqual({
      id: ID,
      listId: LIST,
      name: 'Milk',
      quantity: 2,
      unit: 'l',
      note: null,
      checked: false,
      checkedBy: null,
      checkedAt: null,
      createdBy: ME,
      createdAt: '2026-03-01T10:00:00.000Z',
      serverSeq: 0,
      clocks: { name: CLOCK, quantity: CLOCK, unit: CLOCK, note: CLOCK, checked: CLOCK },
    })
  })

  it('does not count if the server knows the item', () => {
    const server = serverItem()
    expect(applyPending(server, pendingOf(queued(create)))).toEqual(server)
  })

  it('does not count if the item has a tombstone', () => {
    expect(applyPending(undefined, pendingOf(queued(create)), { tombstoned: true })).toBeNull()
  })

  it('has a user that is not signed in as creator null', () => {
    const pending = foldPending([queued(create)], null).get(ID)!
    expect(applyPending(undefined, pending)?.createdBy).toBeNull()
  })
})

describe('update', () => {
  it('overrides only the fields that were sent', () => {
    const server = serverItem()
    const item = applyPending(server, pendingOf(queued(update({ name: 'Bread', note: null }))))
    expect(item).toEqual({ ...server, name: 'Bread', note: null })
  })

  it('lets a later change win per field', () => {
    const item = applyPending(
      serverItem(),
      pendingOf(
        queued(update({ name: 'Bread', quantity: 3 }), t0),
        queued(update({ name: 'Rolls' }), t1),
      ),
    )
    expect(item).toMatchObject({ name: 'Rolls', quantity: 3 })
  })

  it('does not show the clock of the change', () => {
    const server = serverItem()
    const item = applyPending(server, pendingOf(queued(update({ name: 'Bread', clock: CLOCK }))))
    expect(item).toEqual({ ...server, name: 'Bread' })
  })

  it('sets who checked and when on a check', () => {
    const item = applyPending(serverItem(), pendingOf(queued(update({ checked: true }), t1)))
    expect(item).toMatchObject({
      checked: true,
      checkedBy: ME,
      checkedAt: '2026-03-01T10:01:00.000Z',
    })
  })

  it('clears who checked and when on an uncheck', () => {
    const server = serverItem({
      checked: true,
      checkedBy: OTHER,
      checkedAt: '2026-02-02T09:00:00Z',
    })
    const item = applyPending(server, pendingOf(queued(update({ checked: false }))))
    expect(item).toMatchObject({ checked: false, checkedBy: null, checkedAt: null })
  })

  it('keeps the check when another field changes later', () => {
    const item = applyPending(
      serverItem(),
      pendingOf(queued(update({ checked: true }), t0), queued(update({ name: 'Bread' }), t1)),
    )
    expect(item).toMatchObject({ name: 'Bread', checked: true, checkedBy: ME })
  })

  it('shows nothing without a base', () => {
    expect(applyPending(undefined, pendingOf(queued(update({ name: 'Bread' }))))).toBeNull()
  })

  it('lies on top of a created item', () => {
    const item = applyPending(
      undefined,
      pendingOf(queued(create, t0), queued(update({ name: 'Bread', checked: true }), t1)),
    )
    expect(item).toMatchObject({
      name: 'Bread',
      quantity: 2,
      checked: true,
      checkedBy: ME,
      createdAt: '2026-03-01T10:00:00.000Z',
    })
  })

  it('does not change the item of a tombstone', () => {
    const pending = pendingOf(queued(update({ name: 'Bread' })))
    expect(applyPending(undefined, pending, { tombstoned: true })).toBeNull()
  })
})

describe('remove', () => {
  it('hides the item of the server', () => {
    const pending = pendingOf(queued({ kind: 'remove', itemId: ID }))
    expect(applyPending(serverItem(), pending)).toBeNull()
  })

  it('hides a created item', () => {
    const pending = pendingOf(queued(create), queued({ kind: 'remove', itemId: ID }))
    expect(applyPending(undefined, pending)).toBeNull()
  })
})

describe('removeChecked', () => {
  it('has no effect yet', () => {
    const changes = [queued({ kind: 'removeChecked', listId: LIST, itemIds: [ID] })]
    expect(foldPending(changes, ME).size).toBe(0)
  })
})

describe('foldPending', () => {
  it('keeps the items apart', () => {
    const other = '55555555-5555-7555-8555-555555555555'
    const folded = foldPending(
      [queued(update({ name: 'Bread' })), queued({ kind: 'remove', itemId: other })],
      ME,
    )
    expect(folded.get(ID)).toEqual({ created: null, fields: { name: 'Bread' }, removed: false })
    expect(folded.get(other)).toEqual({ created: null, fields: {}, removed: true })
  })

  it('gives the same result for the same changes twice', () => {
    const changes = [
      queued(create, t0),
      queued(update({ name: 'Bread', checked: true }), t1),
      queued({ kind: 'remove', itemId: ID }, t1),
    ]
    expect(foldPending([...changes, ...changes], ME)).toEqual(foldPending(changes, ME))
  })

  it('takes a create once, the first one', () => {
    const again: OutboxChange = {
      ...create,
      item: { ...(create as Extract<OutboxChange, { kind: 'create' }>).item, name: 'Cheese' },
    }
    const pending = pendingOf(queued(create, t0), queued(again, t1))
    expect(pending.created).toMatchObject({ name: 'Milk', createdAt: '2026-03-01T10:00:00.000Z' })
  })
})

describe('applyPending', () => {
  it('does not change the item of the server', () => {
    const server = serverItem()
    const copy = structuredClone(server)
    const item = applyPending(server, pendingOf(queued(update({ name: 'Bread', checked: true }))))
    expect(item).not.toBe(server)
    expect(server).toEqual(copy)
  })

  it('returns a new object also without pending fields', () => {
    const server = serverItem()
    const item = applyPending(server, { created: null, fields: {}, removed: false })
    expect(item).toEqual(server)
    expect(item).not.toBe(server)
  })
})
