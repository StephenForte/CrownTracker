import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Watch } from "@/lib/watches";
import { ACTIVE_LISTING_WINDOW_DAYS, UNCERTAIN_LISTING_WEIGHT, confidenceFor, isPhase1bEnabled, phase1bConfigurationError } from "@/lib/phase1b";

type Seller = { id: string; name: string; domain: string };
type DiscoveryResult = { url: string; title: string };
type ScopeClass = "in_scope" | "out_of_scope" | "uncertain";
type ListingCandidate = {
  title: string; sourceUrl: string; detailUrl: string | null; stableSku: string | null;
  priceOriginal: number; currency: string; condition: string | null; productionYear: number | null;
  hasPapers: boolean | null; hasBox: boolean | null; warranty: string | null; groundingSnippet: string;
};
type StoredListing = ListingCandidate & { priceUsd: number; fxRate: number; scope: { match: ScopeClass; reason: string | null; weight: number } };
type Discovery = { results: DiscoveryResult[]; queryCount: number; usedBaseReferenceFallback: boolean };

const userAgent = "CrownTracker/1.1 market research (+personal dashboard)";
const robotsCache = new Map<string, Promise<string | null>>();
const lastRequestByDomain = new Map<string, number>();
const requestIntervalMs = 5_000;

export async function researchWatch(pool: Pool, watch: Watch, runId: string) {
  const configurationError = phase1bConfigurationError();
  if (configurationError) throw new Error(configurationError);
  const phase1b = isPhase1bEnabled();
  // Preserve legacy scope in storage, but do not enforce attributes that Phase
  // 1A cannot ground at listing level.
  const effectiveWatch = phase1b ? watch : { ...watch, scope: { ...watch.scope, yearMin: null, yearMax: null, warranty: "none_ok" as const } };
  const sellers = (await pool.query<Seller>("SELECT id, name, domain FROM sellers WHERE curated = true ORDER BY trust_score DESC")).rows;
  const discovery = await discoverListings(pool, watch, sellers, phase1b);
  const allowedResults = discovery.results.filter((result) => sellerForUrl(result.url, sellers)).slice(0, phase1b ? 32 : 10);
  const fxRates = phase1b ? await getUsdRates() : { USD: 1 };
  let pagesRead = 0, savedListings = 0, scopeMatchedListings = 0, groundingDrops = 0;
  const scopeExclusions = new Map<string, number>();

  for (const result of allowedResults) {
    try {
      const seller = sellerForUrl(result.url, sellers);
      if (!seller) continue;
      const html = await fetchAllowedPage(result.url, sellers);
      if (!html) continue;
      pagesRead += 1;
      let candidates = extractListingRows(html, result.url, result.title, { allowLoosePage: phase1b, extractScopeAttributes: phase1b });
      // Haiku adds row-level classification hints, but every retained value still
      // has to be grounded in the row/detail text below.
      if (phase1b) candidates = await enrichRowsWithClaude(candidates, html);
      for (const candidate of candidates) {
        const detail = phase1b && needsDetailEnrichment(candidate, watch) && candidate.detailUrl && canonicalUrl(candidate.detailUrl) !== canonicalUrl(result.url)
          ? await fetchDetail(candidate.detailUrl, sellers)
          : null;
        const enriched = detail ? mergeDetail(candidate, detail.html, detail.url) : candidate;
        if (!isPriceGrounded(enriched)) { groundingDrops += 1; continue; }
        const priceUsd = normalizeToUsd(enriched.priceOriginal, enriched.currency, fxRates);
        if (!priceUsd || priceUsd.value < 1_000 || priceUsd.value > 1_000_000) { groundingDrops += 1; continue; }
        const scope = classifyScope(enriched, effectiveWatch);
        const stored: StoredListing = { ...enriched, priceUsd: priceUsd.value, fxRate: priceUsd.rate, scope };
        await saveListing(pool, runId, watch.id, seller.id, stored);
        savedListings += 1;
        if (scope.match === "in_scope") scopeMatchedListings += 1;
        else if (scope.reason) scopeExclusions.set(scope.reason, (scopeExclusions.get(scope.reason) ?? 0) + 1);
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: "listing_page_skipped", watchId: watch.id, url: result.url, error: errorMessage(error) }));
    }
  }

  const metrics = await createMetrics(pool, watch.id, runId);
  return {
    discoveryQueries: discovery.queryCount,
    expanded: phase1b, pagesRead, savedListings, scopeMatchedListings, scopeExcludedListings: savedListings - scopeMatchedListings,
    scopeExclusions: [...scopeExclusions.entries()].map(([reason, count]) => ({ reason, count })), discovered: discovery.results.length,
    usedBaseReferenceFallback: discovery.usedBaseReferenceFallback,
    groundingDrops, metrics,
  };
}

