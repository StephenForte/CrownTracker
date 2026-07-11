import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  clearSession(response);
  return response;
}
