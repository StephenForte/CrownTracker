-- Existing watches retain their market history; only a display/research alias is backfilled.
-- The UUID suffix keeps the existing per-reference nickname uniqueness intact.
UPDATE watches
SET nickname = CONCAT('Reference ', reference_number, ' — ', LEFT(id::text, 8))
WHERE nickname IS NULL OR BTRIM(nickname) = '';

ALTER TABLE watches ALTER COLUMN nickname SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'watches_nickname_not_blank'
  ) THEN
    ALTER TABLE watches ADD CONSTRAINT watches_nickname_not_blank CHECK (CHAR_LENGTH(BTRIM(nickname)) BETWEEN 2 AND 80);
  END IF;
END $$;
