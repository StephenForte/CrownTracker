import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const { id } = await context.params;
  const ownership = "id = $2 AND user_id = (SELECT id FROM users WHERE email = $3)";
  let result;
  if (typeof body.status === "string" && ["active", "archived"].includes(body.status)) {
    result = await db.query(`UPDATE watches SET status = $1, updated_at = now() WHERE ${ownership} RETURNING id`, [body.status, id, "owner@crown-tracker.local"]);
  } else {
    const scope = z.object({ condition: z.enum(["any", "unworn", "pre_owned"]), papers: z.enum(["required", "not_required"]), box: z.enum(["required", "not_required"]), warranty: z.enum(["factory_remaining", "third_party_ok", "none_ok"]), yearMin: z.number().int().nullable(), yearMax: z.number().int().nullable() }).safeParse(body.scope);
    if (!scope.success || (scope.data.yearMin && scope.data.yearMax && scope.data.yearMin > scope.data.yearMax)) return NextResponse.json({ error: "Invalid market scope." }, { status: 400 });
    result = await db.query(`UPDATE watches SET scope = $1::jsonb, updated_at = now() WHERE ${ownership} RETURNING id`, [JSON.stringify(scope.data), id, "owner@crown-tracker.local"]);
  }
  if (!result.rowCount) return NextResponse.json({ error: "Watch not found." }, { status: 404 });
  return NextResponse.json({ id });
}
