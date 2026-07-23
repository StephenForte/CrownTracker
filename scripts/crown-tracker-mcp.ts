import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

// MCP clients can launch this outside the repository. Resolve the local
// development database configuration from this script's location instead of
// the caller's working directory. An explicitly supplied environment variable
// always takes precedence.
const projectRoot = resolve(dirname(process.argv[1] ?? process.cwd()), "..");
config({ path: resolve(projectRoot, ".env.local"), override: false });
process.chdir(projectRoot);

async function main() {
  // `tsx` executes this project's scripts as CommonJS. Require after loading
  // `.env.local` so `lib/db` sees DATABASE_URL during its module initialization.
  const { db } = require("@/lib/db") as typeof import("@/lib/db");
  const { getActiveWatchMetrics } = require("@/lib/active-watch-metrics") as typeof import("@/lib/active-watch-metrics");
  const server = new McpServer({
    name: "crown-tracker-metrics",
    version: "0.1.0",
  });
  const freshnessSchema = z.object({
    label: z.string(),
    state: z.enum(["gathering", "fresh", "stale", "outdated"]),
  });
  const priceMetricSchema = z.object({
    askingPriceUsd: z.number().nullable(),
    sampleSize: z.number().int().nonnegative(),
    uncertainSampleSize: z.number().int().nonnegative(),
    confidence: z.enum(["high", "medium", "low", "insufficient"]).nullable(),
    computedAt: z.string().datetime().nullable(),
    freshness: freshnessSchema,
  });

  server.registerTool("get_active_watch_metrics", {
    title: "Get active CrownTracker watch metrics",
    description: "Return every active tracked watch and its latest derived market metrics. This is read-only: it never refreshes research, calls Tavily or Anthropic, or consumes provider credits. Grey and resell figures are asking-price estimates, not transaction prices.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    outputSchema: {
      generatedAt: z.string().datetime(),
      activeWatchCount: z.number().int().nonnegative(),
      watches: z.array(z.object({
        referenceNumber: z.string(),
        modelName: z.string(),
        nickname: z.string().nullable(),
        retailPriceUsd: z.number().nullable(),
        greyAsking: priceMetricSchema,
        resellAsking: priceMetricSchema,
        availability: z.object({
          level: z.string().nullable(),
          observedListings: z.number().nullable(),
          sampleSize: z.number().int().nonnegative(),
          confidence: z.enum(["high", "medium", "low", "insufficient"]).nullable(),
          computedAt: z.string().datetime().nullable(),
        }),
      })),
      notes: z.array(z.string()),
    },
  }, async () => {
    try {
      const watches = await getActiveWatchMetrics(db);
      const result = {
        generatedAt: new Date().toISOString(),
        activeWatchCount: watches.length,
        watches,
        notes: [
          "Grey and resell figures are asking-price estimates, not sold-price or transaction data.",
          "Sample size, uncertain sample size, confidence, and freshness should be considered before comparing watches.",
        ],
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch {
      return {
        content: [{ type: "text", text: "CrownTracker could not read its database. Start the local Postgres service or set DATABASE_URL to the reachable CrownTracker database, then try again." }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error("CrownTracker metrics MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("CrownTracker metrics MCP server failed to start", error);
  process.exit(1);
});
