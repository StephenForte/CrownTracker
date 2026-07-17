import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { extractListingRows } from "@/lib/research";

type Golden = {
  name: string; file: string; sourceUrl: string; fallbackTitle: string;
  options: { allowLoosePage: boolean; extractScopeAttributes: boolean };
  expected: Array<Record<string, string | number | boolean | null>>;
};

const fixtures = path.join(process.cwd(), "tests/fixtures");

test("cached extraction goldens retain their expected listing fields", async () => {
  const goldens = JSON.parse(await readFile(path.join(fixtures, "extraction-goldens.json"), "utf8")) as Golden[];
  for (const golden of goldens) {
    const html = await readFile(path.join(fixtures, golden.file), "utf8");
    const rows = extractListingRows(html, golden.sourceUrl, golden.fallbackTitle, golden.options);
    assert.equal(rows.length, golden.expected.length, golden.name);
    golden.expected.forEach((expected, index) => {
      for (const [field, value] of Object.entries(expected)) assert.equal(rows[index][field as keyof typeof rows[number]], value, `${golden.name}: ${field}`);
    });
  }
});
