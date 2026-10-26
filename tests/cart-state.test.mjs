import assert from "node:assert/strict";
import test from "node:test";
import { parseCart, inspectStoredCart, reconcileCart, serializeCart, addCartLine, updateCartLine, validQuantity, cartQuantity } from "../lib/cart/cart-state.ts";
import { switchLocalePath } from "../lib/storefront/localization.ts";
const id = "12345678-abcd-1234-abcd-123456789abc";
const payload = lines => JSON.stringify({ version: 1, lines });
test("invalid persisted quantities are distinguishable from an empty cart and input is not repaired silently", () => {
  assert.deepEqual(inspectStoredCart(null), { lines: [], invalid: false });
  assert.deepEqual(inspectStoredCart(payload([])), { lines: [], invalid: false });
  for (const quantity of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
    const raw = payload([{ publicId: id, quantity }]);
    assert.deepEqual(inspectStoredCart(raw), { lines: [], invalid: true });
  }
  for (const raw of ["{", "", JSON.stringify({ version: 2, lines: [] }),
    payload([{ publicId: id, quantity: 1, price: 500 }])]) {
    assert.equal(inspectStoredCart(raw).invalid, true);
  }
});
test("catalogue reconciliation uses UUID identity, preserves selections, and never asserts price or stock", () => {
  const missing = "22345678-abcd-1234-abcd-123456789abc";
  const lines = [{ publicId: id.toUpperCase(), quantity: 2 }, { publicId: missing, quantity: 3 }];
  const product = { publicId: id, slug: "test-only" };
  const result = reconcileCart(lines, [product]);
  assert.strictEqual(result[0].product, product);
  assert.strictEqual(result[1].product, null);
  assert.strictEqual(result[0].line, lines[0]);
  assert.strictEqual(result[1].line, lines[1]);
  assert.deepEqual(Object.keys(result[0]).sort(), ["line", "product"]);
  assert.equal(reconcileCart(lines, [])[0].product, null);
  assert.deepEqual(lines, [{ publicId: id.toUpperCase(), quantity: 2 }, { publicId: missing, quantity: 3 }]);
});

test("WEB22 reconciliation indexes each published identity once at 0/1/12/13/25/37/100/500/1000 scale", () => {
  for (const count of [0, 1, 12, 13, 25, 37, 100, 500, 1000]) {
    const identity = index => `${String(index + 1).padStart(8, "0")}-abcd-1234-abcd-123456789abc`;
    let reads = 0;
    const products = Array.from({ length: count }, (_, index) => Object.freeze({
      get publicId() { reads++; return identity(index); }, slug: `test-only-${index}`,
    }));
    const lines = Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
      publicId: index % 2 ? identity(index).toUpperCase() : identity(index), quantity: index + 1,
    })));
    // These identities/quantities must fit the existing persisted Cart contract.
    assert.equal(inspectStoredCart(serializeCart(lines)).invalid, false);
    const result = reconcileCart(lines, products);
    assert.equal(result.length, count);
    assert.equal(reads, count, "One catalogue scan, not a repeated scan for every Cart line");
    result.forEach((row, index) => {
      assert.strictEqual(row.line, lines[index]);
      assert.strictEqual(row.product, products[index]);
    });
  }
});

test("WEB22 reconciliation preserves first case-alias match, missing rows and line order without changing input", () => {
  const missing = "22345678-abcd-1234-abcd-123456789abc";
  const first = Object.freeze({ publicId: id.toUpperCase(), slug: "first-test-only" });
  const duplicate = Object.freeze({ publicId: id, slug: "later-test-only" });
  const lines = Object.freeze([Object.freeze({ publicId: missing, quantity: 3 }), Object.freeze({ publicId: id, quantity: 2 })]);
  const products = Object.freeze([first, duplicate]);
  const result = reconcileCart(lines, products);
  assert.strictEqual(result[0].product, null); assert.strictEqual(result[1].product, first);
  assert.strictEqual(result[0].line, lines[0]); assert.strictEqual(result[1].line, lines[1]);
  assert.deepEqual(products, [first, duplicate]);
  assert.deepEqual(lines, [{ publicId: missing, quantity: 3 }, { publicId: id, quantity: 2 }]);
});

test("WEB22 reconciliation never caches removed or replaced catalogue entries and skips scanning an empty Cart", () => {
  const lines = [{ publicId: id, quantity: 1 }];
  const first = { publicId: id, slug: "old-test-only" }, replacement = { publicId: id, slug: "new-test-only" };
  assert.strictEqual(reconcileCart(lines, [first])[0].product, first);
  assert.equal(reconcileCart(lines, [])[0].product, null);
  assert.strictEqual(reconcileCart(lines, [replacement])[0].product, replacement);
  assert.deepEqual(reconcileCart([], [{ get publicId() { throw new Error("An empty Cart must not scan the catalogue"); } }]), []);
  assert.strictEqual(reconcileCart(lines, [first,
    { get publicId() { throw new Error("A single matching line must retain its early exit"); } },
  ])[0].product, first);
  const second = { publicId: "22345678-abcd-1234-abcd-123456789abc" };
  const pair = reconcileCart([...lines, { publicId: second.publicId, quantity: 2 }], [first, second,
    { get publicId() { throw new Error("A small Cart must not scan an unneeded catalogue suffix"); } },
  ]);
  assert.strictEqual(pair[0].product, first); assert.strictEqual(pair[1].product, second);
});
test("Header quantity sums selections rather than line count, without unsafe-number rounding", () => {
  assert.equal(cartQuantity([]), "0");
  assert.equal(cartQuantity([{ publicId: id, quantity: 2 }, { publicId: id, quantity: 3 }]), "5");
  assert.equal(cartQuantity([{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }, { publicId: id, quantity: Number.MAX_SAFE_INTEGER }]), "18014398509481982");
});

