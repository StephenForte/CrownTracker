-- Web login failure lockout (mirrors MCP OAuth auth-failure buckets).
-- bucket_key is login:<ip-hash>; rotating APP_PASSWORD does not clear rows.
CREATE TABLE IF NOT EXISTS auth_login_rate_limits (
  bucket_key text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_rate_limits_window_idx
  ON auth_login_rate_limits(window_started_at);

CREATE INDEX IF NOT EXISTS auth_login_rate_limits_blocked_idx
  ON auth_login_rate_limits(blocked_until)
  WHERE blocked_until IS NOT NULL;
