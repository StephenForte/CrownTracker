import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Watch } from "@/lib/watches";
import { ACTIVE_LISTING_WINDOW_DAYS, HOST_FETCH_MISSES_BEFORE_SKIP, MIN_LISTING_PRICE_TO_RETAIL_RATIO, PHASE1A_PAGE_FETCH_LIMIT, PHASE1B_PAGE_FETCH_LIMIT, UNCERTAIN_LISTING_WEIGHT, confidenceFor, isGreyMarketSellerDomain, isPhase1bEnabled, isUnextractableSellerDomain, nextHostMissCount, phase1bConfigurationError, priceReliability } from "@/lib/phase1b";
import { matchesRobotsPath } from "@/lib/robots";

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
  let discovery = await discoverListings(pool, watch, sellers, phase1b);
  const fxRates = phase1b ? await getUsdRates() : { USD: 1 };
  const seenUrls = new Set<string>();
  const fetchMissesByHost = new Map<string, number>();
  const skippedHosts = new Set<string>();
  let pagesRead = 0, savedListings = 0, scopeMatchedListings = 0, groundingDrops = 0;
  const scopeExclusions = new Map<string, number>();

  const ingestResults = async (results: DiscoveryResult[]) => {
    const allowedResults = prioritizeDiscoveryUrls(results.filter((result) => sellerForUrl(result.url, sellers)));
    let fetchAttempts = 0;
    const fetchLimit = phase1b ? PHASE1B_PAGE_FETCH_LIMIT : PHASE1A_PAGE_FETCH_LIMIT;
    for (const result of allowedResults) {
      if (fetchAttempts >= fetchLimit) break;
      const key = canonicalUrl(result.url);
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      try {
        const seller = sellerForUrl(result.url, sellers);
        if (!seller) continue;
        if (isUnextractableSellerDomain(seller.domain)) continue;
        if (!isLikelyProductListingUrl(result.url)) continue;
        const misses = fetchMissesByHost.get(seller.domain) ?? 0;
        if (misses >= HOST_FETCH_MISSES_BEFORE_SKIP) {
          if (!skippedHosts.has(seller.domain)) {
            skippedHosts.add(seller.domain);
            console.warn(JSON.stringify({ event: "listing_host_fetch_budget_exceeded", watchId: watch.id, host: seller.domain, misses }));
          }
          continue;
        }
        fetchAttempts += 1;
        let html: string | null = null;
        try {
          html = await fetchAllowedPage(result.url, sellers);
        } catch (error) {
          fetchMissesByHost.set(seller.domain, nextHostMissCount(misses, false));
          console.warn(JSON.stringify({ event: "listing_page_skipped", watchId: watch.id, url: result.url, error: errorMessage(error) }));
          continue;
        }
        if (!html) {
          fetchMissesByHost.set(seller.domain, nextHostMissCount(misses, false));
          continue;
        }
        pagesRead += 1;
        let candidates: ListingCandidate[] = [];
        try {
          candidates = extractListingRows(html, result.url, result.title, { allowLoosePage: phase1b, extractScopeAttributes: phase1b });
          // Haiku adds row-level classification hints, but every retained value still
          // has to be grounded in the row/detail text below.
          if (phase1b) candidates = await enrichRowsWithClaude(candidates, html);
        } catch (error) {
          fetchMissesByHost.set(seller.domain, nextHostMissCount(misses, false));
          console.warn(JSON.stringify({ event: "listing_page_skipped", watchId: watch.id, url: result.url, error: errorMessage(error) }));
          continue;
        }
        if (!candidates.length) {
          if (pageHasNoPublicAskingPrice(html)) {
            await markListingNotCurrentAsk(pool, watch.id, result.url);
            continue;
          }
          fetchMissesByHost.set(seller.domain, nextHostMissCount(misses, false));
          continue;
        }
        fetchMissesByHost.set(seller.domain, nextHostMissCount(misses, true));
        for (const candidate of candidates) {
          const detail = phase1b && needsDetailEnrichment(candidate, watch) && candidate.detailUrl && canonicalUrl(candidate.detailUrl) !== canonicalUrl(result.url)
            ? await fetchDetail(candidate.detailUrl, sellers)
            : null;
          const enriched = detail ? mergeDetail(candidate, detail.html, detail.url) : candidate;
          if (!isPriceGrounded(enriched) || !isAskAttributedToListing(enriched.groundingSnippet, enriched.title, enriched.priceOriginal, watch.reference_number)) { groundingDrops += 1; continue; }
          const priceUsd = normalizeToUsd(enriched.priceOriginal, enriched.currency, fxRates);
          if (!priceUsd || priceUsd.value < 1_000 || priceUsd.value > 1_000_000) { groundingDrops += 1; continue; }
          const scope = classifyListing(enriched, effectiveWatch, priceUsd.value);
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
  };

  await ingestResults(discovery.results);

  // Search hits alone are not enough: if every curated page failed extraction or
  // grounding, widen once with the base-reference fallback before writing metrics.
  if (phase1b && savedListings === 0 && !discovery.usedBaseReferenceFallback) {
    const fallback = await discoverBaseReferenceFallback(pool, watch, sellers);
    if (fallback) {
      discovery = {
        results: [...discovery.results, ...fallback.results],
        queryCount: discovery.queryCount + fallback.queryCount,
        usedBaseReferenceFallback: true,
      };
      await ingestResults(fallback.results);
    }
  }

  const metrics = await createMetrics(pool, effectiveWatch, runId);
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
      body: JSON.stringify({ query, search_depth: expanded ? "advanced" : "basic", max_results: expanded ? 12 : 20, include_answer: false, include_domains: includeDomainsForDiscoveryQuery(query, sellers) }),
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
  if (expanded && !hasCuratedResult) {
    const fallback = await discoverBaseReferenceFallback(pool, watch, sellers);
    if (fallback) {
      for (const result of fallback.results) unique.set(canonicalUrl(result.url), result);
      return { results: [...unique.values()], queryCount: queries.length + fallback.queryCount, usedBaseReferenceFallback: true };
    }
  }
  return { results: [...unique.values()], queryCount: queries.length, usedBaseReferenceFallback: false };
}

async function discoverBaseReferenceFallback(pool: Pool, watch: Watch, sellers: Seller[]): Promise<Discovery | null> {
  const query = baseReferenceFallbackQuery(watch);
  if (!query) return null;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is required for the market-research pipeline.");
  await reserveSearchCredit(pool, 2);
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, search_depth: "advanced", max_results: 12, include_answer: false, include_domains: sellers.map((seller) => seller.domain) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Tavily discovery fallback failed with HTTP ${response.status}.`);
  const body = await response.json() as { results?: Array<{ url?: string; title?: string }> };
  const results: DiscoveryResult[] = [];
  for (const result of body.results ?? []) {
    if (!result.url || !isHttpUrl(result.url)) continue;
    results.push({ url: result.url, title: result.title?.trim() || "Untitled listing" });
  }
  return { results, queryCount: 1, usedBaseReferenceFallback: true };
}

function needsDetailEnrichment(row: ListingCandidate, watch: Watch) {
  // Always try to resolve unknown condition in Phase 1B callers: grey vs resell
  // series only count rows with an explicit unworn/pre-owned label.
  return row.condition === null
    || (watch.scope.papers === "required" && row.hasPapers === null)
    || (watch.scope.box === "required" && row.hasBox === null)
    || (watch.scope.warranty !== "none_ok" && row.warranty === null)
    || ((watch.scope.yearMin !== null || watch.scope.yearMax !== null) && row.productionYear === null);
}

export function priceQueryTemplates(watch: Watch, sellers: Seller[]) {
  const exactIdentity = researchIdentity(watch);
  const broaderIdentity = researchIdentity({ ...watch, reference_number: discoveryReference(watch.reference_number) });
  return [
    `${exactIdentity} for sale`,
    `${broaderIdentity} unworn OR new asking price`,
    ...siteScopedDiscoverySellers(watch, sellers).map((seller) => `site:${seller.domain} ${broaderIdentity} for sale`),
  ];
}

export function siteScopedDiscoverySellers(watch: Pick<Watch, "id">, sellers: Seller[]) {
  const grey = sellers.filter((seller) => isGreyMarketSellerDomain(seller.domain));
  const others = sellers
    .filter((seller) => !isGreyMarketSellerDomain(seller.domain) && !isUnextractableSellerDomain(seller.domain))
    .sort((a, b) => stableHash(`${watch.id}:${a.domain}`) - stableHash(`${watch.id}:${b.domain}`));
  return [...grey, ...others].slice(0, 3);
}

export function includeDomainsForDiscoveryQuery(query: string, sellers: Seller[]) {
  // Tavily's include_domains allowlist overrides a site: operator. A site-scoped
  // query sent with every curated host never returns the pinned dealer.
  const siteHost = query.match(/^site:(\S+)/i)?.[1]?.toLowerCase();
  if (!siteHost) return sellers.map((seller) => seller.domain);
  const seller = sellers.find((candidate) => {
    const domain = candidate.domain.toLowerCase();
    return siteHost === domain || siteHost.endsWith(`.${domain}`);
  });
  return [seller?.domain ?? siteHost];
}

export function prioritizeDiscoveryUrls(results: DiscoveryResult[]) {
  const groups = new Map<string, DiscoveryResult[]>();
  const order: string[] = [];
  for (const result of results) {
    const host = discoveryHostKey(result.url);
    if (!groups.has(host)) {
      groups.set(host, []);
      order.push(host);
    }
    groups.get(host)!.push(result);
  }
  const ranked = [...order].sort((a, b) => {
    const greyDelta = Number(isGreyMarketSellerDomain(b)) - Number(isGreyMarketSellerDomain(a));
    return greyDelta || order.indexOf(a) - order.indexOf(b);
  });
  const queues = ranked.map((host) => groups.get(host) ?? []);
  const selected: DiscoveryResult[] = [];
  while (queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) selected.push(next);
    }
  }
  return selected;
}

function discoveryHostKey(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function baseReferenceFallbackQuery(watch: Pick<Watch, "reference_number" | "model_name">) {
  const baseReference = watch.reference_number.split("-")[0];
  return baseReference !== watch.reference_number ? `Rolex ${baseReference} ${watch.model_name} for sale` : null;
}

function discoveryReference(referenceNumber: string) {
  const hyphenBase = referenceNumber.split("-")[0];
  if (hyphenBase !== referenceNumber) return hyphenBase;
  return referenceNumber.match(/^(\d+)[a-z]+$/i)?.[1] ?? referenceNumber;
}

function researchIdentity(watch: Pick<Watch, "reference_number" | "model_name">) {
  // Nicknames are personal shorthand, not reliable dealer vocabulary. Keep
  // them out of discovery queries; listing-level identity and scope checks
  // still decide what reaches a metric.
  return ["Rolex", watch.reference_number, watch.model_name.replace(/^Rolex\s+/i, "")].filter(Boolean).join(" ");
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

export function extractListingRows(html: string, pageUrl: string, fallbackTitle: string, options: { allowLoosePage?: boolean; extractScopeAttributes?: boolean } = {}): ListingCandidate[] {
  const { allowLoosePage = true, extractScopeAttributes = true } = options;
  const products: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectProducts(JSON.parse(match[1]), products); } catch { /* Ignore malformed publisher JSON. */ }
  }
  const rows = products.map((product) => candidateFromProduct(product, pageUrl, extractScopeAttributes)).filter((row): row is ListingCandidate => Boolean(row));
  // A Product node with no usable ask (price 0, inquire, missing offer) is
  // evidence of no public price. Do not fall through to related-item chrome.
  if (products.length) return dedupeRows(rows);
  if (!allowLoosePage || !isLikelyProductListingUrl(pageUrl) || pageHasNoPublicAskingPrice(html)) return [];
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
  const text = JSON.stringify({ name: title, offers: offer, sku: product.sku, description: product.description, itemCondition: product.itemCondition ?? offer.itemCondition }).slice(0, 2048);
  return listingFromText({ title, sourceUrl: pageUrl, detailUrl, stableSku: stringValue(product.sku) ?? stringValue(product.mpn), priceOriginal: price, currency, text, structuredCondition: listingConditionFromStructuredValue(product.itemCondition ?? offer.itemCondition) }, extractScopeAttributes);
}
function candidateFromLoosePage(html: string, pageUrl: string, fallbackTitle: string, extractScopeAttributes: boolean): ListingCandidate | null {
  const found = loosePagePrice(html);
  if (!found) return null;
  const price = parseNumber(found.raw);
  if (!price) return null;
  const text = `${found.source} ${found.raw}. ${htmlToText(html)}`.slice(0, 2048);
  return listingFromText({ title: metaContent(html, "og:title") ?? fallbackTitle, sourceUrl: pageUrl, detailUrl: pageUrl, stableSku: null, priceOriginal: price, currency: "USD", text }, extractScopeAttributes);
}
function listingFromText(input: { title: string; sourceUrl: string; detailUrl: string | null; stableSku: string | null; priceOriginal: number; currency: string; text: string; structuredCondition?: "unworn" | "pre_owned" | null }, extractScopeAttributes: boolean): ListingCandidate {
  const text = `${input.title} ${input.text}`.toLowerCase();
  const { structuredCondition, ...row } = input;
  return { ...row, groundingSnippet: input.text.slice(0, 2048), productionYear: extractScopeAttributes ? findYear(text) : null, hasPapers: /\b(with )?(papers|certificate|full set)\b/.test(text) ? true : null, hasBox: /\b(with )?box\b|\bfull set\b/.test(text) ? true : null, condition: structuredCondition ?? listingConditionFromText(text), warranty: extractScopeAttributes ? (/\b(factory|manufacturer(?:'s)?|rolex) warranty\b/.test(text) ? "factory" : /\bwarranty\b/.test(text) ? "third_party" : null) : null };
}

export function isLikelyProductListingUrl(url: string) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\/(blog|editorial|news|guides?|market-report|grey-market|product-category|archives?)(\/|$)/i.test(path)) return false;
    if (/\/brands\//.test(path) && !/\/product\//.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function listingConditionFromStructuredValue(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (/(?:schema\.org\/)?(?:brand)?newcondition\b/.test(normalized)) return "unworn" as const;
  if (/(?:schema\.org\/)?(?:used|refurbished|damaged)condition\b/.test(normalized)) return "pre_owned" as const;
  return null;
}

export function listingConditionFromText(text: string) {
  const value = text.toLowerCase();
  if (/(?:schema\.org\/)?(?:brand)?newcondition\b/.test(value) || /\b(?:unworn|never worn|nwbig|brand[ -]?new)\b/.test(value)) return "unworn";
  if (/(?:schema\.org\/)?(?:used|refurbished|damaged)condition\b/.test(value) || /\b(?:pre[- ]?owned|used)\b/.test(value)) return "pre_owned";
  if (/\bnew\b/.test(value)) return "unworn";
  return null;
}
function dedupeRows(rows: ListingCandidate[]) { const unique = new Map<string, ListingCandidate>(); for (const row of rows) unique.set(row.stableSku ?? canonicalUrl(row.detailUrl ?? row.sourceUrl), row); return [...unique.values()]; }
function findOffer(product: Record<string, unknown>) {
  const offers = product.offers;
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const value of list) {
    if (!value || typeof value !== "object") continue;
    const offer = value as Record<string, unknown>;
    const price = parseNumber(offer.price ?? offer.lowPrice);
    const currency = stringValue(offer.priceCurrency ?? offer.currency);
    if (price && price > 0 && currency) return offer;
  }
  return null;
}

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
  const evidence = listingConditionFromText(text);
  const conditionIsGrounded = extra.condition != null && extra.condition === evidence;
  const yearIsGrounded = Number.isInteger(extra.productionYear)
    && (text.match(/\b(?:19|20)\d{2}\b/g) ?? []).some((year) => Number(year) === extra.productionYear);
  const warrantyIsGrounded = extra.warranty === "factory"
    ? /\b(?:factory|manufacturer(?:'s)?|rolex) warranty\b/i.test(text)
    : extra.warranty === "third_party" && /\bwarranty\b/i.test(text);
  return { ...row,
    condition: conditionIsGrounded ? extra.condition! : row.condition,
    productionYear: yearIsGrounded ? extra.productionYear! : row.productionYear,
    hasPapers: extra.hasPapers === true && /papers|certificate|full set/i.test(text) ? true : row.hasPapers,
    hasBox: extra.hasBox === true && /box|full set/i.test(text) ? true : row.hasBox,
    warranty: warrantyIsGrounded ? extra.warranty! : row.warranty,
  };
}
function mergeDetail(row: ListingCandidate, html: string, detailUrl: string) {
  const detail = extractListingRows(html, detailUrl, row.title)[0];
  if (!detail) return row;
  return { ...row, detailUrl, groundingSnippet: `${row.groundingSnippet}\n${detail.groundingSnippet}`.slice(0, 2048), condition: detail.condition ?? row.condition, productionYear: detail.productionYear ?? row.productionYear, hasPapers: detail.hasPapers ?? row.hasPapers, hasBox: detail.hasBox ?? row.hasBox, warranty: detail.warranty ?? row.warranty };
}
export function isPriceGrounded(row: Pick<ListingCandidate, "groundingSnippet" | "priceOriginal">) { return numericText(row.groundingSnippet).includes(numericText(row.priceOriginal)); }

export function classifyListingIdentity(title: string, groundingSnippet: string, watch: Pick<Watch, "reference_number" | "scope">) {
  const text = `${title} ${groundingSnippet}`.toLowerCase();
  const normalized = text.replace(/[^a-z0-9]/g, "");
  const reference = watch.reference_number.toLowerCase().replace(/[^a-z0-9]/g, "");
  const baseReference = watch.reference_number.split("-")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const identityTerms = watch.scope.identityTerms ?? [];
  const numericStem = reference.match(/^(\d+)[a-z]+$/)?.[1];
  const hasExactReference = normalized.includes(reference) || normalized.includes(baseReference);
  // A dealer may abbreviate a letter-suffixed Rolex reference (for example,
  // 126610LN as 126610). Allow that when evidence does not name a conflicting
  // suffix variant (126610LV). Saved identity terms still apply as an extra filter.
  const canUseBareNumericStem = Boolean(
    numericStem
      && hasStandaloneNumericReference(text, numericStem)
      && !hasConflictingReferenceVariant(text, numericStem, reference),
  );
  if (!hasExactReference && !canUseBareNumericStem) return "Tracked reference or base reference not found in listing evidence.";
  if (/(?:\b(?:watch\s+)?(?:part|parts|accessory|accessories|component|replacement)\b|\b(?:bezel|dial|bracelet|strap|crystal|link|insert|case)\s+(?:only|for|fits?|fit)\b|\b(?:bezel|dial|bracelet|strap|crystal|link|insert|case)[\s-]*only\b)/i.test(text)) return "Listing appears to be a part or accessory, not a complete watch.";
  const missingTerms = identityTerms.filter((term) => term.toLowerCase().split(/\s+/).some((token) => !normalized.includes(token.replace(/[^a-z0-9]/g, ""))));
  return missingTerms.length ? `Missing required identity terms: ${missingTerms.join(", ")}.` : null;
}

function hasStandaloneNumericReference(text: string, numericStem: string) {
  return text.match(/[a-z0-9]+/gi)?.some((token) => token.toLowerCase() === numericStem) ?? false;
}

function hasConflictingReferenceVariant(text: string, numericStem: string, reference: string) {
  return text.match(/[a-z0-9]+/gi)?.some((token) => {
    const normalized = token.toLowerCase();
    return normalized.startsWith(numericStem)
      && /^[a-z]+$/.test(normalized.slice(numericStem.length))
      && normalized !== reference;
  }) ?? false;
}

export function pageHasNoPublicAskingPrice(text: string) {
  const value = text.toLowerCase();
  return /\binquire\s+for\s+pric(?:e|ing)\b/.test(value)
    || /\bcall\s+(?:us\s+)?for\s+pric(?:e|ing)\b/.test(value)
    || /\b(?:price\s+on\s+request|request\s+(?:a\s+)?quot(?:e|ation)|contact\s+(?:us\s+)?for\s+(?:a\s+)?(?:price|pricing))\b/.test(value)
    || /"price"\s*:\s*"?0(?:\.0+)?"?/.test(value);
}

export function isListingUnavailable(groundingSnippet: string) {
  const text = groundingSnippet.toLowerCase();
  return /"availability"\s*:\s*"[^"\n]*(?:outofstock|soldout)/.test(text)
    || /\b(?:out\s*-?of\s*-?stock|sold\s*-?out)\b/.test(text)
    || pageHasNoPublicAskingPrice(groundingSnippet);
}

const GENERIC_ASK_TITLE_TOKENS = new Set([
  "rolex", "watch", "watches", "steel", "stainless", "white", "black", "gold", "dial",
  "mens", "womens", "men", "women", "oyster", "ceramic", "automatic", "date", "timepiece",
  "sale", "new", "used", "the", "with", "and", "for", "from",
]);

export function isAskAttributedToListing(snippet: string, title: string, price: number, reference?: string) {
  const haystack = `${title} ${snippet}`;
  const tokens = listingAskIdentityTokens(title, reference);
  if (!tokens.length) return numericText(haystack).includes(numericText(price));
  const matcher = priceBoundaryPattern(price);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(haystack))) {
    const window = haystack.slice(Math.max(0, match.index - 80), match.index + match[0].length + 24).toLowerCase();
    if (tokens.some((token) => window.includes(token))) return true;
  }
  return false;
}

function listingAskIdentityTokens(title: string, reference?: string) {
  const tokens = new Set<string>();
  if (reference) {
    const normalized = reference.toLowerCase();
    tokens.add(normalized);
    tokens.add(normalized.replace(/[^a-z0-9]/g, ""));
    const stem = normalized.split("-")[0];
    if (stem.length >= 4) tokens.add(stem);
  }
  for (const raw of title.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    if (raw.length >= 4 && !GENERIC_ASK_TITLE_TOKENS.has(raw)) tokens.add(raw);
  }
  return [...tokens];
}

function priceBoundaryPattern(price: number) {
  const [intPart, frac] = String(price).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = frac && Number(frac) !== 0 ? `\\.${frac}` : "(?:\\.00)?";
  return new RegExp(`(?<![0-9])(?:${grouped}|${intPart})${fraction}(?![0-9])`, "g");
}

export function listingAskEligibleForSeries(
  row: { source_url: string; title: string; price_usd: number | string; grounding_snippet: string },
  watch: Pick<Watch, "reference_number" | "retail_price_usd" | "scope">,
) {
  return isLikelyProductListingUrl(row.source_url)
    && !classifyListingIdentity(row.title, row.grounding_snippet, watch)
    && !listingPriceSanityReason(Number(row.price_usd), watch)
    && !isListingUnavailable(row.grounding_snippet)
    && isAskAttributedToListing(row.grounding_snippet, row.title, Number(row.price_usd), watch.reference_number);
}

export function listingPriceSanityReason(priceUsd: number, watch: Pick<Watch, "retail_price_usd">) {
  const retail = Number(watch.retail_price_usd);
  if (!Number.isFinite(retail) || retail <= 0 || priceUsd >= retail * MIN_LISTING_PRICE_TO_RETAIL_RATIO) return null;
  return `Price is below ${Math.round(MIN_LISTING_PRICE_TO_RETAIL_RATIO * 100)}% of the saved retail price; retained for review instead of used as a watch ask.`;
}

function classifyListing(listing: ListingCandidate, watch: Watch, priceUsd: number) {
  if (isListingUnavailable(listing.groundingSnippet)) return { match: "out_of_scope" as const, reason: "Listing is marked out of stock.", weight: 0 };
  const priceFailure = listingPriceSanityReason(priceUsd, watch);
  if (priceFailure) return { match: "out_of_scope" as const, reason: priceFailure, weight: 0 };
  return classifyScope(listing, watch);
}

function classifyScope(listing: ListingCandidate, watch: Watch) {
  const identityFailure = classifyListingIdentity(listing.title, listing.groundingSnippet, watch);
  if (identityFailure) return { match: "out_of_scope" as const, reason: identityFailure, weight: 0 };
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

async function markListingNotCurrentAsk(pool: Pool, watchId: string, pageUrl: string) {
  let key = pageUrl.replace(/\/+$/, "");
  try { key = canonicalUrl(pageUrl); } catch { /* Keep the trimmed URL if canonicalization fails. */ }
  await pool.query(
    `UPDATE market_listings
     SET scope_match = false, scope_match_class = 'out_of_scope', scope_weight = 0,
         scope_reason = 'Listing has no public asking price.', updated_at = now()
     WHERE watch_id = $1 AND is_active = true
       AND (
         regexp_replace(source_url, '/+$', '') = $2
         OR regexp_replace(coalesce(detail_url, ''), '/+$', '') = $2
       )`,
    [watchId, key],
  );
}

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

async function createMetrics(pool: Pool, watch: Watch, runId: string) {
  const rows = (await pool.query<{ id: string; title: string; price_usd: string; condition: string | null; scope_match_class: ScopeClass; scope_weight: string; seller_domain: string; source_url: string; grounding_snippet: string }>(
    `SELECT l.id, l.title, l.price_usd, l.condition, l.scope_match_class, l.scope_weight, s.domain AS seller_domain, l.source_url, l.grounding_snippet
     FROM market_listings l JOIN sellers s ON s.id = l.seller_id
     WHERE l.watch_id = $1 AND l.is_active = true AND l.price_usd IS NOT NULL AND l.scope_match_class IN ('in_scope','uncertain')
       AND l.last_seen_at > now() - ($2 || ' days')::interval`, [watch.id, ACTIVE_LISTING_WINDOW_DAYS],
  )).rows;
  // Recheck historical rows here too, so a deployed identity, URL, inquire, or
  // related-item price guard immediately stops old mismatches from contaminating
  // a newly written snapshot.
  const eligibleRows = rows.filter((row) => listingAskEligibleForSeries(row, watch));
  const grey = await savePriceMetric(pool, watch.id, runId, "grey_avg", eligibleRows.filter((row) => row.condition === "unworn"));
  const resell = await savePriceMetric(pool, watch.id, runId, "resell_avg", eligibleRows.filter((row) => row.condition === "pre_owned"));
  await flagAnomalies(pool, watch.id, grey.value, resell.value);
  const availability = await saveAvailability(pool, watch.id, runId, eligibleRows.filter((row) => row.scope_match_class === "in_scope").length);
  return { grey, resell, availability };
}
async function savePriceMetric(pool: Pool, watchId: string, runId: string, metric: "grey_avg" | "resell_avg", rows: Array<{ id: string; price_usd: string; scope_match_class: ScopeClass; scope_weight: string; seller_domain: string; source_url: string; grounding_snippet: string }>) {
  const values = rows.map((row) => ({ ...row, value: Number(row.price_usd), weight: Number(row.scope_weight) }));
  const uncertain = values.filter((row) => row.scope_match_class === "uncertain").length;
  // Confirmed rows set the comparable sample size; uncertain rows still enter the
  // weighted median at UNCERTAIN_LISTING_WEIGHT so thin markets keep a labeled estimate.
  const confirmedCandidates = values.filter((row) => row.scope_match_class === "in_scope");
  const retainedConfirmed = iqrRetained(confirmedCandidates);
  const retainedUncertain = values.filter((row) => row.scope_match_class === "uncertain");
  const retained = [...retainedConfirmed, ...retainedUncertain];
  const value = weightedMedian(retained);
  const certain = retainedConfirmed.length;
  const iqr = interquartileRange(retainedConfirmed.map((row) => row.value)), diversity = Math.min(new Set(retainedConfirmed.map((row) => row.seller_domain)).size / 4, 1), agreement = value ? Math.max(0, 1 - Math.min((iqr ?? 0) / value, 1)) : 0;
  const reliability = priceReliability(value, certain, uncertain);
  const confidence = confidenceFor(Math.min(certain / 8, 1), diversity, agreement, reliability.eligibleForComparison);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO metric_snapshots (watch_id, run_id, metric, value, value_low, value_high, n, n_uncertain, outliers_dropped, conf_sample, conf_diversity, conf_agreement, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [watchId, runId, metric, value, retained.length ? Math.min(...retained.map((row) => row.value)) : null, retained.length ? Math.max(...retained.map((row) => row.value)) : null, certain, uncertain, confirmedCandidates.length - retainedConfirmed.length, Math.min(certain / 8, 1), diversity, agreement, confidence],
  );
  for (const row of retained) await pool.query("INSERT INTO evidence (run_id, watch_id, attached_to, attached_id, url, domain, quote) VALUES ($1,$2,'snapshot',$3,$4,$5,$6)", [runId, watchId, inserted.rows[0].id, row.source_url, row.seller_domain, row.grounding_snippet?.slice(0, 300) ?? row.source_url]);
  // Persist the estimate even when provisional/withheld so the UI can show a
  // labeled number; movers/alerts still require eligibleForComparison.
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
export function iqrRetained<T extends { value: number }>(rows: T[]) {
  if (rows.length < 4) return rows;
  const values = rows.map((row) => row.value).sort((a, b) => a - b);
  const q1 = quantile(values, .25), q3 = quantile(values, .75), iqr = q3 - q1;
  // A mode-heavy sample can have zero IQR even when one normal, nearby ask
  // differs slightly. In that case there is no spread from which to derive an
  // outlier boundary, so retain the observed in-scope rows.
  if (iqr === 0) return rows;
  return rows.filter((row) => row.value >= q1 - 1.5 * iqr && row.value <= q3 + 1.5 * iqr);
}
function weightedMedian<T extends { value: number; weight: number }>(rows: T[]) { if (!rows.length) return null; const sorted = [...rows].sort((a, b) => a.value - b.value), total = sorted.reduce((sum, row) => sum + row.weight, 0); let sum = 0; for (const row of sorted) { sum += row.weight; if (sum >= total / 2) return row.value; } return sorted.at(-1)!.value; }
function interquartileRange(values: number[]) { return values.length ? quantile([...values].sort((a, b) => a - b), .75) - quantile([...values].sort((a, b) => a - b), .25) : null; }
function quantile(values: number[], p: number) { const index = (values.length - 1) * p, lower = Math.floor(index), upper = Math.ceil(index); return values[lower] + (values[upper] - values[lower]) * (index - lower); }

function sellerForUrl(url: string, sellers: Seller[]) { try { const host = new URL(url).hostname.toLowerCase(); return sellers.find((seller) => host === seller.domain || host.endsWith(`.${seller.domain}`)); } catch { return undefined; } }
function resolveUrl(value: string | null, base: string) { try { return value ? new URL(value, base).href : null; } catch { return null; } }
function canonicalUrl(value: string) { const url = new URL(value); url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key); return url.href.replace(/\/$/, ""); }
function htmlToText(html: string) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").trim().slice(0, 100_000); }
function metaContent(html: string, property: string) {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of tag[0].matchAll(/\b([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4]);
    }
    if ((attributes.get("property") ?? attributes.get("name"))?.toLowerCase() === property.toLowerCase()) return attributes.get("content") ?? null;
  }
  return null;
}
function loosePagePrice(html: string) {
  const product = metaContent(html, "product:price:amount");
  if (product) return { raw: product, source: "product:price:amount" };
  const og = metaContent(html, "og:price:amount");
  if (og) return { raw: og, source: "og:price:amount" };
  const itemprop = itempropContent(html, "price");
  if (itemprop) return { raw: itemprop, source: "itemprop:price" };
  return null;
}
function itempropContent(html: string, itemprop: string) {
  for (const match of html.matchAll(/<(meta|span|div|p|strong|b|data)\b([^>]*)>/gi)) {
    const tagName = match[1].toLowerCase();
    const attributes = new Map<string, string>();
    for (const attribute of match[2].matchAll(/\b([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4]);
    }
    if (attributes.get("itemprop")?.toLowerCase() !== itemprop.toLowerCase()) continue;
    const fromAttr = attributes.get("content") ?? attributes.get("value");
    if (fromAttr?.trim() && parseNumber(fromAttr)) return fromAttr.trim();
    if (tagName === "meta") continue;
    const start = match.index! + match[0].length;
    const inner = innerTextUntilBalancedClose(html, start, tagName);
    if (inner && parseNumber(inner)) return inner;
  }
  return null;
}
function innerTextUntilBalancedClose(html: string, start: number, tagName: string) {
  const finder = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}\\s*>`, "gi");
  const region = html.slice(start);
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = finder.exec(region))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return region.slice(0, match.index).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
      continue;
    }
    if (!/\/\s*>$/.test(match[0])) depth += 1;
  }
  return "";
}
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function parseNumber(value: unknown) { const number = Number(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(number) ? number : null; }
function findYear(text: string) { const year = text.match(/\b(?:19|20)\d{2}\b/)?.[0]; return year ? Number(year) : null; }
function numericText(value: string | number) { return String(value).replace(/\D/g, ""); }
function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function stableHash(value: string) { return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unknown error"; }
