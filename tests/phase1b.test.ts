import assert from "node:assert/strict";
import test from "node:test";
import {
  confidenceFor,
  freshness,
  trustBucket,
  PRICE_STALE_AFTER_HOURS,
  PRICE_OUTDATED_AFTER_HOURS,
} from "@/lib/phase1b";

test("confidenceFor returns 'insufficient' when hasValue is false", () => {
  assert.equal(confidenceFor(1, 1, 1, false), "insufficient");
  assert.equal(confidenceFor(0.9, 0.9, 0.9, false), "insufficient");
});

test("confidenceFor returns 'high' for strong metrics", () => {
  assert.equal(confidenceFor(1, 1, 1, true), "high");
  assert.equal(confidenceFor(0.8, 0.8, 0.8, true), "high");
});

test("confidenceFor returns 'medium' for moderate metrics", () => {
  assert.equal(confidenceFor(0.5, 0.5, 0.5, true), "medium");
  assert.equal(confidenceFor(0.6, 0.4, 0.4, true), "medium");
});

test("confidenceFor returns 'low' for weak metrics", () => {
  assert.equal(confidenceFor(0.1, 0.1, 0.1, true), "low");
  assert.equal(confidenceFor(0.2, 0.2, 0.2, true), "low");
  assert.equal(confidenceFor(0, 0, 0, true), "low");
});

test("confidenceFor uses weighted formula (0.4 sample, 0.3 diversity, 0.3 agreement)", () => {
  const sample = 1.0, diversity = 0.5, agreement = 0.5;
  const score = sample * 0.4 + diversity * 0.3 + agreement * 0.3;
  assert.ok(Math.abs(score - 0.7) < 0.001, "Score should be approximately 0.7");
  assert.equal(confidenceFor(sample, diversity, agreement, true), "high");

  const sample2 = 0.5, diversity2 = 0.5, agreement2 = 0.2;
  const score2 = sample2 * 0.4 + diversity2 * 0.3 + agreement2 * 0.3;
  assert.ok(score2 >= 0.4 && score2 < 0.7, "Score should be in medium range");
  assert.equal(confidenceFor(sample2, diversity2, agreement2, true), "medium");
});

test("freshness returns 'Gathering' for null/undefined dates", () => {
  assert.deepEqual(freshness(null), { label: "Gathering", state: "gathering" });
  assert.deepEqual(freshness(undefined), { label: "Gathering", state: "gathering" });
});

test("freshness returns 'Just now' for dates less than 1 hour ago", () => {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  assert.deepEqual(freshness(thirtyMinutesAgo), { label: "Just now", state: "fresh" });
});

test("freshness returns hours ago for fresh data within stale threshold", () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

  const result10h = freshness(hoursAgo(10));
  assert.equal(result10h.label, "10h ago");
  assert.equal(result10h.state, "fresh");

  const result24h = freshness(hoursAgo(24));
  assert.equal(result24h.label, "24h ago");
  assert.equal(result24h.state, "fresh");
});

test("freshness returns 'STALE' for data older than stale threshold but not outdated", () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

  const result = freshness(hoursAgo(PRICE_STALE_AFTER_HOURS + 1));
  assert.equal(result.label, "STALE");
  assert.equal(result.state, "stale");
});

test("freshness returns 'OUTDATED' for data older than outdated threshold", () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

  const result = freshness(hoursAgo(PRICE_OUTDATED_AFTER_HOURS + 1));
  assert.equal(result.label, "OUTDATED");
  assert.equal(result.state, "outdated");
});

test("trustBucket returns 'Caution' for null scores", () => {
  assert.equal(trustBucket(null), "Caution");
});

test("trustBucket returns 'Trusted' for scores >= 80", () => {
  assert.equal(trustBucket(80), "Trusted");
  assert.equal(trustBucket(90), "Trusted");
  assert.equal(trustBucket(100), "Trusted");
});

test("trustBucket returns 'Caution' for scores 50-79", () => {
  assert.equal(trustBucket(50), "Caution");
  assert.equal(trustBucket(65), "Caution");
  assert.equal(trustBucket(79), "Caution");
});

test("trustBucket returns 'High risk' for scores < 50", () => {
  assert.equal(trustBucket(0), "High risk");
  assert.equal(trustBucket(25), "High risk");
  assert.equal(trustBucket(49), "High risk");
});
