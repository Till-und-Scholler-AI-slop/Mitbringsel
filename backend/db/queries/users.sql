-- name: UpsertUserByGoogleSub :one
-- Creates the user on first sign-in, otherwise refreshes the profile data
-- Google sends. locale and theme are user settings and stay untouched.
INSERT INTO users (google_sub, email, display_name, avatar_url)
VALUES ($1, $2, $3, $4)
ON CONFLICT (google_sub) DO UPDATE
SET email        = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    avatar_url   = EXCLUDED.avatar_url
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1;
