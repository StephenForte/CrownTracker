import type { Pool } from "pg";
import { LINK_CHECK_MAX_PER_RUN, LINK_CHECK_STALE_DAYS } from "@/lib/phase2";

export type LinkHealthStatus = "reachable" | "offline" | "unreachable" | "blocked_by_robots" | "invalid";
type Candidate = { evidence_id: string; url: string };
type CheckResult = { status: LinkHealthStatus; httpStatus: number | null; error: string | null };

const userAgent = "CrownTracker/1.1 link health (+personal dashboard)";
const robotsCache = new Map<string, Promise<string | null>>();
const lastRequestByDomain = new Map<string, number>();
const requestIntervalMs = 5_000;

export async function checkLatestEvidenceLinks(pool: Pool, runId: string) {
  const candidates = await pool.query<Candidate>(
    `WITH latest_snapshots AS (
       SELECT DISTINCT ON (m.watch_id, m.metric) m.id
       FROM metric_snapshots m JOIN watches w ON w.id = m.watch_id
       WHERE w.status = 'active'
       ORDER BY m.watch_id, m.metric, m.computed_at DESC
     ), latest_urls AS (
       SELECT DISTINCT ON (e.url) e.id AS evidence_id, e.url, e.retrieved_at
       FROM evidence e JOIN latest_snapshots s ON e.attached_to = 'snapshot' AND e.attached_id = s.id
       WHERE NOT EXISTS (
         SELECT 1 FROM link_checks c
         WHERE c.url = e.url AND c.checked_at >= now() - ($1 || ' days')::interval
       )
       ORDER BY e.url, e.retrieved_at DESC
     )
     SELECT evidence_id, url FROM latest_urls ORDER BY retrieved_at ASC LIMIT $2`,
    [LINK_CHECK_STALE_DAYS, LINK_CHECK_MAX_PER_RUN],
  );
  const summary: Record<LinkHealthStatus, number> = { reachable: 0, offline: 0, unreachable: 0, blocked_by_robots: 0, invalid: 0 };
  for (const candidate of candidates.rows) {
    const result = await checkLink(candidate.url);
    await pool.query(
      "INSERT INTO link_checks (evidence_id, url, status, http_status, error) VALUES ($1,$2,$3,$4,$5)",
      [candidate.evidence_id, candidate.url, result.status, result.httpStatus, result.error],
    );
    summary[result.status] += 1;
  }
  return { checked: candidates.rowCount, ...summary };
}

export function classifyLinkResponse(status: number): LinkHealthStatus {
  if (status >= 200 && status < 400) return "reachable";
  if (status === 404 || status === 410) return "offline";
  return "unreachable";
}

export function isSafeLinkUrl(value: string) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (host === "localhost" || host === "::1" || host === "[::1]" || host.includes(":") || host.endsWith(".localhost")) return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return true;
    const octets = ipv4.slice(1).map(Number);
    return !(octets.some((part) => part > 255) || octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  } catch { return false; }
}

async function checkLink(value: string): Promise<CheckResult> {
  if (!isSafeLinkUrl(value)) return { status: "invalid", httpStatus: null, error: "URL is not a permitted public HTTP(S) address." };
  let url = new URL(value);
  try {
    for (let redirects = 0; redirects < 4; redirects += 1) {
      if (!(await allowedByRobots(url))) return { status: "blocked_by_robots", httpStatus: null, error: "Robots policy does not permit a health check." };
      await rateLimit(url.hostname);
      let response = await fetch(url, { method: "HEAD", headers: { "User-Agent": userAgent }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      // Some valid sources reject HEAD. A minimal GET still avoids downloading
      // the body and produces a useful reachability result.
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, { method: "GET", headers: { "User-Agent": userAgent, Range: "bytes=0-0" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { status: "unreachable", httpStatus: response.status, error: "Redirect response did not include a location." };
        url = new URL(location, url);
        if (!isSafeLinkUrl(url.href)) return { status: "invalid", httpStatus: null, error: "Redirected to a non-public or unsupported URL." };
        continue;
      }
      return { status: classifyLinkResponse(response.status), httpStatus: response.status, error: null };
    }
    return { status: "unreachable", httpStatus: null, error: "Too many redirects." };
  } catch (error) {
    return { status: "unreachable", httpStatus: null, error: error instanceof Error ? error.message.slice(0, 500) : "Network check failed." };
  }
}

async function allowedByRobots(url: URL) {
  const robots = robotsCache.get(url.origin) ?? getRobots(url.origin); robotsCache.set(url.origin, robots);
  const body = await robots;
  if (body === null) return false;
  const groups = parseRobots(body), matching = groups.filter((group) => group.agents.includes("crowntracker") || group.agents.includes("*"));
  const rank = Math.max(...matching.map((group) => group.agents.includes("crowntracker") ? 2 : 1), 0);
  const rules = matching.filter((group) => (group.agents.includes("crowntracker") ? 2 : 1) === rank).flatMap((group) => group.rules);
  let winner: { allow: boolean; path: string } | undefined;
  for (const rule of rules) if (rule.path && pathMatches(rule.path, `${url.pathname}${url.search}`) && (!winner || rule.path.length >= winner.path.length)) winner = rule;
  return winner?.allow ?? true;
}

async function getRobots(origin: string) {
  try {
    const response = await fetch(new URL("/robots.txt", origin), { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return "";
    return response.ok ? response.text() : null;
  } catch { return null; }
}

async function rateLimit(host: string) {
  const delay = (lastRequestByDomain.get(host) ?? 0) + requestIntervalMs - Date.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastRequestByDomain.set(host, Date.now());
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

function pathMatches(pattern: string, path: string) {
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`).test(path);
}