async function discoverListings(pool: Pool, watch: Watch, sellers: Seller[], expanded: boolean): Promise<Discovery> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is required for the market-research pipeline.");
  const queries = expanded ? priceQueryTemplates(watch, sellers) : [`Rolex ${watch.reference_number}${watch.nickname ? ` ${watch.nickname}` : ""} for sale`];
  const unique = new Map<string, DiscoveryResult>();
  for (const query of queries) {
    // Phase 1B deliberately uses Tavily's advanced depth for the multi-source
    // listing scan. Tavily bills that depth at two credits per request.
    await reserveSearchCredit(pool, expanded ? 2 : 1);
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: expanded ? "advanced" : "basic", max_results: expanded ? 12 : 20, include_answer: false, include_domains: sellers.map((seller) => seller.domain) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Tavily discovery failed with HTTP ${response.status}.`);
    const body = await response.json() as { results?: Array<{ url?: string; title?: string }> };
    for (const result of body.results ?? []) {
      if (!result.url || !isHttpUrl(result.url)) continue;
      unique.set(canonicalUrl(result.url), { url: result.url, title: result.title?.trim() || "Untitled listing" });
    }
  }
  const hasCuratedResult = [...unique.values()].some((result) => sellerForUrl(result.url, sellers));
  const fallback = expanded && !hasCuratedResult ? baseReferenceFallbackQuery(watch) : null;
  if (fallback) {
    await reserveSearchCredit(pool, 2);
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: fallback, search_depth: "advanced", max_results: 12, include_answer: false, include_domains: sellers.map((seller) => seller.domain) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Tavily discovery fallback failed with HTTP ${response.status}.`);
    const body = await response.json() as { results?: Array<{ url?: string; title?: string }> };
    for (const result of body.results ?? []) if (result.url && isHttpUrl(result.url)) unique.set(canonicalUrl(result.url), { url: result.url, title: result.title?.trim() || "Untitled listing" });
  }
  return { results: [...unique.values()], queryCount: queries.length + (fallback ? 1 : 0), usedBaseReferenceFallback: Boolean(fallback) };
}

function needsDetailEnrichment(row: ListingCandidate, watch: Watch) {
  return (watch.scope.condition !== "any" && row.condition === null)
    || (watch.scope.papers === "required" && row.hasPapers === null)
    || (watch.scope.box === "required" && row.hasBox === null)
    || (watch.scope.warranty !== "none_ok" && row.warranty === null)
    || ((watch.scope.yearMin !== null || watch.scope.yearMax !== null) && row.productionYear === null);
}

export function priceQueryTemplates(watch: Watch, sellers: Seller[]) {
  const identity = researchIdentity(watch);
  const rotation = [...sellers].sort((a, b) => stableHash(`${watch.id}:${a.domain}`) - stableHash(`${watch.id}:${b.domain}`)).slice(0, 3);
  return [
    `${identity} for sale`, `${identity} asking price`,
    ...rotation.map((seller) => `site:${seller.domain} ${identity} for sale`),
  ];
}

