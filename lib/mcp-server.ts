import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { db } from "@/lib/db";
import { getActiveWatchMetrics, type DatabaseReader } from "@/lib/active-watch-metrics";

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
  reliabilityStatus: z.enum(["verified", "provisional", "withheld", "gathering"]),
  eligibleForComparison: z.boolean(),
  withholdReason: z.string().nullable(),
});

/** Creates a fresh, stateless server for each Streamable HTTP or stdio session. */
export function createMetricsMcpServer(reader: DatabaseReader = db) {
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
      reportingGuidance: z.array(z.string()),
    },
  }, async () => {
    try {
      const watches = await getActiveWatchMetrics(reader);
      const result = {
        generatedAt: new Date().toISOString(),
        activeWatchCount: watches.length,
        watches,
        notes: [
          "Grey and resell figures are asking-price estimates, not sold-price or transaction data.",
          "Compare a price only when eligibleForComparison is true. Provisional and withheld readings may include an indicative askingPriceUsd from confirmed plus half-weighted uncertain listings, but must not be used for retail-premium or discount claims.",
        ],
        reportingGuidance: [
          "Present provisional readings as an indicative approximate asking price with confirmed and uncertain counts. Do not use them for a retail premium, discount, alert, mover, or comparison claim.",
          "Render withheld readings as Unverified ask with the retained uncertain-listing count. The raw askingPriceUsd is evidence, not a market conclusion.",
          "For a fresh snapshot with zero or thin listings, say Needs coverage, not Needs refresh. Describe availability as observed supply so zero listings does not claim the market is definitively scarce.",
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
