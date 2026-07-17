import type { Pool } from "pg";
import type { Watch } from "@/lib/watches";
import { confidenceFor } from "@/lib/phase1b";
import { NEWS_MAX_AGE_DAYS, sentimentLabel, WAITLIST_MIN_ANECDOTES, waitlistConfidence, weightedQuantile } from "@/lib/phase2";

type SearchResult = { url: string; title: string };
type Source = SearchResult & { text: string; domain: string };
type ClaudeAnecdote = { reportedMonths?: number; reportedDate?: string | null; region?: string | null; purchaseContext?: string | null; quote?: string };
type ClaudeNews = { index?: number; summary?: string; quote?: string };
type ClaudeSentiment = { desirability?: number; criticism?: number; hype?: number; rationale?: string; quotes?: Array<{ index?: number; quote?: string }> };

const userAgent = "CrownTracker/1.1 market research (+personal dashboard)";
const robotsCache = new Map<string, Promise<string | null>>();
const lastRequestByDomain = new Map<string, number>();

export async function researchChatterWatch(pool: Pool, watch: Watch, runId: string) {
  ensureProviders();
  const results = await search(pool, [
    `Rolex ${watch.reference_number} waitlist wait time`,
    `${watch.model_name} Rolex AD wait time`,
    `${watch.nickname ? `${watch.nickname} ` : ""}Rolex ${watch.reference_number} waitlist`,
  ]);
  const sources = await readSources(results.slice(0, 12));
  const anecdoteCount = await saveAnecdotes(pool, watch.id, runId, sources);
  const waitlist = await saveWaitlistMetric(pool, watch.id, runId);
  const sentiment = await saveSentimentMetric(pool, watch.id, runId, sources);
  return { discoveryQueries: 3, pagesRead: sources.length, anecdoteCount, waitlist, sentiment };
}

export async function researchNewsWatch(pool: Pool, watch: Watch, runId: string) {
  ensureProviders();
  const results = await search(pool, [`Rolex ${watch.reference_number}${watch.nickname ? ` ${watch.nickname}` : ""} news`]);
  const sources = await readSources(results.slice(0, 10));
  const filtered = await extractNews(sources);
  let saved = 0;
  for (const item of filtered) {
    const source = item.index === undefined ? undefined : sources[item.index];
    const quote = compactQuote(item.quote);
    if (!source || !item.summary || !quote || !containsQuote(source.text, quote)) continue;
    const result = await pool.query<{ id: string }>(
      "INSERT INTO news_items (watch_id, run_id, source_url, domain, title, summary, quote) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [watch.id, runId, source.url, source.domain, source.title.slice(0, 500), item.summary.slice(0, 500), quote],
    );
    await addEvidence(pool, runId, watch.id, "news", result.rows[0].id, source.url, source.domain, quote, "news_page");
    saved += 1;
  }
  return { discoveryQueries: 1, pagesRead: sources.length, saved };
}

