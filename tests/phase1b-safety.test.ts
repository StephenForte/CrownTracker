import assert from "node:assert/strict";
import test from "node:test";
import { extractListingRows } from "@/lib/research";
import { isPhase1bEnabled, phase1aScopeError, phase1bConfigurationError } from "@/lib/phase1b";

const phase1aScope = {
  condition: "any" as const,
  yearMin: null,
  yearMax: null,
  papers: "required" as const,
  box: "not_required" as const,
  warranty: "none_ok" as const,
};

test("Phase 1B requires an explicit flag and both paid-provider prerequisites", () => {
  assert.equal(isPhase1bEnabled({ ANTHROPIC_API_KEY: "key", TAVILY_MONTHLY_CREDIT_CAP: "10" }), false);
  assert.match(phase1bConfigurationError({ PHASE1B_ENRICHMENT_ENABLED: "true" }) ?? "", /TAVILY_MONTHLY_CREDIT_CAP.*ANTHROPIC_API_KEY/);
  assert.match(phase1bConfigurationError({ PHASE1B_ENRICHMENT_ENABLED: "true", ANTHROPIC_API_KEY: "key", TAVILY_MONTHLY_CREDIT_CAP: "zero" }) ?? "", /positive integer/);
  assert.equal(isPhase1bEnabled({ PHASE1B_ENRICHMENT_ENABLED: "true", ANTHROPIC_API_KEY: "key", TAVILY_MONTHLY_CREDIT_CAP: "10" }), true);
});

test("Phase 1A rejects ungroundable year and warranty constraints", () => {
  assert.equal(phase1aScopeError(phase1aScope), null);
  assert.match(phase1aScopeError({ ...phase1aScope, yearMin: 2020 }) ?? "", /Production-year/);
  assert.match(phase1aScopeError({ ...phase1aScope, warranty: "factory_remaining" }) ?? "", /Warranty/);
});

test("structured listing fixture preserves distinct row evidence and Phase 1A withholds year and warranty", () => {
  const html = `<script type="application/ld+json">[
    {"@type":"Product","name":"Panda A","sku":"a-1","description":"2024 unworn full set with Rolex warranty","url":"/listing/a","offers":{"@type":"Offer","price":"30000","priceCurrency":"USD"}},
    {"@type":"Product","name":"Panda B","sku":"b-2","description":"2019 pre-owned with papers","url":"/listing/b","offers":{"@type":"Offer","price":"25000","priceCurrency":"USD"}}
  ]</script>`;

  const rows = extractListingRows(html, "https://dealer.example/collection", "Collection", { allowLoosePage: false, extractScopeAttributes: false });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.title, row.detailUrl, row.priceOriginal]), [
    ["Panda A", "https://dealer.example/listing/a", 30000],
    ["Panda B", "https://dealer.example/listing/b", 25000],
  ]);
  assert.deepEqual(rows.map((row) => [row.productionYear, row.warranty]), [[null, null], [null, null]]);
  assert.deepEqual(rows.map((row) => row.condition), ["unworn", "pre_owned"]);
});

test("Phase 1A does not turn an unstructured page price into a listing", () => {
  const html = "<html><head><title>Collection</title></head><body>Rolex collection from $27,500</body></html>";
  assert.equal(extractListingRows(html, "https://dealer.example/collection", "Collection", { allowLoosePage: false }).length, 0);
  assert.equal(extractListingRows(html, "https://dealer.example/collection", "Collection", { allowLoosePage: true }).length, 1);
});
