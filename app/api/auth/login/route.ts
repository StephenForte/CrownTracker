import { NextRequest, NextResponse } from "next/server";
import { setSession } from "@/lib/auth";
import { completeLoginPasswordAttempt, loginFailureBlocked } from "@/lib/login-rate-limit";
import { passwordsMatch } from "@/lib/mcp-remote";

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return NextResponse.json({ error: "APP_PASSWORD is not configured." }, { status: 500 });

  try {
    // Blocked IPs get the lockout redirect before consent work, except when the
    // password is already correct so the owner can clear cooldown.
    if (!(expected && passwordsMatch(password, expected)) && await loginFailureBlocked(request)) {
      return redirect("/login?error=locked");
    }
    const attempt = await completeLoginPasswordAttempt(request, password, expected);
    if (attempt === "blocked") return redirect("/login?error=locked");
    if (attempt === "mismatch") return redirect("/login?error=invalid");
  } catch {
    return NextResponse.json({ error: "Login is temporarily unavailable." }, { status: 503 });
  }

  const response = redirect("/");
  setSession(response);
  return response;
}