export function baseReferenceFallbackQuery(watch: Pick<Watch, "reference_number" | "model_name">) {
  const baseReference = watch.reference_number.split("-")[0];
  return baseReference !== watch.reference_number ? `Rolex ${baseReference} ${watch.model_name} for sale` : null;
}

function researchIdentity(watch: Pick<Watch, "reference_number" | "model_name" | "nickname">) {
  return ["Rolex", watch.reference_number, watch.model_name.replace(/^Rolex\s+/i, ""), watch.nickname].filter(Boolean).join(" ");
}

async function reserveSearchCredit(pool: Pool, credits: number) {
  const capRaw = process.env.TAVILY_MONTHLY_CREDIT_CAP;
  if (!capRaw) return;
  const cap = Number(capRaw);
  if (!Number.isInteger(cap) || cap < 1) throw new Error("TAVILY_MONTHLY_CREDIT_CAP must be a positive integer.");
  const key = `tavily_credits:${new Date().toISOString().slice(0, 7)}`;
  const result = await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, jsonb_build_object('used', $2::integer))
     ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('used', COALESCE((settings.value->>'used')::integer, 0) + $2::integer), updated_at = now()
       WHERE COALESCE((settings.value->>'used')::integer, 0) + $2::integer <= $3::integer
     RETURNING value`, [key, credits, cap],
  );
  if (!result.rowCount) throw new Error(`Tavily monthly credit cap (${cap}) has been reached; expanded scans are paused.`);
}

async function fetchDetail(url: string, sellers: Seller[]) {
  const html = await fetchAllowedPage(url, sellers);
  return html ? { html, url } : null;
}

async function fetchAllowedPage(value: string, sellers: Seller[]) {
  let current = new URL(value);
  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    if (!sellerForUrl(current.href, sellers) || !(await isAllowedByRobots(current))) return null;
    await rateLimit(current.hostname);
    const response = await fetch(current, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location"); if (!location) return null;
      current = new URL(location, current); continue;
    }
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    return type.includes("text/html") || type.includes("application/xhtml+xml") ? response.text() : null;
  }
  return null;
}

async function rateLimit(host: string) {
  const now = Date.now(), previous = lastRequestByDomain.get(host) ?? 0;
  const delay = previous + requestIntervalMs - now;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastRequestByDomain.set(host, Date.now());
}

async function isAllowedByRobots(url: URL) {
  const robots = robotsCache.get(url.origin) ?? getRobots(url.origin); robotsCache.set(url.origin, robots);
  return isPathAllowed(await robots, `${url.pathname}${url.search}`);
}
async function getRobots(origin: string) {
  try {
    const response = await fetch(new URL("/robots.txt", origin), { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return null;
    return response.ok ? response.text() : "User-agent: *\nDisallow: /";
  } catch { return "User-agent: *\nDisallow: /"; }
}
function isPathAllowed(robots: string | null, path: string) {
  if (!robots) return true;
  const groups = parseRobots(robots), matching = groups.filter((group) => group.agents.includes("crowntracker") || group.agents.includes("*"));
  const rank = Math.max(...matching.map((group) => group.agents.includes("crowntracker") ? 2 : 1), 0);
  const rules = matching.filter((group) => (group.agents.includes("crowntracker") ? 2 : 1) === rank).flatMap((group) => group.rules);
  let length = -1, allowed = true;
  for (const rule of rules) if (rule.path && matchesRobotsPath(rule.path, path) && rule.path.length >= length) { length = rule.path.length; allowed = rule.allow; }
  return allowed;
}
function parseRobots(robots: string) {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = []; let current: typeof groups[number] | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const match = raw.split("#", 1)[0].trim().match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i); if (!match) continue;
    const directive = match[1].toLowerCase(), value = match[2].trim();
    if (directive === "user-agent") { if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); } current.agents.push(value.toLowerCase()); }
    else if (current) current.rules.push({ allow: directive === "allow", path: value });
  }
  return groups;
}
function matchesRobotsPath(pattern: string, path: string) { return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\$$/, "$")}`).test(path); }

