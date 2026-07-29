import assert from "node:assert/strict";
import test from "node:test";
import { presentObservedSupply, presentPriceMetric } from "@/lib/market-presentation";

test("price presentation gives comparison-ready estimates a normal headline", () => {
  assert.deepEqual(presentPriceMetric({ value: "15295", confirmed: 6, uncertain: 0 }), {
    headline: "$15,295",
    detail: "6 confirmed · insufficient confidence",
    status: "verified",
    eligibleForComparison: true,
    reason: null,
  });
});

test("price presentation shows an indicative provisional read but keeps withheld prices out of headlines", () => {
  assert.equal(presentPriceMetric({ value: "13595", confirmed: 1, uncertain: 4 }).headline, "~$13,595");
  assert.equal(presentPriceMetric({ value: "279950", confirmed: 0, uncertain: 1 }).headline, "Unverified ask");
  assert.equal(presentPriceMetric({ value: null, confirmed: 0, uncertain: 0 }).detail, "Searching for in-scope listings");
});

test("observed supply distinguishes no listings from an unrun scan", () => {
  assert.equal(presentObservedSupply("Low", 0).headline, "No current observed listings");
  assert.equal(presentObservedSupply(null, null).headline, "Gathering");
});
