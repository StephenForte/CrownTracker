import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWatchBaseDetails, lookupWatchBase } from "@/lib/watchbase";

const querySchema = z.string().trim().min(3).max(30);
const idSchema = z.string().trim().min(1).max(100);

export async function GET(request: NextRequest) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const reference = querySchema.safeParse(request.nextUrl.searchParams.get("reference"));
  if (!reference.success) return NextResponse.json({ error: "Enter a reference of 3 to 30 characters." }, { status: 400 });
  const id = request.nextUrl.searchParams.get("id");
  const parsedId = id === null ? null : idSchema.safeParse(id);
  if (parsedId && !parsedId.success) return NextResponse.json({ error: "Invalid WatchBase candidate." }, { status: 400 });
  try {
    return NextResponse.json(parsedId ? await getWatchBaseDetails(db, parsedId.data, reference.data) : await lookupWatchBase(db, reference.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WatchBase lookup failed." }, { status: 503 });
  }
}
