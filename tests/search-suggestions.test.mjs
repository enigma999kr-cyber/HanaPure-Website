import assert from "node:assert/strict";
import test from "node:test";
import { searchSuggestions, MAX_SEARCH_SUGGESTIONS, MAX_SUGGESTION_QUERY_LENGTH } from "../lib/catalog/search-suggestions.ts";
import { searchSuggestionLabels } from "../lib/catalog/search-suggestion-labels.ts";

const item = (index, patch = {}) => Object.freeze({
  publicId: `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`,
  slug: `test-only-${index}`, brand: "beplain", name: "Fixture Cleanser", description: "Synthetic gentle wash", ...patch,
});

test("suggestions use NFKC case-insensitive all-term containment across brand and selected content", () => {
  const first = item(1), second = item(2, { brand: "Anua", name: "Fixture cream" });
  const products = Object.freeze([first, second]);
  assert.deepEqual(searchSuggestions(products, " ＢＥＰＬＡＩＮ　ＣＬＥＡＮＳＥＲ wash "), [first]);
  assert.deepEqual(searchSuggestions(products, "anua gentle cream"), [second]);
  assert.deepEqual(searchSuggestions(products, "beplain cream"), []);
  assert.deepEqual(searchSuggestions(products, "cleanser absent"), []);
  assert.deepEqual(searchSuggestions([item(3, { name: "Lemosó" })], "LEMOSÓ"), [item(3, { name: "Lemosó" })]);
  assert.equal(searchSuggestions([item(4, { name: "세안제" })], "세안제").length, 1);
});

test("blank, oversized, arbitrary and regex-like input stays bounded without regex evaluation", () => {
  const products = [item(1)];
  for (const query of ["", "   \t\n", "　", null, undefined, 1, {}, [], "x".repeat(MAX_SUGGESTION_QUERY_LENGTH + 1)]) {
    assert.deepEqual(searchSuggestions(products, query), []);
  }
  assert.deepEqual(searchSuggestions(products, ".*"), []);
  assert.deepEqual(searchSuggestions(products, "["), []);
  assert.deepEqual(searchSuggestions([], "beplain"), []);
});

test("at most five unique valid identities retain publication order and original immutable references", () => {
  const products = Object.freeze(Array.from({ length: 9 }, (_, index) => item(index + 1)));
  const alias = item(1, { publicId: products[0].publicId.toUpperCase() });
  const supplied = Object.freeze([products[0], alias, item(99, { publicId: "fake" }), ...products.slice(1)]);
  const result = searchSuggestions(supplied, "beplain");
  assert.equal(result.length, MAX_SEARCH_SUGGESTIONS);
  assert.deepEqual(result, products.slice(0, 5));
  assert.strictEqual(result[0], products[0]);
  assert.equal(supplied.length, 11);
  assert.deepEqual(searchSuggestions([item(1, { slug: "https://invalid.test" })], "beplain"), []);
});

test("missing selected translation contributes brand only, with no other-language fallback or unknown IDs", () => {
  const missing = item(1, { name: null, description: null });
  assert.deepEqual(searchSuggestions([missing], "beplain"), [missing]);
  assert.deepEqual(searchSuggestions([missing], "Fixture"), []);
  assert.deepEqual(searchSuggestions([missing], "gentle"), []);
  assert.deepEqual(searchSuggestions([missing], "unrelated"), []);
  assert.deepEqual(Object.keys(searchSuggestions([missing], "beplain")[0]).sort(),
    ["brand", "description", "name", "publicId", "slug"]);
});

test("suggestion-only EN/HU/KO labels are complete and distinct", () => {
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(searchSuggestionLabels[locale]), ["heading", "none"]);
    for (const label of Object.values(searchSuggestionLabels[locale])) assert.ok(label.trim());
  }
  assert.notEqual(searchSuggestionLabels.en.heading, searchSuggestionLabels.hu.heading);
  assert.notEqual(searchSuggestionLabels.en.heading, searchSuggestionLabels.ko.heading);
});
