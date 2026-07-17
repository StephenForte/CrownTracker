import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReference, lookupReference, searchCatalog } from "@/lib/catalog";

test("normalizeReference trims whitespace", () => {
  assert.equal(normalizeReference("  126500LN  "), "126500LN");
  assert.equal(normalizeReference("\t126500LN\n"), "126500LN");
});

test("normalizeReference converts to uppercase", () => {
  assert.equal(normalizeReference("126500ln"), "126500LN");
  assert.equal(normalizeReference("126710blro"), "126710BLRO");
});

test("normalizeReference removes internal spaces", () => {
  assert.equal(normalizeReference("126 500 LN"), "126500LN");
  assert.equal(normalizeReference("126  710  BLRO"), "126710BLRO");
});

test("normalizeReference handles combined transformations", () => {
  assert.equal(normalizeReference("  126 500 ln  "), "126500LN");
});

test("lookupReference returns catalog data for known references", () => {
  const panda = lookupReference("126500LN");
  assert.equal(panda.referenceNumber, "126500LN");
  assert.equal(panda.modelName, "Oyster Perpetual Cosmograph Daytona");
  assert.equal(panda.nickname, "Panda");
  assert.equal(panda.retailPriceUsd, 16700);
  assert.equal(panda.discontinued, false);
  assert.equal(panda.specs.caseSizeMm, 40);
  assert.equal(panda.specs.dial, "White");
});

test("lookupReference returns catalog data for Submariner Date", () => {
  const sub = lookupReference("126610LN");
  assert.equal(sub.referenceNumber, "126610LN");
  assert.equal(sub.modelName, "Oyster Perpetual Submariner Date");
  assert.equal(sub.nickname, "Black Sub Date");
  assert.equal(sub.retailPriceUsd, 11100);
});

test("lookupReference returns catalog data for GMT-Master Pepsi", () => {
  const pepsi = lookupReference("126710BLRO");
  assert.equal(pepsi.referenceNumber, "126710BLRO");
  assert.equal(pepsi.modelName, "Oyster Perpetual GMT-Master II");
  assert.equal(pepsi.nickname, "Pepsi");
});

test("lookupReference returns catalog data for Submariner No Date", () => {
  const noDate = lookupReference("124060");
  assert.equal(noDate.referenceNumber, "124060");
  assert.equal(noDate.modelName, "Oyster Perpetual Submariner");
  assert.equal(noDate.nickname, "No Date");
});

test("lookupReference normalizes input before lookup", () => {
  const panda = lookupReference("  126500ln  ");
  assert.equal(panda.referenceNumber, "126500LN");
  assert.equal(panda.modelName, "Oyster Perpetual Cosmograph Daytona");
});

test("lookupReference returns fallback for unknown references", () => {
  const unknown = lookupReference("UNKNOWN123");
  assert.equal(unknown.referenceNumber, "UNKNOWN123");
  assert.equal(unknown.modelName, "");
  assert.equal(unknown.nickname, "");
  assert.equal(unknown.retailPriceUsd, null);
  assert.equal(unknown.discontinued, false);
  assert.deepEqual(unknown.specs, {});
  assert.equal(unknown.source.name, "WatchBase fallback");
});

test("searchCatalog returns all watches for empty query", () => {
  const results = searchCatalog("");
  assert.ok(results.length >= 4);
  assert.ok(results.some((w) => w.referenceNumber === "126500LN"));
  assert.ok(results.some((w) => w.referenceNumber === "126610LN"));
});

test("searchCatalog filters by reference number", () => {
  const results = searchCatalog("126500");
  assert.ok(results.some((w) => w.referenceNumber === "126500LN"));
  assert.ok(!results.some((w) => w.referenceNumber === "124060"));
});

test("searchCatalog filters by model name (case insensitive)", () => {
  const results = searchCatalog("daytona");
  assert.ok(results.some((w) => w.referenceNumber === "126500LN"));
  assert.ok(!results.some((w) => w.referenceNumber === "126610LN"));
});

test("searchCatalog filters by nickname (case insensitive)", () => {
  const pandaResults = searchCatalog("panda");
  assert.ok(pandaResults.some((w) => w.nickname === "Panda"));

  const pepsiResults = searchCatalog("PEPSI");
  assert.ok(pepsiResults.some((w) => w.nickname === "Pepsi"));
});

test("searchCatalog limits results to 8", () => {
  const results = searchCatalog("");
  assert.ok(results.length <= 8);
});

test("searchCatalog returns empty array for non-matching query", () => {
  const results = searchCatalog("xyz123nonexistent");
  assert.equal(results.length, 0);
});

test("searchCatalog trims query whitespace", () => {
  const results = searchCatalog("  panda  ");
  assert.ok(results.some((w) => w.nickname === "Panda"));
});

test("searchCatalog finds indexed aliases and ranks exact alias matches first", () => {
  const sprite = searchCatalog("sprite");
  assert.equal(sprite[0]?.referenceNumber, "126720VTNR");

  const explorer = searchCatalog("explorer 2");
  assert.ok(explorer.some((watch) => watch.referenceNumber === "226570"));
});

test("searchCatalog result shape includes required fields", () => {
  const results = searchCatalog("panda");
  assert.ok(results.length > 0);
  const result = results[0];
  assert.ok("referenceNumber" in result);
  assert.ok("modelName" in result);
  assert.ok("nickname" in result);
});
