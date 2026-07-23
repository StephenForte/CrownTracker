import type { QueryResult, QueryResultRow } from "pg";
import { freshness, type Confidence } from "@/lib/phase1b";

export type DatabaseReader = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

type ActiveWatchMetricsRow = {
  reference_number: string;
  model_name: string;
  nickname: string | null;
  retail_price_usd: string | null;
  grey_value: string | null;
  grey_n: number | null;
  grey_n_uncertain: number | null;
  grey_confidence: Confidence | null;
  grey_computed_at: Date | null;
  resell_value: string | null;
  resell_n: number | null;
  resell_n_uncertain: number | null;
  resell_confidence: Confidence | null;
  resell_computed_at: Date | null;
  availability_value: string | null;
  availability_label: string | null;
  availability_n: number | null;
  availability_confidence: Confidence | null;
  availability_computed_at: Date | null;
};

export type ActiveWatchMetrics = {
  referenceNumber: string;
  modelName: string;
  nickname: string | null;
  retailPriceUsd: number | null;
  greyAsking: PriceMetric;
  resellAsking: PriceMetric;
  availability: AvailabilityMetric;
};

export type PriceMetric = {
  askingPriceUsd: number | null;
  sampleSize: number;
  uncertainSampleSize: number;
  confidence: Confidence | null;
  computedAt: string | null;
  freshness: ReturnType<typeof freshness>;
};

export type AvailabilityMetric = {
  level: string | null;
  observedListings: number | null;
  sampleSize: number;
  confidence: Confidence | null;
  computedAt: string | null;
};

const activeWatchMetricsQuery = `
  SELECT w.reference_number, w.model_name, w.nickname, w.retail_price_usd,
    grey.value AS grey_value, grey.n AS grey_n, grey.n_uncertain AS grey_n_uncertain,
    grey.confidence AS grey_confidence, grey.computed_at AS grey_computed_at,
    resell.value AS resell_value, resell.n AS resell_n, resell.n_uncertain AS resell_n_uncertain,
    resell.confidence AS resell_confidence, resell.computed_at AS resell_computed_at,
    availability.value AS availability_value, availability.label AS availability_label,
    availability.n AS availability_n, availability.confidence AS availability_confidence,
    availability.computed_at AS availability_computed_at
  FROM watches w
  LEFT JOIN LATERAL (
    SELECT value, n, n_uncertain, confidence, computed_at
    FROM metric_snapshots
    WHERE watch_id = w.id AND metric = 'grey_avg'
    ORDER BY computed_at DESC
    LIMIT 1
  ) grey ON true
  LEFT JOIN LATERAL (
    SELECT value, n, n_uncertain, confidence, computed_at
    FROM metric_snapshots
    WHERE watch_id = w.id AND metric = 'resell_avg'
    ORDER BY computed_at DESC
    LIMIT 1
  ) resell ON true
  LEFT JOIN LATERAL (
    SELECT value, label, n, confidence, computed_at
    FROM metric_snapshots
    WHERE watch_id = w.id AND metric = 'availability'
    ORDER BY computed_at DESC
    LIMIT 1
  ) availability ON true
  WHERE w.status = 'active'
  ORDER BY w.created_at DESC
`;

function numberOrNull(value: string | null) {
  return value === null ? null : Number(value);
}

function isoOrNull(value: Date | null) {
  return value?.toISOString() ?? null;
}

function priceMetric(value: string | null, n: number | null, nUncertain: number | null, confidence: Confidence | null, computedAt: Date | null): PriceMetric {
  return {
    askingPriceUsd: numberOrNull(value),
    sampleSize: n ?? 0,
    uncertainSampleSize: nUncertain ?? 0,
    confidence,
    computedAt: isoOrNull(computedAt),
    freshness: freshness(computedAt),
  };
}

export function mapActiveWatchMetrics(row: ActiveWatchMetricsRow): ActiveWatchMetrics {
  return {
    referenceNumber: row.reference_number,
    modelName: row.model_name,
    nickname: row.nickname,
    retailPriceUsd: numberOrNull(row.retail_price_usd),
    greyAsking: priceMetric(row.grey_value, row.grey_n, row.grey_n_uncertain, row.grey_confidence, row.grey_computed_at),
    resellAsking: priceMetric(row.resell_value, row.resell_n, row.resell_n_uncertain, row.resell_confidence, row.resell_computed_at),
    availability: {
      level: row.availability_label,
      observedListings: numberOrNull(row.availability_value),
      sampleSize: row.availability_n ?? 0,
      confidence: row.availability_confidence,
      computedAt: isoOrNull(row.availability_computed_at),
    },
  };
}

/** Read-only dashboard equivalent for an MCP client. It never starts research. */
export async function getActiveWatchMetrics(reader: DatabaseReader): Promise<ActiveWatchMetrics[]> {
  const result = await reader.query<ActiveWatchMetricsRow>(activeWatchMetricsQuery);
  return result.rows.map(mapActiveWatchMetrics);
}
