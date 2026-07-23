import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { lookupWatchBase } from "@/lib/watchbase";

const querySchema = z.string().trim().min(3).max(30);

export async function GET(request: NextRequest) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const reference = querySchema.safeParse(request.nextUrl.searchParams.get("reference"));
  if (!reference.success) return NextResponse.json({ error: "Enter a reference of 3 to 30 characters." }, { status: 400 });
  try {
    return NextResponse.json(await lookupWatchBase(db, reference.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WatchBase lookup failed." }, { status: 503 });
  }
}
