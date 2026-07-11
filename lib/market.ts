import { db } from "@/lib/db";

export type MarketSnapshot = {
  observed_at: Date;
  matched_listing_count: number;
  low_price_usd: string | null;
  median_price_usd: string | null;
  high_price_usd: string | null;
};

export type MarketListing = {
  id: string;
  source_url: string;
  title: string;
  price_usd: string | null;
  condition: string | null;
  production_year: number | null;
  has_papers: boolean | null;
  has_box: boolean | null;
  warranty: string | null;
  last_seen_at: Date;
  seller_name: string | null;
  seller_domain: string | null;
};

export async function getLatestMarketSnapshots(watchIds: string[]) {
  const snapshots = new Map<string, MarketSnapshot>();
  if (!watchIds.length) return snapshots;
  const result = await db.query<MarketSnapshot & { watch_id: string }>(
    `SELECT DISTINCT ON (watch_id) watch_id, observed_at, matched_listing_count, low_price_usd, median_price_usd, high_price_usd
     FROM market_snapshots WHERE watch_id = ANY($1::uuid[]) ORDER BY watch_id, observed_at DESC`,
    [watchIds],
  );
  for (const snapshot of result.rows) snapshots.set(snapshot.watch_id, snapshot);
  return snapshots;
}

export async function getMarketDetails(watchId: string) {
  const [snapshots, listings] = await Promise.all([
    db.query<MarketSnapshot>(
      `SELECT observed_at, matched_listing_count, low_price_usd, median_price_usd, high_price_usd
       FROM market_snapshots WHERE watch_id = $1 ORDER BY observed_at DESC LIMIT 8`,
      [watchId],
    ),
    db.query<MarketListing>(
      `SELECT l.id, l.source_url, l.title, l.price_usd, l.condition, l.production_year, l.has_papers, l.has_box, l.warranty,
              l.last_seen_at, s.name AS seller_name, s.domain AS seller_domain
       FROM market_listings l LEFT JOIN sellers s ON s.id = l.seller_id
       WHERE l.watch_id = $1 AND l.is_active = true AND l.scope_match = true AND l.price_usd IS NOT NULL
         AND l.last_seen_at > now() - interval '14 days'
       ORDER BY l.price_usd ASC, l.last_seen_at DESC LIMIT 25`,
      [watchId],
    ),
  ]);
  return { snapshots: snapshots.rows, listings: listings.rows };
}
