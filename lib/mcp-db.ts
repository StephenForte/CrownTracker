import { Pool } from "pg";
import { isMcpRemoteEnabled } from "@/lib/mcp-remote";

declare global {
  // eslint-disable-next-line no-var
  var crownTrackerMcpPool: Pool | undefined;
}

/**
 * Narrow Postgres pool for the remote MCP runtime. Missing when remote MCP is
 * disabled; when enabled, callers must treat absence as fail-closed.
 */
export function mcpDb(): Pool {
  if (!isMcpRemoteEnabled()) {
    throw new Error("Remote MCP database access is unavailable while MCP_REMOTE_ENABLED is off.");
  }
  const connectionString = process.env.MCP_DATABASE_URL;
  if (!connectionString) {
    throw new Error("MCP_DATABASE_URL is required when remote MCP is enabled.");
  }
  if (!global.crownTrackerMcpPool) {
    global.crownTrackerMcpPool = new Pool({ connectionString });
  }
  return global.crownTrackerMcpPool;
}
