-- +goose Up

-- Who changed an item last and when (ADR 0008). Existing rows start with their
-- creator and creation time. The default on updated_at keeps the previous
-- backend version working if a rollout has to be rolled back: it inserts
-- without the new columns.
ALTER TABLE items
    ADD COLUMN updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE items
SET updated_by = created_by,
    updated_at = created_at;

-- +goose Down

ALTER TABLE items
    DROP COLUMN updated_at,
    DROP COLUMN updated_by;
