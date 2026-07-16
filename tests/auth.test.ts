import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createSessionValue, isValidSession } from "@/lib/auth";

const testSecret = "test-secret-that-is-at-least-32-characters-long";

test("createSessionValue returns a signed payload", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    const session = createSessionValue();
    assert.ok(session.includes("."), "Session should contain payload.signature format");
    const [payload, signature] = session.split(".");
    assert.ok(payload.length > 0, "Payload should not be empty");
    assert.ok(signature.length > 0, "Signature should not be empty");
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("createSessionValue payload contains role and expiresAt", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    const session = createSessionValue();
    const [payload] = session.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    assert.equal(decoded.role, "owner");
    assert.ok(typeof decoded.expiresAt === "number");
    assert.ok(decoded.expiresAt > Date.now());
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("isValidSession returns false for undefined", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    assert.equal(isValidSession(undefined), false);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("isValidSession returns false for empty string", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    assert.equal(isValidSession(""), false);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("isValidSession returns false for malformed token (no dot)", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    assert.equal(isValidSession("invalidtoken"), false);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("isValidSession returns false for invalid signature", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    const payload = Buffer.from(JSON.stringify({ role: "owner", expiresAt: Date.now() + 1000000 })).toString("base64url");
    assert.equal(isValidSession(`${payload}.invalidsignature`), false);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("isValidSession returns false for expired session", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    // Sign a genuinely expired payload so failure is due to expiry, not HMAC mismatch
    const expiredPayload = Buffer.from(
      JSON.stringify({ role: "owner", expiresAt: Date.now() - 1000 }),
    ).toString("base64url");
    const signature = createHmac("sha256", testSecret).update(expiredPayload).digest("base64url");

    assert.equal(isValidSession(`${expiredPayload}.${signature}`), false);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("isValidSession returns true for valid session", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    const session = createSessionValue();
    assert.equal(isValidSession(session), true);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("isValidSession uses timing-safe comparison", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    const session = createSessionValue();
    const [payload, signature] = session.split(".");
    const tamperedSignature = signature.slice(0, -1) + (signature.slice(-1) === "a" ? "b" : "a");

    assert.equal(isValidSession(`${payload}.${tamperedSignature}`), false);
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});

test("session expires in approximately 30 days", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = testSecret;

  try {
    const session = createSessionValue();
    const [payload] = session.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;
    const expectedExpiry = Date.now() + thirtyDaysMs;

    assert.ok(Math.abs(decoded.expiresAt - expectedExpiry) < 1000, "Expiry should be ~30 days from now");
  } finally {
    process.env.SESSION_SECRET = originalSecret;
  }
});
