import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createLocalCatalogueReader, validateEditorialCatalogue } from "../lib/catalog/editorial-catalogue.ts";
import { readCatalogueCriteria, discoverCatalogue, catalogueQueryString } from "../lib/catalog/catalogue-discovery.ts";
import { catalogueResultPage, readCatalogueBrowse, catalogueBrowseHref } from "../lib/catalog/catalogue-browse.ts";
import { publishedComparison, comparisonHref } from "../lib/comparison/compare-selection.ts";
import { readShoppingPlan, shoppingPlanHref, shoppingPlanCartHref } from "../lib/catalog/catalogue-shopping-plan.ts";
import { readPortableLink, planPortableMerge, portablePayload } from "../lib/cart/cart-portable-handoff.ts";
import { cartDraftImpact } from "../lib/cart/cart-draft-impact.ts";
import { publishedCatalogueFixtures, journeyCatalogueProducts, paginatedCatalogueFixtures } from "./browser/published-catalogue-fixtures.mjs";
import { publishedTestSelection, publishedFixtureScenario, fixtureEnvironment } from "./browser/published-catalogue-server.mjs";

// Pure/domain + runner-selection proof only. This file never starts a fixture,
// opens a socket/browser, runs a build or writes browser storage.
const catalogue = createLocalCatalogueReader(paginatedCatalogueFixtures);
const params = { q: "TEST ONLY JOURNEY", brand: "Round Lab", sort: "name-asc", withLocaleInfo: "1", withLocaleImage: "1" };
const first = journeyCatalogueProducts[0], second = journeyCatalogueProducts[12];

test("WEB20 opt-in scenario leaves the five CLOSED base records and publication distribution intact", () => {
  assert.equal(publishedCatalogueFixtures.length, 5);
  const base = createLocalCatalogueReader(publishedCatalogueFixtures);
  assert.equal(base.listPublished().length, 4);
  assert.deepEqual(paginatedCatalogueFixtures.slice(0, 5), publishedCatalogueFixtures);
  assert.equal(base.findPublishedBySlug(first.slug), null);
  assert.equal(publishedCatalogueFixtures[2].translations.hu, null);
});

test("WEB20 paginated synthetic records satisfy the real authority without price/stock/readiness facts", () => {
  assert.equal(validateEditorialCatalogue(paginatedCatalogueFixtures).ok, true);
  assert.equal(catalogue.listPublished().length, 18);
  assert.equal(catalogue.findPublishedBySlug("test-only-journey-draft"), null);
  for (const record of journeyCatalogueProducts) {
    assert.deepEqual(Object.keys(record).sort(), ["brand", "publicId", "slug", "state", "translations"]);
    for (const locale of ["en", "hu", "ko"]) {
      assert.ok(record.translations[locale].name.startsWith("TEST ONLY JOURNEY"));
      assert.ok(record.translations[locale].images[0].alt.startsWith("TEST ONLY"));
    }
  }
});

for (const locale of ["en", "hu", "ko"]) test(`WEB20 ${locale} real discovery spans 12+2 and restores cross-page identities without draft leakage`, () => {
  const criteria = readCatalogueCriteria(params), query = catalogueQueryString(criteria);
  const discovered = discoverCatalogue(catalogue, locale, criteria);
  const pageOne = catalogueResultPage(discovered, locale, readCatalogueBrowse(params));
  const pageTwo = catalogueResultPage(discovered, locale, readCatalogueBrowse({ ...params, page: "2", pickFirst: first.publicId }));
  assert.equal(discovered.length, 14);
  assert.deepEqual(pageOne.items.map(product => product.publicId), journeyCatalogueProducts.slice(0, 12).map(product => product.publicId));
  assert.deepEqual(pageTwo.items.map(product => product.publicId), journeyCatalogueProducts.slice(12).map(product => product.publicId));
  const href = catalogueBrowseHref(`/${locale}/products`, query, readCatalogueBrowse({ ...params, page: "2", pickFirst: first.publicId }));
  const url = new URL(href, "http://localhost");
  assert.equal(url.searchParams.get("pickFirst"), first.publicId);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("withLocaleImage"), "1");
  const pair = publishedComparison(catalogue.listPublished(), { first: url.searchParams.get("pickFirst"), second: pageTwo.items[0].publicId });
  assert.deepEqual(pair.map(product => product.publicId), [first.publicId, second.publicId]);
  const detail = new URL(comparisonHref(`/${locale}/products/${first.slug}`, pair, query), "http://localhost");
  assert.equal(detail.searchParams.get("q"), params.q);
  assert.equal(detail.searchParams.get("brand"), params.brand);
  assert.equal(detail.searchParams.get("compareSecond"), second.publicId);
  assert.equal(catalogue.findPublishedBySlug(detail.pathname.split("/").at(-1)).publicId, first.publicId);
});

