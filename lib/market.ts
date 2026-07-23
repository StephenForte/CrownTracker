import { db } from "@/lib/db";
import { ACTIVE_LISTING_WINDOW_DAYS } from "@/lib/phase1b";

export type MetricSnapshot = {
  id: string; metric: "grey_avg" | "resell_avg" | "availability" | "waitlist" | "sentiment"; value: string | null; value_low: string | null; value_high: string | null;
  label: string | null; n: number; n_uncertain: number; outliers_dropped: number; conf_sample: number; conf_diversity: number; conf_agreement: number;
  confidence: "high" | "medium" | "low" | "insufficient"; provenance: "live" | "backfill" | "carried_forward"; computed_at: Date;
};
export type MarketListing = {
  id: string; source_url: string; detail_url: string | null; title: string; price_usd: string | null; price_original: string | null; currency: string | null;
  condition: string | null; scope_match_class: "in_scope" | "out_of_scope" | "uncertain"; scope_reason: string | null; anomaly_flags: string[];
  last_seen_at: Date; seller_name: string | null; seller_domain: string | null; seller_platform: string | null; seller_jurisdiction: string | null; trust_score: number | null; trust_rationale: string | null; curated: boolean | null;
};
export type Evidence = { id: string; url: string; domain: string; quote: string; retrieved_at: Date; link_status: "reachable" | "offline" | "unreachable" | "blocked_by_robots" | "invalid" | null; link_checked_at: Date | null };
export type MovingAverage = { value: string | null; weeks: number; hasFullYear: boolean; backfillCount: number };
export type CommunityAnecdote = { id: string; source_url: string; domain: string; quote: string; reported_at: Date | null; wait_months: string | null; region: string | null; purchase_context: string | null; retrieved_at: Date };
export type NewsItem = { id: string; source_url: string; domain: string; title: string; summary: string; quote: string; published_at: Date | null; retrieved_at: Date };
export type ScopeChange = { id: string; changed_at: Date; old_scope: Record<string, unknown>; new_scope: Record<string, unknown> };
export type SourceCoverage = { domain: string; curated: boolean; active_listings: number; watches_observed: number; last_seen_at: Date | null; evidence_items: number; last_link_status: Evidence["link_status"]; last_link_checked_at: Date | null };

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

export async function getSevenDayMovers(watchIds: string[]) {
  const movers = new Map<string, number>();
  if (!watchIds.length) return movers;
  const result = await db.query<{ watch_id: string; current: string | null; prior: string | null }>(
    `WITH ranked AS (
       SELECT watch_id, value, computed_at,
         row_number() OVER (PARTITION BY watch_id ORDER BY computed_at DESC) AS newest,
         row_number() OVER (PARTITION BY watch_id ORDER BY computed_at ASC) AS oldest
       FROM metric_snapshots
       WHERE watch_id = ANY($1::uuid[]) AND metric = 'resell_avg' AND value IS NOT NULL AND computed_at >= now() - interval '7 days'
     ) SELECT watch_id, max(value) FILTER (WHERE newest = 1) AS current, max(value) FILTER (WHERE oldest = 1) AS prior FROM ranked GROUP BY watch_id`, [watchIds],
  );
  for (const row of result.rows) if (row.current && row.prior && Number(row.prior) !== 0) movers.set(row.watch_id, (Number(row.current) - Number(row.prior)) / Number(row.prior));
  return movers;
}

