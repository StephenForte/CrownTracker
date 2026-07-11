import type { Pool } from "pg";
import type { Watch } from "@/lib/watches";

type Seller = { id: string; name: string; domain: string };
type DiscoveryResult = { url: string; title: string };
type ListingData = {
  title: string;
  priceUsd: number | null;
  currency: string | null;
  condition: string | null;
  productionYear: number | null;
  hasPapers: boolean | null;
  hasBox: boolean | null;
  warranty: string | null;
  sourceData: Record<string, string | number | boolean | null>;
};

const userAgent = "CrownTracker/1.0 market research";
const robotsCache = new Map<string, Promise<string | null>>();

export async function researchWatch(pool: Pool, watch: Watch, runId: string) {
  const sellerResult = await pool.query<Seller>("SELECT id, name, domain FROM sellers WHERE curated = true ORDER BY trust_score DESC");
  const sellers = sellerResult.rows;
  const discovered = await discoverListings(watch, sellers);
  const allowedResults = discovered.filter((result) => sellerForUrl(result.url, sellers)).slice(0, 10);
  let pagesRead = 0;
  let savedListings = 0;

  for (const result of allowedResults) {
    try {
      const seller = sellerForUrl(result.url, sellers);
      if (!seller) continue;
      const html = await fetchAllowedPage(result.url, sellers);
      if (!html) continue;
      pagesRead += 1;
      const listing = extractListing(html, result.title);
      if (!listing) continue;
      const scope = evaluateScope(listing, watch);
      await saveListing(pool, runId, watch.id, seller.id, result.url, listing, scope);
      savedListings += 1;
    } catch (error) {
      console.warn(JSON.stringify({ event: "listing_skipped", watchId: watch.id, url: result.url, error: errorMessage(error) }));
    }
  }

  await createSnapshot(pool, watch.id, runId);
  return { discoveryQueries: 1, pagesRead, savedListings, discovered: discovered.length };
}

