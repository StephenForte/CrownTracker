import type { Confidence } from "@/lib/phase1b";

export const CHATTER_STALE_AFTER_HOURS = 168;
export const CHATTER_OUTDATED_AFTER_HOURS = 336;
export const NEWS_MAX_AGE_DAYS = 30;
export const WAITLIST_MIN_ANECDOTES = 3;
export const LINK_CHECK_MAX_PER_RUN = 60;
export const LINK_CHECK_STALE_DAYS = 30;

export function sentimentLabel(value: number | null) {
  if (value === null) return "Gathering";
  if (value >= 1.2) return "Hyped";
  if (value >= 0.4) return "Warm";
  if (value > -0.4) return "Neutral";
  if (value > -1.2) return "Cooling";
  return "Very negative";
}

export function waitlistConfidence(sample: number, diversity: number, low: number, high: number): { confidence: Confidence; agreement: number } {
  const midpoint = (low + high) / 2;
  const agreement = midpoint > 0 ? Math.max(0, 1 - Math.min((high - low) / midpoint, 1)) : 0;
  const score = sample * .4 + diversity * .3 + agreement * .3;
  return { confidence: score >= .7 ? "high" : score >= .4 ? "medium" : "low", agreement };
}

export function weightedQuantile(values: Array<{ value: number; weight: number }>, percentile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let accumulated = 0;
  for (const item of sorted) {
    accumulated += item.weight;
    if (accumulated >= total * percentile) return item.value;
  }
  return sorted.at(-1)?.value ?? null;
}
