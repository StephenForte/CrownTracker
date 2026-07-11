import { NextRequest, NextResponse } from "next/server";
import { setSession } from "@/lib/auth";

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!process.env.APP_PASSWORD) return NextResponse.json({ error: "APP_PASSWORD is not configured." }, { status: 500 });
  if (password !== process.env.APP_PASSWORD) {
    return redirect("/login?error=invalid");
  }
  const response = redirect("/");
  setSession(response);
  return response;
}
