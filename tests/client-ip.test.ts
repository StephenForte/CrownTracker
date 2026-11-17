import assert from "node:assert/strict";
import test from "node:test";
import { clientIpBucketKey, trustedClientIp } from "@/lib/client-ip";

function requestWith(headers: Record<string, string>) {
  return new Request("https://crown-tracker.example/login", { headers });
}

test("trustedClientIp prefers CF-Connecting-IP over spoofed X-Forwarded-For", () => {
  const request = requestWith({
    "x-forwarded-for": "198.51.100.1, 203.0.113.50, 104.16.1.1",
    "cf-connecting-ip": "203.0.113.50",
  });
  assert.equal(trustedClientIp(request), "203.0.113.50");
});

test("trustedClientIp prefers True-Client-IP when CF-Connecting-IP is absent", () => {
  const request = requestWith({
    "x-forwarded-for": "198.51.100.1, 203.0.113.77",
    "true-client-ip": "203.0.113.77",
  });
  assert.equal(trustedClientIp(request), "203.0.113.77");
});

test("trustedClientIp uses rightmost XFF hop, not the client-controlled leftmost", () => {
  const request = requestWith({
    "x-forwarded-for": "198.51.100.1, 203.0.113.9, 10.1.2.3",
  });
  assert.equal(trustedClientIp(request), "10.1.2.3");
});

test("spoofing leftmost XFF does not change the bucket when CF-Connecting-IP is set", () => {
  const real = requestWith({
    "cf-connecting-ip": "203.0.113.50",
    "x-forwarded-for": "203.0.113.50, 104.16.1.1",
  });
  const spoofed = requestWith({
    "cf-connecting-ip": "203.0.113.50",
    "x-forwarded-for": "198.51.100.99, 203.0.113.50, 104.16.1.1",
  });
  assert.equal(clientIpBucketKey(real), clientIpBucketKey(spoofed));
});

test("rotating spoofed leftmost XFF alone does not create distinct buckets", () => {
  const first = requestWith({ "x-forwarded-for": "198.51.100.1, 10.1.2.3" });
  const second = requestWith({ "x-forwarded-for": "198.51.100.2, 10.1.2.3" });
  assert.equal(clientIpBucketKey(first), clientIpBucketKey(second));
});

test("trustedClientIp falls back to X-Real-IP then unknown", () => {
  assert.equal(trustedClientIp(requestWith({ "x-real-ip": "192.0.2.10" })), "192.0.2.10");
  assert.equal(trustedClientIp(requestWith({})), "unknown");
  assert.equal(trustedClientIp(null), "unknown");
});
