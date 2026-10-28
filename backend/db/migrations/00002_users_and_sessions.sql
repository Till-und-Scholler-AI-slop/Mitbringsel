-- +goose Up

-- uuidv7() is built into PostgreSQL 18. Its time-ordered values keep the
-- primary key index compact, unlike random UUIDv4.
CREATE TABLE users (
    id           uuid        PRIMARY KEY DEFAULT uuidv7(),
    -- Google's stable account ID; the email address can change, this cannot.
    google_sub   text        NOT NULL UNIQUE,
    email        text        NOT NULL,
    display_name text        NOT NULL,
    avatar_url   text,
    -- text + CHECK instead of ENUM: values can be removed or renamed later
    -- without rewriting a type.
    locale       text        NOT NULL DEFAULT 'de'
                             CHECK (locale IN ('de', 'en')),
    theme        text        NOT NULL DEFAULT 'system'
                             CHECK (theme IN ('light', 'dark', 'system')),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    -- SHA-256 of the random session ID from the cookie. Only the hash is
    -- stored, so a database leak does not expose valid session cookies.
    id_hash      bytea       PRIMARY KEY CHECK (octet_length(id_hash) = 32),
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Speeds up the cascade on account deletion and "log out everywhere".
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- +goose Down

DROP TABLE sessions;
DROP TABLE users;
