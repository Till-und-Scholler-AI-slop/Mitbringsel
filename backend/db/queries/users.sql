-- name: UpsertUserByGoogleSub :one
-- Creates the user on first sign-in, otherwise refreshes the profile data
-- Google sends. locale and theme are user settings and stay untouched.
-- display_name is only replaced if the login came with a name (name_given);
-- otherwise display_name is just the fallback for a new user.
INSERT INTO users (google_sub, email, display_name, avatar_url)
VALUES (
    sqlc.arg(google_sub),
    sqlc.arg(email),
    sqlc.arg(display_name),
    sqlc.arg(avatar_url)
)
ON CONFLICT (google_sub) DO UPDATE
SET email        = EXCLUDED.email,
    display_name = CASE
                       WHEN sqlc.arg(name_given)::boolean THEN EXCLUDED.display_name
                       ELSE users.display_name
                   END,
    avatar_url   = EXCLUDED.avatar_url
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1;
