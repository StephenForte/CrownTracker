import assert from "node:assert/strict";
import test from "node:test";
import { extractListingRows } from "@/lib/research";

test("extractListingRows extracts products from JSON-LD script tags", () => {
  const html = `<html><head>
    <script type="application/ld+json">{
      "@type": "Product",
      "name": "Rolex Submariner",
      "sku": "sub-001",
      "url": "/watches/submariner",
      "offers": {
        "@type": "Offer",
        "price": "15000",
        "priceCurrency": "USD"
      }
    }</script>
  </head><body></body></html>`;

  const rows = extractListingRows(html, "https://dealer.example/collection", "Collection");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Rolex Submariner");
  assert.equal(rows[0].priceOriginal, 15000);
  assert.equal(rows[0].currency, "USD");
  assert.equal(rows[0].detailUrl, "https://dealer.example/watches/submariner");
});

test("extractListingRows handles multiple products in array", () => {
  const html = `<script type="application/ld+json">[
    {"@type":"Product","name":"Watch A","sku":"a-1","offers":{"price":"10000","priceCurrency":"USD"}},
    {"@type":"Product","name":"Watch B","sku":"b-2","offers":{"price":"20000","priceCurrency":"USD"}}
  ]</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Watch A");
  assert.equal(rows[1].title, "Watch B");
});

test("extractListingRows deduplicates by SKU", () => {
  const html = `<script type="application/ld+json">[
    {"@type":"Product","name":"Watch A","sku":"same-sku","offers":{"price":"10000","priceCurrency":"USD"}},
    {"@type":"Product","name":"Watch A Duplicate","sku":"same-sku","offers":{"price":"10000","priceCurrency":"USD"}}
  ]</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows.length, 1);
});

test("extractListingRows extracts condition from text", () => {
  const htmlUnworn = `<script type="application/ld+json">{
    "@type":"Product","name":"Brand New Rolex","sku":"new-1",
    "description":"unworn condition",
    "offers":{"price":"25000","priceCurrency":"USD"}
  }</script>`;

  const rowsUnworn = extractListingRows(htmlUnworn, "https://dealer.example/", "Watches");
  assert.equal(rowsUnworn[0].condition, "unworn");

  const htmlPreOwned = `<script type="application/ld+json">{
    "@type":"Product","name":"Pre-owned Rolex","sku":"used-1",
    "description":"pre-owned excellent condition",
    "offers":{"price":"18000","priceCurrency":"USD"}
  }</script>`;

  const rowsPreOwned = extractListingRows(htmlPreOwned, "https://dealer.example/", "Watches");
  assert.equal(rowsPreOwned[0].condition, "pre_owned");
});

test("extractListingRows detects papers/box from description", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Full Set Rolex","sku":"full-1",
    "description":"Complete full set with papers and box",
    "offers":{"price":"30000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows[0].hasPapers, true);
  assert.equal(rows[0].hasBox, true);
});

test("extractListingRows returns null for condition when not specified", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Rolex Watch","sku":"watch-1",
    "description":"Beautiful timepiece",
    "offers":{"price":"20000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows[0].condition, null);
});

test("extractListingRows falls back to loose page extraction when allowLoosePage is true", () => {
  const html = `<html>
    <head><meta property="og:title" content="Rolex Daytona for Sale"></head>
    <body>Price: $28,500 - Beautiful watch</body>
  </html>`;

  const rows = extractListingRows(html, "https://dealer.example/watch", "Daytona", { allowLoosePage: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Rolex Daytona for Sale");
  assert.equal(rows[0].priceOriginal, 28500);
  assert.equal(rows[0].currency, "USD");
});

test("extractListingRows returns empty when no price found and allowLoosePage is true", () => {
  const html = `<html><body>No price information here</body></html>`;
  const rows = extractListingRows(html, "https://dealer.example/", "Collection", { allowLoosePage: true });
  assert.equal(rows.length, 0);
});

test("extractListingRows returns empty when allowLoosePage is false and no structured data", () => {
  const html = `<html><body>Price: $28,500</body></html>`;
  const rows = extractListingRows(html, "https://dealer.example/", "Collection", { allowLoosePage: false });
  assert.equal(rows.length, 0);
});

test("extractListingRows resolves relative URLs correctly", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-1",
    "url":"/products/watch-123",
    "offers":{"price":"15000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/collection/page", "Watches");
  assert.equal(rows[0].detailUrl, "https://dealer.example/products/watch-123");
});

test("extractListingRows handles offers array (takes first)", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-1",
    "offers":[
      {"price":"10000","priceCurrency":"USD"},
      {"price":"12000","priceCurrency":"EUR"}
    ]
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows[0].priceOriginal, 10000);
  assert.equal(rows[0].currency, "USD");
});

