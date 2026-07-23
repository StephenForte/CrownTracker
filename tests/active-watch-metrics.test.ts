import assert from "node:assert/strict";
import test from "node:test";
import { getActiveWatchMetrics, mapActiveWatchMetrics } from "@/lib/active-watch-metrics";

test("maps active-watch metrics without claiming missing research exists", () => {
  const computedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const watch = mapActiveWatchMetrics({
    reference_number: "126503-0001",
    model_name: "Rolex Daytona",
    nickname: "Yellow Rolesor / white dial",
    retail_price_usd: "22250.00",
    grey_value: "24100.50",
    grey_n: 5,
    grey_n_uncertain: 1,
    grey_confidence: "medium",
    grey_computed_at: computedAt,
    resell_value: null,
    resell_n: null,
    resell_n_uncertain: null,
    resell_confidence: null,
    resell_computed_at: null,
    availability_value: "6.00",
    availability_label: "medium",
    availability_n: 6,
    availability_confidence: "medium",
    availability_computed_at: computedAt,
  });

  assert.equal(watch.retailPriceUsd, 22250);
  assert.equal(watch.greyAsking.askingPriceUsd, 24100.5);
  assert.equal(watch.greyAsking.sampleSize, 5);
  assert.equal(watch.greyAsking.uncertainSampleSize, 1);
  assert.equal(watch.greyAsking.freshness.state, "fresh");
  assert.deepEqual(watch.resellAsking, {
    askingPriceUsd: null,
    sampleSize: 0,
    uncertainSampleSize: 0,
    confidence: null,
    computedAt: null,
    freshness: { label: "Gathering", state: "gathering" },
  });
});

test("queries active watches only", async () => {
  let query = "";
  const watches = await getActiveWatchMetrics({
    async query(text) {
      query = text;
      return { rows: [] } as never;
    },
  });

  assert.deepEqual(watches, []);
  assert.match(query, /WHERE w\.status = 'active'/);
  assert.match(query, /metric = 'grey_avg'/);
  assert.match(query, /metric = 'resell_avg'/);
});
