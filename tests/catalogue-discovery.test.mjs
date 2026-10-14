import assert from "node:assert/strict";
import test from "node:test";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { catalogueQueryString, discoverCatalogue, publishedCatalogueBrands, readCatalogueCriteria } from "../lib/catalog/catalogue-discovery.ts";
import { brandNames } from "../data/brands.ts";

const content = (name, description = "Fictional test content only.") => ({ name, description, images: [], usage: null, caution: null });
const record = (number, brand, state = "published") => ({
  publicId: `${number}2345678-abcd-1234-abcd-123456789abc`, slug: `fixture-${number}`, brand, state,
  translations: { en: content("Fixture cleanser", "Gentle fictional formula"), hu: content("Teszt lemosó", "Kímélő teszt formula"), ko: content("테스트 세안제", "테스트 설명" ) },
});
const catalogue = createLocalCatalogueReader([record(1, "beplain"), record(2, "Anua"), record(3, "beplain", "draft")]);
const search = (query = "", brand = "", locale = "en", reader = catalogue) => discoverCatalogue(reader, locale, { query, brand });

test("brand discovery is unique, alphabetical, published-only, independent of missing locale and stock", () => {
  const missing = record(4, "COSRX"); missing.translations.hu = null; missing.translations.ko = null;
  const reader = createLocalCatalogueReader([record(1, "beplain"), record(2, "beplain"), record(3, "Anua", "draft"), missing]);
  assert.deepEqual(publishedCatalogueBrands(reader), ["beplain", "COSRX"]);
  assert.deepEqual(publishedCatalogueBrands(createLocalCatalogueReader([])), []);
  assert.deepEqual(publishedCatalogueBrands(createLocalCatalogueReader([record(1, "Anua", "draft")])), []);
  assert.equal(reader.listPublished().length, 3);
});

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

test("sort allowlist round-trips while repeated/invalid sort defaults and q/brand first values remain", () => {
  for (const sort of ["name-asc", "name-desc"]) {
    const criteria = readCatalogueCriteria({ q: [" 테스트 & lemosó ", "ignored"], brand: ["Round Lab", "Anua"], sort });
    assert.deepEqual(criteria, { query: "테스트 & lemosó", brand: "Round Lab", sort });
    assert.deepEqual(readCatalogueCriteria(Object.fromEntries(new URLSearchParams(catalogueQueryString(criteria)))), criteria);
    assert.deepEqual(readCatalogueCriteria({ sort: [sort] }), { query: "", brand: "", sort });
  }
  for (const sort of ["", "default", "price", "//example.invalid", [], ["name-asc", "name-asc"], ["name-desc", "name-asc"]]) {
    const criteria = readCatalogueCriteria({ q: ["first", "second"], brand: ["Anua", "beplain"], sort, returnUrl: "//example.invalid" });
    assert.deepEqual(criteria, { query: "first", brand: "Anua" });
    assert.equal(catalogueQueryString(criteria), "?q=first&brand=Anua");
  }
  assert.equal(catalogueQueryString({ query: "", brand: "", sort: "invalid" }), "");
});

test("localized names sort after filtering; ties and missing names stay deterministic without mutating publication", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const names = locale === "ko" ? ["나 테스트", "가 테스트"] : locale === "hu" ? ["Zebra teszt", "Alma teszt"] : ["Zebra fixture", "Alpha fixture"];
    const records = [record(1, "beplain"), record(4, "beplain"), record(2, "beplain"), record(6, "Anua"), record(5, "beplain"), record(3, "beplain", "draft")];
    for (const item of records) item.translations[locale] = content(item.slug === "fixture-1" ? names[0] : names[1]);
    records[3].translations[locale] = null; records[4].translations[locale] = null;
    const reader = createLocalCatalogueReader(records);
    const before = JSON.stringify(reader.listPublished());
    const slugs = criteria => discoverCatalogue(reader, locale, criteria).map(item => item.slug);
    assert.deepEqual(slugs({ query: "", brand: "" }), ["fixture-1", "fixture-4", "fixture-2", "fixture-6", "fixture-5"]);
    assert.deepEqual(slugs({ query: "", brand: "", sort: "name-asc" }), ["fixture-2", "fixture-4", "fixture-1", "fixture-5", "fixture-6"]);
    assert.deepEqual(slugs({ query: "", brand: "", sort: "name-desc" }), ["fixture-1", "fixture-2", "fixture-4", "fixture-5", "fixture-6"]);
    assert.deepEqual(slugs({ query: names[1], brand: "beplain", sort: "name-desc" }), ["fixture-2", "fixture-4"]);
    assert.deepEqual(slugs({ query: "beplain", brand: "beplain", sort: "name-asc" }), ["fixture-2", "fixture-4", "fixture-1", "fixture-5"]);
    assert.equal(JSON.stringify(reader.listPublished()), before);
  }
});

test("the same published identities use selected-language names rather than English sorting", () => {
  const one = record(1, "beplain"), two = record(2, "beplain");
  one.translations.en.name = "Zebra"; two.translations.en.name = "Alpha";
  one.translations.hu.name = "Alma"; two.translations.hu.name = "Zebra";
  one.translations.ko.name = "가"; two.translations.ko.name = "나";
  const reader = createLocalCatalogueReader([one, two]);
  for (const locale of ["en", "hu", "ko"]) assert.deepEqual(discoverCatalogue(reader, locale,
    { query: "", brand: "", sort: "name-asc" }).map(item => item.slug), locale === "en" ? ["fixture-2", "fixture-1"] : ["fixture-1", "fixture-2"]);
});
