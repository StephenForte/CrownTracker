import assert from "node:assert/strict";
import test from "node:test";
import { parseClaudeJson } from "@/lib/community-research";

test("parseClaudeJson keeps a complete object when Claude adds trailing text", () => {
  assert.deepEqual(parseClaudeJson<{ anecdotes: unknown[] }>("{\n  \"anecdotes\": []\n}\n\nNo dated reports were found."), { anecdotes: [] });
});

test("parseClaudeJson handles fenced JSON and braces inside a JSON string", () => {
  assert.deepEqual(parseClaudeJson<{ quote: string }>("Here is the result:\n```json\n{\"quote\":\"A {grounded} quote\"}\n```"), { quote: "A {grounded} quote" });
});

test("parseClaudeJson rejects a response without a complete JSON value", () => {
  assert.throws(() => parseClaudeJson("I could not find anything."), /complete JSON/);
});
