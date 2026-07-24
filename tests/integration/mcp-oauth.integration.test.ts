import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

const adminUrl = process.env.DATABASE_URL ?? "postgresql://ubuntu:ubuntu@localhost:5432/crown_tracker";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function applyMigrations(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = (await readdir(path.join(process.cwd(), "db/migrations"))).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (applied.rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(path.join(process.cwd(), "db/migrations", file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

test("mcp oauth integration: lifecycle, revoke, cleanup, and migration idempotency", async (t) => {
  const integrationDb = `crown_tracker_mcp_oauth_${randomBytes(4).toString("hex")}`;
  const bootstrap = new Pool({ connectionString: adminUrl });
  await bootstrap.query(`CREATE DATABASE ${integrationDb}`);
  const databaseUrl = `${adminUrl.replace(/\/[^/?]+(\?|$)/, `/${integrationDb}$1`)}`;
  const pool = new Pool({ connectionString: databaseUrl });

  t.after(async () => {
    const oauth = await import("@/lib/mcp-oauth");
    oauth.setMcpOAuthDbForTests(null);
    await pool.end();
    await bootstrap.query(`DROP DATABASE IF EXISTS ${integrationDb} WITH (FORCE)`);
    await bootstrap.end();
  });

  await applyMigrations(pool);
  await applyMigrations(pool);

  process.env.DATABASE_URL = databaseUrl;
  process.env.MCP_REMOTE_ENABLED = "true";
  process.env.MCP_PUBLIC_BASE_URL = "https://crown-tracker.example";
  process.env.MCP_DATABASE_URL = databaseUrl;
  process.env.APP_PASSWORD = "integration-password-123";

  const oauth = await import("@/lib/mcp-oauth");
  oauth.setMcpOAuthDbForTests(pool);

  const rejectedBefore = Number((await pool.query("SELECT count(*)::int AS n FROM mcp_oauth_clients")).rows[0].n);
  const bad = await oauth.registerPublicClient({
    redirectUris: ["http://evil.example/callback"],
    clientName: "Bad",
  });
  assert.ok("error" in bad);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM mcp_oauth_clients")).rows[0].n), rejectedBefore);

  const registered = await oauth.registerPublicClient({
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    clientName: "Claude",
  });
  assert.ok(!("error" in registered));
  const clientId = registered.client_id;

  const { verifier, challenge } = pkce();
  const auth = await oauth.validateAuthorizationRequest(new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "crowntracker.read",
    resource: "https://crown-tracker.example/mcp",
  }));
  assert.ok(!("error" in auth));
  assert.equal(auth.redirectOrigin, "https://claude.ai");

  const code = await oauth.createAuthorizationCode(auth);
  const tokens = await oauth.exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeVerifier: verifier,
    resource: "https://crown-tracker.example/mcp",
  });
  assert.ok(!("error" in tokens));

  const replay = await oauth.exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeVerifier: verifier,
    resource: "https://crown-tracker.example/mcp",
  });
  assert.ok("error" in replay);

  const concurrentCode = await oauth.createAuthorizationCode(auth);
  const [first, second] = await Promise.all([
    oauth.exchangeAuthorizationCode({
      code: concurrentCode,
      clientId,
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeVerifier: verifier,
      resource: "https://crown-tracker.example/mcp",
    }),
    oauth.exchangeAuthorizationCode({
      code: concurrentCode,
      clientId,
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeVerifier: verifier,
      resource: "https://crown-tracker.example/mcp",
    }),
  ]);
  assert.equal([first, second].filter((result) => !("error" in result)).length, 1);
  assert.equal([first, second].filter((result) => "error" in result).length, 1);

  const refreshed = await oauth.refreshAccessToken({
    refreshToken: tokens.refresh_token,
    clientId,
    resource: "https://crown-tracker.example/mcp",
  });
  assert.ok(!("error" in refreshed));
  const refreshReplay = await oauth.refreshAccessToken({
    refreshToken: tokens.refresh_token,
    clientId,
    resource: "https://crown-tracker.example/mcp",
  });
  assert.ok("error" in refreshReplay);

  const bearer = await oauth.verifyMcpBearer(`Bearer ${refreshed.access_token}`, pool);
  assert.ok(bearer);
  assert.deepEqual(bearer.scopes, ["crowntracker.read"]);
  assert.equal(await oauth.verifyMcpBearer(null, pool), null);
  assert.equal(await oauth.verifyMcpBearer("Bearer not-a-real-token", pool), null);

  const clients = await oauth.listMcpConnectorClients();
  assert.ok(clients.some((client) => client.clientId === clientId && client.status === "active"));

  assert.equal(await oauth.revokeMcpClient(clientId), true);
  assert.equal(await oauth.verifyMcpBearer(`Bearer ${refreshed.access_token}`, pool), null);
  const revokedRefresh = await oauth.refreshAccessToken({
    refreshToken: refreshed.refresh_token,
    clientId,
    resource: "https://crown-tracker.example/mcp",
  });
  assert.ok("error" in revokedRefresh);

  const secondClient = await oauth.registerPublicClient({
    redirectUris: ["http://127.0.0.1:9999/cb"],
    clientName: "Local",
  });
  assert.ok(!("error" in secondClient));
  const secondAuth = await oauth.validateAuthorizationRequest(new URLSearchParams({
    response_type: "code",
    client_id: secondClient.client_id,
    redirect_uri: "http://127.0.0.1:9999/cb",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: "https://crown-tracker.example/mcp",
  }));
  assert.ok(!("error" in secondAuth));
  const secondCode = await oauth.createAuthorizationCode(secondAuth);
  const secondTokens = await oauth.exchangeAuthorizationCode({
    code: secondCode,
    clientId: secondClient.client_id,
    redirectUri: "http://127.0.0.1:9999/cb",
    codeVerifier: verifier,
    resource: null,
  });
  assert.ok(!("error" in secondTokens));
  assert.ok((await oauth.revokeAllMcpClients()) >= 1);
  assert.equal(await oauth.verifyMcpBearer(`Bearer ${secondTokens.access_token}`, pool), null);

  await pool.query("UPDATE mcp_oauth_codes SET consumed_at = now() - interval '10 days' WHERE consumed_at IS NOT NULL");
  await pool.query("UPDATE mcp_oauth_tokens SET revoked_at = now() - interval '10 days' WHERE revoked_at IS NOT NULL");
  // 10 days > MCP_REVOKED_RETENTION_DAYS (7) and < MCP_IDLE_CLIENT_RETENTION_DAYS (30).
  await pool.query("UPDATE mcp_oauth_clients SET revoked_at = now() - interval '10 days' WHERE revoked_at IS NOT NULL");
  const cleanup = await oauth.cleanupMcpOAuthState(pool);
  assert.ok(cleanup.tokensDeleted >= 1);
  assert.ok(cleanup.clientsDeleted >= 1);

  // Fill the registration rate limit without unbounded client growth once capped by rate limit.
  let limited = false;
  for (let i = 0; i < 20; i += 1) {
    const result = await oauth.registerPublicClient({
      redirectUris: [`https://claude.ai/callback/${i}`],
      clientName: `Rate ${i}`,
    }, { request: new Request("https://crown-tracker.example/oauth/register", { headers: { "x-forwarded-for": "203.0.113.10" } }) });
    if ("error" in result && result.error?.error === "temporarily_unavailable") {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
  const activeClients = Number((await pool.query("SELECT count(*)::int AS n FROM mcp_oauth_clients WHERE revoked_at IS NULL")).rows[0].n);
  assert.ok(activeClients <= 25);
});

