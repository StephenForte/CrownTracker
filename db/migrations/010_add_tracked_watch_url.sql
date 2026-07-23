-- This is a user-maintained link only; research pipelines do not fetch or infer from it.
ALTER TABLE watches ADD COLUMN IF NOT EXISTS tracked_watch_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'watches_tracked_watch_url_http'
  ) THEN
    ALTER TABLE watches ADD CONSTRAINT watches_tracked_watch_url_http
      CHECK (tracked_watch_url IS NULL OR tracked_watch_url ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$');
  END IF;
END $$;
