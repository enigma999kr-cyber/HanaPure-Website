import assert from "node:assert/strict";
import test from "node:test";
import { parseCart, serializeCart, addCartLine, updateCartLine, validQuantity, cartQuantity } from "../lib/cart/cart-state.ts";
import { switchLocalePath } from "../lib/storefront/localization.ts";
const id = "12345678-abcd-1234-abcd-123456789abc";
const payload = lines => JSON.stringify({ version: 1, lines });
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
test("cart language switching keeps the cart route in EN/HU/KO and legacy English", () => {
  for (const source of ["/cart", "/en/cart", "/hu/cart", "/ko/cart"]) for (const target of ["en", "hu", "ko"]) {
    assert.equal(switchLocalePath(source, target), `/${target}/cart`);
  }
});
