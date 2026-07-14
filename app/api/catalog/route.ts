import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { searchCatalog } from "@/lib/catalog";

export async function GET(request: NextRequest) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(searchCatalog(request.nextUrl.searchParams.get("q") ?? ""));
}
