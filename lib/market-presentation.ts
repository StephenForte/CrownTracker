import { MIN_CONFIRMED_LISTINGS_FOR_PRICE, priceReliability, type Confidence, type PriceReliabilityStatus } from "@/lib/phase1b";

type PriceInput = {
  value: string | number | null | undefined;
  confirmed: number;
  uncertain: number;
  confidence?: Confidence | null;
};

export type PricePresentation = {
  headline: string;
  detail: string;
  status: PriceReliabilityStatus;
  eligibleForComparison: boolean;
};

function money(value: string | number) {
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function sampleLabel(confirmed: number, uncertain: number, confidence?: Confidence | null) {
  return `${confirmed} confirmed${uncertain ? ` + ${uncertain} uncertain` : ""} · ${confidence ?? "insufficient"} confidence`;
}

/**
 * Gives an early read useful context without treating it as a market conclusion.
 */
export function presentPriceMetric({ value, confirmed, uncertain, confidence }: PriceInput): PricePresentation {
  const reliability = priceReliability(value, confirmed, uncertain);
  if (reliability.eligibleForComparison && value !== null && value !== undefined) {
    return { headline: money(value), detail: sampleLabel(confirmed, uncertain, confidence), ...reliability };
  }
  if (reliability.status === "withheld") {
    return { headline: "Unverified ask", detail: `${sampleLabel(confirmed, uncertain, confidence)} · shown in evidence`, ...reliability };
  }
  if (reliability.status === "provisional") {
    const coverage = confirmed < MIN_CONFIRMED_LISTINGS_FOR_PRICE
      ? `${MIN_CONFIRMED_LISTINGS_FOR_PRICE - confirmed} more confirmed needed`
      : "uncertainty outweighs matches";
    return { headline: value === null || value === undefined ? "Early read" : `~${money(value)}`, detail: `Indicative · ${sampleLabel(confirmed, uncertain, confidence)} · ${coverage}`, ...reliability };
  }
  return { headline: "Gathering", detail: confirmed ? `${sampleLabel(confirmed, uncertain, confidence)} · no usable estimate yet` : "Searching for in-scope listings", ...reliability };
}

export function presentObservedSupply(level: string | null | undefined, sampleSize: number | null | undefined, confidence?: Confidence | null) {
  if (sampleSize === null || sampleSize === undefined) return { headline: "Gathering", detail: "Calculated after the first price scan." };
  if (sampleSize === 0) return { headline: "No current observed listings", detail: `No in-scope listing rows in the latest scan · ${confidence ?? "insufficient"} confidence · needs coverage` };
  return { headline: `${level ?? "Observed"} supply`, detail: `${sampleSize} in-scope listing${sampleSize === 1 ? "" : "s"} observed · ${confidence ?? "insufficient"} confidence` };
}
