-- Phase 3B notification configuration is intentionally single-user. Market
-- evidence and snapshot history remain append-only; these tables only hold
-- delivery preferences, current alert state, and an immutable delivery log.
CREATE TABLE IF NOT EXISTS watch_alerts (
  watch_id uuid PRIMARY KEY REFERENCES watches(id) ON DELETE CASCADE,
  grey_above numeric(12,2),
  grey_below numeric(12,2),
  resell_above numeric(12,2),
  resell_below numeric(12,2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (grey_above IS NULL OR grey_above > 0),
  CHECK (grey_below IS NULL OR grey_below > 0),
  CHECK (resell_above IS NULL OR resell_above > 0),
  CHECK (resell_below IS NULL OR resell_below > 0)
);

CREATE TABLE IF NOT EXISTS alert_states (
  key text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('normal', 'above', 'below', 'stale', 'outdated', 'warning', 'paused')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid REFERENCES watches(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('price_threshold', 'staleness', 'budget')),
  state text NOT NULL,
  subject text NOT NULL CHECK (length(subject) <= 300),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status text NOT NULL CHECK (delivery_status IN ('sent', 'failed')),
  provider_id text,
  error text CHECK (length(error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_events_created_idx ON alert_events(created_at DESC);
CREATE INDEX IF NOT EXISTS alert_events_watch_created_idx ON alert_events(watch_id, created_at DESC);
