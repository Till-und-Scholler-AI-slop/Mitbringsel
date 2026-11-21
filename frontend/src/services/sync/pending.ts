import type { OutboxChange } from '@/services/sync/outbox'
import type { Item } from '@/types/api'

/**
 * The changes in the outbox that the server has not answered yet, laid over
 * the state of the server. The stores keep only what the server confirmed
 * (docs/sync.md); what the user sees is that state plus these changes. Both
 * functions are pure: no store, no storage, no clock, so the rules for what
 * a pending change shows can be tested alone.
 */

/** An outbox change with the time it was made (an OutboxEntry fits). */
export interface QueuedChange {
  change: OutboxChange
  // Date.now() when the change was made.
  queuedAt: number
}

/** The fields of an item that a change can set. */
export type PendingFields = Partial<
  Pick<Item, 'name' | 'quantity' | 'unit' | 'note' | 'checked' | 'checkedBy' | 'checkedAt'>
>

/** What the pending changes of one item amount to. */
export interface PendingItem {
  // The item as a pending create shows it, until the server knows it.
  created: Item | null
  // The fields that pending updates set, the latest change per field.
  fields: PendingFields
  // A pending remove hides the item.
  removed: boolean
}

export interface ApplyOptions {
  // The item has a tombstone: the server deleted it. Only the store knows
  // that, the server state it passes in has no item then.
  tombstoned?: boolean
}

function emptyPending(): PendingItem {
  return { created: null, fields: {}, removed: false }
}

// The item that a create shows. The server has not answered, so there is
// nothing to take from it: unset fields are null, the item is not checked,
// it has no server sequence yet (0, like an item that no event has told
// about), and every field carries the clock of the create.
function synthesize(
  listId: string,
  request: Extract<OutboxChange, { kind: 'create' }>['item'],
  userId: string | null,
  queuedAt: number,
): Item {
  // A create from the store always carries a clock. Without one the server
  // stamps the change, and an empty clock is older than any real one.
  const clock = request.clock ?? ''
  return {
    id: request.id,
    listId,
    name: request.name,
    quantity: request.quantity ?? null,
    unit: request.unit ?? null,
    note: request.note ?? null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: userId,
    createdAt: new Date(queuedAt).toISOString(),
    serverSeq: 0,
    clocks: { name: clock, quantity: clock, unit: clock, note: clock, checked: clock },
  }
}

// The fields an update sets. Only the keys that the request has: null is a
// value (clears the quantity), a missing key leaves the field alone. Who
// checked and when is not part of the request; the server sets it from the
// session and its time, so the client shows the same until the answer comes.
function fieldsOf(
  change: Extract<OutboxChange, { kind: 'update' }>['change'],
  userId: string | null,
  queuedAt: number,
): PendingFields {
  const fields: PendingFields = {}
  if (change.name !== undefined) fields.name = change.name
  if (change.quantity !== undefined) fields.quantity = change.quantity
  if (change.unit !== undefined) fields.unit = change.unit
  if (change.note !== undefined) fields.note = change.note
  if (change.checked !== undefined) {
    fields.checked = change.checked
    fields.checkedBy = change.checked ? userId : null
    fields.checkedAt = change.checked ? new Date(queuedAt).toISOString() : null
  }
  // change.clock is not a field to show: it only orders the change.
  return fields
}

/**
 * Folds the changes per item, oldest first, so a later change wins per
 * field. `userId` is the signed-in user, who made the changes: the creator
 * of a created item and the one who checked.
 *
 * Folding the same change again gives the same result (a create is taken
 * once per ID, an update sets the same fields again), because the outbox
 * sends a change again when its answer got lost, and an entry may be in the
 * list while the answer of the server is already stored.
 */
export function foldPending(
  changes: readonly QueuedChange[],
  userId: string | null,
): Map<string, PendingItem> {
  const pending = new Map<string, PendingItem>()
  const of = (itemId: string): PendingItem => {
    let entry = pending.get(itemId)
    if (!entry) {
      entry = emptyPending()
      pending.set(itemId, entry)
    }
    return entry
  }

  for (const { change, queuedAt } of changes) {
    switch (change.kind) {
      case 'create': {
        const entry = of(change.item.id)
        entry.created ??= synthesize(change.listId, change.item, userId, queuedAt)
        break
      }
      case 'update': {
        const entry = of(change.itemId)
        Object.assign(entry.fields, fieldsOf(change.change, userId, queuedAt))
        break
      }
      case 'remove':
        of(change.itemId).removed = true
        break
      case 'removeChecked':
        // #133: the items to remove are in change.itemIds. Until then the
        // store hides them itself while the undo toast runs.
        break
    }
  }
  return pending
}

/**
 * What an item shows: the state of the server with the pending changes on
 * top, or null if it shows nothing (removed, or nothing it could be based
 * on). Returns a new object and never changes `server`.
 *
 * A pending create is the base only while the server does not know the item
 * yet. The server state wins if it has the item (the answer or an event came
 * before the entry left the outbox) or if the item has a tombstone
 * (`options.tombstoned`): then it was deleted, and a create that is sent
 * again must not bring it back. An update on its own needs a base, else
 * there is nothing to show it on.
 */
export function applyPending(
  server: Item | undefined,
  pending: PendingItem,
  options: ApplyOptions = {},
): Item | null {
  if (pending.removed) return null

  let base = server
  if (!base && !options.tombstoned) base = pending.created ?? undefined
  if (!base) return null

  return { ...base, ...pending.fields }
}
