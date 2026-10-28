-- +goose Up
-- Baseline without schema changes: proves the migration pipeline works.
-- The real tables arrive together with the features that need them.
SELECT 1;

-- +goose Down
SELECT 1;
