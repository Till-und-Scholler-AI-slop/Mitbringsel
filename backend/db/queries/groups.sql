-- name: CreateGroup :one
INSERT INTO groups (name, created_by)
VALUES ($1, $2)
RETURNING *;

-- name: AddGroupMember :exec
INSERT INTO group_members (group_id, user_id, role)
VALUES ($1, $2, $3);

-- name: GetGroup :one
SELECT * FROM groups
WHERE id = $1;

-- name: LockGroup :one
-- Locks the group row until the transaction ends. Membership changes take
-- this lock first, so two of them on the same group run one after the
-- other: an admin cannot remove a member on the strength of a role that
-- the owner takes away at the same moment.
SELECT id FROM groups
WHERE id = $1
FOR UPDATE;

-- name: CountOwnedGroups :one
-- How many groups the user has created and still owns.
SELECT count(*) FROM group_members
WHERE user_id = $1 AND role = 'owner';

-- name: GetGroupMemberRole :one
SELECT role FROM group_members
WHERE group_id = $1 AND user_id = $2;

-- name: ListGroupsForUser :many
-- The user's groups with their role in each, oldest first.
SELECT sqlc.embed(g), m.role
FROM groups g
JOIN group_members m ON m.group_id = g.id
WHERE m.user_id = $1
ORDER BY g.created_at, g.id;

-- name: ListGroupMembers :many
-- Members of several groups at once, so a list of groups needs one query
-- for all their members instead of one per group.
SELECT m.group_id, m.user_id, m.role, m.joined_at, u.display_name, u.avatar_url
FROM group_members m
JOIN users u ON u.id = m.user_id
WHERE m.group_id = ANY(sqlc.arg(group_ids)::uuid[])
ORDER BY m.group_id, m.joined_at, m.user_id;

-- name: RenameGroup :one
UPDATE groups
SET name       = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteGroup :execrows
-- Members go with the group (ON DELETE CASCADE).
DELETE FROM groups
WHERE id = $1;

-- name: RemoveGroupMember :execrows
DELETE FROM group_members
WHERE group_id = $1 AND user_id = $2;

-- name: SetGroupMemberRole :execrows
UPDATE group_members
SET role = $3
WHERE group_id = $1 AND user_id = $2;
