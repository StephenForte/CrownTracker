import { createHash } from "node:crypto";

/**
 * Client IP for rate-limit buckets behind Render/Cloudflare.
 *
 * Prefer Cloudflare's connecting-IP headers (edge overwrites them). Never use the
 * leftmost X-Forwarded-For hop: Render appends to a client-supplied chain, so that
 * value is attacker-controlled. When those headers are absent, use the rightmost
 * XFF hop (nearest proxy append) rather than failing open to a spoofed left hop.
 */
export function trustedClientIp(request: Request | null): string {
  if (!request) return "unknown";

  const cfConnecting = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnecting) return cfConnecting;

  const trueClient = request.headers.get("true-client-ip")?.trim();
  if (trueClient) return trueClient;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function clientIpBucketKey(request: Request | null): string {
  return createHash("sha256").update(trustedClientIp(request)).digest("base64url").slice(0, 24);
}
