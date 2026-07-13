import { db } from "@/lib/db";
import { ACTIVE_LISTING_WINDOW_DAYS } from "@/lib/phase1b";

export type MetricSnapshot = {
  id: string; metric: "grey_avg" | "resell_avg" | "availability"; value: string | null; value_low: string | null; value_high: string | null;
  label: string | null; n: number; n_uncertain: number; outliers_dropped: number; conf_sample: number; conf_diversity: number; conf_agreement: number;
  confidence: "high" | "medium" | "low" | "insufficient"; provenance: "live" | "backfill" | "carried_forward"; computed_at: Date;
};
export type MarketListing = {
  id: string; source_url: string; detail_url: string | null; title: string; price_usd: string | null; price_original: string | null; currency: string | null;
  condition: string | null; scope_match_class: "in_scope" | "out_of_scope" | "uncertain"; scope_reason: string | null; anomaly_flags: string[];
  last_seen_at: Date; seller_name: string | null; seller_domain: string | null; seller_platform: string | null; seller_jurisdiction: string | null; trust_score: number | null; curated: boolean | null;
};
export type Evidence = { id: string; url: string; domain: string; quote: string; retrieved_at: Date };
export type MovingAverage = { value: string | null; weeks: number; hasFullYear: boolean; backfillCount: number };

export async function getLatestMetrics(watchIds: string[]) {
  const metrics = new Map<string, Map<MetricSnapshot["metric"], MetricSnapshot>>();
  if (!watchIds.length) return metrics;
  const result = await db.query<MetricSnapshot & { watch_id: string }>(
    `SELECT DISTINCT ON (watch_id, metric) * FROM metric_snapshots WHERE watch_id = ANY($1::uuid[])
     ORDER BY watch_id, metric, computed_at DESC`, [watchIds],
  );
  for (const row of result.rows) {
    const byMetric = metrics.get(row.watch_id) ?? new Map<MetricSnapshot["metric"], MetricSnapshot>();
    byMetric.set(row.metric, row); metrics.set(row.watch_id, byMetric);
  }
  return metrics;
}

export async function getMarketDetails(watchId: string) {
  const [metrics, listings, movingAverages] = await Promise.all([
    db.query<MetricSnapshot>(`SELECT * FROM metric_snapshots WHERE watch_id = $1 ORDER BY computed_at DESC LIMIT 40`, [watchId]),
    db.query<MarketListing>(
      `SELECT l.id, l.source_url, l.detail_url, l.title, l.price_usd, l.price_original, l.currency, l.condition, l.scope_match_class, l.scope_reason, l.anomaly_flags, l.last_seen_at,
              s.name AS seller_name, s.domain AS seller_domain, s.platform AS seller_platform, s.jurisdiction AS seller_jurisdiction, s.trust_score, s.curated
       FROM market_listings l LEFT JOIN sellers s ON s.id = l.seller_id
       WHERE l.watch_id = $1 AND l.is_active = true AND l.scope_match_class IN ('in_scope', 'uncertain') AND l.price_usd IS NOT NULL
         AND l.last_seen_at > now() - ($2 || ' days')::interval
       ORDER BY s.trust_score DESC NULLS LAST, l.price_usd ASC, l.last_seen_at DESC LIMIT 40`, [watchId, ACTIVE_LISTING_WINDOW_DAYS],
    ),
    getMovingAverages(watchId),
  ]);
  const latest = new Map<MetricSnapshot["metric"], MetricSnapshot>();
  for (const metric of metrics.rows) if (!latest.has(metric.metric)) latest.set(metric.metric, metric);
  const snapshotIds = metrics.rows.map((metric) => metric.id);
  const evidence = snapshotIds.length ? await db.query<Evidence & { attached_id: string }>("SELECT id, attached_id, url, domain, quote, retrieved_at FROM evidence WHERE attached_to = 'snapshot' AND attached_id = ANY($1::uuid[]) ORDER BY retrieved_at DESC", [snapshotIds]) : { rows: [] as Array<Evidence & { attached_id: string }> };
  const evidenceBySnapshot = new Map<string, Evidence[]>();
  for (const item of evidence.rows) evidenceBySnapshot.set(item.attached_id, [...(evidenceBySnapshot.get(item.attached_id) ?? []), item]);
  return { latest, metrics: metrics.rows, listings: listings.rows, movingAverages, evidenceBySnapshot };
}

async function getMovingAverages(watchId: string) {
  const result = await db.query<{ metric: "grey_avg" | "resell_avg"; value: string | null; first_at: Date | null; points: string; backfill_count: string }>(
    `WITH daily AS (
       SELECT DISTINCT ON (metric, date_trunc('day', computed_at)) metric, value, provenance, computed_at
       FROM metric_snapshots
       WHERE watch_id = $1 AND metric IN ('grey_avg','resell_avg') AND value IS NOT NULL AND computed_at >= now() - interval '365 days'
       ORDER BY metric, date_trunc('day', computed_at), computed_at DESC
     ) SELECT metric, avg(value) AS value, min(computed_at) AS first_at, count(*) AS points,
       count(*) FILTER (WHERE provenance = 'backfill') AS backfill_count FROM daily GROUP BY metric`, [watchId],
  );
  const output = new Map<"grey_avg" | "resell_avg", MovingAverage>();
  for (const row of result.rows) {
    const weeks = row.first_at ? Math.min(52, Math.max(1, Math.ceil((Date.now() - row.first_at.getTime()) / (7 * 86_400_000)))) : 0;
    output.set(row.metric, { value: row.value, weeks, hasFullYear: weeks >= 52, backfillCount: Number(row.backfill_count) });
  }
  return output;
}
