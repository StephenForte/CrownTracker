import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSession } from "@/lib/auth";
import { normalizeReference } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getOwnerId } from "@/lib/owner";
import { hasValidYearRange, scopeSchema } from "@/lib/watch-schema";

const watchInput = z.object({
  referenceNumber: z.string().min(3).max(30), modelName: z.string().min(2).max(120), nickname: z.string().max(80).optional(),
  retailPriceUsd: z.number().nonnegative().nullable(), discontinued: z.boolean(), photoSourceUrl: z.string().url().nullable(),
  specs: z.object({ caseSizeMm: z.number().positive().nullable(), dial: z.string().max(100).optional(), bezel: z.string().max(100).optional(), bracelet: z.string().max(100).optional(), movement: z.string().max(100).optional(), material: z.string().max(100).optional() }),
  scope: scopeSchema,
  notes: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = watchInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid watch details.", details: parsed.error.flatten() }, { status: 400 });
  const watch = parsed.data;
  if (!hasValidYearRange(watch.scope)) return NextResponse.json({ error: "The start year cannot be after the end year." }, { status: 400 });
  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO watches (user_id, reference_number, model_name, nickname, specs, scope, photo_source_url, retail_price_usd, discontinued, notes)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10) RETURNING id`,
      [await getOwnerId(), normalizeReference(watch.referenceNumber), watch.modelName.trim(), watch.nickname?.trim() || null, JSON.stringify(watch.specs), JSON.stringify(watch.scope), watch.photoSourceUrl, watch.retailPriceUsd, watch.discontinued, watch.notes?.trim() || null],
    );
    return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ error: "This reference is already being tracked with the same nickname." }, { status: 409 });
    throw error;
  }
}
