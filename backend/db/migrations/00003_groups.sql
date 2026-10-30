-- +goose Up

-- A group is a household in the UI ("WG Kaiserstraße"). Invites follow in
-- their own migration together with the invite feature.
CREATE TABLE groups (
    id         uuid        PRIMARY KEY DEFAULT uuidv7(),
    -- The service trims and checks the length first; the CHECK is the
    -- safety net for anything that bypasses it.
    name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    -- NULL once the creator deleted their account: the group lives on
    -- with its other members (docs/data-model.md).
    created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
    group_id  uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- text + CHECK instead of ENUM, like users.locale.
    role      text        NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

-- "Which groups is this user in?" runs on almost every request. The primary
-- key starts with group_id, so it cannot answer that on its own.
CREATE INDEX group_members_user_id_idx ON group_members (user_id);

-- +goose Down

DROP TABLE group_members;
DROP TABLE groups;