async function discoverListings(watch: Watch, sellers: Seller[]): Promise<DiscoveryResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is required for the daily market-research pipeline.");
  const sellerDomains = sellers.map((seller) => seller.domain).join(" OR site:");
  const nickname = watch.nickname ? ` ${watch.nickname}` : "";
  const query = `Rolex ${watch.reference_number}${nickname} for sale (site:${sellerDomains})`;
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 20, include_answer: false }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Tavily discovery failed with HTTP ${response.status}.`);
  const body = await response.json() as { results?: Array<{ url?: string; title?: string }> };
  const unique = new Map<string, DiscoveryResult>();
  for (const result of body.results ?? []) {
    if (!result.url || !isHttpUrl(result.url)) continue;
    unique.set(result.url, { url: result.url, title: result.title?.trim() || "Untitled listing" });
  }
  return [...unique.values()];
}

async function fetchAllowedPage(url: string, sellers: Seller[]) {
  let current = new URL(url);
  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    if (!sellerForUrl(current.href, sellers) || !(await isAllowedByRobots(current))) {
      console.info(JSON.stringify({ event: "listing_skipped_robots_or_domain", url: current.href }));
      return null;
    }
    const response = await fetch(current, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
    return response.text();
  }
  return null;
}

async function isAllowedByRobots(url: URL) {
  const origin = url.origin;
  const robots = robotsCache.get(origin) ?? getRobots(origin);
  robotsCache.set(origin, robots);
  return isPathAllowed(await robots, `${url.pathname}${url.search}`);
}

async function getRobots(origin: string) {
  try {
    const response = await fetch(new URL("/robots.txt", origin), { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return null;
    if (!response.ok) return "User-agent: *\nDisallow: /";
    return response.text();
  } catch {
    // Fail closed when the policy cannot be retrieved; a later run can try again.
    return "User-agent: *\nDisallow: /";
  }
}

function isPathAllowed(robots: string | null, path: string) {
  if (!robots) return true;
  const groups = parseRobots(robots);
  const matching = groups.filter((group) => group.agents.includes("crowntracker") || group.agents.includes("*"));
  const bestRank = Math.max(...matching.map((group) => group.agents.includes("crowntracker") ? 2 : 1), 0);
  const rules = matching.filter((group) => (group.agents.includes("crowntracker") ? 2 : 1) === bestRank).flatMap((group) => group.rules);
  let longestMatch = -1;
  let allowed = true;
  for (const rule of rules) {
    if (!rule.path || !matchesRobotsPath(rule.path, path)) continue;
    if (rule.path.length >= longestMatch) {
      allowed = rule.allow;
      longestMatch = rule.path.length;
    }
  }
  return allowed;
}

function parseRobots(robots: string) {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const match = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!match) continue;
    const directive = match[1].toLowerCase();
    const value = match[2].trim();
    if (directive === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) current.rules.push({ allow: directive === "allow", path: value });
  }
  return groups;
}

function matchesRobotsPath(pattern: string, path: string) {
  const expression = `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\$$/, "$")}`;
  return new RegExp(expression).test(path);
}

function extractListing(html: string, fallbackTitle: string): ListingData | null {
  const products = structuredProducts(html);
  const product = products.find((item) => findOffer(item)) ?? products[0];
  const offer = product ? findOffer(product) : null;
  const rawPrice = offer?.price ?? offer?.lowPrice;
  const price = typeof rawPrice === "number" ? rawPrice : parseNumber(rawPrice);
  const rawCurrency = offer?.priceCurrency ?? offer?.currency;
  const currency = typeof rawCurrency === "string" ? rawCurrency.toUpperCase() : null;
  const priceUsd = currency === "USD" && price && price >= 1000 && price <= 1_000_000 ? price : null;
  if (!offer || !price) return null;
  const title = stringValue(product?.name) || metaContent(html, "og:title") || fallbackTitle;
  const text = `${title} ${htmlToText(html)}`.toLowerCase();
  const productionYear = findYear(title) ?? findYear(text);
  const hasPapers = /\b(with )?(papers|certificate|full set)\b/.test(text) ? true : null;
  const hasBox = /\b(with )?box\b|\bfull set\b/.test(text) ? true : null;
  const condition = /\b(unworn|brand new|new)\b/.test(text) ? "unworn" : /\b(pre[- ]?owned|used)\b/.test(text) ? "pre_owned" : null;
  const warranty = /\b(factory|manufacturer(?:'s)?|rolex) warranty\b/.test(text) ? "factory" : /\bwarranty\b/.test(text) ? "third_party" : null;
  return {
    title,
    priceUsd,
    currency,
    condition,
    productionYear,
    hasPapers,
    hasBox,
    warranty,
    sourceData: { structuredData: true, listedPrice: price, listedCurrency: currency, hasUsdPrice: Boolean(priceUsd) },
  };
}

function structuredProducts(html: string): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectProducts(JSON.parse(match[1]), items); } catch { /* Ignore malformed publisher data. */ }
  }
  return items;
}

function collectProducts(value: unknown, results: Array<Record<string, unknown>>) {
  if (Array.isArray(value)) return value.forEach((item) => collectProducts(item, results));
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const type = item["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) results.push(item);
  if (item["@graph"]) collectProducts(item["@graph"], results);
}

function findOffer(product: Record<string, unknown>) {
  const offers = product.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  return offer && typeof offer === "object" ? offer as Record<string, unknown> : null;
}

function evaluateScope(listing: ListingData, watch: Watch) {
  const reasons: string[] = [];
  if (!listing.priceUsd) reasons.push("Price is not published in USD.");
  if (watch.scope.condition !== "any" && listing.condition !== watch.scope.condition) reasons.push(`Condition is not confirmed as ${watch.scope.condition.replace("_", " ")}.`);
  if (watch.scope.papers === "required" && !listing.hasPapers) reasons.push("Papers are not confirmed.");
  if (watch.scope.box === "required" && !listing.hasBox) reasons.push("Box is not confirmed.");
  if (watch.scope.warranty === "factory_remaining" && listing.warranty !== "factory") reasons.push("Factory warranty is not confirmed.");
  if (watch.scope.warranty === "third_party_ok" && !listing.warranty) reasons.push("Warranty is not confirmed.");
  if (watch.scope.yearMin && (!listing.productionYear || listing.productionYear < watch.scope.yearMin)) reasons.push("Production year is below the selected range or unknown.");
  if (watch.scope.yearMax && (!listing.productionYear || listing.productionYear > watch.scope.yearMax)) reasons.push("Production year is above the selected range or unknown.");
  return { matches: reasons.length === 0, reason: reasons.join(" ") || null };
}

async function saveListing(pool: Pool, runId: string, watchId: string, sellerId: string, sourceUrl: string, listing: ListingData, scope: { matches: boolean; reason: string | null }) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO market_listings (watch_id, seller_id, source_url, title, price_usd, currency, condition, production_year, has_papers, has_box, warranty, scope_match, scope_reason, source_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     ON CONFLICT (watch_id, source_url) DO UPDATE SET seller_id = EXCLUDED.seller_id, title = EXCLUDED.title,
       price_usd = EXCLUDED.price_usd, currency = EXCLUDED.currency, condition = EXCLUDED.condition, production_year = EXCLUDED.production_year,
       has_papers = EXCLUDED.has_papers, has_box = EXCLUDED.has_box, warranty = EXCLUDED.warranty, scope_match = EXCLUDED.scope_match,
       scope_reason = EXCLUDED.scope_reason, source_data = EXCLUDED.source_data, is_active = true, missing_since_at = NULL,
       last_seen_at = now(), updated_at = now() RETURNING id`,
    [watchId, sellerId, sourceUrl, listing.title, listing.priceUsd, listing.currency, listing.condition, listing.productionYear, listing.hasPapers, listing.hasBox, listing.warranty, scope.matches, scope.reason, JSON.stringify(listing.sourceData)],
  );
  if (listing.priceUsd) await pool.query("INSERT INTO listing_price_observations (listing_id, run_id, price_usd) VALUES ($1, $2, $3) ON CONFLICT (listing_id, run_id) DO NOTHING", [result.rows[0].id, runId, listing.priceUsd]);
}