test("WEB20 fixture selection is explicit while base all-tests excludes the opt-in cases", () => {
  assert.equal(publishedFixtureScenario([]), "base");
  assert.deepEqual(publishedTestSelection([]), ["--grep-invert", "\\[web20\\]"]);
  for (const selector of ["--gallery-only", "--journey-quality-only", "--cart-only", "--discovery-only"]) {
    assert.equal(publishedFixtureScenario([selector]), "base");
  }
  assert.equal(publishedFixtureScenario(["--integrated-journey-only"]), "paginated");
  assert.deepEqual(publishedTestSelection(["--integrated-journey-only"]), ["--grep", "\\[web20\\]", "--project", "published-chromium-375"]);
  assert.deepEqual(publishedTestSelection(["--gallery-only"]), ["--grep", "media gallery"]);
});

test("WEB20 unknown or combined scenario selectors fail before any fixture/browser execution", () => {
  for (const args of [["--unknown"], ["--integrated-journey-only", "--gallery-only"], ["--integrated-journey-only=base"]]) {
    assert.throws(() => publishedFixtureScenario(args), /STOP/);
  }
});

test("WEB20 scenario cannot be selected by caller environment or weaken secret filtering", () => {
  const env = fixtureEnvironment({ HANAPURE_PUBLISHED_SCENARIO: "paginated", NODE_OPTIONS: "test-only-hook", API_SECRET: "test-only-secret", SYSTEMROOT: "C:\\Windows" });
  assert.equal(env.HANAPURE_PUBLISHED_SCENARIO, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.API_SECRET, undefined);
  assert.equal(env.SYSTEMROOT, "C:\\Windows");
});

for (const locale of ["en", "hu", "ko"]) test(`WEB20 ${locale} paginated selections compose Plan and read-only Cart impact before additive merge`, () => {
  const lines = [{ publicId: first.publicId, quantity: 3 }, { publicId: second.publicId, quantity: 1 }];
  const plan = readShoppingPlan(portablePayload(lines), catalogue.listPublished());
  const href = shoppingPlanHref(`/${locale}/products`, "?q=TEST+ONLY+JOURNEY&brand=Round+Lab", lines);
  assert.deepEqual(readShoppingPlan(new URL(href, "http://localhost").searchParams.get("cartPlan"), catalogue.listPublished()), plan);
  const incoming = readPortableLink(new URL(shoppingPlanCartHref(`/${locale}/cart`, plan, catalogue.listPublished()), "http://localhost").href);
  assert.equal(incoming.status, "ready");
  const current = [{ publicId: first.publicId, quantity: 2 }], before = JSON.stringify(current);
  const impact = cartDraftImpact(current, incoming.lines, catalogue.listPublished());
  assert.equal(impact.status, "ready");
  assert.equal(JSON.stringify(current), before);
  const merged = planPortableMerge(current, incoming.lines, catalogue.listPublished());
  assert.equal(merged.status, "ready");
  assert.deepEqual(merged.after, [{ publicId: first.publicId, quantity: 5 }, { publicId: second.publicId, quantity: 1 }]);
});

test("WEB20 unknown/draft Plan and comparison cannot enter the synthetic public chain", () => {
  const privateId = "81999999-abcd-1234-abcd-123456789abc";
  assert.equal(readShoppingPlan(portablePayload([{ publicId: privateId, quantity: 1 }]), catalogue.listPublished()).status, "invalid");
  assert.equal(publishedComparison(catalogue.listPublished(), { first: first.publicId, second: privateId }), null);
  assert.match(readFileSync(new URL("../data/catalogue.ts", import.meta.url), "utf8"), /Object\.freeze\(\[\]\)/);
});
