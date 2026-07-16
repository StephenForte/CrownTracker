import assert from "node:assert/strict";
import test from "node:test";
import { sentimentLabel, waitlistConfidence, weightedQuantile } from "@/lib/phase2";

test("sentimentLabel returns 'Gathering' for null", () => {
  assert.equal(sentimentLabel(null), "Gathering");
});

test("sentimentLabel returns 'Hyped' for values >= 1.2", () => {
  assert.equal(sentimentLabel(1.2), "Hyped");
  assert.equal(sentimentLabel(1.5), "Hyped");
  assert.equal(sentimentLabel(2.0), "Hyped");
});

test("sentimentLabel returns 'Warm' for values 0.4 to 1.2", () => {
  assert.equal(sentimentLabel(0.4), "Warm");
  assert.equal(sentimentLabel(0.8), "Warm");
  assert.equal(sentimentLabel(1.19), "Warm");
});

test("sentimentLabel returns 'Neutral' for values -0.4 to 0.4", () => {
  assert.equal(sentimentLabel(0), "Neutral");
  assert.equal(sentimentLabel(0.39), "Neutral");
  assert.equal(sentimentLabel(-0.39), "Neutral");
});

test("sentimentLabel returns 'Cooling' for values -1.2 to -0.4", () => {
  assert.equal(sentimentLabel(-0.4), "Cooling");
  assert.equal(sentimentLabel(-0.8), "Cooling");
  assert.equal(sentimentLabel(-1.19), "Cooling");
});

test("sentimentLabel returns 'Very negative' for values < -1.2", () => {
  assert.equal(sentimentLabel(-1.2), "Very negative");
  assert.equal(sentimentLabel(-1.5), "Very negative");
  assert.equal(sentimentLabel(-2.0), "Very negative");
});

test("waitlistConfidence calculates agreement from low/high range", () => {
  const result = waitlistConfidence(0.5, 0.5, 6, 6);
  assert.equal(result.agreement, 1);

  const result2 = waitlistConfidence(0.5, 0.5, 3, 9);
  assert.ok(result2.agreement < 1);
  assert.ok(result2.agreement >= 0);
});

test("waitlistConfidence returns high confidence for strong metrics", () => {
  const result = waitlistConfidence(1, 1, 6, 6);
  assert.equal(result.confidence, "high");
});

test("waitlistConfidence returns medium confidence for moderate metrics", () => {
  const result = waitlistConfidence(0.6, 0.6, 6, 9);
  assert.equal(result.confidence, "medium");
});

test("waitlistConfidence returns low confidence for weak metrics", () => {
  const result = waitlistConfidence(0.1, 0.1, 1, 20);
  assert.equal(result.confidence, "low");
});

test("waitlistConfidence handles zero midpoint gracefully", () => {
  const result = waitlistConfidence(0.5, 0.5, 0, 0);
  assert.equal(result.agreement, 0);
});

test("weightedQuantile returns null for empty array", () => {
  assert.equal(weightedQuantile([], 0.5), null);
});

test("weightedQuantile returns single value for single-element array", () => {
  assert.equal(weightedQuantile([{ value: 10, weight: 1 }], 0.5), 10);
});

test("weightedQuantile respects weights in median calculation", () => {
  const values = [
    { value: 10, weight: 1 },
    { value: 20, weight: 3 },
  ];
  assert.equal(weightedQuantile(values, 0.5), 20);
});

test("weightedQuantile returns correct 25th percentile", () => {
  const values = [
    { value: 10, weight: 1 },
    { value: 20, weight: 1 },
    { value: 30, weight: 1 },
    { value: 40, weight: 1 },
  ];
  assert.equal(weightedQuantile(values, 0.25), 10);
});

test("weightedQuantile returns correct 75th percentile", () => {
  const values = [
    { value: 10, weight: 1 },
    { value: 20, weight: 1 },
    { value: 30, weight: 1 },
    { value: 40, weight: 1 },
  ];
  assert.equal(weightedQuantile(values, 0.75), 30);
});

test("weightedQuantile handles unsorted input", () => {
  const values = [
    { value: 30, weight: 1 },
    { value: 10, weight: 1 },
    { value: 20, weight: 1 },
  ];
  assert.equal(weightedQuantile(values, 0.5), 20);
});

test("weightedQuantile returns last value when accumulated weight never reaches threshold", () => {
  const values = [
    { value: 5, weight: 0.1 },
    { value: 10, weight: 0.1 },
  ];
  assert.equal(weightedQuantile(values, 0.99), 10);
});

test("weightedQuantile handles equal weights correctly", () => {
  const values = [
    { value: 100, weight: 1 },
    { value: 200, weight: 1 },
    { value: 300, weight: 1 },
  ];
  assert.equal(weightedQuantile(values, 0.5), 200);
});
