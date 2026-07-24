import { createHash, randomBytes } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { db } from "@/lib/db";
import {
  MCP_ACCESS_TOKEN_LIFETIME_SECONDS,
  MCP_AUTH_COOLDOWN_SECONDS,
  MCP_AUTH_FAILURE_LIMIT,
  MCP_AUTH_FAILURE_WINDOW_SECONDS,
  MCP_CODE_LIFETIME_SECONDS,
  MCP_IDLE_CLIENT_RETENTION_DAYS,
  MCP_MAX_ACTIVE_CLIENTS,
  MCP_MAX_CLIENT_NAME_LENGTH,
  MCP_MAX_REDIRECT_URIS,
  MCP_RATE_LIMIT_RETENTION_DAYS,
  MCP_REFRESH_TOKEN_LIFETIME_SECONDS,
  MCP_REGISTRATION_RATE_LIMIT,
  MCP_REGISTRATION_WINDOW_SECONDS,
  MCP_REVOKED_RETENTION_DAYS,
  passwordsMatch,
  redirectOriginLabel,
} from "@/lib/mcp-remote";

export const MCP_READ_SCOPE = "crowntracker.read";

/** Advisory-lock namespace for MCP OAuth critical sections. */
const MCP_OAUTH_LOCK_NAMESPACE = 872351;
const MCP_ACTIVE_CLIENTS_LOCK_ID = 1;

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
};

let adminPoolOverride: Pool | null = null;

/** Test-only override so disposable Postgres suites do not share the process pool. */
export function setMcpOAuthDbForTests(pool: Pool | null) {
  adminPoolOverride = pool;
}

function adminPool(): Pool {
  return adminPoolOverride ?? db;
}

type OAuthClient = {
  client_id: string;
  redirect_uris: unknown;
  client_name: string | null;
  revoked_at: Date | null;
};

type AuthorizationCode = {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string[];
  resource: string;
  expires_at: Date;
  consumed_at: Date | null;
};

type StoredToken = {
  client_id: string;
  scope: string[];
  resource: string;
  expires_at: Date;
  refresh_expires_at: Date | null;
  revoked_at: Date | null;
};

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string[];
  resource: string;
  clientName: string | null;
  redirectOrigin: string;
};

export type OAuthError = { error: string; description: string };

export type McpConnectorClient = {
  clientId: string;
  clientName: string | null;
  redirectOrigin: string;
  redirectUris: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  status: "active" | "revoked";
  activeTokenCount: number;
};

export type OAuthCleanupResult = {
  codesDeleted: number;
  tokensDeleted: number;
  clientsDeleted: number;
  rateLimitsDeleted: number;
};

