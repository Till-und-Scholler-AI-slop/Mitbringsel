-- name: CreateItem :one
-- The id comes from the client. A second insert of the same id (a request
-- sent again after a lost answer) inserts nothing and returns no row, which
-- the caller tells apart from success.
INSERT INTO items (id, list_id, name, quantity, unit, note, created_by, field_clocks)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- name: GetItem :one
SELECT * FROM items
WHERE id = $1;

-- name: GetItemForUpdate :one
-- Locks the row until the transaction ends. Changes to one item take this
-- lock first, so two of them cannot read the same clocks and overwrite each
-- other: the second waits and then sees the first one's result.
SELECT * FROM items
WHERE id = $1
FOR UPDATE;

-- name: ListItemsForList :many
-- Oldest first; deleted items (tombstones) stay out of the normal view.
SELECT * FROM items
WHERE list_id = $1
  AND deleted_at IS NULL
ORDER BY created_at, id;

-- name: ApplyItemUpdate :one
-- Writes only the fields that won the merge: a set_* flag says whether the
-- field is part of the update, so "leave as is" and "set to NULL" differ.
-- The new clocks are merged into field_clocks (|| keeps the other keys).
UPDATE items
SET name         = CASE WHEN sqlc.arg(set_name)::boolean THEN sqlc.arg(name)::text ELSE name END,
    quantity     = CASE WHEN sqlc.arg(set_quantity)::boolean THEN sqlc.narg(quantity)::numeric ELSE quantity END,
    unit         = CASE WHEN sqlc.arg(set_unit)::boolean THEN sqlc.narg(unit)::text ELSE unit END,
    note         = CASE WHEN sqlc.arg(set_note)::boolean THEN sqlc.narg(note)::text ELSE note END,
    checked      = CASE WHEN sqlc.arg(set_checked)::boolean THEN sqlc.arg(checked)::boolean ELSE checked END,
    checked_by   = CASE WHEN sqlc.arg(set_checked)::boolean THEN sqlc.narg(checked_by)::uuid ELSE checked_by END,
    checked_at   = CASE WHEN sqlc.arg(set_checked)::boolean THEN sqlc.narg(checked_at)::timestamptz ELSE checked_at END,
    field_clocks = field_clocks || sqlc.arg(clocks)::jsonb,
    server_seq   = nextval('change_seq')
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: MarkItemDeleted :one
-- Tombstone instead of DELETE, so offline devices learn about the deletion.
-- Deleting a deleted item changes nothing, not even server_seq.
UPDATE items
SET deleted_at = COALESCE(deleted_at, now()),
    server_seq = CASE WHEN deleted_at IS NULL THEN nextval('change_seq') ELSE server_seq END
WHERE id = $1
RETURNING *;
