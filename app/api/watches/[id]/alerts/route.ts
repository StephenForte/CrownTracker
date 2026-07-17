import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownerEmail } from "@/lib/owner";

const threshold = z.number().positive().max(1_000_000).nullable();
const alertSchema = z.object({ greyAbove: threshold, greyBelow: threshold, resellAbove: threshold, resellBelow: threshold });

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = alertSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Each threshold must be a positive dollar amount or blank." }, { status: 400 });
  const { id } = await context.params;
  const owned = await db.query("SELECT 1 FROM watches WHERE id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)", [id, ownerEmail]);
  if (!owned.rowCount) return NextResponse.json({ error: "Watch not found." }, { status: 404 });
  const values = parsed.data;
  const hasThreshold = Object.values(values).some((value) => value !== null);
  if (!hasThreshold) {
    await db.query("DELETE FROM watch_alerts WHERE watch_id = $1", [id]);
    return NextResponse.json({ id, enabled: false });
  }
  await db.query(
    `INSERT INTO watch_alerts (watch_id, grey_above, grey_below, resell_above, resell_below)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (watch_id) DO UPDATE SET grey_above = EXCLUDED.grey_above, grey_below = EXCLUDED.grey_below,
       resell_above = EXCLUDED.resell_above, resell_below = EXCLUDED.resell_below, updated_at = now()`,
    [id, values.greyAbove, values.greyBelow, values.resellAbove, values.resellBelow],
  );
  return NextResponse.json({ id, enabled: true });
}