// Unknown sellers are researched only after they exist in the local seller
// table. Curated seed scores are never replaced by model inference.
export async function researchUncuratedSellers(pool: Pool, runId: string) {
  ensureProviders();
  const sellers = (await pool.query<{ id: string; name: string; jurisdiction_modifier: number }>(
    "SELECT id, name, jurisdiction_modifier FROM sellers WHERE curated = false AND (last_researched_at IS NULL OR last_researched_at < now() - interval '30 days') ORDER BY last_researched_at NULLS FIRST LIMIT 12",
  )).rows;
  let queries = 0, updated = 0;
  for (const seller of sellers) {
    const sources = await readSources((await search(pool, [`${seller.name} watch dealer review legit scam`])).slice(0, 6));
    queries += 1;
    const judgment = await callClaude<{ score?: number; rationale?: string; quotes?: Array<{ index?: number; quote?: string }> }>(
      `Assess this watch seller only from the supplied source excerpts. Return JSON {"score":0..100,"rationale":"short evidence-grounded explanation","quotes":[{"index":0,"quote":"exact source text"}]}. Require at least two grounded quotes. Do not claim facts not in the excerpts.\n${sourcePrompt(sources)}`,
      700,
    );
    const quotes = (judgment.quotes ?? []).flatMap((item) => {
      const source = item.index === undefined ? undefined : sources[item.index], quote = compactQuote(item.quote);
      return source && quote && containsQuote(source.text, quote) ? [{ source, quote }] : [];
    });
    if (!Number.isInteger(judgment.score) || judgment.score! < 0 || judgment.score! > 100 || !judgment.rationale || quotes.length < 2) continue;
    const score = Math.max(0, Math.min(100, judgment.score! + seller.jurisdiction_modifier));
    const result = await pool.query<{ id: string }>(
      "INSERT INTO seller_research (seller_id, run_id, score, rationale, source_count) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [seller.id, runId, score, judgment.rationale.slice(0, 500), quotes.length],
    );
    for (const item of quotes) await addEvidence(pool, runId, null, "seller_research", result.rows[0].id, item.source.url, item.source.domain, item.quote, "seller_research");
    await pool.query("UPDATE sellers SET trust_score = $1, trust_rationale = $2, last_researched_at = now() WHERE id = $3", [score, judgment.rationale.slice(0, 500), seller.id]);
    updated += 1;
  }
  return { discoveryQueries: queries, sellersConsidered: sellers.length, updated };
}

async function saveAnecdotes(pool: Pool, watchId: string, runId: string, sources: Source[]) {
  let saved = 0;
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const output = await callClaude<{ anecdotes?: ClaudeAnecdote[] }>(
      `Extract dated Rolex wait-time anecdotes from this source only. Return JSON {"anecdotes":[{"reportedMonths":number,"reportedDate":"YYYY-MM-DD"|null,"region":string|null,"purchaseContext":string|null,"quote":"exact source text"}]}. Include an item only if the wait and date are explicitly supported. Never infer.\nSource URL: ${source.url}\nText: ${source.text.slice(0, 12000)}`,
      700,
    );
    for (const item of output.anecdotes ?? []) {
      const quote = compactQuote(item.quote), months = Number(item.reportedMonths);
      if (!quote || !containsQuote(source.text, quote) || !Number.isFinite(months) || months <= 0 || months > 240 || !validDate(item.reportedDate)) continue;
      const result = await pool.query<{ id: string }>(
        "INSERT INTO community_anecdotes (watch_id, run_id, source_url, domain, quote, reported_at, wait_months, region, purchase_context) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        [watchId, runId, source.url, source.domain, quote, `${item.reportedDate}T12:00:00Z`, months, item.region?.slice(0, 120) ?? null, item.purchaseContext?.slice(0, 300) ?? null],
      );
      await addEvidence(pool, runId, watchId, "anecdote", result.rows[0].id, source.url, source.domain, quote, "community_post");
      saved += 1;
    }
  }
  return saved;
}