test("mcp oauth enforces active-client and auth-failure caps under concurrency", async (t) => {
  const integrationDb = `crown_tracker_mcp_caps_${randomBytes(4).toString("hex")}`;
  const bootstrap = new Pool({ connectionString: adminUrl });
  await bootstrap.query(`CREATE DATABASE ${integrationDb}`);
  const databaseUrl = `${adminUrl.replace(/\/[^/?]+(\?|$)/, `/${integrationDb}$1`)}`;
  const pool = new Pool({ connectionString: databaseUrl });

  t.after(async () => {
    const oauth = await import("@/lib/mcp-oauth");
    oauth.setMcpOAuthDbForTests(null);
    await pool.end();
    await bootstrap.query(`DROP DATABASE IF EXISTS ${integrationDb} WITH (FORCE)`);
    await bootstrap.end();
  });

  await applyMigrations(pool);
  // DROP DATABASE … WITH (FORCE) can emit late socket errors after pool.end().
  pool.on("error", () => {});
  process.env.DATABASE_URL = databaseUrl;
  process.env.MCP_REMOTE_ENABLED = "true";
  process.env.MCP_PUBLIC_BASE_URL = "https://crown-tracker.example";
  process.env.MCP_DATABASE_URL = databaseUrl;
  process.env.APP_PASSWORD = "integration-password-123";

  const oauth = await import("@/lib/mcp-oauth");
  const { MCP_AUTH_FAILURE_LIMIT, MCP_MAX_ACTIVE_CLIENTS } = await import("@/lib/mcp-remote");
  oauth.setMcpOAuthDbForTests(pool);

  // Leave one active-client slot, then race many registrations from distinct IPs.
  for (let i = 0; i < MCP_MAX_ACTIVE_CLIENTS - 1; i += 1) {
    await pool.query(
      "INSERT INTO mcp_oauth_clients (client_id, redirect_uris, client_name) VALUES ($1, $2::jsonb, $3)",
      [`seed_${i}`, JSON.stringify([`https://claude.ai/seed/${i}`]), `Seed ${i}`],
    );
  }
  const raced = await Promise.all(
    Array.from({ length: 8 }, (_, i) => oauth.registerPublicClient(
      { redirectUris: [`https://claude.ai/race/${i}`], clientName: `Race ${i}` },
      {
        request: new Request("https://crown-tracker.example/oauth/register", {
          headers: { "x-forwarded-for": `198.51.100.${i + 1}` },
        }),
      },
    )),
  );
  const created = raced.filter((result) => !("error" in result));
  const rejected = raced.filter((result) => "error" in result && result.error?.error === "temporarily_unavailable");
  assert.equal(created.length, 1);
  assert.equal(rejected.length, 7);
  const activeAfterRace = Number((await pool.query("SELECT count(*)::int AS n FROM mcp_oauth_clients WHERE revoked_at IS NULL")).rows[0].n);
  assert.equal(activeAfterRace, MCP_MAX_ACTIVE_CLIENTS);

  const authRequest = new Request("https://crown-tracker.example/oauth/authorize", {
    headers: { "x-forwarded-for": "203.0.113.50" },
  });
  const passwordAttempts = await Promise.all(
    Array.from({ length: MCP_AUTH_FAILURE_LIMIT + 5 }, () =>
      oauth.completeAuthorizationPasswordAttempt(authRequest, "wrong-password", "integration-password-123")),
  );
  const mismatches = passwordAttempts.filter((result) => result === "mismatch").length;
  const blocked = passwordAttempts.filter((result) => result === "blocked").length;
  assert.equal(mismatches, MCP_AUTH_FAILURE_LIMIT);
  assert.equal(blocked, 5);
  assert.equal(passwordAttempts.includes("ok"), false);

  const bucket = (await pool.query<{ attempt_count: number }>(
    "SELECT attempt_count FROM mcp_oauth_rate_limits WHERE bucket_key LIKE 'authorize:%'",
  )).rows[0];
  assert.ok(bucket);
  assert.equal(bucket.attempt_count, MCP_AUTH_FAILURE_LIMIT);

  // Correct password must succeed (and clear) even after the IP is blocked.
  assert.equal(
    await oauth.completeAuthorizationPasswordAttempt(
      authRequest,
      "integration-password-123",
      "integration-password-123",
    ),
    "ok",
  );
  assert.equal(
    Number((await pool.query("SELECT count(*)::int AS n FROM mcp_oauth_rate_limits WHERE bucket_key LIKE 'authorize:%'")).rows[0].n),
    0,
  );

  // Race one more wrong attempt against a correct password at the failure ceiling.
  // The correct password must still return ok even if the wrong attempt hits the
  // limit first under the advisory lock.
  const mixedRequest = new Request("https://crown-tracker.example/oauth/authorize", {
    headers: { "x-forwarded-for": "203.0.113.51" },
  });
  for (let i = 0; i < MCP_AUTH_FAILURE_LIMIT - 1; i += 1) {
    assert.equal(
      await oauth.completeAuthorizationPasswordAttempt(mixedRequest, "wrong-password", "integration-password-123"),
      "mismatch",
    );
  }
  const mixedAttempts = await Promise.all([
    oauth.completeAuthorizationPasswordAttempt(mixedRequest, "wrong-password", "integration-password-123"),
    oauth.completeAuthorizationPasswordAttempt(
      mixedRequest,
      "integration-password-123",
      "integration-password-123",
    ),
  ]);
  assert.equal(mixedAttempts.filter((result) => result === "ok").length, 1);
});

