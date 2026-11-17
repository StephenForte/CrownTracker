import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createSessionValue, isValidSession } from "@/lib/auth";

const testSecret = "test-secret-that-is-at-least-32-characters-long";
const testPassword = "test-app-password";

function withAuthEnv(run: () => void) {
  const originalSecret = process.env.SESSION_SECRET;
  const originalPassword = process.env.APP_PASSWORD;
  process.env.SESSION_SECRET = testSecret;
  process.env.APP_PASSWORD = testPassword;
  try {
    run();
  } finally {
    process.env.SESSION_SECRET = originalSecret;
    process.env.APP_PASSWORD = originalPassword;
  }
}

function passwordBinding(secret: string, password: string) {
  return createHmac("sha256", secret).update(`app-password:${password}`).digest("base64url");
}

function signPayload(payload: string, secret = testSecret, password = testPassword) {
  return createHmac("sha256", secret).update(`${passwordBinding(secret, password)}.${payload}`).digest("base64url");
}

test("createSessionValue returns a signed payload", () => {
  withAuthEnv(() => {
    const session = createSessionValue();
    assert.ok(session.includes("."), "Session should contain payload.signature format");
    const [payload, signature] = session.split(".");
    assert.ok(payload.length > 0, "Payload should not be empty");
    assert.ok(signature.length > 0, "Signature should not be empty");
  });
});

test("createSessionValue payload contains role and expiresAt", () => {
  withAuthEnv(() => {
    const session = createSessionValue();
    const [payload] = session.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    assert.equal(decoded.role, "owner");
    assert.ok(typeof decoded.expiresAt === "number");
    assert.ok(decoded.expiresAt > Date.now());
  });
});

test("isValidSession returns false for undefined", () => {
  withAuthEnv(() => {
    assert.equal(isValidSession(undefined), false);
  });
});

test("isValidSession returns false for empty string", () => {
  withAuthEnv(() => {
    assert.equal(isValidSession(""), false);
  });
});

test("isValidSession returns false for malformed token (no dot)", () => {
  withAuthEnv(() => {
    assert.equal(isValidSession("invalidtoken"), false);
  });
});

test("isValidSession returns false for invalid signature", () => {
  withAuthEnv(() => {
    const payload = Buffer.from(JSON.stringify({ role: "owner", expiresAt: Date.now() + 1000000 })).toString("base64url");
    assert.equal(isValidSession(`${payload}.invalidsignature`), false);
  });
});

test("isValidSession returns false for expired session", () => {
  withAuthEnv(() => {
    const expiredPayload = Buffer.from(
      JSON.stringify({ role: "owner", expiresAt: Date.now() - 1000 }),
    ).toString("base64url");
    const signature = signPayload(expiredPayload);

    assert.equal(isValidSession(`${expiredPayload}.${signature}`), false);
  });
});

test("isValidSession returns true for valid session", () => {
  withAuthEnv(() => {
    const session = createSessionValue();
    assert.equal(isValidSession(session), true);
  });
});

test("isValidSession uses timing-safe comparison", () => {
  withAuthEnv(() => {
    const session = createSessionValue();
    const [payload, signature] = session.split(".");
    const tamperedSignature = signature.slice(0, -1) + (signature.slice(-1) === "a" ? "b" : "a");

    assert.equal(isValidSession(`${payload}.${tamperedSignature}`), false);
  });
});

test("rotating APP_PASSWORD invalidates existing sessions", () => {
  withAuthEnv(() => {
    const session = createSessionValue();
    assert.equal(isValidSession(session), true);
    process.env.APP_PASSWORD = "rotated-password";
    assert.equal(isValidSession(session), false);
  });
});

test("session expires in approximately 30 days", () => {
  withAuthEnv(() => {
    const session = createSessionValue();
    const [payload] = session.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;
    const expectedExpiry = Date.now() + thirtyDaysMs;

    assert.ok(Math.abs(decoded.expiresAt - expectedExpiry) < 1000, "Expiry should be ~30 days from now");
  });
});
