import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { getWatchBaseDetails, watchBaseCandidates, watchBaseConfigurationError } from "@/lib/watchbase";

test("WatchBase lookup requires a key and explicit positive cap", () => {
  assert.match(watchBaseConfigurationError({}) ?? "", /WATCHBASE_API_KEY/);
  assert.match(watchBaseConfigurationError({ WATCHBASE_API_KEY: "test" }) ?? "", /CREDIT_CAP/);
  assert.equal(watchBaseConfigurationError({ WATCHBASE_API_KEY: "test", WATCHBASE_LOOKUP_MONTHLY_CREDIT_CAP: "10" }), null);
});

test("WatchBase candidates preserve variant-specific basics from a JSON result", () => {
  const candidates = watchBaseCandidates({ watches: [{ id: 77, reference_number: "116503-0003", name: "Cosmograph Daytona Stainless Steel / Yellow Gold / Champagne", brand: { name: "Rolex" }, family: { name: "Daytona" }, case: { diameter: "40", materials: ["Stainless Steel", "Yellow Gold"], bezel: "Tachymeter" }, dial: { color: "Champagne" }, bracelet: { name: "Oyster" }, caliber: { name: "4130" } }] }, "116503");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, "77");
  assert.equal(candidates[0].referenceNumber, "116503-0003");
  assert.equal(candidates[0].modelName, "Rolex Daytona");
  assert.equal(candidates[0].specs.caseSizeMm, 40);
  assert.equal(candidates[0].specs.dial, "Champagne");
  assert.equal(candidates[0].specs.material, "Stainless Steel, Yellow Gold");
  assert.equal(candidates[0].source.name, "WatchBase API");
});

test("WatchBase candidates exclude non-Rolex results and rank exact references first", () => {
  const candidates = watchBaseCandidates({ results: [
    { id: "other", reference: "116503", name: "Not Rolex", brand: "Omega" },
    { id: "variant", reference: "116503-0001", name: "Daytona variant", brand: "Rolex", family: "Daytona" },
    { id: "base", reference: "116503", name: "Daytona base", brand: "Rolex", family: "Daytona" },
  ] }, "116503");
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["base", "variant"]);
});

test("WatchBase detail lookup loads technical fields only after an explicit candidate selection", async () => {
  const pool = { query: async () => ({ rowCount: 1, rows: [] }) } as unknown as Pool;
  const details = await getWatchBaseDetails(pool, "77", "126503-0001", {
    env: { WATCHBASE_API_KEY: "test", WATCHBASE_LOOKUP_MONTHLY_CREDIT_CAP: "10" },
    fetchFn: async () => new Response(JSON.stringify({ watch: { id: 77, reference_number: "126503-0001", name: "Cosmograph Daytona Stainless Steel - Yellow Gold / White", brand: { name: "Rolex" }, family: { name: "Daytona" }, case: { diameter: 40, materials: ["Stainless Steel", "Yellow Gold"], bezel: "Tachymeter" }, dial: { color: "White" }, bracelet: { name: "Oyster" }, caliber: { name: "4131" } } }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(details.referenceNumber, "126503-0001");
  assert.equal(details.specs.caseSizeMm, 40);
  assert.equal(details.specs.dial, "White");
  assert.equal(details.specs.bezel, "Tachymeter");
  assert.equal(details.specs.bracelet, "Oyster");
  assert.equal(details.specs.movement, "4131");
  assert.equal(details.specs.material, "Stainless Steel, Yellow Gold");
});
