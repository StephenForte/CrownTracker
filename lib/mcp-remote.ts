/**
 * Remote MCP connector availability. Credentials or a public URL alone never
 * enable the public write/auth surface; the flag must be exactly "true".
 */

import { timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export const MCP_MAX_ACTIVE_CLIENTS = 25;
export const MCP_MAX_REDIRECT_URIS = 10;
export const MCP_MAX_CLIENT_NAME_LENGTH = 120;
export const MCP_REGISTRATION_RATE_LIMIT = 10;
export const MCP_REGISTRATION_WINDOW_SECONDS = 60 * 60;
export const MCP_AUTH_FAILURE_LIMIT = 5;
export const MCP_AUTH_FAILURE_WINDOW_SECONDS = 15 * 60;
export const MCP_AUTH_COOLDOWN_SECONDS = 15 * 60;
export const MCP_CODE_LIFETIME_SECONDS = 5 * 60;
export const MCP_ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;
export const MCP_REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const MCP_REVOKED_RETENTION_DAYS = 7;
export const MCP_IDLE_CLIENT_RETENTION_DAYS = 30;
export const MCP_RATE_LIMIT_RETENTION_DAYS = 7;

export function isMcpRemoteRequested(env: Env = process.env) {
  return env.MCP_REMOTE_ENABLED === "true";
}

export function mcpRemoteConfigurationError(env: Env = process.env) {
  if (!isMcpRemoteRequested(env)) return null;
  if (!env.MCP_PUBLIC_BASE_URL?.trim()) return "MCP_REMOTE_ENABLED=true requires MCP_PUBLIC_BASE_URL.";
  if (!env.MCP_DATABASE_URL?.trim()) return "MCP_REMOTE_ENABLED=true requires MCP_DATABASE_URL.";
  try {
    const url = new URL(env.MCP_PUBLIC_BASE_URL);
    if (url.protocol !== "https:" && env.NODE_ENV === "production") {
      return "MCP_PUBLIC_BASE_URL must use HTTPS in production.";
    }
  } catch {
    return "MCP_PUBLIC_BASE_URL must be a valid absolute URL.";
  }
  return null;
}

export function isMcpRemoteEnabled(env: Env = process.env) {
  return isMcpRemoteRequested(env) && mcpRemoteConfigurationError(env) === null;
}

/** Non-disclosing response when remote MCP is off or misconfigured. */
export function mcpRemoteUnavailableResponse(env: Env = process.env) {
  const status = isMcpRemoteRequested(env) ? 503 : 404;
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export function authorizePageSecurityHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  };
}

export function redirectOriginLabel(redirectUri: string) {
  return new URL(redirectUri).origin;
}

export function passwordsMatch(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    const pad = Buffer.alloc(left.length);
    timingSafeEqual(left, pad);
    return false;
  }
  return timingSafeEqual(left, right);
}