export function extractListingRows(html: string, pageUrl: string, fallbackTitle: string, options: { allowLoosePage?: boolean; extractScopeAttributes?: boolean } = {}): ListingCandidate[] {
  const { allowLoosePage = true, extractScopeAttributes = true } = options;
  const products: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectProducts(JSON.parse(match[1]), products); } catch { /* Ignore malformed publisher JSON. */ }
  }
  const rows = products.map((product) => candidateFromProduct(product, pageUrl, extractScopeAttributes)).filter((row): row is ListingCandidate => Boolean(row));
  if (rows.length) return dedupeRows(rows);
  if (!allowLoosePage) return [];
  const loose = candidateFromLoosePage(html, pageUrl, fallbackTitle, extractScopeAttributes);
  return loose ? [loose] : [];
}
function collectProducts(value: unknown, results: Array<Record<string, unknown>>) {
  if (Array.isArray(value)) { value.forEach((item) => collectProducts(item, results)); return; }
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>, type = item["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) results.push(item);
  for (const nested of Object.values(item)) if (nested && typeof nested === "object") collectProducts(nested, results);
}
function candidateFromProduct(product: Record<string, unknown>, pageUrl: string, extractScopeAttributes: boolean): ListingCandidate | null {
  const offer = findOffer(product), raw = offer?.price ?? offer?.lowPrice, price = typeof raw === "number" ? raw : parseNumber(raw);
  const currency = stringValue(offer?.priceCurrency ?? offer?.currency)?.toUpperCase();
  if (!offer || !price || !currency) return null;
  const title = stringValue(product.name) ?? "Untitled listing";
  const detailUrl = resolveUrl(stringValue(product.url) ?? stringValue(offer.url), pageUrl);
  const text = JSON.stringify({ name: title, offers: offer, sku: product.sku, description: product.description }).slice(0, 2048);
  return listingFromText({ title, sourceUrl: pageUrl, detailUrl, stableSku: stringValue(product.sku) ?? stringValue(product.mpn), priceOriginal: price, currency, text }, extractScopeAttributes);
}
function candidateFromLoosePage(html: string, pageUrl: string, fallbackTitle: string, extractScopeAttributes: boolean): ListingCandidate | null {
  const text = htmlToText(html), priceText = text.match(/(?:US\$|USD\s?|\$)\s?([\d,]+(?:\.\d{2})?)/i)?.[1], price = parseNumber(priceText);
  if (!price) return null;
  return listingFromText({ title: metaContent(html, "og:title") ?? fallbackTitle, sourceUrl: pageUrl, detailUrl: pageUrl, stableSku: null, priceOriginal: price, currency: "USD", text: text.slice(0, 2048) }, extractScopeAttributes);
}
function listingFromText(input: { title: string; sourceUrl: string; detailUrl: string | null; stableSku: string | null; priceOriginal: number; currency: string; text: string }, extractScopeAttributes: boolean): ListingCandidate {
  const text = `${input.title} ${input.text}`.toLowerCase();
  return { ...input, groundingSnippet: input.text.slice(0, 2048), productionYear: extractScopeAttributes ? findYear(text) : null, hasPapers: /\b(with )?(papers|certificate|full set)\b/.test(text) ? true : null, hasBox: /\b(with )?box\b|\bfull set\b/.test(text) ? true : null, condition: /\b(unworn|brand new|new)\b/.test(text) ? "unworn" : /\b(pre[- ]?owned|used)\b/.test(text) ? "pre_owned" : null, warranty: extractScopeAttributes ? (/\b(factory|manufacturer(?:'s)?|rolex) warranty\b/.test(text) ? "factory" : /\bwarranty\b/.test(text) ? "third_party" : null) : null };
}
function dedupeRows(rows: ListingCandidate[]) { const unique = new Map<string, ListingCandidate>(); for (const row of rows) unique.set(row.stableSku ?? canonicalUrl(row.detailUrl ?? row.sourceUrl), row); return [...unique.values()]; }
function findOffer(product: Record<string, unknown>) { const offers = product.offers, offer = Array.isArray(offers) ? offers[0] : offers; return offer && typeof offer === "object" ? offer as Record<string, unknown> : null; }

export async function enrichRowsWithClaude(rows: ListingCandidate[], html: string, throwOnFailure = false) {
  if (!rows.length) return rows;
  if (!process.env.ANTHROPIC_API_KEY) {
    if (throwOnFailure) throw new Error("ANTHROPIC_API_KEY is required for live prompt verification.");
    return rows;
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_HAIKU_MODEL ?? "claude-haiku-4-5-20251001", max_tokens: 1500, temperature: 0, messages: [{ role: "user", content: `Extract only supported attributes for these watch listing rows. Return a JSON array with index, condition (unworn|pre_owned|null), productionYear, hasPapers, hasBox, warranty (factory|third_party|null). Never infer.\nRows: ${JSON.stringify(rows.map((row, index) => ({ index, title: row.title, price: row.priceOriginal, currency: row.currency, snippet: row.groundingSnippet.slice(0, 500) })))}\nPage text: ${htmlToText(html).slice(0, 8000)}` }] }), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Anthropic listing extraction failed with HTTP ${response.status}.`);
    const payload = await response.json() as { content?: Array<{ text?: string }> };
    const text = payload.content?.map((item) => item.text ?? "").join("") ?? "";
    const extracted = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Array<Partial<ListingCandidate> & { index: number }>;
    return rows.map((row, index) => mergeGroundedAttributes(row, extracted.find((item) => item.index === index)));
  } catch (error) {
    if (throwOnFailure) throw error;
    return rows;
  }
}
function mergeGroundedAttributes(row: ListingCandidate, extra?: Partial<ListingCandidate>) {
  if (!extra) return row;
  const text = row.groundingSnippet.toLowerCase();
  return { ...row,
    condition: extra.condition && new RegExp(extra.condition === "unworn" ? "unworn|brand new|new" : "pre[- ]?owned|used", "i").test(text) ? extra.condition : row.condition,
    productionYear: extra.productionYear && new RegExp(`\\b${extra.productionYear}\\b`).test(text) ? extra.productionYear : row.productionYear,
    hasPapers: extra.hasPapers === true && /papers|certificate|full set/i.test(text) ? true : row.hasPapers,
    hasBox: extra.hasBox === true && /box|full set/i.test(text) ? true : row.hasBox,
    warranty: extra.warranty && new RegExp(extra.warranty === "factory" ? "factory|manufacturer|rolex.*warranty" : "warranty", "i").test(text) ? extra.warranty : row.warranty,
  };
}
function mergeDetail(row: ListingCandidate, html: string, detailUrl: string) {
  const detail = extractListingRows(html, detailUrl, row.title)[0];
  if (!detail) return row;
  return { ...row, detailUrl, groundingSnippet: `${row.groundingSnippet}\n${detail.groundingSnippet}`.slice(0, 2048), condition: detail.condition ?? row.condition, productionYear: detail.productionYear ?? row.productionYear, hasPapers: detail.hasPapers ?? row.hasPapers, hasBox: detail.hasBox ?? row.hasBox, warranty: detail.warranty ?? row.warranty };
}
function isPriceGrounded(row: ListingCandidate) { return numericText(row.groundingSnippet).includes(numericText(row.priceOriginal)); }

function classifyScope(listing: ListingCandidate, watch: Watch) {
  const failures: string[] = [], unknown: string[] = [];
  if (watch.scope.condition !== "any") listing.condition === null ? unknown.push("condition") : listing.condition !== watch.scope.condition && failures.push("condition");
  if (watch.scope.papers === "required") listing.hasPapers === null ? unknown.push("papers") : !listing.hasPapers && failures.push("papers");
  if (watch.scope.box === "required") listing.hasBox === null ? unknown.push("box") : !listing.hasBox && failures.push("box");
  if (watch.scope.warranty !== "none_ok") {
    if (listing.warranty === null) unknown.push("warranty");
    else if (watch.scope.warranty === "factory_remaining" && listing.warranty !== "factory") failures.push("factory warranty");
  }
  if (watch.scope.yearMin || watch.scope.yearMax) {
    if (listing.productionYear === null) unknown.push("production year");
    else if ((watch.scope.yearMin && listing.productionYear < watch.scope.yearMin) || (watch.scope.yearMax && listing.productionYear > watch.scope.yearMax)) failures.push("production year");
  }
  if (failures.length) return { match: "out_of_scope" as const, reason: `Does not match ${failures.join(", ")}.`, weight: 0 };
  if (unknown.length) return { match: "uncertain" as const, reason: `Unknown ${unknown.join(", ")}.`, weight: UNCERTAIN_LISTING_WEIGHT };
  return { match: "in_scope" as const, reason: null, weight: 1 };
}

async function getUsdRates() {
  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD", { signal: AbortSignal.timeout(10_000) });
    const data = await response.json() as { rates?: Record<string, number> };
    return { USD: 1, ...(data.rates ?? {}) };
  } catch { return { USD: 1 }; }
}
function normalizeToUsd(amount: number, currency: string, rates: Record<string, number>) { const rate = rates[currency]; return rate && Number.isFinite(rate) ? { value: amount / rate, rate } : null; }

async function saveListing(pool: Pool, runId: string, watchId: string, sellerId: string, listing: StoredListing) {
  const identityUrl = listing.detailUrl ?? listing.sourceUrl;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO market_listings (watch_id, seller_id, source_url, title, price_usd, currency, price_original, fx_rate, condition, production_year, has_papers, has_box, warranty, scope_match, scope_match_class, scope_weight, scope_reason, stable_sku, detail_url, grounding_snippet, source_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)
     ON CONFLICT (watch_id, source_url) DO UPDATE SET seller_id = EXCLUDED.seller_id, title = EXCLUDED.title, price_usd = EXCLUDED.price_usd, currency = EXCLUDED.currency, price_original = EXCLUDED.price_original, fx_rate = EXCLUDED.fx_rate, condition = EXCLUDED.condition, production_year = EXCLUDED.production_year, has_papers = EXCLUDED.has_papers, has_box = EXCLUDED.has_box, warranty = EXCLUDED.warranty, scope_match = EXCLUDED.scope_match, scope_match_class = EXCLUDED.scope_match_class, scope_weight = EXCLUDED.scope_weight, scope_reason = EXCLUDED.scope_reason, stable_sku = EXCLUDED.stable_sku, detail_url = EXCLUDED.detail_url, grounding_snippet = EXCLUDED.grounding_snippet, source_data = EXCLUDED.source_data, is_active = true, missing_since_at = NULL, last_seen_at = now(), updated_at = now() RETURNING id`,
    [watchId, sellerId, identityUrl, listing.title, listing.priceUsd, listing.currency, listing.priceOriginal, listing.fxRate, listing.condition, listing.productionYear, listing.hasPapers, listing.hasBox, listing.warranty, listing.scope.match === "in_scope", listing.scope.match, listing.scope.weight, listing.scope.reason, listing.stableSku, listing.detailUrl, listing.groundingSnippet, JSON.stringify({ rowUrl: listing.sourceUrl, detailUrl: listing.detailUrl, priceBasis: "asking" })],
  );
  await pool.query("INSERT INTO listing_price_observations (listing_id, run_id, price_usd) VALUES ($1, $2, $3) ON CONFLICT (listing_id, run_id) DO NOTHING", [result.rows[0].id, runId, listing.priceUsd]);
  await pool.query("INSERT INTO evidence (run_id, watch_id, attached_to, attached_id, url, domain, quote) VALUES ($1,$2,'listing',$3,$4,$5,$6)", [runId, watchId, result.rows[0].id, listing.detailUrl ?? listing.sourceUrl, new URL(listing.detailUrl ?? listing.sourceUrl).hostname, listing.groundingSnippet.slice(0, 300)]);
}

async function createMetrics(pool: Pool, watchId: string, runId: string) {
  const rows = (await pool.query<{ id: string; price_usd: string; condition: string | null; scope_match_class: ScopeClass; scope_weight: string; seller_domain: string; source_url: string; grounding_snippet: string }>(
    `SELECT l.id, l.price_usd, l.condition, l.scope_match_class, l.scope_weight, s.domain AS seller_domain, l.source_url, l.grounding_snippet
     FROM market_listings l JOIN sellers s ON s.id = l.seller_id
     WHERE l.watch_id = $1 AND l.is_active = true AND l.price_usd IS NOT NULL AND l.scope_match_class IN ('in_scope','uncertain')
       AND l.last_seen_at > now() - ($2 || ' days')::interval`, [watchId, ACTIVE_LISTING_WINDOW_DAYS],
  )).rows;
  const grey = await savePriceMetric(pool, watchId, runId, "grey_avg", rows.filter((row) => row.condition === "unworn"));
  const resell = await savePriceMetric(pool, watchId, runId, "resell_avg", rows.filter((row) => row.condition === "pre_owned"));
  await flagAnomalies(pool, watchId, grey.value, resell.value);
  const availability = await saveAvailability(pool, watchId, runId, rows.filter((row) => row.scope_match_class === "in_scope").length);
  return { grey, resell, availability };
}
async function savePriceMetric(pool: Pool, watchId: string, runId: string, metric: "grey_avg" | "resell_avg", rows: Array<{ id: string; price_usd: string; scope_match_class: ScopeClass; scope_weight: string; seller_domain: string; source_url: string; grounding_snippet: string }>) {
  const values = rows.map((row) => ({ ...row, value: Number(row.price_usd), weight: Number(row.scope_weight) }));
  const retained = iqrRetained(values), value = weightedMedian(retained);
  const uncertain = retained.filter((row) => row.scope_match_class === "uncertain").length, certain = retained.length - uncertain;
  const iqr = interquartileRange(retained.map((row) => row.value)), sample = Math.min((certain + uncertain * UNCERTAIN_LISTING_WEIGHT) / 8, 1), diversity = Math.min(new Set(retained.map((row) => row.seller_domain)).size / 4, 1), agreement = value ? Math.max(0, 1 - Math.min((iqr ?? 0) / value, 1)) : 0;
  const confidence = confidenceFor(sample, diversity, agreement, Boolean(value));
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO metric_snapshots (watch_id, run_id, metric, value, value_low, value_high, n, n_uncertain, outliers_dropped, conf_sample, conf_diversity, conf_agreement, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [watchId, runId, metric, value, retained.length ? Math.min(...retained.map((row) => row.value)) : null, retained.length ? Math.max(...retained.map((row) => row.value)) : null, certain, uncertain, values.length - retained.length, sample, diversity, agreement, confidence],
  );
  for (const row of retained) await pool.query("INSERT INTO evidence (run_id, watch_id, attached_to, attached_id, url, domain, quote) VALUES ($1,$2,'snapshot',$3,$4,$5,$6)", [runId, watchId, inserted.rows[0].id, row.source_url, row.seller_domain, row.grounding_snippet?.slice(0, 300) ?? row.source_url]);
  return { value, n: certain, uncertain, confidence };
}
async function saveAvailability(pool: Pool, watchId: string, runId: string, count: number) {
  const baseline = await pool.query<{ baseline: string | null; prior: string | null }>(
    `SELECT avg(n) FILTER (WHERE computed_at > now() - interval '56 days') AS baseline, avg(n) FILTER (WHERE computed_at > now() - interval '28 days' AND computed_at <= now() - interval '7 days') AS prior FROM metric_snapshots WHERE watch_id = $1 AND metric = 'availability'`, [watchId],
  );
  // Availability's raw value is a 0–1 score. Before an eight-week baseline, use the growing baseline.
  const previousCount = Number(baseline.rows[0]?.baseline ?? count) || count, prior = Number(baseline.rows[0]?.prior ?? count) || count;
  const relative = Math.min(count / Math.max(previousCount, 1), 1), trend = Math.min(Math.max((count / Math.max(prior, 1)) / 2, 0), 1);
  const value = count < 3 ? Math.min(relative * 0.67 + trend * 0.33, 0.32) : relative * 0.67 + trend * 0.33;
  const label = value >= 0.66 ? "High" : value >= 0.33 ? "Medium" : "Low";
  await pool.query("INSERT INTO metric_snapshots (watch_id, run_id, metric, value, label, n, conf_sample, conf_diversity, conf_agreement, confidence) VALUES ($1,$2,'availability',$3,$4,$5,$6,$7,$8,$9)", [watchId, runId, value, label, count, Math.min(count / 8, 1), 1, 1, confidenceFor(Math.min(count / 8, 1), 1, 1, count > 0)]);
  return { value, label, count };
}
async function flagAnomalies(pool: Pool, watchId: string, grey: number | null, resell: number | null) {
  const floor = Math.min(...[grey, resell].filter((value): value is number => Boolean(value)).map((value) => value * 0.8));
  if (!Number.isFinite(floor)) return;
  await pool.query("UPDATE market_listings SET anomaly_flags = CASE WHEN price_usd < $2 THEN ARRAY['price_too_low']::text[] ELSE '{}'::text[] END WHERE watch_id = $1 AND is_active = true", [watchId, floor]);
}
function iqrRetained<T extends { value: number }>(rows: T[]) { if (rows.length < 4) return rows; const values = rows.map((row) => row.value).sort((a, b) => a - b), q1 = quantile(values, .25), q3 = quantile(values, .75), iqr = q3 - q1; return rows.filter((row) => row.value >= q1 - 1.5 * iqr && row.value <= q3 + 1.5 * iqr); }
function weightedMedian<T extends { value: number; weight: number }>(rows: T[]) { if (!rows.length) return null; const sorted = [...rows].sort((a, b) => a.value - b.value), total = sorted.reduce((sum, row) => sum + row.weight, 0); let sum = 0; for (const row of sorted) { sum += row.weight; if (sum >= total / 2) return row.value; } return sorted.at(-1)!.value; }
function interquartileRange(values: number[]) { return values.length ? quantile([...values].sort((a, b) => a - b), .75) - quantile([...values].sort((a, b) => a - b), .25) : null; }
function quantile(values: number[], p: number) { const index = (values.length - 1) * p, lower = Math.floor(index), upper = Math.ceil(index); return values[lower] + (values[upper] - values[lower]) * (index - lower); }

function sellerForUrl(url: string, sellers: Seller[]) { try { const host = new URL(url).hostname.toLowerCase(); return sellers.find((seller) => host === seller.domain || host.endsWith(`.${seller.domain}`)); } catch { return undefined; } }
function resolveUrl(value: string | null, base: string) { try { return value ? new URL(value, base).href : null; } catch { return null; } }
function canonicalUrl(value: string) { const url = new URL(value); url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key); return url.href.replace(/\/$/, ""); }
function htmlToText(html: string) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").trim().slice(0, 100_000); }
function metaContent(html: string, property: string) { return html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)`, "i"))?.[1] ?? null; }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function parseNumber(value: unknown) { const number = Number(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(number) ? number : null; }
function findYear(text: string) { const year = text.match(/\b(?:19|20)\d{2}\b/)?.[0]; return year ? Number(year) : null; }
function numericText(value: string | number) { return String(value).replace(/\D/g, ""); }
function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function stableHash(value: string) { return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unknown error"; }