async function saveWaitlistMetric(pool: Pool, watchId: string, runId: string) {
  const anecdotes = (await pool.query<{ id: string; source_url: string; domain: string; quote: string; wait_months: string; reported_at: Date }>(
    `SELECT DISTINCT ON (source_url, quote) id, source_url, domain, quote, wait_months, reported_at
     FROM community_anecdotes WHERE watch_id = $1 AND reported_at >= now() - interval '365 days' AND wait_months IS NOT NULL
     ORDER BY source_url, quote, retrieved_at DESC`, [watchId],
  )).rows;
  if (anecdotes.length < WAITLIST_MIN_ANECDOTES) {
    await pool.query("INSERT INTO metric_snapshots (watch_id, run_id, metric, label, n, confidence) VALUES ($1,$2,'waitlist','Insufficient chatter to estimate',$3,'insufficient')", [watchId, runId, anecdotes.length]);
    return { n: anecdotes.length, low: null, high: null, confidence: "insufficient" };
  }
  const now = Date.now();
  const weighted = anecdotes.map((item) => ({ value: Number(item.wait_months), weight: Math.pow(.5, (now - item.reported_at.getTime()) / (90 * 86_400_000)) }));
  const low = weightedQuantile(weighted, .25), high = weightedQuantile(weighted, .75);
  if (low === null || high === null) return { n: anecdotes.length, low: null, high: null, confidence: "insufficient" };
  const sample = Math.min(anecdotes.length / 6, 1), diversity = Math.min(new Set(anecdotes.map((item) => item.domain)).size / 3, 1);
  const confidence = waitlistConfidence(sample, diversity, low, high);
  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO metric_snapshots (watch_id, run_id, metric, value_low, value_high, label, n, conf_sample, conf_diversity, conf_agreement, confidence) VALUES ($1,$2,'waitlist',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
    [watchId, runId, low, high, `≈ ${formatMonths(low)}–${formatMonths(high)} months`, anecdotes.length, sample, diversity, confidence.agreement, confidence.confidence],
  );
  for (const item of anecdotes) await addEvidence(pool, runId, watchId, "snapshot", inserted.rows[0].id, item.source_url, item.domain, item.quote, "community_post");
  return { n: anecdotes.length, low, high, confidence: confidence.confidence };
}

async function saveSentimentMetric(pool: Pool, watchId: string, runId: string, sources: Source[]) {
  if (sources.length < 3) return { n: sources.length, confidence: "insufficient" };
  let output: ClaudeSentiment | null = null;
  for (let attempt = 0; attempt < 2 && !output; attempt += 1) {
    const response = await callClaude<ClaudeSentiment>(
      `Score Rolex community sentiment from these sources using this fixed rubric. desirability: excitement trajectory (-2..2); criticism: recurring negatives (-2..2, negative is more criticism); hype: hype versus fatigue (-2..2). Return JSON {"desirability":number,"criticism":number,"hype":number,"rationale":"one sentence","quotes":[{"index":0,"quote":"exact source text"}]}. Require three grounded quotes from distinct sources; do not infer.\n${sourcePrompt(sources)}`,
      900,
    );
    const quotes = response.quotes ?? [];
    const grounded = quotes.filter((item) => item.index !== undefined && sources[item.index] && compactQuote(item.quote) && containsQuote(sources[item.index].text, compactQuote(item.quote)!));
    if (grounded.length >= 3 && new Set(grounded.map((item) => item.index)).size >= 3) output = response;
  }
  if (!output || ![-2, -1, 0, 1, 2].includes(output.desirability ?? 99) || ![-2, -1, 0, 1, 2].includes(output.criticism ?? 99) || ![-2, -1, 0, 1, 2].includes(output.hype ?? 99)) return { n: sources.length, confidence: "insufficient" };
  const values = [output.desirability!, output.criticism!, output.hype!], runValue = values.reduce((sum, item) => sum + item, 0) / 3;
  const previous = await pool.query<{ value: string }>("SELECT value FROM metric_snapshots WHERE watch_id = $1 AND metric = 'sentiment' AND value IS NOT NULL ORDER BY computed_at DESC LIMIT 1", [watchId]);
  // EWMA (α = 0.3) dampens LLM run-to-run variation while retaining the raw
  // rubric agreement in this immutable snapshot's confidence components.
  const value = previous.rows[0] ? Number(previous.rows[0].value) * .7 + runValue * .3 : runValue;
  const deviation = Math.sqrt(values.reduce((sum, item) => sum + (item - runValue) ** 2, 0) / values.length);
  const sample = Math.min(sources.length / 10, 1), diversity = Math.min(new Set(sources.map((item) => item.domain)).size / 3, 1), agreement = Math.max(0, 1 - deviation / 2), confidence = confidenceFor(sample, diversity, agreement, true);
  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO metric_snapshots (watch_id, run_id, metric, value, label, n, conf_sample, conf_diversity, conf_agreement, confidence) VALUES ($1,$2,'sentiment',$3,$4,$5,$6,$7,$8,$9) RETURNING id",
    [watchId, runId, value, sentimentLabel(value), sources.length, sample, diversity, agreement, confidence],
  );
  for (const item of output.quotes ?? []) {
    const source = item.index === undefined ? undefined : sources[item.index], quote = compactQuote(item.quote);
    if (source && quote && containsQuote(source.text, quote)) await addEvidence(pool, runId, watchId, "snapshot", inserted.rows[0].id, source.url, source.domain, quote, "community_post");
  }
  return { n: sources.length, value, confidence };
}

