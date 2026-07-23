import type { Pool } from "pg";
import { normalizeReference, type WatchDraft } from "@/lib/catalog";

type Environment = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

export type WatchBaseCandidate = WatchDraft & { id: string };

const apiBase = "https://api.watchbase.com/v1";
const maxCandidates = 8;

export function watchBaseConfigurationError(env: Environment = process.env) {
  if (!env.WATCHBASE_API_KEY) return "WATCHBASE_API_KEY is required for WatchBase lookup.";
  const cap = Number(env.WATCHBASE_LOOKUP_MONTHLY_CREDIT_CAP);
  return Number.isInteger(cap) && cap > 0 ? null : "WATCHBASE_LOOKUP_MONTHLY_CREDIT_CAP must be a positive integer before WatchBase lookup is enabled.";
}

export async function lookupWatchBase(pool: Pool, reference: string, options: { env?: Environment; fetchFn?: FetchLike } = {}) {
  const env = options.env ?? process.env, configurationError = watchBaseConfigurationError(env);
  if (configurationError) throw new Error(configurationError);
  const normalizedReference = normalizeReference(reference);
  await reserveWatchBaseCredit(pool, env);
  const url = new URL(`${apiBase}/search/refnr`);
  url.searchParams.set("key", env.WATCHBASE_API_KEY!);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", normalizedReference);
  const response = await (options.fetchFn ?? fetch)(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`WatchBase lookup failed with HTTP ${response.status}.`);
  return watchBaseCandidates(await response.json(), normalizedReference);
}

export async function getWatchBaseDetails(pool: Pool, id: string, reference: string, options: { env?: Environment; fetchFn?: FetchLike } = {}) {
  const env = options.env ?? process.env, configurationError = watchBaseConfigurationError(env);
  if (configurationError) throw new Error(configurationError);
  await reserveWatchBaseCredit(pool, env);
  const url = new URL(`${apiBase}/watch`);
  url.searchParams.set("key", env.WATCHBASE_API_KEY!);
  url.searchParams.set("format", "json");
  url.searchParams.set("id", id);
  const response = await (options.fetchFn ?? fetch)(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`WatchBase detail lookup failed with HTTP ${response.status}.`);
  const candidates = watchBaseCandidates(await response.json(), reference);
  const match = candidates.find((candidate) => candidate.id === id) ?? candidates[0];
  if (!match) throw new Error("WatchBase returned no usable Rolex details for this reference.");
  return match;
}

export function watchBaseCandidates(payload: unknown, searchedReference: string): WatchBaseCandidate[] {
  const normalizedReference = normalizeReference(searchedReference);
  const candidates = recordsIn(payload)
    .map((record) => candidateFromRecord(record, normalizedReference))
    .filter((candidate): candidate is WatchBaseCandidate => candidate !== null);
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
    .sort((left, right) => exactRank(left.referenceNumber, normalizedReference) - exactRank(right.referenceNumber, normalizedReference) || left.referenceNumber.localeCompare(right.referenceNumber))
    .slice(0, maxCandidates);
}

