-- +goose Up

-- One counter for every change to a list or an item. Clients ask "what
-- changed since server_seq N?" and the answer must be ordered across both
-- tables, hence one global sequence instead of one per table. The default
-- numbers new rows; the service draws a new value on every later change
-- (docs/sync.md).
CREATE SEQUENCE change_seq;

CREATE TABLE lists (
    id          uuid        PRIMARY KEY DEFAULT uuidv7(),
    group_id    uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    -- The service trims and checks the length first; the CHECK is the
    -- safety net for anything that bypasses it.
    name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
    -- NULL = active. An archived list stays in the database and in the
    -- sync, it is only hidden in the UI.
    archived_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    server_seq  bigint      NOT NULL DEFAULT nextval('change_seq')
);

-- Delta sync: all lists of a group changed after a given server_seq.
CREATE INDEX lists_group_id_server_seq_idx ON lists (group_id, server_seq);

CREATE TABLE items (
    -- No default: the client creates the id (UUIDv7) so it can show and
    -- edit the item offline before the server has seen it. A missing id
    -- must fail loudly instead of being papered over.
    id          uuid        PRIMARY KEY,
    list_id     uuid        NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    quantity    numeric     CHECK (quantity > 0),
    -- Fixed set, displayed via i18n. A new unit needs a new migration.
    unit        text        CHECK (unit IN ('piece', 'g', 'kg', 'ml', 'l', 'pack')),
    note        text        CHECK (char_length(note) <= 500),
    checked     boolean     NOT NULL DEFAULT false,
    -- NULL once the person deleted their account; the item stays.
    checked_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    checked_at  timestamptz,
    created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Tombstone: deleted items stay for 30 days so offline clients can
    -- still learn about the deletion (docs/sync.md).
    deleted_at  timestamptz,
    -- Last-write-wins per field (ADR 0004): field name -> HLC timestamp of
    -- its latest accepted change.
    field_clocks jsonb      NOT NULL DEFAULT '{}',
    server_seq  bigint      NOT NULL DEFAULT nextval('change_seq'),
    -- Who checked an item and when only makes sense while it is checked.
    CHECK (checked OR (checked_by IS NULL AND checked_at IS NULL))
);

-- Delta sync: all items of a list changed after a given server_seq. Also
-- serves "all items of this list", the list view.
CREATE INDEX items_list_id_server_seq_idx ON items (list_id, server_seq);

-- +goose Down

DROP TABLE items;
DROP TABLE lists;
DROP SEQUENCE change_seq;
