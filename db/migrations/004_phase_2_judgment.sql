-- Phase 2 research is append-only. Current seller fields remain a convenient
-- cache; their supporting research and all community/news observations live
-- in immutable records below.

ALTER TABLE metric_snapshots DROP CONSTRAINT IF EXISTS metric_snapshots_metric_check;
ALTER TABLE metric_snapshots
  ADD CONSTRAINT metric_snapshots_metric_check
  CHECK (metric IN ('grey_avg', 'resell_avg', 'availability', 'waitlist', 'sentiment'));

ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_attached_to_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_attached_to_check
  CHECK (attached_to IN ('listing', 'snapshot', 'anecdote', 'news', 'seller_research'));

CREATE TABLE IF NOT EXISTS community_anecdotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  source_url text NOT NULL,
  domain text NOT NULL,
  quote text NOT NULL CHECK (length(quote) <= 300),
  reported_at timestamptz,
  wait_months numeric(7,2),
  region text,
  purchase_context text,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  source_url text NOT NULL,
  domain text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL CHECK (length(summary) <= 500),
  quote text NOT NULL CHECK (length(quote) <= 300),
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  rationale text NOT NULL CHECK (length(rationale) <= 500),
  source_count integer NOT NULL DEFAULT 0,
  researched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_anecdotes_watch_reported_idx ON community_anecdotes(watch_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS news_items_watch_retrieved_idx ON news_items(watch_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS seller_research_seller_researched_idx ON seller_research(seller_id, researched_at DESC);
