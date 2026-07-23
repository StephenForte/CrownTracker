import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { parseClaudeJson, researchUncuratedSellers } from "@/lib/community-research";

test("parseClaudeJson keeps a complete object when Claude adds trailing text", () => {
  assert.deepEqual(parseClaudeJson<{ anecdotes: unknown[] }>("{\n  \"anecdotes\": []\n}\n\nNo dated reports were found."), { anecdotes: [] });
});

test("parseClaudeJson handles fenced JSON and braces inside a JSON string", () => {
  assert.deepEqual(parseClaudeJson<{ quote: string }>("Here is the result:\n```json\n{\"quote\":\"A {grounded} quote\"}\n```"), { quote: "A {grounded} quote" });
});

test("parseClaudeJson rejects a response without a complete JSON value", () => {
  assert.throws(() => parseClaudeJson("I could not find anything."), /complete JSON/);
});

test("monthly seller research skips paid-provider validation when no seller is stale", async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  await assert.doesNotReject(researchUncuratedSellers(pool, "monthly-run"));
  assert.deepEqual(await researchUncuratedSellers(pool, "monthly-run"), { discoveryQueries: 0, sellersConsidered: 0, updated: 0 });
});
