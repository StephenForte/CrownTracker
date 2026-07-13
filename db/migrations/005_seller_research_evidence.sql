-- Seller-research citations are not inherently tied to one tracked watch.
-- Existing watch-linked evidence remains unchanged.
ALTER TABLE evidence ALTER COLUMN watch_id DROP NOT NULL;
