import assert from "node:assert/strict";
import test from "node:test";
import { matchesRobotsPath } from "@/lib/robots";

test("matchesRobotsPath supports literal, wildcard, and end-anchored rules", () => {
  assert.equal(matchesRobotsPath("/private", "/private/listing"), true);
  assert.equal(matchesRobotsPath("/watches/*/detail", "/watches/126610/detail"), true);
  assert.equal(matchesRobotsPath("/watches/*/detail", "/watches/126610/specs"), false);
  assert.equal(matchesRobotsPath("/*.pdf$", "/catalog.pdf"), true);
  assert.equal(matchesRobotsPath("/*.pdf$", "/catalog.pdf?download=1"), false);
});