test("mcp oauth migration applies on a fresh schema and reruns cleanly", async (t) => {
  const bootstrap = new Pool({ connectionString: adminUrl });
  const dbName = `crown_tracker_mcp_mig_${randomBytes(4).toString("hex")}`;
  await bootstrap.query(`CREATE DATABASE ${dbName}`);
  const databaseUrl = `${adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)}`;
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await pool.end();
    await bootstrap.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await bootstrap.end();
  });

  await applyMigrations(pool);
  const first = await pool.query("SELECT name FROM schema_migrations WHERE name = '011_mcp_oauth_hardening.sql'");
  assert.equal(first.rowCount, 1);
  await applyMigrations(pool);
  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'mcp_oauth_clients' AND column_name IN ('revoked_at', 'last_used_at')
     ORDER BY column_name`,
  );
  assert.deepEqual(columns.rows.map((row) => row.column_name), ["last_used_at", "revoked_at"]);
  const rateLimits = await pool.query("SELECT to_regclass('public.mcp_oauth_rate_limits') AS name");
  assert.equal(rateLimits.rows[0].name, "mcp_oauth_rate_limits");
});

test("end-to-end read-only metrics tool does not mutate collection data", async (t) => {
  const dbName = `crown_tracker_mcp_e2e_${randomBytes(4).toString("hex")}`;
  const bootstrap = new Pool({ connectionString: adminUrl });
  await bootstrap.query(`CREATE DATABASE ${dbName}`);
  const databaseUrl = `${adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)}`;
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    const oauth = await import("@/lib/mcp-oauth");
    oauth.setMcpOAuthDbForTests(null);
    await pool.end();
    await bootstrap.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await bootstrap.end();
  });

  await applyMigrations(pool);
  await pool.query("INSERT INTO users (email) VALUES ('owner@crown-tracker.local') ON CONFLICT DO NOTHING");
  const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'owner@crown-tracker.local'");
  await pool.query(
    `INSERT INTO watches (user_id, reference_number, model_name, nickname, status, scope)
     VALUES ($1, '126610LN', 'Submariner Date', 'E2E Sub', 'active', '{}'::jsonb)`,
    [user.rows[0].id],
  );
  const runsBefore = Number((await pool.query("SELECT count(*)::int AS n FROM runs")).rows[0].n);

  process.env.DATABASE_URL = databaseUrl;
  process.env.MCP_PUBLIC_BASE_URL = "https://crown-tracker.example";
  const oauth = await import("@/lib/mcp-oauth");
  oauth.setMcpOAuthDbForTests(pool);
  const { createMetricsMcpServer } = await import("@/lib/mcp-server");
  const { getActiveWatchMetrics } = await import("@/lib/active-watch-metrics");

  assert.equal(await oauth.verifyMcpBearer(null, pool), null);

  const registered = await oauth.registerPublicClient({
    redirectUris: ["https://claude.ai/callback"],
    clientName: "E2E",
  });
  assert.ok(!("error" in registered));
  const { verifier, challenge } = pkce();
  const auth = await oauth.validateAuthorizationRequest(new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: "https://claude.ai/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: "https://crown-tracker.example/mcp",
  }));
  assert.ok(!("error" in auth));
  const code = await oauth.createAuthorizationCode(auth);
  const tokens = await oauth.exchangeAuthorizationCode({
    code,
    clientId: registered.client_id,
    redirectUri: "https://claude.ai/callback",
    codeVerifier: verifier,
    resource: null,
  });
  assert.ok(!("error" in tokens));
  assert.ok(await oauth.verifyMcpBearer(`Bearer ${tokens.access_token}`, pool));

  const metrics = await getActiveWatchMetrics(pool);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].referenceNumber, "126610LN");
  createMetricsMcpServer(pool);

  const runsAfter = Number((await pool.query("SELECT count(*)::int AS n FROM runs")).rows[0].n);
  assert.equal(runsAfter, runsBefore);
});
