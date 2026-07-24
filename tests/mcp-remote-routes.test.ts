import assert from "node:assert/strict";
import test from "node:test";

async function withEnv<T>(updates: Record<string, string | undefined>, fn: () => Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("public MCP and OAuth routes fail closed when remote MCP is disabled", async () => {
  process.env.DATABASE_URL ??= "postgresql://ubuntu:ubuntu@localhost:5432/crown_tracker";
  await withEnv({
    MCP_REMOTE_ENABLED: "false",
    MCP_PUBLIC_BASE_URL: undefined,
    MCP_DATABASE_URL: undefined,
  }, async () => {
    const register = await import("@/app/oauth/register/route");
    const authorize = await import("@/app/oauth/authorize/route");
    const token = await import("@/app/oauth/token/route");
    const asMeta = await import("@/app/.well-known/oauth-authorization-server/route");
    const resourceMeta = await import("@/app/.well-known/oauth-protected-resource/mcp/route");
    const mcp = await import("@/app/mcp/route");

    const responses = await Promise.all([
      register.POST(new Request("http://localhost/oauth/register", { method: "POST", body: "{}" })),
      authorize.GET(new Request("http://localhost/oauth/authorize")),
      token.POST(new Request("http://localhost/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=authorization_code" })),
      asMeta.GET(),
      resourceMeta.GET(),
      mcp.GET(new Request("http://localhost/mcp")),
    ]);

    for (const response of responses) {
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  });
});