export async function getMarketDetails(watchId: string) {
  const [metrics, listings, movingAverages, anecdotes, news, scopeChanges, chatterRun] = await Promise.all([
    db.query<MetricSnapshot>(`SELECT * FROM metric_snapshots WHERE watch_id = $1 ORDER BY computed_at DESC LIMIT 40`, [watchId]),
    db.query<MarketListing>(
      `SELECT l.id, l.source_url, l.detail_url, l.title, l.price_usd, l.price_original, l.currency, l.condition, l.scope_match_class, l.scope_reason, l.anomaly_flags, l.last_seen_at,
              s.name AS seller_name, s.domain AS seller_domain, s.platform AS seller_platform, s.jurisdiction AS seller_jurisdiction, s.trust_score, s.trust_rationale, s.curated
       FROM market_listings l LEFT JOIN sellers s ON s.id = l.seller_id
       WHERE l.watch_id = $1 AND l.is_active = true AND l.scope_match_class IN ('in_scope', 'uncertain') AND l.price_usd IS NOT NULL
         AND l.last_seen_at > now() - ($2 || ' days')::interval
       ORDER BY s.trust_score DESC NULLS LAST, l.price_usd ASC, l.last_seen_at DESC LIMIT 40`, [watchId, ACTIVE_LISTING_WINDOW_DAYS],
    ),
    getMovingAverages(watchId),
    db.query<CommunityAnecdote>("SELECT * FROM community_anecdotes WHERE watch_id = $1 ORDER BY reported_at DESC NULLS LAST, retrieved_at DESC LIMIT 20", [watchId]),
    db.query<NewsItem>("SELECT DISTINCT ON (source_url) * FROM news_items WHERE watch_id = $1 AND retrieved_at >= now() - ($2 || ' days')::interval ORDER BY source_url, retrieved_at DESC LIMIT 5", [watchId, NEWS_WINDOW_DAYS]),
    db.query<ScopeChange>("SELECT * FROM scope_changes WHERE watch_id = $1 ORDER BY changed_at DESC LIMIT 12", [watchId]),
    db.query<{ completed: boolean }>("SELECT EXISTS(SELECT 1 FROM runs WHERE watch_id = $1 AND job_type = 'chatter_scan' AND status = 'succeeded') AS completed", [watchId]),
  ]);
  const latest = new Map<MetricSnapshot["metric"], MetricSnapshot>();
  for (const metric of metrics.rows) if (!latest.has(metric.metric)) latest.set(metric.metric, metric);
  const snapshotIds = metrics.rows.map((metric) => metric.id);
  const evidence = snapshotIds.length ? await db.query<Evidence & { attached_id: string }>(
    `SELECT e.id, e.attached_id, e.url, e.domain, e.quote, e.retrieved_at, c.status AS link_status, c.checked_at AS link_checked_at
     FROM evidence e
     LEFT JOIN LATERAL (
       SELECT status, checked_at FROM link_checks WHERE url = e.url ORDER BY checked_at DESC LIMIT 1
     ) c ON true
     WHERE e.attached_to = 'snapshot' AND e.attached_id = ANY($1::uuid[])
     ORDER BY e.retrieved_at DESC`, [snapshotIds],
  ) : { rows: [] as Array<Evidence & { attached_id: string }> };
  const evidenceBySnapshot = new Map<string, Evidence[]>();
  for (const item of evidence.rows) evidenceBySnapshot.set(item.attached_id, [...(evidenceBySnapshot.get(item.attached_id) ?? []), item]);
  return { latest, metrics: metrics.rows, listings: listings.rows, movingAverages, evidenceBySnapshot, anecdotes: anecdotes.rows, news: news.rows, scopeChanges: scopeChanges.rows, hasCompletedChatterRun: chatterRun.rows[0]?.completed ?? false };
}

/**
 * A transparent observed-coverage report: it describes what the pipeline has
 * actually retained, rather than claiming a source was crawled successfully.
 * Failed page fetches remain visible in runs; this report avoids guessing why
 * a domain has no observations.
 */
export async function getSourceCoverageReport() {
  const result = await db.query<SourceCoverage>(
    `WITH listing_coverage AS (
       SELECT COALESCE(s.domain, lower(split_part(regexp_replace(l.source_url, '^https?://', ''), '/', 1))) AS domain,
         COALESCE(bool_or(s.curated), false) AS curated, count(*) FILTER (WHERE l.last_seen_at >= now() - interval '30 days')::int AS active_listings,
         count(DISTINCT l.watch_id) FILTER (WHERE l.last_seen_at >= now() - interval '30 days')::int AS watches_observed,
         max(l.last_seen_at) AS last_seen_at
       FROM market_listings l LEFT JOIN sellers s ON s.id = l.seller_id
       GROUP BY 1
     ), evidence_coverage AS (
       SELECT e.domain, count(*) FILTER (WHERE e.retrieved_at >= now() - interval '30 days')::int AS evidence_items,
         (array_agg(c.status ORDER BY c.checked_at DESC NULLS LAST))[1] AS last_link_status,
         max(c.checked_at) AS last_link_checked_at
       FROM evidence e LEFT JOIN LATERAL (
         SELECT status, checked_at FROM link_checks WHERE url = e.url ORDER BY checked_at DESC LIMIT 1
       ) c ON true WHERE e.retrieved_at >= now() - interval '30 days' GROUP BY e.domain
     ), domains AS (
       SELECT domain FROM listing_coverage UNION SELECT domain FROM evidence_coverage UNION SELECT domain FROM sellers WHERE curated = true
     ) SELECT d.domain, COALESCE(l.curated, s.curated, false) AS curated, COALESCE(l.active_listings, 0) AS active_listings,
       COALESCE(l.watches_observed, 0) AS watches_observed, l.last_seen_at, COALESCE(e.evidence_items, 0) AS evidence_items,
       e.last_link_status, e.last_link_checked_at
       FROM domains d LEFT JOIN listing_coverage l ON l.domain = d.domain LEFT JOIN evidence_coverage e ON e.domain = d.domain
       LEFT JOIN sellers s ON s.domain = d.domain ORDER BY l.last_seen_at DESC NULLS LAST, d.domain`,
  );
  return result.rows;
}

const NEWS_WINDOW_DAYS = 30;

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
