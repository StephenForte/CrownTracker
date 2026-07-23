import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownerEmail } from "@/lib/owner";
import { DAILY_MANUAL_REFRESH_LIMIT } from "@/lib/phase1b";
import { researchWatch } from "@/lib/research";
import type { Watch } from "@/lib/watches";

export const maxDuration = 120;

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const watch = await db.query<Watch>("SELECT * FROM watches WHERE id = $1 AND user_id = (SELECT id FROM users WHERE email = $2) AND status = 'active'", [id, ownerEmail]);
  if (!watch.rowCount) return NextResponse.json({ error: "Active watch not found." }, { status: 404 });
  const usage = await db.query<{ count: string }>("SELECT count(*) FROM runs WHERE job_type = 'manual_price_scan' AND started_at >= date_trunc('day', now())");
  if (Number(usage.rows[0].count) >= DAILY_MANUAL_REFRESH_LIMIT) return NextResponse.json({ error: `Manual refresh limit reached (${DAILY_MANUAL_REFRESH_LIMIT}/day).` }, { status: 429 });
  const created = await db.query<{ id: string }>("INSERT INTO runs (watch_id, job_type, status) VALUES ($1, 'manual_price_scan', 'running') RETURNING id", [id]);
  try {
    const outcome = await researchWatch(db, watch.rows[0], created.rows[0].id);
    await db.query("UPDATE runs SET status = 'succeeded', finished_at = now(), queries_used = $1 WHERE id = $2", [outcome.discoveryQueries, created.rows[0].id]);
    return NextResponse.json({ ok: true, expanded: outcome.expanded, outcome: {
      discovered: outcome.discovered,
      pagesRead: outcome.pagesRead,
      savedListings: outcome.savedListings,
      scopeMatchedListings: outcome.scopeMatchedListings,
      scopeExcludedListings: outcome.scopeExcludedListings,
      groundingDrops: outcome.groundingDrops,
      usedBaseReferenceFallback: outcome.usedBaseReferenceFallback,
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed.";
    await db.query("UPDATE runs SET status = 'failed', finished_at = now(), error = $1::jsonb WHERE id = $2", [JSON.stringify({ message }), created.rows[0].id]);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
