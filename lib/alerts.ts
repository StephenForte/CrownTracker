import type { Pool } from "pg";
import { PRICE_OUTDATED_AFTER_HOURS, PRICE_STALE_AFTER_HOURS } from "@/lib/phase1b";

export type WatchAlert = { watch_id: string; grey_above: string | null; grey_below: string | null; resell_above: string | null; resell_below: string | null };
export type BudgetStatus = { used: number; cap: number | null; percentage: number | null; state: "normal" | "warning" | "paused" | "unconfigured" };

const RESEND_URL = "https://api.resend.com/emails";

export function notificationConfigurationError(env: NodeJS.ProcessEnv = process.env) {
  const supplied = [env.RESEND_API_KEY, env.ALERT_FROM_EMAIL, env.ALERT_TO_EMAIL].filter(Boolean).length;
  if (supplied === 0) return null;
  if (!env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL || !env.ALERT_TO_EMAIL) return "RESEND_API_KEY, ALERT_FROM_EMAIL, and ALERT_TO_EMAIL must be set together to enable email alerts.";
  return null;
}

export function emailAlertsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return notificationConfigurationError(env) === null && Boolean(env.RESEND_API_KEY);
}

export function currentBudgetStatus(value: unknown, capRaw = process.env.TAVILY_MONTHLY_CREDIT_CAP): BudgetStatus {
  const cap = Number(capRaw);
  if (!Number.isInteger(cap) || cap < 1) return { used: 0, cap: null, percentage: null, state: "unconfigured" };
  const used = typeof value === "object" && value !== null && Number.isFinite(Number((value as { used?: unknown }).used)) ? Math.max(0, Number((value as { used: unknown }).used)) : 0;
  const percentage = used / cap;
  return { used, cap, percentage, state: percentage >= 1 ? "paused" : percentage >= .8 ? "warning" : "normal" };
}

export async function getBudgetStatus(pool: Pool) {
  const key = `tavily_credits:${new Date().toISOString().slice(0, 7)}`;
  const result = await pool.query<{ value: unknown }>("SELECT value FROM settings WHERE key = $1", [key]);
  return currentBudgetStatus(result.rows[0]?.value);
}

export async function getWatchAlert(pool: Pool, watchId: string) {
  const result = await pool.query<WatchAlert>("SELECT watch_id, grey_above, grey_below, resell_above, resell_below FROM watch_alerts WHERE watch_id = $1", [watchId]);
  return result.rows[0] ?? null;
}

export async function evaluateEmailAlerts(pool: Pool) {
  const configurationError = notificationConfigurationError();
  if (configurationError) throw new Error(configurationError);
  if (!emailAlertsEnabled()) return { enabled: false, sent: 0, failed: 0, checked: 0 };
  let sent = 0, failed = 0, checked = 0;
  const deliver = async (input: AlertInput) => {
    checked += 1;
    const prior = await pool.query<{ state: string }>("SELECT state FROM alert_states WHERE key = $1", [input.key]);
    const priorState = prior.rows[0]?.state ?? "normal";
    if (priorState === input.state) return;
    if (input.state === "normal") {
      await setState(pool, input.key, input.state, input.detail);
      return;
    }
    try {
      const providerId = await sendEmail(input.subject, input.text);
      await recordEvent(pool, input, "sent", providerId, null);
      await setState(pool, input.key, input.state, input.detail);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email delivery error";
      await recordEvent(pool, input, "failed", null, message);
      failed += 1;
    }
  };

  const thresholds = await pool.query<WatchAlert & { nickname: string; reference_number: string; grey_value: string | null; resell_value: string | null }>(
    `SELECT a.*, w.nickname, w.reference_number,
       (SELECT value FROM metric_snapshots WHERE watch_id = w.id AND metric = 'grey_avg' AND value IS NOT NULL ORDER BY computed_at DESC LIMIT 1) AS grey_value,
       (SELECT value FROM metric_snapshots WHERE watch_id = w.id AND metric = 'resell_avg' AND value IS NOT NULL ORDER BY computed_at DESC LIMIT 1) AS resell_value
     FROM watch_alerts a JOIN watches w ON w.id = a.watch_id WHERE w.status = 'active'`,
  );
  for (const alert of thresholds.rows) {
    await checkPriceThresholds(deliver, alert, "grey", alert.grey_value, alert.grey_above, alert.grey_below);
    await checkPriceThresholds(deliver, alert, "resell", alert.resell_value, alert.resell_above, alert.resell_below);
  }

  const stale = await pool.query<{ id: string; nickname: string; reference_number: string; computed_at: Date | null }>(
    `SELECT w.id, w.nickname, w.reference_number, latest.computed_at
     FROM watches w LEFT JOIN LATERAL (
       SELECT computed_at FROM metric_snapshots WHERE watch_id = w.id AND metric IN ('grey_avg', 'resell_avg') ORDER BY computed_at DESC LIMIT 1
     ) latest ON true WHERE w.status = 'active'`,
  );
  for (const watch of stale.rows) {
    // A brand-new watch is still gathering, not stale. Staleness begins only
    // after at least one real price observation exists.
    if (!watch.computed_at) continue;
    const ageHours = watch.computed_at ? (Date.now() - watch.computed_at.getTime()) / 3_600_000 : Infinity;
    const state = ageHours > PRICE_OUTDATED_AFTER_HOURS ? "outdated" : ageHours > PRICE_STALE_AFTER_HOURS ? "stale" : "normal";
    const age = Number.isFinite(ageHours) ? Math.floor(ageHours) : null;
    await deliver({ key: `staleness:${watch.id}`, watchId: watch.id, kind: "staleness", state, subject: `Crown Tracker: ${watch.nickname} research is ${state}`, text: `${watch.reference_number} (${watch.nickname}) has not received a price observation for ${age === null ? "an unknown period" : `${age} hours`}. Open Crown Tracker to review the last successful run.`, detail: { computedAt: watch.computed_at?.toISOString() ?? null, ageHours: age } });
  }

  const budget = await getBudgetStatus(pool);
  if (budget.state !== "unconfigured") await deliver({ key: "budget:tavily", watchId: null, kind: "budget", state: budget.state, subject: `Crown Tracker: Tavily budget ${budget.state}`, text: `This month's Tavily usage is ${budget.used} of ${budget.cap} credits (${Math.round((budget.percentage ?? 0) * 100)}%). ${budget.state === "paused" ? "New capped searches are paused." : "Review usage before the cap is reached."}`, detail: budget });
  return { enabled: true, sent, failed, checked };
}

