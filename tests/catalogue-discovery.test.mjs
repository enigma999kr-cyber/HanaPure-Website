import assert from "node:assert/strict";
import test from "node:test";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { catalogueQueryString, discoverCatalogue, readCatalogueCriteria } from "../lib/catalog/catalogue-discovery.ts";
import { brandNames } from "../data/brands.ts";

const content = (name, description = "Fictional test content only.") => ({ name, description, images: [], usage: null, caution: null });
const record = (number, brand, state = "published") => ({
  publicId: `${number}2345678-abcd-1234-abcd-123456789abc`, slug: `fixture-${number}`, brand, state,
  translations: { en: content("Fixture cleanser", "Gentle fictional formula"), hu: content("Teszt lemosó", "Kímélő teszt formula"), ko: content("테스트 세안제", "테스트 설명" ) },
});
const catalogue = createLocalCatalogueReader([record(1, "beplain"), record(2, "Anua"), record(3, "beplain", "draft")]);
const search = (query = "", brand = "", locale = "en", reader = catalogue) => discoverCatalogue(reader, locale, { query, brand });

test("published name/description and brand searches are deterministic and never expose drafts", () => {
  assert.deepEqual(search("  CLEANser  ").map(p => p.slug), ["fixture-1", "fixture-2"]);
  assert.equal(search("gentle formula").length, 2);
  assert.deepEqual(search("BEPLAIN").map(p => p.slug), ["fixture-1"]);
  assert.equal(search("fixture-3").length, 0);
});

test("EN/HU/KO search only their selected editorial text; Unicode normalization is consistent", () => {
  assert.equal(search("lemosó", "", "hu").length, 2);
  assert.equal(search("세안제", "", "ko").length, 2);
  assert.equal(search("cleanser", "", "hu").length, 0);
  assert.equal(search("lemosó", "", "ko").length, 0);
  assert.equal(search("ＣＬＥＡＮＳＥＲ").length, 2);
  assert.equal(search("kímélő", "", "hu").length, 2);
});

test("exact authoritative brand filters intersect with search and never multiply results", () => {
  for (const brand of brandNames) {
    const found = search("", brand);
    assert.ok(found.every(p => p.brand === brand));
    assert.equal(found.length, brand === "beplain" || brand === "Anua" ? 1 : 0);
  }
  assert.deepEqual(search("cleanser", "Anua").map(p => p.slug), ["fixture-2"]);
  assert.equal(search("beplain", "Anua").length, 0);
  assert.equal(new Set(search("fixture cleanser").map(p => p.publicId)).size, 2);
  assert.equal(search("", "unknown-brand").length, 0);
});

test("clearing either field retains the other; clearing both restores the published snapshot order", () => {
  assert.equal(search("unmatched", "beplain").length, 0);
  assert.equal(search("", "beplain").length, 1);
  assert.equal(search("cleanser", "").length, 2);
  assert.deepEqual(search().map(p => p.publicId), catalogue.listPublished().map(p => p.publicId));
  assert.deepEqual(search(" \n ").map(p => p.slug), ["fixture-1", "fixture-2"]);
});

test("missing translations supply no fallback text while brand discovery retains explicit missing-content records", () => {
  const missing = record(4, "COSRX"); missing.translations.hu = null; missing.translations.ko = null;
  const reader = createLocalCatalogueReader([missing]);
  assert.equal(search("cleanser", "", "hu", reader).length, 0);
  assert.equal(search("formula", "", "ko", reader).length, 0);
  assert.equal(search("COSRX", "", "hu", reader)[0].translations.hu, null);
  assert.equal(search("", "COSRX", "ko", reader)[0].translations.ko, null);
  assert.equal(search("", "", "hu", reader).length, 1);
});

test("invalid publication/brand/operational fields cannot enter discovery", () => {
  const invalid = record(5, "beplain"); invalid.translations.en.name = "";
  assert.throws(() => createLocalCatalogueReader([invalid]), /incomplete_published_content/);
  assert.throws(() => createLocalCatalogueReader([record(5, "invented-brand")]), /invalid_brand/);
  for (const field of ["basePriceHuf", "sellableStock", "operationalReady"]) {
    assert.throws(() => createLocalCatalogueReader([{ ...record(5, "beplain"), [field]: 1 }]), /invalid_record/);
  }
  const before = JSON.stringify(catalogue.listPublished());
  search("cleanser", "beplain");
  assert.equal(JSON.stringify(catalogue.listPublished()), before);
});

test("query parsing and serialization preserve active state, use first repeated values and clear explicitly", () => {
  assert.deepEqual(readCatalogueCriteria({ q: ["  cleanser  ", "ignored"], brand: ["Round Lab", "Anua"] }), { query: "cleanser", brand: "Round Lab" });
  assert.deepEqual(readCatalogueCriteria({ q: [], brand: undefined }), { query: "", brand: "" });
  const criteria = { query: "테스트 & lemosó", brand: "Round Lab" };
  const serialized = catalogueQueryString(criteria);
  assert.deepEqual(readCatalogueCriteria(Object.fromEntries(new URLSearchParams(serialized))), criteria);
  assert.equal(catalogueQueryString(readCatalogueCriteria()), "");
  assert.equal(catalogueQueryString({ query: "", brand: "Anua" }), "?brand=Anua");
});
