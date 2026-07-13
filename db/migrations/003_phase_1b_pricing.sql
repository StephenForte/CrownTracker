-- Phase 1B keeps the Phase 1A tables intact so existing local data remains usable.
-- The new tables are append-only audit records; current listings remain in
-- market_listings for fast marketplace and seller reads.

ALTER TABLE market_listings
  ADD COLUMN IF NOT EXISTS price_original numeric(12,2),
  ADD COLUMN IF NOT EXISTS fx_rate numeric(14,8),
  ADD COLUMN IF NOT EXISTS price_basis text NOT NULL DEFAULT 'asking' CHECK (price_basis IN ('asking', 'sold')),
  ADD COLUMN IF NOT EXISTS scope_match_class text NOT NULL DEFAULT 'out_of_scope' CHECK (scope_match_class IN ('in_scope', 'out_of_scope', 'uncertain')),
  ADD COLUMN IF NOT EXISTS scope_weight numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stable_sku text,
  ADD COLUMN IF NOT EXISTS detail_url text,
  ADD COLUMN IF NOT EXISTS grounding_snippet text CHECK (length(grounding_snippet) <= 2048),
  ADD COLUMN IF NOT EXISTS anomaly_flags text[] NOT NULL DEFAULT '{}';

UPDATE market_listings
SET price_original = COALESCE(price_original, price_usd),
    fx_rate = COALESCE(fx_rate, 1),
    scope_match_class = CASE WHEN scope_match THEN 'in_scope' ELSE 'out_of_scope' END,
    scope_weight = CASE WHEN scope_match THEN 1 ELSE 0 END
WHERE price_original IS NULL OR fx_rate IS NULL OR scope_weight = 0;

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  metric text NOT NULL CHECK (metric IN ('grey_avg', 'resell_avg', 'availability')),
  value numeric(12,2),
  value_low numeric(12,2),
  value_high numeric(12,2),
  label text,
  n integer NOT NULL DEFAULT 0,
  n_uncertain integer NOT NULL DEFAULT 0,
  outliers_dropped integer NOT NULL DEFAULT 0,
  conf_sample real NOT NULL DEFAULT 0,
  conf_diversity real NOT NULL DEFAULT 0,
  conf_agreement real NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'insufficient' CHECK (confidence IN ('high', 'medium', 'low', 'insufficient')),
  provenance text NOT NULL DEFAULT 'live' CHECK (provenance IN ('live', 'backfill', 'carried_forward')),
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  attached_to text NOT NULL CHECK (attached_to IN ('listing', 'snapshot')),
  attached_id uuid NOT NULL,
  url text NOT NULL,
  domain text NOT NULL,
  quote text NOT NULL CHECK (length(quote) <= 300),
  source_type text NOT NULL DEFAULT 'listing_page',
  retrieved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scope_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  old_scope jsonb NOT NULL,
  new_scope jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS metric_snapshots_watch_metric_time_idx ON metric_snapshots(watch_id, metric, computed_at DESC);
CREATE INDEX IF NOT EXISTS evidence_attached_idx ON evidence(attached_to, attached_id);
CREATE INDEX IF NOT EXISTS market_listings_watch_scope_class_idx ON market_listings(watch_id, is_active, scope_match_class);
