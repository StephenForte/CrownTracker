import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { passwordsMatch } from "@/lib/mcp-remote";

export const LOGIN_AUTH_FAILURE_LIMIT = 5;
export const LOGIN_AUTH_FAILURE_WINDOW_SECONDS = 15 * 60;
export const LOGIN_AUTH_COOLDOWN_SECONDS = 15 * 60;

const LOGIN_LOCK_NAMESPACE = 872352;

type Queryable = Pick<PoolClient, "query">;

function hash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function clientIpBucket(request: Request | null) {
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || request?.headers.get("x-real-ip")?.trim() || "unknown";
  return hash(raw).slice(0, 24);
}

function loginBucket(request: Request | null) {
  return `login:${clientIpBucket(request)}`;
}

function loginFailureLockId(bucketKey: string) {
  return createHash("sha256").update(bucketKey).digest().readInt32BE(0);
}

async function advisoryXactLock(connection: PoolClient, lockId: number) {
  await connection.query("SELECT pg_advisory_xact_lock($1, $2)", [LOGIN_LOCK_NAMESPACE, lockId]);
}

function failureRowBlocked(row: {
  blocked_until: Date | null;
  attempt_count: number;
  window_started_at: Date;
} | undefined) {
  if (!row) return false;
  if (row.blocked_until && row.blocked_until > new Date()) return true;
  if (
    row.window_started_at > new Date(Date.now() - LOGIN_AUTH_FAILURE_WINDOW_SECONDS * 1000)
    && row.attempt_count >= LOGIN_AUTH_FAILURE_LIMIT
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
  cooldownSeconds: number,
) {
  const result = await reader.query<{ allowed: boolean }>(
    `INSERT INTO auth_login_rate_limits (bucket_key, attempt_count, window_started_at, blocked_until, updated_at)
     VALUES (
       $1,
       1,
       now(),
       CASE WHEN 1 >= $2 THEN now() + ($4 || ' seconds')::interval ELSE NULL END,
       now()
     )
     ON CONFLICT (bucket_key) DO UPDATE SET
       attempt_count = CASE
         WHEN auth_login_rate_limits.blocked_until IS NOT NULL AND auth_login_rate_limits.blocked_until > now()
           THEN auth_login_rate_limits.attempt_count
         WHEN auth_login_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval
           THEN 1
         ELSE auth_login_rate_limits.attempt_count + 1
       END,
       window_started_at = CASE
         WHEN auth_login_rate_limits.blocked_until IS NOT NULL AND auth_login_rate_limits.blocked_until > now()
           THEN auth_login_rate_limits.window_started_at
         WHEN auth_login_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval
           THEN now()
         ELSE auth_login_rate_limits.window_started_at
       END,
       blocked_until = CASE
         WHEN auth_login_rate_limits.blocked_until IS NOT NULL AND auth_login_rate_limits.blocked_until > now()
           THEN auth_login_rate_limits.blocked_until
         WHEN (
           CASE
             WHEN auth_login_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval THEN 1
             ELSE auth_login_rate_limits.attempt_count + 1
           END
         ) >= $2
           THEN now() + ($4 || ' seconds')::interval
         WHEN auth_login_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval
           THEN NULL
         ELSE auth_login_rate_limits.blocked_until
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
  await reader.query("DELETE FROM auth_login_rate_limits WHERE bucket_key = $1", [bucketKey]);
}

export async function loginFailureBlocked(request: Request | null) {
  const bucket = loginBucket(request);
  const result = await db.query<{ blocked_until: Date | null; attempt_count: number; window_started_at: Date }>(
    "SELECT blocked_until, attempt_count, window_started_at FROM auth_login_rate_limits WHERE bucket_key = $1",
    [bucket],
  );
  return failureRowBlocked(result.rows[0]);
}

/**
 * Atomically gate a dashboard login attempt. Correct password clears the bucket
 * even during cooldown so the owner is never locked out of a valid secret.
 * Concurrent wrong guesses share an advisory lock so they cannot exceed the
 * failure cap before a cooldown starts.
 */
export async function completeLoginPasswordAttempt(
  request: Request | null,
  provided: string,
  expected: string,
): Promise<"blocked" | "mismatch" | "ok"> {
  const bucket = loginBucket(request);
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    await advisoryXactLock(connection, loginFailureLockId(bucket));
    if (expected && passwordsMatch(provided, expected)) {
      await clearRateLimit(connection, bucket);
      await connection.query("COMMIT");
      return "ok";
    }
    const current = await connection.query<{ blocked_until: Date | null; attempt_count: number; window_started_at: Date }>(
      "SELECT blocked_until, attempt_count, window_started_at FROM auth_login_rate_limits WHERE bucket_key = $1",
      [bucket],
    );
    if (failureRowBlocked(current.rows[0])) {
      await connection.query("COMMIT");
      return "blocked";
    }
    await consumeRateLimit(
      connection,
      bucket,
      LOGIN_AUTH_FAILURE_LIMIT,
      LOGIN_AUTH_FAILURE_WINDOW_SECONDS,
      LOGIN_AUTH_COOLDOWN_SECONDS,
    );
    await connection.query("COMMIT");
    return "mismatch";
  } catch {
    await connection.query("ROLLBACK");
    throw new Error("Could not complete CrownTracker login.");
  } finally {
    connection.release();
  }
}
