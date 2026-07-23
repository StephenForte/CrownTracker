import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

config({ path: ".env.local" });
config();

function sqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * One-time (idempotent) provision of the crown_tracker_mcp read-only role used
 * by MCP_DATABASE_URL. Run with a privileged DATABASE_URL that can CREATE ROLE.
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const password = process.env.MCP_DATABASE_PASSWORD || randomBytes(24).toString("base64url");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'crown_tracker_mcp'");
    if (!role.rowCount) {
      await client.query(`CREATE ROLE crown_tracker_mcp LOGIN PASSWORD ${sqlStringLiteral(password)}`);
      console.log("Created role crown_tracker_mcp.");
    } else if (process.env.MCP_DATABASE_PASSWORD) {
      await client.query(`ALTER ROLE crown_tracker_mcp WITH LOGIN PASSWORD ${sqlStringLiteral(password)}`);
      console.log("Updated password for crown_tracker_mcp.");
    } else {
      console.log("Role crown_tracker_mcp already exists; pass MCP_DATABASE_PASSWORD to rotate its password.");
    }

    const dbName = (await client.query<{ current_database: string }>("SELECT current_database()")).rows[0].current_database;
    await client.query(`GRANT CONNECT ON DATABASE "${dbName.replaceAll('"', '""')}" TO crown_tracker_mcp`);
    await client.query("GRANT USAGE ON SCHEMA public TO crown_tracker_mcp");
    await client.query(`
      GRANT SELECT (id, status, reference_number, model_name, nickname, retail_price_usd, created_at)
      ON watches TO crown_tracker_mcp
    `);
    await client.query(`
      GRANT SELECT (watch_id, metric, value, label, n, n_uncertain, confidence, computed_at)
      ON metric_snapshots TO crown_tracker_mcp
    `);
    await client.query(`
      GRANT SELECT (access_token_hash, client_id, scope, resource, expires_at, refresh_expires_at, revoked_at)
      ON mcp_oauth_tokens TO crown_tracker_mcp
    `);
    await client.query("REVOKE ALL ON TABLE mcp_oauth_clients FROM crown_tracker_mcp");
    await client.query("REVOKE ALL ON TABLE mcp_oauth_codes FROM crown_tracker_mcp");
    await client.query("REVOKE ALL ON TABLE mcp_oauth_rate_limits FROM crown_tracker_mcp");
    await client.query("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE watches FROM crown_tracker_mcp");
    await client.query("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE metric_snapshots FROM crown_tracker_mcp");
    await client.query("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE mcp_oauth_tokens FROM crown_tracker_mcp");

    const url = new URL(process.env.DATABASE_URL);
    url.username = "crown_tracker_mcp";
    url.password = password;
    console.log("Granted least-privilege SELECT rights for remote MCP.");
    console.log(`Set MCP_DATABASE_URL=${url.toString()}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
