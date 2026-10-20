import assert from "node:assert/strict";
import test from "node:test";
import { comparisonOptions, resolveComparison } from "../lib/comparison/compare-selection.ts";
import { comparisonLabels } from "../lib/comparison/labels.ts";

const first = Object.freeze({ publicId: "12345678-abcd-1234-abcd-123456789abc", slug: "test-only-first" });
const second = Object.freeze({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "test-only-second" });
const third = Object.freeze({ publicId: "32345678-abcd-1234-abcd-123456789abc", slug: "test-only-third" });
const products = Object.freeze([first, second, third]);

test("comparison initializes exactly two canonical public identities and preselects the current detail item", () => {
  assert.deepEqual(resolveComparison(products), [first, second]);
  assert.deepEqual(resolveComparison(products, third.publicId.toUpperCase()), [third, first]);
  assert.deepEqual(resolveComparison(products, second.publicId, third.publicId), [second, third]);
  assert.strictEqual(resolveComparison(products, third.publicId)[0], third);
  assert.deepEqual(products, [first, second, third]);
});

test("empty and single distinct projections cannot expose comparison controls or alias pairs", () => {
  for (const values of [[], [first], [first, { ...first, publicId: first.publicId.toUpperCase() }],
    [first, { publicId: "invalid" }]]) assert.equal(resolveComparison(values), null);
  assert.deepEqual(comparisonOptions([first, { ...first, publicId: first.publicId.toUpperCase() }, second]), [first, second]);
  assert.deepEqual(resolveComparison([first, { ...first, publicId: first.publicId.toUpperCase() }, second],
    first.publicId, first.publicId.toUpperCase()), [first, second]);
});

test("unknown, stale, malformed and duplicate selections resolve only within the public projection", () => {
  for (const invalid of [null, undefined, "", "invalid", 42, {}, [first.publicId], `${first.publicId} `,
    "92345678-abcd-1234-abcd-123456789abc"]) {
    assert.deepEqual(resolveComparison(products, invalid, invalid), [first, second]);
    assert.deepEqual(resolveComparison(products, second.publicId, invalid), [second, first]);
  }
  assert.deepEqual(resolveComparison([second, third], first.publicId, second.publicId), [second, third]);
  assert.deepEqual(resolveComparison(products, first.publicId, first.publicId), [first, second]);
  assert.deepEqual(resolveComparison(products, third.publicId, second.publicId), [third, second]);
});

test("helper retains original editorial references and does not inject data or mutate frozen input", () => {
  const selected = resolveComparison(products, second.publicId, first.publicId);
  assert.equal(selected.length, 2);
  assert.strictEqual(selected[0], second);
  assert.strictEqual(selected[1], first);
  assert.deepEqual(Object.keys(selected[0]), ["publicId", "slug"]);
  assert.deepEqual(products.map(product => product.publicId), [first.publicId, second.publicId, third.publicId]);
});

test("EN/HU/KO comparison labels are complete technical UI strings", () => {
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(comparisonLabels[locale]), Object.keys(comparisonLabels.en));
    for (const label of Object.values(comparisonLabels[locale])) assert.ok(label.trim());
  }
  assert.notEqual(comparisonLabels.hu.heading, comparisonLabels.en.heading);
  assert.notEqual(comparisonLabels.ko.heading, comparisonLabels.en.heading);
});
