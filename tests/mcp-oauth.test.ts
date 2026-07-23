import assert from "node:assert/strict";
import test from "node:test";
import {
  isMcpRemoteEnabled,
  isMcpRemoteRequested,
  mcpRemoteConfigurationError,
  mcpRemoteUnavailableResponse,
  passwordsMatch,
  redirectOriginLabel,
} from "@/lib/mcp-remote";

test("remote MCP stays disabled unless MCP_REMOTE_ENABLED is exactly true", () => {
  assert.equal(isMcpRemoteRequested({ MCP_REMOTE_ENABLED: "true" }), true);
  assert.equal(isMcpRemoteRequested({ MCP_REMOTE_ENABLED: "1" }), false);
  assert.equal(isMcpRemoteRequested({}), false);
  assert.match(
    mcpRemoteConfigurationError({
      MCP_REMOTE_ENABLED: "true",
    }) ?? "",
    /MCP_PUBLIC_BASE_URL/,
  );
  assert.match(
    mcpRemoteConfigurationError({
      MCP_REMOTE_ENABLED: "true",
      MCP_PUBLIC_BASE_URL: "https://crown-tracker.onrender.com",
    }) ?? "",
    /MCP_DATABASE_URL/,
  );
  assert.equal(
    mcpRemoteConfigurationError({
      MCP_REMOTE_ENABLED: "true",
      MCP_PUBLIC_BASE_URL: "https://crown-tracker.onrender.com",
      MCP_DATABASE_URL: "postgresql://crown_tracker_mcp:x@localhost:5432/crown_tracker",
    }),
    null,
  );
  assert.equal(
    isMcpRemoteEnabled({
      MCP_REMOTE_ENABLED: "true",
      MCP_PUBLIC_BASE_URL: "https://crown-tracker.onrender.com",
      MCP_DATABASE_URL: "postgresql://crown_tracker_mcp:x@localhost:5432/crown_tracker",
    }),
    true,
  );
  assert.equal(
    mcpRemoteConfigurationError({
      MCP_REMOTE_ENABLED: "true",
      MCP_PUBLIC_BASE_URL: "http://insecure.example",
      MCP_DATABASE_URL: "postgresql://crown_tracker_mcp:x@localhost:5432/crown_tracker",
      NODE_ENV: "production",
    }),
    "MCP_PUBLIC_BASE_URL must use HTTPS in production.",
  );
});

test("disabled remote MCP returns a uniform non-disclosing response", () => {
  const disabled = mcpRemoteUnavailableResponse({ MCP_REMOTE_ENABLED: "false" });
  assert.equal(disabled.status, 404);
  assert.equal(disabled.headers.get("Cache-Control"), "no-store");
  const misconfigured = mcpRemoteUnavailableResponse({ MCP_REMOTE_ENABLED: "true" });
  assert.equal(misconfigured.status, 503);
});

test("redirect URI validation rejects fragments and non-loopback http", async () => {
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/crown_tracker";
  const { validRedirectUri } = await import("@/lib/mcp-oauth");
  assert.equal(validRedirectUri("https://claude.ai/callback"), true);
  assert.equal(validRedirectUri("http://127.0.0.1:8787/callback"), true);
  assert.equal(validRedirectUri("http://localhost:3000/cb"), true);
  assert.equal(validRedirectUri("https://claude.ai/callback#frag"), false);
  assert.equal(validRedirectUri("http://example.com/callback"), false);
  assert.equal(redirectOriginLabel("https://claude.ai/api/callback?x=1"), "https://claude.ai");
});

test("password comparison is length-safe", () => {
  assert.equal(passwordsMatch("crownlocal123", "crownlocal123"), true);
  assert.equal(passwordsMatch("wrong", "crownlocal123"), false);
  assert.equal(passwordsMatch("crownlocal1234", "crownlocal123"), false);
});

test("remote MCP publishes OAuth and protected-resource discovery metadata", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPublicUrl = process.env.MCP_PUBLIC_BASE_URL;
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/crown_tracker";
  process.env.MCP_PUBLIC_BASE_URL = "https://crown-tracker.onrender.com";
  const { mcpEndpointUrl, oauthAuthorizationMetadata, protectedResourceMetadata } = await import("@/lib/mcp-oauth");

  assert.equal(mcpEndpointUrl(), "https://crown-tracker.onrender.com/mcp");
  assert.deepEqual(protectedResourceMetadata(), {
    resource: "https://crown-tracker.onrender.com/mcp",
    authorization_servers: ["https://crown-tracker.onrender.com/"],
    scopes_supported: ["crowntracker.read"],
    bearer_methods_supported: ["header"],
    resource_name: "CrownTracker metrics",
  });
  assert.deepEqual(oauthAuthorizationMetadata().code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(oauthAuthorizationMetadata().grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(oauthAuthorizationMetadata().scopes_supported, ["crowntracker.read"]);

  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousPublicUrl === undefined) delete process.env.MCP_PUBLIC_BASE_URL;
  else process.env.MCP_PUBLIC_BASE_URL = previousPublicUrl;
});

test("createMetricsMcpServer accepts a read-only DatabaseReader", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/crown_tracker";
  const { createMetricsMcpServer } = await import("@/lib/mcp-server");
  let queried = false;
  const reader = {
    query: async () => {
      queried = true;
      return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    },
  };
  const server = createMetricsMcpServer(reader as never);
  assert.ok(server);
  assert.equal(queried, false);
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});
