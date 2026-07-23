import assert from "node:assert/strict";
import test from "node:test";

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

  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousPublicUrl === undefined) delete process.env.MCP_PUBLIC_BASE_URL;
  else process.env.MCP_PUBLIC_BASE_URL = previousPublicUrl;
});
