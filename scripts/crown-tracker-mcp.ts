import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// MCP clients can launch this outside the repository. Resolve the local
// development database configuration from this script's location instead of
// the caller's working directory. An explicitly supplied environment variable
// always takes precedence.
const projectRoot = resolve(dirname(process.argv[1] ?? process.cwd()), "..");
config({ path: resolve(projectRoot, ".env.local"), override: false });
process.chdir(projectRoot);

async function main() {
  // Require after loading `.env.local` so the shared MCP server can initialize
  // the Postgres pool with DATABASE_URL.
  const { createMetricsMcpServer } = require("@/lib/mcp-server") as typeof import("@/lib/mcp-server");
  const server = createMetricsMcpServer();
  await server.connect(new StdioServerTransport());
  console.error("CrownTracker metrics MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("CrownTracker metrics MCP server failed to start", error);
  process.exit(1);
});
