import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";

config({ path: ".env.local" });
config();

type Golden = {
  name: string; file: string; sourceUrl: string; fallbackTitle: string;
  options: { allowLoosePage: boolean; extractScopeAttributes: boolean };
  expected: Array<Record<string, string | number | boolean | null>>;
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for live prompt verification.");
  const { extractListingRows, enrichRowsWithClaude } = await import("../lib/research");
  const fixtures = path.join(process.cwd(), "tests/fixtures");
  const goldens = JSON.parse(await readFile(path.join(fixtures, "extraction-goldens.json"), "utf8")) as Golden[];
  for (const golden of goldens) {
    const html = await readFile(path.join(fixtures, golden.file), "utf8");
    const extracted = extractListingRows(html, golden.sourceUrl, golden.fallbackTitle, golden.options);
    const rows = await enrichRowsWithClaude(extracted, html, true);
    assert.equal(rows.length, golden.expected.length, golden.name);
    golden.expected.forEach((expected, index) => {
      for (const [field, value] of Object.entries(expected)) assert.equal(rows[index][field as keyof typeof rows[number]], value, `${golden.name}: ${field}`);
    });
    console.log(`Verified prompt golden: ${golden.name}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
