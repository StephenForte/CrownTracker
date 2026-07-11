import { NextRequest, NextResponse } from "next/server";
import { setSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!process.env.APP_PASSWORD) return NextResponse.json({ error: "APP_PASSWORD is not configured." }, { status: 500 });
  if (password !== process.env.APP_PASSWORD) {
    return NextResponse.redirect(new URL("/login?error=invalid", request.url), 303);
  }
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  setSession(response);
  return response;
}
