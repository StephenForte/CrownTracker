-- Harden remote MCP OAuth: client revocation, last-used tracking, rate limits,
-- and cleanup-friendly indexes. Compatible with existing 009_mcp_oauth data.
-- The read-only runtime role is provisioned separately via
-- `npm run mcp:provision-readonly` (see README) because Render's default app
-- role may lack CREATEROLE.

ALTER TABLE mcp_oauth_clients ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE mcp_oauth_clients ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE TABLE IF NOT EXISTS mcp_oauth_rate_limits (
  bucket_key text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_client_active_idx
  ON mcp_oauth_tokens(client_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_cleanup_idx
  ON mcp_oauth_tokens(revoked_at, refresh_expires_at);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_cleanup_idx
  ON mcp_oauth_codes(consumed_at, expires_at);

CREATE INDEX IF NOT EXISTS mcp_oauth_clients_active_idx
  ON mcp_oauth_clients(created_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS mcp_oauth_clients_revoked_idx
  ON mcp_oauth_clients(revoked_at)
  WHERE revoked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcp_oauth_rate_limits_window_idx
  ON mcp_oauth_rate_limits(window_started_at);

CREATE INDEX IF NOT EXISTS mcp_oauth_rate_limits_blocked_idx
  ON mcp_oauth_rate_limits(blocked_until)
  WHERE blocked_until IS NOT NULL;
