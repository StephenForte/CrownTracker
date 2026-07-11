import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const sessionCookie = "crown_tracker_session";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionValue() {
  const payload = Buffer.from(JSON.stringify({ role: "owner", expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function isValidSession(value?: string) {
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).expiresAt > Date.now();
  } catch { return false; }
}

export async function hasSession() {
  return isValidSession((await cookies()).get(sessionCookie)?.value);
}

export function setSession(response: NextResponse) {
  response.cookies.set(sessionCookie, createSessionValue(), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession(response: NextResponse) {
  response.cookies.set(sessionCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}