export async function reserveWatchBaseCredit(pool: Pool, env: Environment = process.env) {
  const cap = Number(env.WATCHBASE_LOOKUP_MONTHLY_CREDIT_CAP);
  if (!Number.isInteger(cap) || cap < 1) throw new Error("WATCHBASE_LOOKUP_MONTHLY_CREDIT_CAP must be a positive integer before WatchBase lookup is enabled.");
  const key = `watchbase_credits:${new Date().toISOString().slice(0, 7)}`;
  const result = await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, jsonb_build_object('used', 1))
     ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('used', COALESCE((settings.value->>'used')::integer, 0) + 1), updated_at = now()
       WHERE COALESCE((settings.value->>'used')::integer, 0) + 1 <= $2::integer
     RETURNING value`, [key, cap],
  );
  if (!result.rowCount) throw new Error(`WatchBase monthly lookup cap (${cap}) has been reached; new archive lookups are paused.`);
}

function recordsIn(value: unknown): JsonRecord[] {
  const records: JsonRecord[] = [], seen = new Set<unknown>();
  function visit(current: unknown) {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) { current.forEach(visit); return; }
    const record = current as JsonRecord;
    if (referenceFrom(record) && (stringFrom(record, ["name", "model", "title"]) || stringFrom(record, ["id", "watch_id"]))) records.push(record);
    Object.values(record).forEach(visit);
  }
  visit(value);
  return records;
}

function candidateFromRecord(record: JsonRecord, searchedReference: string): WatchBaseCandidate | null {
  const referenceNumber = referenceFrom(record);
  if (!referenceNumber) return null;
  const brand = stringFrom(record, ["brand.name", "brand", "brand_name"]);
  if (brand && brand.toLowerCase() !== "rolex") return null;
  const family = stringFrom(record, ["family.name", "family", "family_name"]);
  const name = stringFrom(record, ["name", "model", "title"]) ?? `${brand ?? "Rolex"} ${family ?? "watch"}`;
  const id = stringFrom(record, ["id", "watch_id"]) ?? referenceNumber;
  const caseInfo = objectFrom(record, ["case", "case_info"]), dial = objectFrom(record, ["dial"]), bracelet = objectFrom(record, ["bracelet", "strap"]), caliber = objectFrom(record, ["caliber", "movement"]);
  const sourceUrl = stringFrom(record, ["url", "source_url"]) ?? `https://watchbase.com/search#q=${encodeURIComponent(referenceNumber)}`;
  return {
    id,
    referenceNumber,
    modelName: [brand, family].filter(Boolean).join(" ") || name,
    nickname: nicknameFrom(name, family),
    retailPriceUsd: null,
    discontinued: false,
    photoSourceUrl: null,
    specs: compactSpecs({
      caseSizeMm: numberFrom(caseInfo, ["diameter", "diameter_mm", "size"]),
      dial: stringFrom(dial, ["color", "name"]) ?? undefined,
      bezel: stringFrom(caseInfo, ["bezel"]) ?? undefined,
      bracelet: stringFrom(bracelet, ["name", "type", "material"]) ?? undefined,
      movement: stringFrom(caliber, ["name", "reference", "number"]) ?? stringFrom(record, ["movement", "caliber_name"]) ?? undefined,
      material: stringFrom(caseInfo, ["material", "materials"]) ?? undefined,
    }),
    source: { name: "WatchBase API", url: sourceUrl, note: `WatchBase archive match for ${searchedReference}. Confirm the exact variant and current MSRP before saving.` },
  };
}

function exactRank(reference: string, searchedReference: string) { return normalizeReference(reference) === searchedReference ? 0 : 1; }
function objectFrom(record: JsonRecord, paths: string[]) { for (const path of paths) { const value = valueAt(record, path); if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord; } return {}; }
function stringFrom(record: JsonRecord, paths: string[]) { for (const path of paths) { const value = valueAt(record, path); if (typeof value === "string" && value.trim()) return value.trim(); if (typeof value === "number") return String(value); if (Array.isArray(value)) { const joined = value.filter((item): item is string => typeof item === "string").join(", "); if (joined) return joined; } } return null; }
function numberFrom(record: JsonRecord, paths: string[]) { for (const path of paths) { const value = valueAt(record, path), number = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN; if (Number.isFinite(number) && number > 0) return number; } return undefined; }
function valueAt(record: JsonRecord, path: string): unknown { return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" && !Array.isArray(current) ? (current as JsonRecord)[key] : undefined, record); }
function referenceFrom(record: JsonRecord) { const reference = stringFrom(record, ["reference_number", "reference", "refnr", "referenceNumber", "ref"]); return reference ? normalizeReference(reference) : null; }
function nicknameFrom(name: string, family: string | null) { const nickname = name.replace(/^Rolex\s+/i, "").replace(/^Cosmograph\s+/i, "").trim() || family || "WatchBase match"; return nickname.slice(0, 80); }
function compactSpecs(specs: WatchDraft["specs"]) { return Object.fromEntries(Object.entries(specs).filter(([, value]) => value !== null && value !== undefined && value !== "")) as WatchDraft["specs"]; }