test("extractListingRows skips products without price", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-1",
    "offers":{"priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows.length, 0);
});

test("extractListingRows skips products without currency", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-1",
    "offers":{"price":"15000"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows.length, 0);
});

test("extractListingRows handles numeric price values", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-1",
    "offers":{"price":15000,"priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows[0].priceOriginal, 15000);
});

test("extractListingRows handles lowPrice in offers", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-1",
    "offers":{"lowPrice":"12000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows[0].priceOriginal, 12000);
});

test("extractListingRows extracts production year when extractScopeAttributes is true", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Rolex 2023","sku":"w-1",
    "description":"Production year 2023",
    "offers":{"price":"25000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches", { extractScopeAttributes: true });
  assert.equal(rows[0].productionYear, 2023);
});

test("extractListingRows skips year extraction when extractScopeAttributes is false", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Rolex 2023","sku":"w-1",
    "description":"Production year 2023",
    "offers":{"price":"25000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches", { extractScopeAttributes: false });
  assert.equal(rows[0].productionYear, null);
});

test("extractListingRows handles malformed JSON-LD gracefully", () => {
  const html = `<script type="application/ld+json">{invalid json}</script>
    <script type="application/ld+json">{
      "@type":"Product","name":"Valid Watch","sku":"v-1",
      "offers":{"price":"20000","priceCurrency":"USD"}
    }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Valid Watch");
});

test("extractListingRows finds nested Product types", () => {
  const html = `<script type="application/ld+json">{
    "@type":"ItemList",
    "itemListElement":[{
      "@type":"Product","name":"Nested Watch","sku":"n-1",
      "offers":{"price":"18000","priceCurrency":"USD"}
    }]
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Nested Watch");
});

test("extractListingRows handles Product with @type array", () => {
  const html = `<script type="application/ld+json">{
    "@type":["Product","Watch"],"name":"Dual Type Watch","sku":"dt-1",
    "offers":{"price":"22000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Dual Type Watch");
});

test("extractListingRows detects warranty keywords", () => {
  const htmlFactory = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-1",
    "description":"Rolex factory warranty",
    "offers":{"price":"30000","priceCurrency":"USD"}
  }</script>`;

  const rowsFactory = extractListingRows(htmlFactory, "https://dealer.example/", "Watches", { extractScopeAttributes: true });
  assert.equal(rowsFactory[0].warranty, "factory");

  const htmlThirdParty = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","sku":"w-2",
    "description":"Comes with dealer warranty",
    "offers":{"price":"25000","priceCurrency":"USD"}
  }</script>`;

  const rowsThirdParty = extractListingRows(htmlThirdParty, "https://dealer.example/", "Watches", { extractScopeAttributes: true });
  assert.equal(rowsThirdParty[0].warranty, "third_party");
});

test("extractListingRows uses mpn as fallback for sku", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch","mpn":"MPN-123",
    "offers":{"price":"15000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.equal(rows[0].stableSku, "MPN-123");
});

test("extractListingRows parses various USD price formats", () => {
  const formats = [
    { text: "$28,500", expected: 28500 },
    { text: "USD 28500", expected: 28500 },
    { text: "US$ 28,500.00", expected: 28500 },
  ];

  for (const { text, expected } of formats) {
    const html = `<html><body>${text}</body></html>`;
    const rows = extractListingRows(html, "https://dealer.example/", "Watch", { allowLoosePage: true });
    assert.equal(rows.length, 1, `Should parse: ${text}`);
    assert.equal(rows[0].priceOriginal, expected, `Expected ${expected} from: ${text}`);
  }
});

test("extractListingRows preserves grounding snippet", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Watch Title","sku":"w-1",
    "description":"This is a detailed description of the watch for grounding purposes",
    "offers":{"price":"15000","priceCurrency":"USD"}
  }</script>`;

  const rows = extractListingRows(html, "https://dealer.example/", "Watches");
  assert.ok(rows[0].groundingSnippet.length > 0);
  assert.ok(rows[0].groundingSnippet.includes("Watch Title"));
});
