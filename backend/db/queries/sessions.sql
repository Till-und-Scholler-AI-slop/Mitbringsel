-- name: CreateSession :exec
-- Timestamps in this file come in as parameters instead of now(): the auth
-- service owns the clock, so expiry and renewal follow one testable rule.
INSERT INTO sessions (id_hash, user_id, expires_at, last_seen_at)
VALUES ($1, $2, $3, $4);

-- name: GetSession :one
-- Returns expired sessions too; the service decides what counts as expired.
SELECT * FROM sessions
WHERE id_hash = $1;

-- name: TouchSession :exec
-- Sliding expiry: called when a session is used after the touch interval.
UPDATE sessions
SET last_seen_at = $2,
    expires_at   = $3
WHERE id_hash = $1;

-- name: DeleteSession :exec
-- Logout. Deleting an unknown hash affects no rows and is not an error.
DELETE FROM sessions
WHERE id_hash = $1;
