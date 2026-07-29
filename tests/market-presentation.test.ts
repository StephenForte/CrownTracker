import assert from "node:assert/strict";
import test from "node:test";
import { presentObservedSupply, presentPriceMetric } from "@/lib/market-presentation";

test("price presentation promotes only comparison-ready estimates", () => {
  assert.deepEqual(presentPriceMetric({ value: "15295", confirmed: 6, uncertain: 0 }), {
    headline: "$15,295",
    detail: "6 confirmed · insufficient confidence · comparison-ready",
    status: "verified",
    eligibleForComparison: true,
    reason: null,
  });
});

test("price presentation hides provisional and withheld dollar headlines", () => {
  assert.equal(presentPriceMetric({ value: "13595", confirmed: 1, uncertain: 4 }).headline, "Evidence only");
  assert.equal(presentPriceMetric({ value: "279950", confirmed: 0, uncertain: 1 }).headline, "No comparable price");
  assert.equal(presentPriceMetric({ value: null, confirmed: 0, uncertain: 0 }).detail, "No confirmed listings yet · needs coverage");
});

test("observed supply distinguishes no listings from an unrun scan", () => {
  assert.equal(presentObservedSupply("Low", 0).headline, "No current observed listings");
  assert.equal(presentObservedSupply(null, null).headline, "Gathering");
});
