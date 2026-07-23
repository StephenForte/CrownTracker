import { createHash, randomBytes } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { db } from "@/lib/db";

export const MCP_READ_SCOPE = "crowntracker.read";
const codeLifetimeSeconds = 5 * 60;
const accessTokenLifetimeSeconds = 60 * 60;
const refreshTokenLifetimeSeconds = 30 * 24 * 60 * 60;

type OAuthClient = {
  client_id: string;
  redirect_uris: unknown;
  client_name: string | null;
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
};

export type OAuthError = { error: string; description: string };

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

function validRedirectUri(value: string) {
  try {
    const url = new URL(value);
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

export async function registerPublicClient(input: { redirectUris: unknown; clientName: unknown }) {
  const redirectUris = asRedirectUris(input.redirectUris);
  if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(validRedirectUri)) {
    return { error: authorizationError("invalid_client_metadata", "redirect_uris must contain one to ten HTTPS URLs (or localhost URLs for local clients).") };
  }
  const clientName = typeof input.clientName === "string" ? input.clientName.trim().slice(0, 120) || null : null;
  const clientId = `ct_${randomSecret()}`;
  await db.query("INSERT INTO mcp_oauth_clients (client_id, redirect_uris, client_name) VALUES ($1,$2::jsonb,$3)", [clientId, JSON.stringify(redirectUris), clientName]);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: "none",
    redirect_uris: redirectUris,
    client_name: clientName,
  };
}

async function client(clientId: string): Promise<OAuthClient | null> {
  const result = await db.query<OAuthClient>("SELECT client_id, redirect_uris, client_name FROM mcp_oauth_clients WHERE client_id = $1", [clientId]);
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
  if (!registeredClient || !asRedirectUris(registeredClient.redirect_uris).includes(redirectUri)) return authorizationError("invalid_request", "The redirect URI is not registered for this client.");
  const grantedScopes = scopes(search.get("scope"));
  if (!grantedScopes) return authorizationError("invalid_scope", `Only ${MCP_READ_SCOPE} is available.`);
  const resource = search.get("resource") ?? mcpEndpointUrl();
  if (resource !== mcpEndpointUrl()) return authorizationError("invalid_target", "The OAuth resource must be this CrownTracker MCP endpoint.");
  return { clientId, redirectUri, state: search.get("state"), codeChallenge, scope: grantedScopes, resource, clientName: registeredClient.client_name };
}

export async function createAuthorizationCode(request: AuthorizationRequest) {
  const code = randomSecret();
  await db.query(
    `INSERT INTO mcp_oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,now() + ($7 || ' seconds')::interval)`,
    [hash(code), request.clientId, request.redirectUri, request.codeChallenge, request.scope, request.resource, codeLifetimeSeconds],
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
    expires_in: accessTokenLifetimeSeconds,
    refresh_token: refreshToken,
    scope: scopesForToken.join(" "),
  };
}

async function issueTokens(clientId: string, scope: string[], resource: string) {
  const accessToken = randomSecret();
  const refreshToken = randomSecret();
  await db.query(
    `INSERT INTO mcp_oauth_tokens (access_token_hash, refresh_token_hash, client_id, scope, resource, expires_at, refresh_expires_at)
     VALUES ($1,$2,$3,$4,$5,now() + ($6 || ' seconds')::interval,now() + ($7 || ' seconds')::interval)`,
    [hash(accessToken), hash(refreshToken), clientId, scope, resource, accessTokenLifetimeSeconds, refreshTokenLifetimeSeconds],
  );
  return tokenResponse(accessToken, refreshToken, scope);
}

export async function exchangeAuthorizationCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string | null }) {
  if (!validCodeVerifier(input.codeVerifier)) return { error: authorizationError("invalid_grant", "The PKCE code_verifier is invalid.") };
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    const result = await connection.query<AuthorizationCode>("SELECT id, client_id, redirect_uri, code_challenge, scope, resource, expires_at, consumed_at FROM mcp_oauth_codes WHERE code_hash = $1 FOR UPDATE", [hash(input.code)]);
    const code = result.rows[0];
    if (!code || code.consumed_at || code.expires_at <= new Date() || code.client_id !== input.clientId || code.redirect_uri !== input.redirectUri || code.code_challenge !== pkceChallenge(input.codeVerifier) || (input.resource && input.resource !== code.resource)) {
      await connection.query("ROLLBACK");
      return { error: authorizationError("invalid_grant", "The authorization code is invalid, expired, already used, or does not match this client.") };
    }
    await connection.query("UPDATE mcp_oauth_codes SET consumed_at = now() WHERE id = $1", [code.id]);
    const accessToken = randomSecret();
    const refreshToken = randomSecret();
    await connection.query(
      `INSERT INTO mcp_oauth_tokens (access_token_hash, refresh_token_hash, client_id, scope, resource, expires_at, refresh_expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6 || ' seconds')::interval,now() + ($7 || ' seconds')::interval)`,
      [hash(accessToken), hash(refreshToken), code.client_id, code.scope, code.resource, accessTokenLifetimeSeconds, refreshTokenLifetimeSeconds],
    );
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
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    const result = await connection.query<StoredToken & { id: string }>("SELECT id, client_id, scope, resource, expires_at, refresh_expires_at, revoked_at FROM mcp_oauth_tokens WHERE refresh_token_hash = $1 FOR UPDATE", [hash(input.refreshToken)]);
    const token = result.rows[0];
    if (!token || token.revoked_at || !token.refresh_expires_at || token.refresh_expires_at <= new Date() || token.client_id !== input.clientId || (input.resource && input.resource !== token.resource)) {
      await connection.query("ROLLBACK");
      return { error: authorizationError("invalid_grant", "The refresh token is invalid or expired.") };
    }
    await connection.query("UPDATE mcp_oauth_tokens SET revoked_at = now() WHERE id = $1", [token.id]);
    const accessToken = randomSecret();
    const refreshToken = randomSecret();
    await connection.query(
      `INSERT INTO mcp_oauth_tokens (access_token_hash, refresh_token_hash, client_id, scope, resource, expires_at, refresh_expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6 || ' seconds')::interval,now() + ($7 || ' seconds')::interval)`,
      [hash(accessToken), hash(refreshToken), token.client_id, token.scope, token.resource, accessTokenLifetimeSeconds, refreshTokenLifetimeSeconds],
    );
    await connection.query("COMMIT");
    return tokenResponse(accessToken, refreshToken, token.scope);
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not refresh the CrownTracker access token.");
  } finally {
    connection.release();
  }
}

export async function verifyMcpBearer(authorization: string | null): Promise<AuthInfo | null> {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  if (!token) return null;
  const result = await db.query<StoredToken>(
    "SELECT client_id, scope, resource, expires_at, refresh_expires_at, revoked_at FROM mcp_oauth_tokens WHERE access_token_hash = $1",
    [hash(token)],
  );
  const stored = result.rows[0];
  if (!stored || stored.revoked_at || stored.expires_at <= new Date() || stored.resource !== mcpEndpointUrl() || !stored.scope.includes(MCP_READ_SCOPE)) return null;
  return {
    token,
    clientId: stored.client_id,
    scopes: stored.scope,
    expiresAt: Math.floor(stored.expires_at.getTime() / 1000),
    resource: new URL(stored.resource),
  };
}
