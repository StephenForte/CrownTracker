import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { lookupReference } from "@/lib/catalog";

export async function GET(request: NextRequest) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const reference = request.nextUrl.searchParams.get("reference");
  if (!reference) return NextResponse.json({ error: "A reference number is required." }, { status: 400 });
  return NextResponse.json(lookupReference(reference));
}
