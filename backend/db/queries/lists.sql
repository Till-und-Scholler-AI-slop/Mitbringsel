-- name: CreateList :one
INSERT INTO lists (group_id, name)
VALUES ($1, $2)
RETURNING *;

-- name: GetList :one
SELECT * FROM lists
WHERE id = $1;

-- name: ListListsForGroup :many
-- Oldest first, so the order does not jump when a list is renamed.
-- Archived lists only come along if the caller asks for them.
SELECT * FROM lists
WHERE group_id = $1
  AND (archived_at IS NULL OR sqlc.arg(include_archived)::boolean)
ORDER BY created_at, id;

-- name: RenameList :one
-- Every change draws a new server_seq, so clients that ask "what changed
-- since N?" see it (docs/data-model.md).
UPDATE lists
SET name       = $2,
    updated_at = now(),
    server_seq = nextval('change_seq')
WHERE id = $1
RETURNING *;

-- name: SetListArchived :one
-- Archiving an archived list keeps the original archived_at.
UPDATE lists
SET archived_at = CASE WHEN sqlc.arg(archived)::boolean THEN COALESCE(archived_at, now()) END,
    updated_at  = now(),
    server_seq  = nextval('change_seq')
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: DeleteList :execrows
-- The items go with the list (ON DELETE CASCADE).
DELETE FROM lists
WHERE id = $1;
