export const UNCERTAIN_LISTING_WEIGHT = 0.5;
export const DAILY_MANUAL_REFRESH_LIMIT = 5;
export const PRICE_STALE_AFTER_HOURS = 48;
export const PRICE_OUTDATED_AFTER_HOURS = 96;
export const ACTIVE_LISTING_WINDOW_DAYS = 14;

export type Confidence = "high" | "medium" | "low" | "insufficient";

export function confidenceFor(sample: number, diversity: number, agreement: number, hasValue = true): Confidence {
  if (!hasValue) return "insufficient";
  const score = sample * 0.4 + diversity * 0.3 + agreement * 0.3;
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export function freshness(at: Date | null | undefined) {
  if (!at) return { label: "Gathering", state: "gathering" as const };
  const hours = (Date.now() - at.getTime()) / 3_600_000;
  if (hours > PRICE_OUTDATED_AFTER_HOURS) return { label: "OUTDATED", state: "outdated" as const };
  if (hours > PRICE_STALE_AFTER_HOURS) return { label: "STALE", state: "stale" as const };
  if (hours < 1) return { label: "Just now", state: "fresh" as const };
  return { label: `${Math.floor(hours)}h ago`, state: "fresh" as const };
}

export function trustBucket(score: number | null) {
  if (score === null) return "Caution";
  if (score >= 80) return "Trusted";
  if (score >= 50) return "Caution";
  return "High risk";
}
