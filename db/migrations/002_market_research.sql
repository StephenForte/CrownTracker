CREATE TABLE IF NOT EXISTS market_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES sellers(id),
  source_url text NOT NULL,
  title text NOT NULL,
  price_usd numeric(12,2),
  currency text,
  condition text,
  production_year integer,
  has_papers boolean,
  has_box boolean,
  warranty text,
  scope_match boolean NOT NULL DEFAULT false,
  scope_reason text,
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  missing_since_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, source_url)
);

CREATE TABLE IF NOT EXISTS listing_price_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  price_usd numeric(12,2) NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, run_id)
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  matched_listing_count integer NOT NULL DEFAULT 0,
  low_price_usd numeric(12,2),
  median_price_usd numeric(12,2),
  high_price_usd numeric(12,2),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, run_id)
);

CREATE INDEX IF NOT EXISTS market_listings_watch_active_idx ON market_listings(watch_id, is_active, scope_match);
CREATE INDEX IF NOT EXISTS listing_price_observations_listing_observed_idx ON listing_price_observations(listing_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS market_snapshots_watch_observed_idx ON market_snapshots(watch_id, observed_at DESC);
