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
