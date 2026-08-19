import assert from "node:assert/strict";
import test from "node:test";
import { baseReferenceFallbackQuery, classifyListingIdentity, extractListingRows, includeDomainsForDiscoveryQuery, iqrRetained, isAskAttributedToListing, isLikelyProductListingUrl, isListingUnavailable, isPriceGrounded, listingAskEligibleForSeries, listingConditionFromText, listingPriceSanityReason, pageHasNoPublicAskingPrice, prioritizeDiscoveryUrls, priceQueryTemplates, siteScopedDiscoverySellers } from "@/lib/research";
import type { Watch } from "@/lib/watches";

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

test("extractListingRows reads schema.org itemCondition as grey vs resell evidence", () => {
  const htmlNew = `<script type="application/ld+json">{
    "@type":"Product","name":"Rolex Daytona","sku":"new-schema",
    "offers":{"price":"36000","priceCurrency":"USD","itemCondition":"https://schema.org/NewCondition"}
  }</script>`;
  assert.equal(extractListingRows(htmlNew, "https://dealer.example/", "Watches")[0].condition, "unworn");

  const htmlUsed = `<script type="application/ld+json">{
    "@type":"Product","name":"Rolex Daytona","sku":"used-schema",
    "offers":{"price":"34000","priceCurrency":"USD","itemCondition":"https://schema.org/UsedCondition"}
  }</script>`;
  assert.equal(extractListingRows(htmlUsed, "https://dealer.example/", "Watches")[0].condition, "pre_owned");

  const htmlRefurbished = `<script type="application/ld+json">{
    "@type":"Product","name":"Rolex Daytona","sku":"refurb-schema",
    "offers":{"price":"34995","priceCurrency":"USD","itemCondition":"https://schema.org/RefurbishedCondition"}
  }</script>`;
  assert.equal(extractListingRows(htmlRefurbished, "https://dealer.example/", "Watches")[0].condition, "pre_owned");
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

test("extractListingRows falls back to grounded Open Graph price when allowLoosePage is true", () => {
  const html = `<html>
    <head>
      <meta property="og:title" content="Rolex Daytona for Sale">
      <meta property="product:price:amount" content="28500">
    </head>
    <body>Price: $8,000 in page chrome - Beautiful watch</body>
  </html>`;

  const rows = extractListingRows(html, "https://dealer.example/watch", "Daytona", { allowLoosePage: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Rolex Daytona for Sale");
  assert.equal(rows[0].priceOriginal, 28500);
  assert.equal(rows[0].currency, "USD");
  assert.equal(isPriceGrounded(rows[0]), true);
});

test("extractListingRows reads Open Graph metadata regardless of attribute order", () => {
  const html = '<meta content="Rolex Daytona for Sale" property="og:title"><meta content="28500" property="product:price:amount"><body>$8,000</body>';
  const rows = extractListingRows(html, "https://dealer.example/watch", "Daytona");
  assert.equal(rows[0].title, "Rolex Daytona for Sale");
  assert.equal(rows[0].priceOriginal, 28500);
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

test("extractListingRows parses grounded USD price metadata", () => {
  const formats = [
    { content: "28500", expected: 28500 },
    { content: "28,500.00", expected: 28500 },
    { content: "28500.00", expected: 28500 },
  ];

  for (const { content, expected } of formats) {
    const html = `<html><head><meta property="product:price:amount" content="${content}"></head><body>$8,000</body></html>`;
    const rows = extractListingRows(html, "https://dealer.example/watch", "Watch", { allowLoosePage: true });
    assert.equal(rows.length, 1, `Should parse: ${content}`);
    assert.equal(rows[0].priceOriginal, expected, `Expected ${expected} from: ${content}`);
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

test("expanded price queries use the exact WatchBase variant and stay within five searches", () => {
  const watch = { id: "watch-1", reference_number: "126503-0001", model_name: "Rolex Daytona", nickname: "Daytona Stainless Steel - Yellow Gold / White" } as Watch;
  const sellers = [
    { id: "one", name: "One", domain: "one.example" },
    { id: "two", name: "Two", domain: "two.example" },
    { id: "three", name: "Three", domain: "three.example" },
    { id: "four", name: "Four", domain: "four.example" },
  ];
  const queries = priceQueryTemplates(watch, sellers);
  assert.equal(queries.length, 5);
  assert.ok(queries[0].includes("126503-0001"));
  assert.ok(queries.slice(1).every((query) => query.includes("126503")));
  assert.ok(queries.every((query) => !query.includes(watch.nickname)));
  assert.ok(queries.some((query) => query.includes("site:")));
  assert.ok(queries.some((query) => query.includes("unworn OR new")));

  const letterSuffixQueries = priceQueryTemplates({ ...watch, reference_number: "126610LN" }, sellers);
  assert.ok(letterSuffixQueries[0].includes("126610LN"));
  assert.ok(letterSuffixQueries.slice(1).every((query) => query.includes("126610")));
});

test("site-scoped discovery pins extractable grey dealers and fills remaining slots from the rotation", () => {
  const watch = { id: "watch-1", reference_number: "126500LN", model_name: "Rolex Daytona" } as Watch;
  const sellers = [
    { id: "chrono", name: "Chrono24", domain: "chrono24.com" },
    { id: "david", name: "DavidSW", domain: "davidsw.com" },
    { id: "joma", name: "Jomashop", domain: "jomashop.com" },
    { id: "bobs", name: "Bobs", domain: "bobswatches.com" },
  ];
  const selected = siteScopedDiscoverySellers(watch, sellers);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].domain, "davidsw.com");
  assert.ok(selected.every((seller) => seller.domain !== "jomashop.com"));
  const queries = priceQueryTemplates(watch, sellers);
  assert.ok(queries.some((query) => query.includes("site:davidsw.com")));
  assert.ok(queries.every((query) => !query.includes("site:jomashop.com")));
  const siteQuery = queries.find((query) => query.startsWith("site:davidsw.com"));
  assert.ok(siteQuery);
  assert.deepEqual(includeDomainsForDiscoveryQuery(siteQuery!, sellers), ["davidsw.com"]);
  assert.deepEqual(includeDomainsForDiscoveryQuery(queries[0], sellers), sellers.map((seller) => seller.domain));
});

test("discovery URL order round-robins domains and puts extractable grey dealers first", () => {
  const ranked = prioritizeDiscoveryUrls([
    { url: "https://www.chrono24.com/a", title: "A" },
    { url: "https://www.chrono24.com/b", title: "B" },
    { url: "https://www.chrono24.com/c", title: "C" },
    { url: "https://www.jomashop.com/one", title: "JS shell" },
    { url: "https://davidsw.com/one", title: "Grey" },
    { url: "https://bobswatches.com/one", title: "Resell" },
  ]);
  assert.equal(ranked[0].url, "https://davidsw.com/one");
  assert.ok(ranked.findIndex((result) => result.url.includes("jomashop.com")) > 0);
  assert.deepEqual(ranked.slice(0, 4).map((result) => new URL(result.url).hostname.replace(/^www\./, "")), ["davidsw.com", "chrono24.com", "jomashop.com", "bobswatches.com"]);
});

test("listingConditionFromText accepts schema.org and dealer grey vocabulary", () => {
  assert.equal(listingConditionFromText('{"itemCondition":"https://schema.org/NewCondition"}'), "unworn");
  assert.equal(listingConditionFromText("never worn full set"), "unworn");
  assert.equal(listingConditionFromText("NWBIG Rolex"), "unworn");
  assert.equal(listingConditionFromText('{"itemCondition":"UsedCondition"}'), "pre_owned");
  assert.equal(listingConditionFromText("Beautiful timepiece"), null);
});

test("offer itemCondition wins over stray new copy on a used listing", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Used White Dial Rolex Daytona Ref 126500 Steel Oyster",
    "offers":{"price":"38795.00","priceCurrency":"USD","itemCondition":"UsedCondition","availability":"InStock"}
  }</script>`;
  const rows = extractListingRows(html, "https://www.bobswatches.com/used-white-dial-rolex-daytona-ref-126500-steel-oyster.html", "Used White Dial");
  assert.equal(rows[0].condition, "pre_owned");
});

test("collection and brand-index URLs are not treated as product listings", () => {
  assert.equal(isLikelyProductListingUrl("https://www.luxurybazaar.com/brands/rolex/ref-126500ln"), false);
  assert.equal(isLikelyProductListingUrl("https://www.bobswatches.com/rolex-blog/editorial/rolex-daytona-waiting-list.html"), false);
  assert.equal(isLikelyProductListingUrl("https://www.luxurybazaar.com/product/rolex-daytona-white-dial-watch-126500ln-001"), true);
  assert.equal(isLikelyProductListingUrl("https://davidsw.com/shop/watch/rolex/rolex-126610ln-submariner-date-41-21"), true);
  const html = `<html><body>Rolex Daytona Reference 126500LN Shop watches from $8,000</body></html>`;
  assert.equal(extractListingRows(html, "https://www.luxurybazaar.com/brands/rolex/ref-126500ln", "126500LN", { allowLoosePage: true }).length, 0);
  assert.equal(extractListingRows(html, "https://www.luxurybazaar.com/product/rolex-daytona-white-dial-watch-126500ln-001", "Panda", { allowLoosePage: true }).length, 0);
});

test("loose meta prices remain grounded when the digits live only in tag attributes", () => {
  const html = `<html>
    <head>
      <meta property="og:title" content="Rolex Daytona for Sale">
      <meta property="product:price:amount" content="28500">
    </head>
    <body>Beautiful watch. Shop from $8,000.</body>
  </html>`;
  const rows = extractListingRows(html, "https://dealer.example/watch", "Daytona", { allowLoosePage: true });
  assert.equal(rows[0].priceOriginal, 28500);
  assert.equal(isPriceGrounded(rows[0]), true);
  assert.match(rows[0].groundingSnippet, /28500/);
});

test("itemprop text nodes are used and empty itemprop tags do not hide a later price", () => {
  const html = `<html>
    <head><meta property="og:title" content="Rolex Daytona"></head>
    <body>
      <span itemprop="price"></span>
      <div itemprop="price"><strong>$28,500</strong></div>
    </body>
  </html>`;
  const rows = extractListingRows(html, "https://dealer.example/watch", "Daytona", { allowLoosePage: true });
  assert.equal(rows[0].priceOriginal, 28500);
  assert.equal(isPriceGrounded(rows[0]), true);
});

test("nested same-name tags do not truncate an itemprop price or hide a later one", () => {
  const nested = `<html>
    <head><meta property="og:title" content="Rolex Daytona"></head>
    <body>
      <div itemprop="price"><div>MSRP</div>$28,500</div>
    </body>
  </html>`;
  const nestedRows = extractListingRows(nested, "https://dealer.example/watch", "Daytona", { allowLoosePage: true });
  assert.equal(nestedRows[0].priceOriginal, 28500);
  assert.equal(isPriceGrounded(nestedRows[0]), true);

  const later = `<html>
    <head><meta property="og:title" content="Rolex Daytona"></head>
    <body>
      <div itemprop="price"><div>MSRP</div></div>
      <span itemprop="price">$28,500</span>
    </body>
  </html>`;
  const laterRows = extractListingRows(later, "https://dealer.example/watch", "Daytona", { allowLoosePage: true });
  assert.equal(laterRows[0].priceOriginal, 28500);
  assert.equal(isPriceGrounded(laterRows[0]), true);
});

test("base-reference fallback only applies to a subvariant", () => {
  assert.equal(baseReferenceFallbackQuery({ reference_number: "126503-0001", model_name: "Rolex Daytona" } as Watch), "Rolex 126503 Rolex Daytona for sale");
  assert.equal(baseReferenceFallbackQuery({ reference_number: "126500LN", model_name: "Rolex Daytona" } as Watch), null);
});

test("listing identity requires the tracked reference and rejects parts", () => {
  const watch = { reference_number: "126509-0008", scope: { identityTerms: ["factory baguette"] }, retail_price_usd: "59100" } as Watch;
  assert.equal(classifyListingIdentity("Rolex 126509-0008 factory baguette Daytona", "Complete watch with factory baguette dial.", watch), null);
  assert.equal(classifyListingIdentity("Rolex 126509 factory baguette Daytona", "Complete watch with factory baguette dial.", watch), null);
  assert.match(classifyListingIdentity("Rolex 126500LN", "Complete watch", watch) ?? "", /reference/);
  assert.match(classifyListingIdentity("Rolex 126509-0008 bezel for Daytona", "Replacement bezel for 126509-0008", watch) ?? "", /part or accessory/);
  assert.match(classifyListingIdentity("Rolex 126509-0008", "Complete watch", watch) ?? "", /Missing required/);
  assert.match(listingPriceSanityReason(4950, watch) ?? "", /below 20%/);
  assert.equal(listingPriceSanityReason(50950, watch), null);
});

test("letter-suffixed references may use a bare numeric stem when no conflicting variant appears", () => {
  const watch = { reference_number: "126610LN", scope: { condition: "any", yearMin: null, yearMax: null, papers: "not_required", box: "not_required", warranty: "none_ok", identityTerms: ["black"] } } as Watch;
  assert.equal(classifyListingIdentity("Rolex Submariner Ref 126610 Black Dial", "Complete watch", watch), null);
  assert.match(classifyListingIdentity("Rolex Submariner Ref 126610LV Black Dial", "Complete watch", watch) ?? "", /reference/);
  assert.equal(classifyListingIdentity("Rolex Submariner Ref 126610", "Complete watch", { ...watch, scope: { ...watch.scope, identityTerms: [] } }), null);
  assert.match(classifyListingIdentity("Rolex Submariner Ref 126610", "Complete watch", { ...watch, scope: { ...watch.scope, identityTerms: ["hulk"] } }) ?? "", /Missing required/);
});

test("out-of-stock evidence never counts as a current listing", () => {
  assert.equal(isListingUnavailable('{"offers":{"availability":"https://schema.org/OutOfStock"}}'), true);
  assert.equal(isListingUnavailable('{"offers":{"availability":"InStock"}}'), false);
  assert.equal(isListingUnavailable('woocommerce-Price-amount">Inquire For Pricing</span>'), true);
  assert.equal(pageHasNoPublicAskingPrice('{"offers":{"price":"0.00","priceCurrency":"USD"}}'), true);
  assert.equal(pageHasNoPublicAskingPrice("In stock $28,500"), false);
});

test("JSON-LD price 0 and inquire CTAs do not inherit related-item chrome prices", () => {
  const html = `<html>
    <script type="application/ld+json">{
      "@type":"Product","name":"Rolex Daytona White Dial Panda Watch 126500LN-0001","sku":"310726",
      "offers":{"@type":"Offer","price":"0.00","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}
    }</script>
    <span class="woocommerce-Price-amount amount">Inquire For Pricing</span>
    <a id="inquire-button">Inquire for Pricing</a>
    <div>New Arrivals Otsuka Lotec No. 7.5 Jumping Hour Steel Watch $8,000 Take a Look</div>
  </html>`;
  const url = "https://www.luxurybazaar.com/product/rolex-daytona-white-dial-watch-126500ln-001/";
  assert.equal(extractListingRows(html, url, "Panda", { allowLoosePage: true }).length, 0);
});

test("zero-price JSON-LD offers are skipped in favor of a later usable ask", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Product","name":"Rolex Daytona","sku":"w-1",
    "offers":[
      {"price":"0.00","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"},
      {"price":"36575","priceCurrency":"USD","availability":"https://schema.org/InStock"}
    ]
  }</script>`;
  const rows = extractListingRows(html, "https://dealer.example/watch", "Daytona");
  assert.equal(rows[0].priceOriginal, 36575);
});

test("related-item carousel prices are not attributed to the listing", () => {
  const panda = {
    reference_number: "126500LN",
    retail_price_usd: "16700",
    scope: { condition: "any" as const, yearMin: null, yearMax: null, papers: "not_required" as const, box: "not_required" as const, warranty: "none_ok" as const, identityTerms: [] },
  };
  const carousel = "Rolex Daytona White Dial Panda Watch 126500LN-0001 - 40mm - White - - Skip to content Shop By Brand All Watch Brands Brands A to Z Popular Watch Brands Rolex Audemars Piguet Patek Philippe Cartier Omega Tudor Vacheron Constantin Panerai Featured Collections Daytona Submariner GMT-Master Nautilus Dial Colors Blue Dial Green Dial White Dial Black Dial New Arrivals Rolex Audemars Piguet Patek Philippe Cartier Omega Tudor All New Arrivals Otsuka Lotec No. 7.5 Jumping Hour Steel Watch $8,000 Take a Look Otsuka Lotec Double Retrograde Steel Watch $9,650 Take a Look";
  assert.equal(isAskAttributedToListing(carousel, "Rolex Daytona White Dial Panda Watch 126500LN-0001", 8000, "126500LN"), false);
  assert.equal(listingAskEligibleForSeries({
    source_url: "https://www.luxurybazaar.com/product/rolex-daytona-white-dial-watch-126500ln-001",
    title: "Rolex Daytona White Dial Panda Watch 126500LN-0001",
    price_usd: 8000,
    grounding_snippet: carousel,
  }, panda), false);
  assert.equal(listingAskEligibleForSeries({
    source_url: "https://www.luxurybazaar.com/brands/rolex/ref-126500ln",
    title: "126500LN",
    price_usd: 8000,
    grounding_snippet: "Rolex Daytona Reference 126500LN Skip to content Shop By Brand All Watch Brands Featured Collections Daytona Submariner New Arrivals Rolex Audemars Piguet Patek Philippe Cartier Omega Tudor All New Arrivals Otsuka Lotec No. 7.5 Jumping Hour Steel Watch $8,000 Take a Look",
  }, panda), false);
  assert.equal(isAskAttributedToListing(
    '{"name":"Rolex Daytona White Dial Panda Watch 126500LN-0001","offers":{"price":"36575.00","priceCurrency":"USD"}}',
    "Rolex Daytona White Dial Panda Watch 126500LN-0001",
    36575,
    "126500LN",
  ), true);
  assert.equal(isAskAttributedToListing("product:price:amount 28500. Beautiful watch. Shop from $8,000.", "Rolex Daytona for Sale", 28500, "126500LN"), true);
});

test("IQR filtering retains nearby prices when a mode-heavy sample has zero spread", () => {
  const rows = [{ value: 15295 }, { value: 15295 }, { value: 15295 }, { value: 15295 }, { value: 15295 }, { value: 15395 }];
  assert.deepEqual(iqrRetained(rows).map((row) => row.value), [15295, 15295, 15295, 15295, 15295, 15395]);
});
