import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownerEmail } from "@/lib/owner";
import { hasValidYearRange, scopeSchema } from "@/lib/watch-schema";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const { id } = await context.params;
  const ownership = "id = $2 AND user_id = (SELECT id FROM users WHERE email = $3)";
  let result;
  let scopeChanged = false;
  if (typeof body.status === "string" && ["active", "archived"].includes(body.status)) {
    result = await db.query(`UPDATE watches SET status = $1, updated_at = now() WHERE ${ownership} RETURNING id`, [body.status, id, ownerEmail]);
  } else {
    const scope = scopeSchema.safeParse(body.scope);
    if (!scope.success || !hasValidYearRange(scope.data)) return NextResponse.json({ error: "Invalid market scope." }, { status: 400 });
    const previous = await db.query<{ scope: unknown }>(`SELECT scope FROM watches WHERE ${ownership}`, [id, id, ownerEmail]);
    if (!previous.rowCount) return NextResponse.json({ error: "Watch not found." }, { status: 404 });
    result = await db.query(`UPDATE watches SET scope = $1::jsonb, updated_at = now() WHERE ${ownership} RETURNING id`, [JSON.stringify(scope.data), id, ownerEmail]);
    scopeChanged = true;
    await db.query("INSERT INTO scope_changes (watch_id, old_scope, new_scope) VALUES ($1, $2::jsonb, $3::jsonb)", [id, JSON.stringify(previous.rows[0].scope), JSON.stringify(scope.data)]);
  }
  if (!result.rowCount) return NextResponse.json({ error: "Watch not found." }, { status: 404 });
  if (scopeChanged) {
    // History is append-only. The next scan reclassifies active listings against
    // the new scope without erasing earlier, auditable snapshots.
    await db.query("UPDATE market_listings SET scope_match = false, scope_match_class = 'out_of_scope', scope_weight = 0, scope_reason = 'Scope changed; awaiting the next scan.' WHERE watch_id = $1", [id]);
  }
  return NextResponse.json({ id });
}
