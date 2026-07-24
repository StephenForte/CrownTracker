import type { Scope } from "@/lib/watch-schema";

type ResearchEnvironment = Record<string, string | undefined>;

export const UNCERTAIN_LISTING_WEIGHT = 0.5;
export const DAILY_MANUAL_REFRESH_LIMIT = 5;
export const PRICE_STALE_AFTER_HOURS = 48;
export const PRICE_OUTDATED_AFTER_HOURS = 96;
export const ACTIVE_LISTING_WINDOW_DAYS = 14;
export const MIN_CONFIRMED_LISTINGS_FOR_PRICE = 3;

/**
 * Phase 1B changes the network, provider-cost, and data-quality contract. It
 * must be deliberately enabled as well as fully configured; credentials alone
 * never opt a deployment into it.
 */
export function isPhase1bRequested(env: ResearchEnvironment = process.env) {
  return env.PHASE1B_ENRICHMENT_ENABLED === "true";
}

export function phase1bConfigurationError(env: ResearchEnvironment = process.env) {
  if (!isPhase1bRequested(env)) return null;
  const missing = [
    !env.TAVILY_MONTHLY_CREDIT_CAP && "TAVILY_MONTHLY_CREDIT_CAP",
    !env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
  ].filter(Boolean);
  if (missing.length) return `PHASE1B_ENRICHMENT_ENABLED=true requires ${missing.join(" and ")}.`;
  const cap = Number(env.TAVILY_MONTHLY_CREDIT_CAP);
  return Number.isInteger(cap) && cap > 0 ? null : "TAVILY_MONTHLY_CREDIT_CAP must be a positive integer when Phase 1B is enabled.";
}

export function isPhase1bEnabled(env: ResearchEnvironment = process.env) {
  return isPhase1bRequested(env) && phase1bConfigurationError(env) === null;
}

export function phase1aScopeError(scope: Scope) {
  if (scope.yearMin !== null || scope.yearMax !== null) return "Production-year bounds require Phase 1B enrichment.";
  if (scope.warranty !== "none_ok") return "Warranty requirements require Phase 1B enrichment.";
  return null;
}

export type Confidence = "high" | "medium" | "low" | "insufficient";
export type PriceReliabilityStatus = "verified" | "provisional" | "withheld" | "gathering";

export function priceReliability(value: string | number | null | undefined, confirmed: number, uncertain: number) {
  if (confirmed === 0 && uncertain > 0) return { status: "withheld" as const, eligibleForComparison: false, reason: `No confirmed in-scope listings; ${uncertain} uncertain listing${uncertain === 1 ? "" : "s"} retained for review.` };
  if (confirmed === 0) return { status: "gathering" as const, eligibleForComparison: false, reason: "No usable price estimate yet." };
  if (confirmed < MIN_CONFIRMED_LISTINGS_FOR_PRICE) return { status: "provisional" as const, eligibleForComparison: false, reason: `${confirmed} confirmed listing${confirmed === 1 ? "" : "s"} is below the ${MIN_CONFIRMED_LISTINGS_FOR_PRICE}-listing minimum.` };
  if (uncertain > confirmed) return { status: "provisional" as const, eligibleForComparison: false, reason: `${uncertain} uncertain listings outweigh ${confirmed} confirmed listings.` };
  if (value === null || value === undefined) return { status: "gathering" as const, eligibleForComparison: false, reason: "No usable price estimate yet." };
  return { status: "verified" as const, eligibleForComparison: true, reason: null };
}

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
