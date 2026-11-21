-- name: CreateGroupInvite :one
-- A CTE so the insert and the creator's name come back in one round trip.
WITH i AS (
    INSERT INTO group_invites (group_id, token_hash, created_by, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING *
)
SELECT i.id, i.group_id, i.created_at, i.expires_at, i.created_by,
       u.display_name AS created_by_name
FROM i
LEFT JOIN users u ON u.id = i.created_by;

-- name: ListActiveGroupInvites :many
-- Active means not revoked and not expired. now comes in as a parameter, so
-- the service owns the clock. created_by and created_by_name are NULL if
-- the creator deleted their account.
SELECT i.id, i.group_id, i.created_at, i.expires_at, i.created_by,
       u.display_name AS created_by_name
FROM group_invites i
LEFT JOIN users u ON u.id = i.created_by
WHERE i.group_id = $1
  AND i.revoked_at IS NULL
  AND i.expires_at > sqlc.arg(now)
ORDER BY i.created_at DESC, i.id;

-- name: CountActiveGroupInvites :one
SELECT count(*) FROM group_invites
WHERE group_id = $1
  AND revoked_at IS NULL
  AND expires_at > sqlc.arg(now);

-- name: RevokeGroupInvite :execrows
-- Scoped to the group, so an admin cannot revoke the invites of another
-- group by guessing an ID. Revoking twice affects no row the second time.
UPDATE group_invites
SET revoked_at = sqlc.arg(now)
WHERE id = $1
  AND group_id = $2
  AND revoked_at IS NULL;

-- name: DeleteStaleGroupInvites :execrows
-- The cleanup job. Deletes invites that expired or were revoked before the
-- cutoff. Until then an old link still says "expired" instead of "not
-- found". Active invites are never older than the cutoff by either date.
DELETE FROM group_invites
WHERE expires_at < sqlc.arg(cutoff)
   OR revoked_at < sqlc.arg(cutoff);

-- name: GetGroupInviteByTokenHash :one
-- Returns revoked and expired invites too; the service decides what to
-- tell the caller.
SELECT sqlc.embed(g), i.expires_at, i.revoked_at,
       u.display_name AS invited_by, u.avatar_url AS invited_by_avatar_url
FROM group_invites i
JOIN groups g ON g.id = i.group_id
LEFT JOIN users u ON u.id = i.created_by
WHERE i.token_hash = $1;

-- name: AddGroupMemberIfAbsent :execrows
-- Two people opening the same link at once, or one person twice, must not
-- fail on the primary key: being a member already is the goal. The row count
-- tells the caller whether someone was added (1) or already was a member (0).
INSERT INTO group_members (group_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (group_id, user_id) DO NOTHING;

-- name: CountGroupMembers :one
SELECT count(*) FROM group_members
WHERE group_id = $1;

-- name: ListGroupMembersPreview :many
-- The first few members, oldest membership first, for the invite preview
-- that anyone holding the token can open.
SELECT u.display_name, u.avatar_url
FROM group_members m
JOIN users u ON u.id = m.user_id
WHERE m.group_id = $1
ORDER BY m.joined_at, m.user_id
LIMIT sqlc.arg(max_rows);
