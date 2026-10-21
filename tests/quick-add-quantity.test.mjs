import assert from "node:assert/strict";
import test from "node:test";
import { parseQuickAddQuantity } from "../lib/cart/quick-add-quantity.ts";
import { addCartLine } from "../lib/cart/cart-state.ts";

const id = "12345678-abcd-1234-abcd-123456789abc";
const otherId = "22345678-abcd-1234-abcd-123456789abc";

test("plain positive quantities allow leading zeros up to the safe integer and raw length boundaries", () => {
  for (const [raw, expected] of [["1", 1], ["12", 12], ["00012", 12],
    ["0".repeat(31) + "1", 1], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ["0".repeat(16) + String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
    assert.equal(parseQuickAddQuantity(raw), expected, raw);
  }
});

test("invalid syntax, zero, excessive length and unsafe input are rejected without coercion", () => {
  for (const raw of ["", "0", "000", "-1", "+1", "1.0", "1.5", "1e2", "1E2", " 1", "1 ", "1\n", "1\t",
    "1_000", "0x10", "NaN", "Infinity", "１２", "١", "9".repeat(32), "0".repeat(32) + "1",
    "9007199254740992", "9007199254740993", "0".repeat(16) + "9007199254740992", null, undefined, 2]) {
    assert.equal(parseQuickAddQuantity(raw), null, String(raw));
  }
});

test("parsed multi-unit adds reuse case-insensitive merging and preserve unrelated frozen lines", () => {
  const original = Object.freeze([Object.freeze({ publicId: id, quantity: 2 }), Object.freeze({ publicId: otherId, quantity: 7 })]);
  const updated = addCartLine(original, id.toUpperCase(), parseQuickAddQuantity("003"));
  assert.deepEqual(updated, [{ publicId: id.toUpperCase(), quantity: 5 }, { publicId: otherId, quantity: 7 }]);
  assert.strictEqual(updated[1], original[1]);
  assert.deepEqual(original, [{ publicId: id, quantity: 2 }, { publicId: otherId, quantity: 7 }]);
  const added = addCartLine(Object.freeze([]), id, parseQuickAddQuantity("12"));
  assert.deepEqual(added, [{ publicId: id, quantity: 12 }]);
});

test("default one retains old behavior; invalid identity and sum overflow remain no-ops", () => {
  const lines = Object.freeze([Object.freeze({ publicId: id, quantity: Number.MAX_SAFE_INTEGER })]);
  assert.strictEqual(addCartLine(lines, id.toUpperCase(), parseQuickAddQuantity("1")), lines);
  assert.strictEqual(addCartLine(lines, "invalid-id", parseQuickAddQuantity("2")), lines);
  const empty = Object.freeze([]);
  assert.deepEqual(addCartLine(empty, id, parseQuickAddQuantity("1")), addCartLine(empty, id, 1));
  assert.deepEqual(addCartLine(empty, id, parseQuickAddQuantity(String(Number.MAX_SAFE_INTEGER))),
    [{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }]);
});