test("persisted cart contains only immutable identity and quantity, and round-trips", () => {
  const lines = addCartLine([], id, 2);
  assert.deepEqual(parseCart(serializeCart(lines)), [{ publicId: id, quantity: 2 }]);
  assert.equal(lines[0].publicId, id);
  assert.deepEqual(Object.keys(JSON.parse(serializeCart(lines)).lines[0]), ["publicId", "quantity"]);
});
test("invalid/untrusted storage is discarded without throwing or accepting operational facts", () => {
  for (const raw of [null, "", "{", "null", "[]", "{}", JSON.stringify({ version: 2, lines: [] }),
    payload([{ publicId: "bad", quantity: 1 }]), payload([{ publicId: id, quantity: 0 }]),
    payload([{ publicId: id, quantity: -1 }]), payload([{ publicId: id, quantity: 1.5 }]),
    payload([{ publicId: id, quantity: "2" }]), payload([{ publicId: id, quantity: Number.MAX_SAFE_INTEGER + 1 }]),
    payload([{ publicId: id, quantity: 1 }, { publicId: id.toUpperCase(), quantity: 2 }]),
    ...["basePriceHuf", "sellableStock", "operationalReady", "price", "stock"].map(field => payload([{ publicId: id, quantity: 1, [field]: 1 }])),
    JSON.stringify({ version: 1, lines: [], price: 2 }), " ".repeat(100_001)]) {
    assert.deepEqual(parseCart(raw), []);
  }
});
test("add aggregates quantity, update replaces it, and unsafe arithmetic leaves selection unchanged", () => {
  const lines = addCartLine(addCartLine([], id, 2), id, 3);
  assert.deepEqual(lines, [{ publicId: id, quantity: 5 }]);
  assert.deepEqual(addCartLine([{ publicId: id.toUpperCase(), quantity: 2 }], id, 3), lines);
  assert.deepEqual(updateCartLine(lines, id, 4), [{ publicId: id, quantity: 4 }]);
  for (const value of [0, -1, NaN, Infinity, 0.5, "1"]) {
    assert.equal(validQuantity(value), false);
    assert.strictEqual(updateCartLine(lines, id, value), lines);
    assert.strictEqual(addCartLine(lines, id, value), lines);
  }
  const max = [{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }];
  assert.strictEqual(addCartLine(max, id, 1), max);
});
test("update matches UUID casing aliases while preserving stored identities and unrelated selections", () => {
  const otherId = "22345678-abcd-1234-abcd-123456789abc";
  const missingId = "32345678-abcd-1234-abcd-123456789abc";
  for (const [storedId, targetId] of [[id.toUpperCase(), id], [id, id.toUpperCase()]]) {
    const lines = Object.freeze([
      Object.freeze({ publicId: otherId, quantity: 3 }),
      Object.freeze({ publicId: storedId, quantity: 2 }),
    ]);
    const updated = updateCartLine(lines, targetId, 4);
    assert.deepEqual(updated, [lines[0], { publicId: storedId, quantity: 4 }]);
    assert.strictEqual(updated[0], lines[0]);
    assert.deepEqual(updateCartLine(lines, storedId, 5), [lines[0], { publicId: storedId, quantity: 5 }]);
    assert.deepEqual(updateCartLine(lines, targetId, Number.MAX_SAFE_INTEGER),
      [lines[0], { publicId: storedId, quantity: Number.MAX_SAFE_INTEGER }]);
    for (const quantity of [0, -1, 1.5, NaN, Infinity, -Infinity, "2", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
      assert.strictEqual(updateCartLine(lines, targetId, quantity), lines);
    }
    for (const invalidId of ["", "not-a-uuid", `${id}x`, null, undefined, 7, {}, []]) {
      assert.strictEqual(updateCartLine(lines, invalidId, 4), lines);
    }
    const unmatched = updateCartLine(lines, missingId, 4);
    assert.deepEqual(unmatched, lines);
    assert.strictEqual(unmatched[0], lines[0]);
    assert.strictEqual(unmatched[1], lines[1]);
    assert.deepEqual(lines, [{ publicId: otherId, quantity: 3 }, { publicId: storedId, quantity: 2 }]);
  }
});
test("cart language switching keeps the cart route in EN/HU/KO and legacy English", () => {
  for (const source of ["/cart", "/en/cart", "/hu/cart", "/ko/cart"]) for (const target of ["en", "hu", "ko"]) {
    assert.equal(switchLocalePath(source, target), `/${target}/cart`);
  }
});
