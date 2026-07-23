import assert from "node:assert/strict";
import test from "node:test";
import { nullableTrackedWatchUrlSchema } from "@/lib/tracked-watch-url";

test("tracked watch URL accepts HTTP(S) links and normalizes blank input to null", () => {
  assert.equal(nullableTrackedWatchUrlSchema.parse(" https://dealer.example/watch/123 "), "https://dealer.example/watch/123");
  assert.equal(nullableTrackedWatchUrlSchema.parse("   "), null);
});

test("tracked watch URL rejects non-web protocols and invalid links", () => {
  assert.equal(nullableTrackedWatchUrlSchema.safeParse("ftp://dealer.example/watch/123").success, false);
  assert.equal(nullableTrackedWatchUrlSchema.safeParse("not a URL").success, false);
});