async function extractNews(sources: Source[]) {
  const output = await callClaude<{ items?: ClaudeNews[] }>(
    `Identify only news genuinely about this Rolex reference from the source excerpts. Return JSON {"items":[{"index":0,"summary":"one concise sentence","quote":"exact source text"}]}. Skip general Rolex news and rumors without source support.\n${sourcePrompt(sources)}`,
    900,
  );
  return output.items ?? [];
}

async function search(pool: Pool, queries: string[]) {
  const apiKey = process.env.TAVILY_API_KEY!;
  const unique = new Map<string, SearchResult>();
  for (const query of queries) {
    await reserveSearchCredit(pool, 2);
    const response = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ query, search_depth: "advanced", max_results: 12, include_answer: false }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Tavily discovery failed with HTTP ${response.status}.`);
    const body = await response.json() as { results?: Array<{ url?: string; title?: string }> };
    for (const result of body.results ?? []) if (result.url && httpUrl(result.url)) unique.set(canonicalUrl(result.url), { url: result.url, title: result.title?.trim() || "Untitled source" });
  }
  return [...unique.values()];
}

async function readSources(results: SearchResult[]) {
  const sources: Source[] = [];
  for (const result of results) {
    const text = await fetchPermitted(result.url);
    if (text) sources.push({ ...result, text, domain: new URL(result.url).hostname.toLowerCase() });
  }
  return sources;
}

async function fetchPermitted(value: string) {
  let url = new URL(value);
  try {
    for (let redirects = 0; redirects < 4; redirects += 1) {
      if (!(await allowedByRobots(url))) return null;
      await rateLimit(url.hostname);
      const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location"); if (!location) return null;
        url = new URL(location, url); continue;
      }
      if (!response.ok || !/(text\/html|application\/xhtml\+xml)/i.test(response.headers.get("content-type") ?? "")) return null;
      return toText(await response.text());
    }
  } catch { return null; }
  return null;
}

async function allowedByRobots(url: URL) {
  const robots = robotsCache.get(url.origin) ?? getRobots(url.origin); robotsCache.set(url.origin, robots);
  const body = await robots;
  if (body === null) return false;
  const groups = parseRobots(body), matching = groups.filter((group) => group.agents.includes("crowntracker") || group.agents.includes("*"));
  const rank = Math.max(...matching.map((group) => group.agents.includes("crowntracker") ? 2 : 1), 0);
  const rules = matching.filter((group) => (group.agents.includes("crowntracker") ? 2 : 1) === rank).flatMap((group) => group.rules);
  let winner: { allow: boolean; path: string } | undefined;
  for (const rule of rules) if (pathMatches(rule.path, url.pathname) && (!winner || rule.path.length >= winner.path.length)) winner = rule;
  return winner?.allow ?? true;
}

async function getRobots(origin: string) {
  try {
    const response = await fetch(new URL("/robots.txt", origin), { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(10_000) });
    return response.ok ? response.text() : null;
  } catch { return null; }
}

async function rateLimit(host: string) {
  const delay = (lastRequestByDomain.get(host) ?? 0) + 5_000 - Date.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastRequestByDomain.set(host, Date.now());
}

async function callClaude<T>(prompt: string, maxTokens: number): Promise<T> {
  // Assistant prefilling is Anthropic's supported way to force a non-thinking
  // response to begin as JSON. All current Phase 2 prompts return objects.
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: process.env.ANTHROPIC_HAIKU_MODEL ?? "claude-haiku-4-5-20251001", max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content: prompt }, { role: "assistant", content: "{" }] }), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Anthropic extraction failed with HTTP ${response.status}.`);
  const body = await response.json() as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string };
  const text = `{${body.content?.filter((item) => item.type === "text" || item.text).map((item) => item.text ?? "").join("") ?? ""}`;
  try { return parseClaudeJson<T>(text); }
  catch {
    // Do not log model text: it can contain source excerpts. These fields make
    // a provider/model issue diagnosable without exposing retained research.
    throw new Error(`Anthropic returned no JSON object (stop_reason=${body.stop_reason ?? "unknown"}, text_chars=${Math.max(0, text.length - 1)}).`);
  }
}