type AlertInput = { key: string; watchId: string | null; kind: "price_threshold" | "staleness" | "budget"; state: "normal" | "above" | "below" | "stale" | "outdated" | "warning" | "paused"; subject: string; text: string; detail: Record<string, unknown> };

async function checkPriceThresholds(deliver: (input: AlertInput) => Promise<void>, alert: WatchAlert & { nickname: string; reference_number: string }, metric: "grey" | "resell", valueRaw: string | null, aboveRaw: string | null, belowRaw: string | null) {
  const value = Number(valueRaw), above = Number(aboveRaw), below = Number(belowRaw);
  if (!Number.isFinite(value)) return;
  const label = metric === "grey" ? "grey asking" : "resell asking";
  if (Number.isFinite(above)) await deliver({ key: `price:${alert.watch_id}:${metric}:above`, watchId: alert.watch_id, kind: "price_threshold", state: value >= above ? "above" : "normal", subject: `Crown Tracker: ${alert.nickname} ${label} is above your threshold`, text: `${alert.reference_number} (${alert.nickname}) has a current ${label} estimate of ${formatMoney(value)}, above your ${formatMoney(above)} threshold. Asking-price estimate only; it is not a sale price.`, detail: { metric, direction: "above", value, threshold: above } });
  if (Number.isFinite(below)) await deliver({ key: `price:${alert.watch_id}:${metric}:below`, watchId: alert.watch_id, kind: "price_threshold", state: value <= below ? "below" : "normal", subject: `Crown Tracker: ${alert.nickname} ${label} is below your threshold`, text: `${alert.reference_number} (${alert.nickname}) has a current ${label} estimate of ${formatMoney(value)}, below your ${formatMoney(below)} threshold. Asking-price estimate only; it is not a sale price.`, detail: { metric, direction: "below", value, threshold: below } });
}

async function sendEmail(subject: string, text: string) {
  const response = await fetch(RESEND_URL, { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL, to: [process.env.ALERT_TO_EMAIL], subject, text }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok) throw new Error(`Resend delivery failed with HTTP ${response.status}${payload.message ? `: ${payload.message}` : ""}`);
  return payload.id ?? null;
}

async function setState(pool: Pool, key: string, state: AlertInput["state"], detail: Record<string, unknown>) {
  await pool.query("INSERT INTO alert_states (key, state, detail) VALUES ($1,$2,$3::jsonb) ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state, detail = EXCLUDED.detail, updated_at = now()", [key, state, JSON.stringify(detail)]);
}
async function recordEvent(pool: Pool, input: AlertInput, deliveryStatus: "sent" | "failed", providerId: string | null, error: string | null) {
  await pool.query("INSERT INTO alert_events (watch_id, kind, state, subject, detail, delivery_status, provider_id, error) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)", [input.watchId, input.kind, input.state, input.subject, JSON.stringify(input.detail), deliveryStatus, providerId, error?.slice(0, 500) ?? null]);
}
function formatMoney(value: number) { return `$${Math.round(value).toLocaleString("en-US")}`; }