export function mcpPublicBaseUrl() {
  const configured = process.env.MCP_PUBLIC_BASE_URL;
  if (!configured) throw new Error("MCP_PUBLIC_BASE_URL is required to enable the remote MCP connector.");
  const url = new URL(configured);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("MCP_PUBLIC_BASE_URL must use HTTPS in production.");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

export function mcpEndpointUrl() {
  return new URL("/mcp", mcpPublicBaseUrl()).toString();
}

export function authorizationServerUrl() {
  return mcpPublicBaseUrl().toString();
}

export function protectedResourceMetadataUrl() {
  return new URL("/.well-known/oauth-protected-resource/mcp", mcpPublicBaseUrl()).toString();
}

export function oauthAuthorizationMetadata() {
  const base = authorizationServerUrl().replace(/\/$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [MCP_READ_SCOPE],
  };
}

export function protectedResourceMetadata() {
  return {
    resource: mcpEndpointUrl(),
    authorization_servers: [authorizationServerUrl()],
    scopes_supported: [MCP_READ_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "CrownTracker metrics",
  };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

export function validRedirectUri(value: string) {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

function asRedirectUris(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function scopes(value: string | null) {
  const requested = (value ?? "").split(/\s+/).filter(Boolean);
  if (!requested.length) return [MCP_READ_SCOPE];
  if (requested.some((scope) => scope !== MCP_READ_SCOPE)) return null;
  return [MCP_READ_SCOPE];
}

function authorizationError(error: string, description: string): OAuthError {
  return { error, description };
}

function clientIpBucket(request: Request | null) {
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || request?.headers.get("x-real-ip")?.trim() || "unknown";
  return hash(raw).slice(0, 24);
}

function authFailureLockId(bucketKey: string) {
  return createHash("sha256").update(bucketKey).digest().readInt32BE(0);
}

async function advisoryXactLock(connection: PoolClient, lockId: number) {
  await connection.query("SELECT pg_advisory_xact_lock($1, $2)", [MCP_OAUTH_LOCK_NAMESPACE, lockId]);
}

function authorizationFailureRowBlocked(row: {
  blocked_until: Date | null;
  attempt_count: number;
  window_started_at: Date;
} | undefined) {
  if (!row) return false;
  if (row.blocked_until && row.blocked_until > new Date()) return true;
  if (
    row.window_started_at > new Date(Date.now() - MCP_AUTH_FAILURE_WINDOW_SECONDS * 1000)
    && row.attempt_count >= MCP_AUTH_FAILURE_LIMIT
  ) {
    return true;
  }
  return false;
}

async function consumeRateLimit(
  reader: Queryable,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  cooldownSeconds: number | null,
) {
  const result = await reader.query<{ allowed: boolean }>(
    `INSERT INTO mcp_oauth_rate_limits (bucket_key, attempt_count, window_started_at, blocked_until, updated_at)
     VALUES (
       $1,
       1,
       now(),
       CASE WHEN $4::integer IS NOT NULL AND 1 >= $2 THEN now() + ($4 || ' seconds')::interval ELSE NULL END,
       now()
     )
     ON CONFLICT (bucket_key) DO UPDATE SET
       attempt_count = CASE
         WHEN mcp_oauth_rate_limits.blocked_until IS NOT NULL AND mcp_oauth_rate_limits.blocked_until > now()
           THEN mcp_oauth_rate_limits.attempt_count
         WHEN mcp_oauth_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval
           THEN 1
         ELSE mcp_oauth_rate_limits.attempt_count + 1
       END,
       window_started_at = CASE
         WHEN mcp_oauth_rate_limits.blocked_until IS NOT NULL AND mcp_oauth_rate_limits.blocked_until > now()
           THEN mcp_oauth_rate_limits.window_started_at
         WHEN mcp_oauth_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval
           THEN now()
         ELSE mcp_oauth_rate_limits.window_started_at
       END,
       blocked_until = CASE
         WHEN mcp_oauth_rate_limits.blocked_until IS NOT NULL AND mcp_oauth_rate_limits.blocked_until > now()
           THEN mcp_oauth_rate_limits.blocked_until
         WHEN $4::integer IS NOT NULL AND (
           CASE
             WHEN mcp_oauth_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval THEN 1
             ELSE mcp_oauth_rate_limits.attempt_count + 1
           END
         ) >= $2
           THEN now() + ($4 || ' seconds')::interval
         WHEN mcp_oauth_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval
           THEN NULL
         ELSE mcp_oauth_rate_limits.blocked_until
       END,
       updated_at = now()
     RETURNING
       (blocked_until IS NULL OR blocked_until <= now())
         AND attempt_count <= $2 AS allowed`,
    [bucketKey, limit, windowSeconds, cooldownSeconds],
  );
  return Boolean(result.rows[0]?.allowed);
}

async function clearRateLimit(reader: Queryable, bucketKey: string) {
  await reader.query("DELETE FROM mcp_oauth_rate_limits WHERE bucket_key = $1", [bucketKey]);
}

export async function registerPublicClient(
  input: { redirectUris: unknown; clientName: unknown },
  options: { request?: Request | null } = {},
) {
  const redirectUris = asRedirectUris(input.redirectUris);
  const unique = [...new Set(redirectUris)];
  if (!unique.length || unique.length > MCP_MAX_REDIRECT_URIS || unique.length !== redirectUris.length || !unique.every(validRedirectUri)) {
    return { error: authorizationError("invalid_client_metadata", "Client registration was rejected.") };
  }
  const clientName = typeof input.clientName === "string"
    ? input.clientName.trim().slice(0, MCP_MAX_CLIENT_NAME_LENGTH) || null
    : null;
  if (typeof input.clientName === "string" && input.clientName.trim().length > MCP_MAX_CLIENT_NAME_LENGTH) {
    return { error: authorizationError("invalid_client_metadata", "Client registration was rejected.") };
  }

  // Persist the rate-limit attempt even when registration is rejected so
  // anonymous traffic cannot retry without counting.
  const registrationBucket = `register:${clientIpBucket(options.request ?? null)}`;
  const allowed = await consumeRateLimit(
    adminPool(),
    registrationBucket,
    MCP_REGISTRATION_RATE_LIMIT,
    MCP_REGISTRATION_WINDOW_SECONDS,
    null,
  );
  if (!allowed) {
    return { error: authorizationError("temporarily_unavailable", "Client registration is temporarily unavailable.") };
  }

  const connection = await adminPool().connect();
  try {
    await connection.query("BEGIN");
    // Serialize count+insert so concurrent registrations cannot exceed the active-client cap.
    await advisoryXactLock(connection, MCP_ACTIVE_CLIENTS_LOCK_ID);
    const active = await connection.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM mcp_oauth_clients WHERE revoked_at IS NULL",
    );
    if (Number(active.rows[0]?.count ?? 0) >= MCP_MAX_ACTIVE_CLIENTS) {
      await connection.query("ROLLBACK");
      return { error: authorizationError("temporarily_unavailable", "Client registration is temporarily unavailable.") };
    }

    const clientId = `ct_${randomSecret()}`;
    await connection.query(
      "INSERT INTO mcp_oauth_clients (client_id, redirect_uris, client_name) VALUES ($1,$2::jsonb,$3)",
      [clientId, JSON.stringify(unique), clientName],
    );
    await connection.query("COMMIT");
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      redirect_uris: unique,
      client_name: clientName,
    };
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not register the CrownTracker OAuth client.");
  } finally {
    connection.release();
  }
}

async function client(clientId: string): Promise<OAuthClient | null> {
  const result = await adminPool().query<OAuthClient>(
    "SELECT client_id, redirect_uris, client_name, revoked_at FROM mcp_oauth_clients WHERE client_id = $1",
    [clientId],
  );
  return result.rows[0] ?? null;
}

export async function validateAuthorizationRequest(search: URLSearchParams): Promise<AuthorizationRequest | OAuthError> {
  if (search.get("response_type") !== "code") return authorizationError("unsupported_response_type", "Only authorization_code is supported.");
  const clientId = search.get("client_id");
  const redirectUri = search.get("redirect_uri");
  const codeChallenge = search.get("code_challenge");
  if (!clientId || !redirectUri || !codeChallenge || search.get("code_challenge_method") !== "S256") {
    return authorizationError("invalid_request", "client_id, redirect_uri, and an S256 PKCE code_challenge are required.");
  }
  const registeredClient = await client(clientId);
  if (!registeredClient || registeredClient.revoked_at || !asRedirectUris(registeredClient.redirect_uris).includes(redirectUri)) {
    return authorizationError("invalid_request", "The authorization request is invalid.");
  }
  const grantedScopes = scopes(search.get("scope"));
  if (!grantedScopes) return authorizationError("invalid_scope", `Only ${MCP_READ_SCOPE} is available.`);
  const resource = search.get("resource") ?? mcpEndpointUrl();
  if (resource !== mcpEndpointUrl()) return authorizationError("invalid_target", "The OAuth resource must be this CrownTracker MCP endpoint.");
  return {
    clientId,
    redirectUri,
    state: search.get("state"),
    codeChallenge,
    scope: grantedScopes,
    resource,
    clientName: registeredClient.client_name,
    redirectOrigin: redirectOriginLabel(redirectUri),
  };
}

export async function recordAuthorizationFailure(request: Request | null) {
  const bucket = `authorize:${clientIpBucket(request)}`;
  try {
    return await consumeRateLimit(
      adminPool(),
      bucket,
      MCP_AUTH_FAILURE_LIMIT,
      MCP_AUTH_FAILURE_WINDOW_SECONDS,
      MCP_AUTH_COOLDOWN_SECONDS,
    );
  } catch {
    return false;
  }
}

export async function authorizationFailureBlocked(request: Request | null) {
  const bucket = `authorize:${clientIpBucket(request)}`;
  const result = await adminPool().query<{ blocked_until: Date | null; attempt_count: number; window_started_at: Date }>(
    "SELECT blocked_until, attempt_count, window_started_at FROM mcp_oauth_rate_limits WHERE bucket_key = $1",
    [bucket],
  );
  return authorizationFailureRowBlocked(result.rows[0]);
}

/**
 * Atomically gate a password attempt against the auth-failure cap.
 * Check, password compare, and failure recording share one advisory transaction
 * so concurrent requests cannot exceed MCP_AUTH_FAILURE_LIMIT verifications.
 */
export async function completeAuthorizationPasswordAttempt(
  request: Request | null,
  provided: string,
  expected: string,
): Promise<"blocked" | "mismatch" | "ok"> {
  const bucket = `authorize:${clientIpBucket(request)}`;
  const connection = await adminPool().connect();
  try {
    await connection.query("BEGIN");
    await advisoryXactLock(connection, authFailureLockId(bucket));
    const current = await connection.query<{ blocked_until: Date | null; attempt_count: number; window_started_at: Date }>(
      "SELECT blocked_until, attempt_count, window_started_at FROM mcp_oauth_rate_limits WHERE bucket_key = $1",
      [bucket],
    );
    if (authorizationFailureRowBlocked(current.rows[0])) {
      await connection.query("COMMIT");
      return "blocked";
    }
    if (!expected || !passwordsMatch(provided, expected)) {
      await consumeRateLimit(
        connection,
        bucket,
        MCP_AUTH_FAILURE_LIMIT,
        MCP_AUTH_FAILURE_WINDOW_SECONDS,
        MCP_AUTH_COOLDOWN_SECONDS,
      );
      await connection.query("COMMIT");
      return "mismatch";
    }
    await clearRateLimit(connection, bucket);
    await connection.query("COMMIT");
    return "ok";
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not complete CrownTracker authorization.");
  } finally {
    connection.release();
  }
}

export async function clearAuthorizationFailures(request: Request | null) {
  await clearRateLimit(adminPool(), `authorize:${clientIpBucket(request)}`);
}

export async function createAuthorizationCode(request: AuthorizationRequest) {
  const code = randomSecret();
  await adminPool().query(
    `INSERT INTO mcp_oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,now() + ($7 || ' seconds')::interval)`,
    [hash(code), request.clientId, request.redirectUri, request.codeChallenge, request.scope, request.resource, MCP_CODE_LIFETIME_SECONDS],
  );
  return code;
}

function validCodeVerifier(value: string) {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function tokenResponse(accessToken: string, refreshToken: string, scopesForToken: string[]) {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: MCP_ACCESS_TOKEN_LIFETIME_SECONDS,
    refresh_token: refreshToken,
    scope: scopesForToken.join(" "),
  };
}

async function markClientUsed(connection: Pool | PoolClient, clientId: string) {
  await connection.query("UPDATE mcp_oauth_clients SET last_used_at = now() WHERE client_id = $1", [clientId]);
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
}) {
  if (!validCodeVerifier(input.codeVerifier)) return { error: authorizationError("invalid_grant", "The authorization grant is invalid.") };
  const connection = await adminPool().connect();
  try {
    await connection.query("BEGIN");
    const result = await connection.query<AuthorizationCode>(
      "SELECT id, client_id, redirect_uri, code_challenge, scope, resource, expires_at, consumed_at FROM mcp_oauth_codes WHERE code_hash = $1 FOR UPDATE",
      [hash(input.code)],
    );
    const code = result.rows[0];
    if (
      !code
      || code.consumed_at
      || code.expires_at <= new Date()
      || code.client_id !== input.clientId
      || code.redirect_uri !== input.redirectUri
      || code.code_challenge !== pkceChallenge(input.codeVerifier)
      || (input.resource && input.resource !== code.resource)
    ) {
      await connection.query("ROLLBACK");
      return { error: authorizationError("invalid_grant", "The authorization grant is invalid.") };
    }
    const registered = await connection.query<OAuthClient>(
      "SELECT client_id, redirect_uris, client_name, revoked_at FROM mcp_oauth_clients WHERE client_id = $1 FOR UPDATE",
      [code.client_id],
    );
    if (!registered.rows[0] || registered.rows[0].revoked_at) {
      await connection.query("ROLLBACK");
      return { error: authorizationError("invalid_grant", "The authorization grant is invalid.") };
    }
    await connection.query("UPDATE mcp_oauth_codes SET consumed_at = now() WHERE id = $1", [code.id]);
    const accessToken = randomSecret();
    const refreshToken = randomSecret();
    await connection.query(
      `INSERT INTO mcp_oauth_tokens (access_token_hash, refresh_token_hash, client_id, scope, resource, expires_at, refresh_expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6 || ' seconds')::interval,now() + ($7 || ' seconds')::interval)`,
      [hash(accessToken), hash(refreshToken), code.client_id, code.scope, code.resource, MCP_ACCESS_TOKEN_LIFETIME_SECONDS, MCP_REFRESH_TOKEN_LIFETIME_SECONDS],
    );
    await markClientUsed(connection, code.client_id);
    await connection.query("COMMIT");
    return tokenResponse(accessToken, refreshToken, code.scope);
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not exchange the CrownTracker authorization code.");
  } finally {
    connection.release();
  }
}

export async function refreshAccessToken(input: { refreshToken: string; clientId: string; resource: string | null }) {
  const connection = await adminPool().connect();
  try {
    await connection.query("BEGIN");
    const result = await connection.query<StoredToken & { id: string }>(
      "SELECT id, client_id, scope, resource, expires_at, refresh_expires_at, revoked_at FROM mcp_oauth_tokens WHERE refresh_token_hash = $1 FOR UPDATE",
      [hash(input.refreshToken)],
    );
    const token = result.rows[0];
    if (
      !token
      || token.revoked_at
      || !token.refresh_expires_at
      || token.refresh_expires_at <= new Date()
      || token.client_id !== input.clientId
      || (input.resource && input.resource !== token.resource)
    ) {
      await connection.query("ROLLBACK");
      return { error: authorizationError("invalid_grant", "The refresh token is invalid or expired.") };
    }
    const registered = await connection.query<OAuthClient>(
      "SELECT client_id, redirect_uris, client_name, revoked_at FROM mcp_oauth_clients WHERE client_id = $1 FOR UPDATE",
      [token.client_id],
    );
    if (!registered.rows[0] || registered.rows[0].revoked_at) {
      await connection.query("ROLLBACK");
      return { error: authorizationError("invalid_grant", "The refresh token is invalid or expired.") };
    }
    await connection.query("UPDATE mcp_oauth_tokens SET revoked_at = now() WHERE id = $1", [token.id]);
    const accessToken = randomSecret();
    const refreshToken = randomSecret();
    await connection.query(
      `INSERT INTO mcp_oauth_tokens (access_token_hash, refresh_token_hash, client_id, scope, resource, expires_at, refresh_expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6 || ' seconds')::interval,now() + ($7 || ' seconds')::interval)`,
      [hash(accessToken), hash(refreshToken), token.client_id, token.scope, token.resource, MCP_ACCESS_TOKEN_LIFETIME_SECONDS, MCP_REFRESH_TOKEN_LIFETIME_SECONDS],
    );
    await markClientUsed(connection, token.client_id);
    await connection.query("COMMIT");
    return tokenResponse(accessToken, refreshToken, token.scope);
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not refresh the CrownTracker access token.");
  } finally {
    connection.release();
  }
}

export async function verifyMcpBearer(authorization: string | null, reader: Queryable = adminPool()): Promise<AuthInfo | null> {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  if (!token) return null;
  // Token revocation is applied transactionally with client revoke, so the
  // read-only MCP role only needs SELECT on mcp_oauth_tokens.
  const result = await reader.query<StoredToken>(
    "SELECT client_id, scope, resource, expires_at, refresh_expires_at, revoked_at FROM mcp_oauth_tokens WHERE access_token_hash = $1",
    [hash(token)],
  );
  const stored = result.rows[0];
  if (
    !stored
    || stored.revoked_at
    || stored.expires_at <= new Date()
    || stored.resource !== mcpEndpointUrl()
    || !stored.scope.includes(MCP_READ_SCOPE)
  ) {
    return null;
  }
  return {
    token,
    clientId: stored.client_id,
    scopes: stored.scope,
    expiresAt: Math.floor(stored.expires_at.getTime() / 1000),
    resource: new URL(stored.resource),
  };
}

export async function listMcpConnectorClients(): Promise<McpConnectorClient[]> {
  const result = await adminPool().query<{
    client_id: string;
    client_name: string | null;
    redirect_uris: unknown;
    created_at: Date;
    last_used_at: Date | null;
    revoked_at: Date | null;
    active_token_count: string;
  }>(
    `SELECT c.client_id, c.client_name, c.redirect_uris, c.created_at, c.last_used_at, c.revoked_at,
            count(t.id) FILTER (
              WHERE t.revoked_at IS NULL
                AND t.refresh_expires_at > now()
            )::text AS active_token_count
     FROM mcp_oauth_clients c
     LEFT JOIN mcp_oauth_tokens t ON t.client_id = c.client_id
     WHERE c.revoked_at IS NULL
        OR c.revoked_at > now() - ($1 || ' days')::interval
     GROUP BY c.client_id
     ORDER BY c.revoked_at NULLS FIRST, COALESCE(c.last_used_at, c.created_at) DESC`,
    [MCP_REVOKED_RETENTION_DAYS],
  );
  return result.rows.map((row) => {
    const redirectUris = asRedirectUris(row.redirect_uris);
    return {
      clientId: row.client_id,
      clientName: row.client_name,
      redirectOrigin: redirectUris[0] ? redirectOriginLabel(redirectUris[0]) : "unknown",
      redirectUris,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      status: row.revoked_at ? "revoked" : "active",
      activeTokenCount: Number(row.active_token_count),
    };
  });
}

export async function revokeMcpClient(clientId: string) {
  const connection = await adminPool().connect();
  try {
    await connection.query("BEGIN");
    const clientResult = await connection.query("UPDATE mcp_oauth_clients SET revoked_at = now() WHERE client_id = $1 AND revoked_at IS NULL RETURNING client_id", [clientId]);
    if (!clientResult.rowCount) {
      await connection.query("ROLLBACK");
      return false;
    }
    await connection.query("UPDATE mcp_oauth_tokens SET revoked_at = now() WHERE client_id = $1 AND revoked_at IS NULL", [clientId]);
    await connection.query("COMMIT");
    return true;
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not revoke the CrownTracker connector.");
  } finally {
    connection.release();
  }
}

export async function revokeAllMcpClients() {
  const connection = await adminPool().connect();
  try {
    await connection.query("BEGIN");
    const clients = await connection.query("UPDATE mcp_oauth_clients SET revoked_at = now() WHERE revoked_at IS NULL RETURNING client_id");
    await connection.query("UPDATE mcp_oauth_tokens SET revoked_at = now() WHERE revoked_at IS NULL");
    await connection.query("COMMIT");
    return clients.rowCount ?? 0;
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not revoke CrownTracker connectors.");
  } finally {
    connection.release();
  }
}

export async function cleanupMcpOAuthState(reader: Queryable = adminPool()): Promise<OAuthCleanupResult> {
  const codes = await reader.query(
    `DELETE FROM mcp_oauth_codes
     WHERE (consumed_at IS NOT NULL AND consumed_at < now() - ($1 || ' days')::interval)
        OR (consumed_at IS NULL AND expires_at < now() - ($1 || ' days')::interval)`,
    [MCP_REVOKED_RETENTION_DAYS],
  );
  const tokens = await reader.query(
    `DELETE FROM mcp_oauth_tokens
     WHERE (revoked_at IS NOT NULL AND revoked_at < now() - ($1 || ' days')::interval)
        OR (revoked_at IS NULL AND refresh_expires_at < now() - ($1 || ' days')::interval)`,
    [MCP_REVOKED_RETENTION_DAYS],
  );
  // Revoked clients use the same retention window as codes/tokens/UI visibility.
  const clients = await reader.query(
    `DELETE FROM mcp_oauth_clients c
     WHERE c.revoked_at IS NOT NULL
       AND c.revoked_at < now() - ($1 || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM mcp_oauth_tokens t
         WHERE t.client_id = c.client_id
           AND t.revoked_at IS NULL
           AND t.refresh_expires_at > now()
       )
       AND NOT EXISTS (
         SELECT 1 FROM mcp_oauth_codes code
         WHERE code.client_id = c.client_id
           AND code.consumed_at IS NULL
           AND code.expires_at > now()
       )`,
    [MCP_REVOKED_RETENTION_DAYS],
  );
  const idleClients = await reader.query(
    `DELETE FROM mcp_oauth_clients c
     WHERE c.revoked_at IS NULL
       AND c.created_at < now() - ($1 || ' days')::interval
       AND (c.last_used_at IS NULL OR c.last_used_at < now() - ($1 || ' days')::interval)
       AND NOT EXISTS (
         SELECT 1 FROM mcp_oauth_tokens t
         WHERE t.client_id = c.client_id
           AND t.revoked_at IS NULL
           AND t.refresh_expires_at > now()
       )
       AND NOT EXISTS (
         SELECT 1 FROM mcp_oauth_codes code
         WHERE code.client_id = c.client_id
           AND code.consumed_at IS NULL
           AND code.expires_at > now()
       )`,
    [MCP_IDLE_CLIENT_RETENTION_DAYS],
  );
  const rateLimits = await reader.query(
    `DELETE FROM mcp_oauth_rate_limits
     WHERE updated_at < now() - ($1 || ' days')::interval
       AND (blocked_until IS NULL OR blocked_until < now())`,
    [MCP_RATE_LIMIT_RETENTION_DAYS],
  );
  return {
    codesDeleted: codes.rowCount ?? 0,
    tokensDeleted: tokens.rowCount ?? 0,
    clientsDeleted: (clients.rowCount ?? 0) + (idleClients.rowCount ?? 0),
    rateLimitsDeleted: rateLimits.rowCount ?? 0,
  };
}
