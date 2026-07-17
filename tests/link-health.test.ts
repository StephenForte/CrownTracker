import assert from "node:assert/strict";
import test from "node:test";
import { classifyLinkResponse, isSafeLinkUrl } from "@/lib/link-health";

test("classifyLinkResponse keeps 404/410 distinct from temporary failures", () => {
  assert.equal(classifyLinkResponse(200), "reachable");
  assert.equal(classifyLinkResponse(302), "reachable");
  assert.equal(classifyLinkResponse(404), "offline");
  assert.equal(classifyLinkResponse(410), "offline");
  assert.equal(classifyLinkResponse(503), "unreachable");
});

test("isSafeLinkUrl refuses local and non-HTTP destinations", () => {
  assert.equal(isSafeLinkUrl("https://example.com/listing"), true);
  assert.equal(isSafeLinkUrl("http://192.168.1.8/private"), false);
  assert.equal(isSafeLinkUrl("http://127.0.0.1:5432/"), false);
  assert.equal(isSafeLinkUrl("http://[::1]/"), false);
  assert.equal(isSafeLinkUrl("https://localhost/"), false);
  assert.equal(isSafeLinkUrl("file:///etc/passwd"), false);
});
