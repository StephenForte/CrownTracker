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
    result = await db.query(`UPDATE watches SET scope = $1::jsonb, updated_at = now() WHERE ${ownership} RETURNING id`, [JSON.stringify(scope.data), id, ownerEmail]);
    scopeChanged = true;
  }
  if (!result.rowCount) return NextResponse.json({ error: "Watch not found." }, { status: 404 });
  if (scopeChanged) {
    await Promise.all([
      db.query("UPDATE market_listings SET scope_match = false, scope_reason = 'Scope changed; awaiting the next daily validation.' WHERE watch_id = $1", [id]),
      db.query("DELETE FROM market_snapshots WHERE watch_id = $1", [id]),
    ]);
  }
  return NextResponse.json({ id });
}
