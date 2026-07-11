import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export function POST() {
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  clearSession(response);
  return response;
}
