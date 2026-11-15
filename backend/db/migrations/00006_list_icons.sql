-- +goose Up

-- The sticker shown next to the list's name (design: icons3-sticker). A
-- fixed set like items.unit, drawn by the frontend; a new icon needs a new
-- migration. Existing lists get the neutral clipboard.
ALTER TABLE lists
    ADD COLUMN icon text NOT NULL DEFAULT 'general'
    CHECK (icon IN (
        'supermarket', 'market', 'bakery', 'butcher', 'drinks', 'organic',
        'drugstore', 'pharmacy', 'baby', 'pets', 'hardware', 'garden',
        'furniture', 'electronics', 'stationery', 'clothing', 'online', 'general'
    ));

-- +goose Down

ALTER TABLE lists DROP COLUMN icon;