/** Claude is instructed to return JSON, but an otherwise useful response can
 * contain a markdown fence or a short trailing explanation. Keep the first
 * complete JSON value and reject malformed content rather than failing on the
 * harmless suffix. */
export function parseClaudeJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return JSON.parse(fenced.trim()) as T;
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const end = endOfJsonValue(text, start);
    if (end === null) continue;
    try { return JSON.parse(text.slice(start, end + 1)) as T; } catch { /* Try the next possible JSON value. */ }
  }
  throw new Error("Anthropic response did not contain a complete JSON object or array.");
}

function endOfJsonValue(text: string, start: number) {
  const stack: string[] = [];
  let inString = false, escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const opener = stack.pop();
      if ((character === "}" && opener !== "{") || (character === "]" && opener !== "[")) return null;
      if (!stack.length) return index;
    }
  }
  return null;
}

async function reserveSearchCredit(pool: Pool, credits: number) {
  const cap = Number(process.env.TAVILY_MONTHLY_CREDIT_CAP);
  if (!Number.isInteger(cap) || cap < 1) throw new Error("TAVILY_MONTHLY_CREDIT_CAP must be a positive integer for Phase 2 research.");
  const key = `tavily_credits:${new Date().toISOString().slice(0, 7)}`;
  const result = await pool.query("INSERT INTO settings (key, value) VALUES ($1, jsonb_build_object('used', $2::integer)) ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('used', COALESCE((settings.value->>'used')::integer, 0) + $2::integer), updated_at = now() WHERE COALESCE((settings.value->>'used')::integer, 0) + $2::integer <= $3::integer RETURNING value", [key, credits, cap]);
  if (!result.rowCount) throw new Error(`Tavily monthly credit cap (${cap}) has been reached; Phase 2 scans are paused.`);
}

async function addEvidence(pool: Pool, runId: string, watchId: string | null, attachedTo: "anecdote" | "news" | "seller_research" | "snapshot", attachedId: string, url: string, domain: string, quote: string, sourceType: string) {
  await pool.query("INSERT INTO evidence (run_id, watch_id, attached_to, attached_id, url, domain, quote, source_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [runId, watchId, attachedTo, attachedId, url, domain, quote, sourceType]);
}

function ensureProviders() { if (!process.env.TAVILY_API_KEY || !process.env.ANTHROPIC_API_KEY || !process.env.TAVILY_MONTHLY_CREDIT_CAP) throw new Error("Phase 2 research requires TAVILY_API_KEY, ANTHROPIC_API_KEY, and TAVILY_MONTHLY_CREDIT_CAP."); }
function sourcePrompt(sources: Source[]) { return sources.map((source, index) => `[#${index}] ${source.url}\n${source.text.slice(0, 6000)}`).join("\n\n"); }
function compactQuote(value: unknown) { return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, 300) : null; }
function containsQuote(text: string, quote: string) { return toText(text).toLowerCase().includes(quote.toLowerCase()); }
function validDate(value: unknown) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)); }
function formatMonths(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function toText(html: string) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").trim().slice(0, 100_000); }
function canonicalUrl(value: string) { const url = new URL(value); url.hash = ""; return url.href.replace(/\/$/, ""); }
function httpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function pathMatches(pattern: string, path: string) { return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`).test(path); }
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
