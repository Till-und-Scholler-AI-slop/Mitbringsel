-- +goose Up

-- Group names get shorter: they have to fit a phone screen. No group can
-- exceed the new limit yet, because the API for groups does not exist.
ALTER TABLE groups DROP CONSTRAINT groups_name_check;
ALTER TABLE groups ADD CONSTRAINT groups_name_check
    CHECK (char_length(name) BETWEEN 1 AND 30);

-- A group has one owner and any number of admins. Admins invite people,
-- rename the group and remove plain members; only the owner deletes the
-- group and hands out the admin role.
ALTER TABLE group_members DROP CONSTRAINT group_members_role_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_role_check
    CHECK (role IN ('owner', 'admin', 'member'));

-- Partial index: it only covers rows with role = 'owner', so a second owner
-- in the same group is impossible, whatever the application does.
CREATE UNIQUE INDEX group_members_one_owner_idx ON group_members (group_id)
    WHERE role = 'owner';

CREATE TABLE group_invites (
    id         uuid        PRIMARY KEY DEFAULT uuidv7(),
    group_id   uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    -- SHA-256 of the random token in the invite link. Only the hash is
    -- stored, so a database leak does not expose working links.
    token_hash bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    -- NULL once the inviting person deleted their account; the invite
    -- stays valid until it expires.
    created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

-- Lists the invites of one group (the UNIQUE constraint above already
-- indexes token_hash for redeeming a link).
CREATE INDEX group_invites_group_id_idx ON group_invites (group_id);

-- +goose Down

DROP TABLE group_invites;
DROP INDEX group_members_one_owner_idx;

-- Admins would violate the old constraint.
UPDATE group_members SET role = 'member' WHERE role = 'admin';
ALTER TABLE group_members DROP CONSTRAINT group_members_role_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_role_check
    CHECK (role IN ('owner', 'member'));

ALTER TABLE groups DROP CONSTRAINT groups_name_check;
ALTER TABLE groups ADD CONSTRAINT groups_name_check
    CHECK (char_length(name) BETWEEN 1 AND 100);
