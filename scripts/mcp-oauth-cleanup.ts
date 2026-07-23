import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local" });
config();

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { cleanupMcpOAuthState } = await import("@/lib/mcp-oauth");
    const result = await cleanupMcpOAuthState(pool);
    console.log(JSON.stringify({
      event: "mcp_oauth_cleanup",
      codesDeleted: result.codesDeleted,
      tokensDeleted: result.tokensDeleted,
      clientsDeleted: result.clientsDeleted,
      rateLimitsDeleted: result.rateLimitsDeleted,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "mcp_oauth_cleanup_failed",
    error: error instanceof Error ? error.message : "unknown",
  }));
  process.exit(1);
});
