import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { db } from "@/lib/db";
import { getActiveWatchMetrics } from "@/lib/active-watch-metrics";

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

/** Creates a fresh, stateless server for each Streamable HTTP request. */
export function createMetricsMcpServer() {
  const server = new McpServer({
    name: "crown-tracker-metrics",
    version: "0.1.0",
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
        content: [{ type: "text", text: "CrownTracker could not read its database. Please try again later." }],
        isError: true,
      };
    }
  });

  return server;
}
