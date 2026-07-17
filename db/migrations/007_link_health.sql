-- Link checks are append-only: a past outage remains auditable even if the
-- source later recovers. Checks are keyed to a representative evidence row,
-- while presentation reads the latest result for the same URL.
CREATE TABLE IF NOT EXISTS link_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  url text NOT NULL,
  status text NOT NULL CHECK (status IN ('reachable', 'offline', 'unreachable', 'blocked_by_robots', 'invalid')),
  http_status integer,
  error text CHECK (length(error) <= 500),
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS link_checks_url_checked_idx ON link_checks(url, checked_at DESC);
CREATE INDEX IF NOT EXISTS link_checks_evidence_checked_idx ON link_checks(evidence_id, checked_at DESC);