async function createSnapshot(pool: Pool, watchId: string, runId: string) {
  const summary = await pool.query<{ count: number; low: string | null; median: string | null; high: string | null }>(
    `SELECT count(*)::integer AS count, min(price_usd) AS low, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_usd) AS median, max(price_usd) AS high
     FROM market_listings WHERE watch_id = $1 AND is_active = true AND scope_match = true AND price_usd IS NOT NULL
       AND last_seen_at > now() - interval '14 days'`,
    [watchId],
  );
  const row = summary.rows[0];
  await pool.query(
    `INSERT INTO market_snapshots (watch_id, run_id, matched_listing_count, low_price_usd, median_price_usd, high_price_usd)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (watch_id, run_id) DO UPDATE SET matched_listing_count = EXCLUDED.matched_listing_count,
       low_price_usd = EXCLUDED.low_price_usd, median_price_usd = EXCLUDED.median_price_usd, high_price_usd = EXCLUDED.high_price_usd, observed_at = now()`,
    [watchId, runId, row.count, row.low, row.median, row.high],
  );
}

function sellerForUrl(url: string, sellers: Seller[]) {
  const hostname = new URL(url).hostname.toLowerCase();
  return sellers.find((seller) => hostname === seller.domain || hostname.endsWith(`.${seller.domain}`));
}

function htmlToText(html: string) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").slice(0, 100_000); }
function metaContent(html: string, property: string) { return html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)`, "i"))?.[1] ?? null; }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function parseNumber(value: unknown) { const number = Number(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(number) ? number : null; }
function findYear(text: string) { const year = text.match(/\b(?:19|20)\d{2}\b/)?.[0]; return year ? Number(year) : null; }
function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unknown error"; }
