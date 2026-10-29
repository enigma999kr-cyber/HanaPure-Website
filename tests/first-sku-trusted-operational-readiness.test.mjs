import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inspectFirstSkuTrustedOperationalReadiness as inspect } from "../lib/storefront/first-sku-trusted-operational-readiness.ts";

const id = "a1234567-1234-4321-8123-123456789abc";
const raw = (patch = {}) => ({ public_id: id, retail_price_huf: 1000, sellable_stock: 7, operational_ready: true, ...patch });
const envelope = (patch = {}) => ({ version: "1", product: raw(), ...patch });
const keys = ["shape", "evidence", "erpFacts", "authenticity", "attestation", "freshness", "expiry", "effectiveAvailability", "manualIntent", "trustedForLiveUse", "publicationAuthorized", "checkoutAuthorized", "blockers"].sort();
function check(status, body, evidence, selected = id) {
  const result = inspect(selected, status, body);
  assert.equal(result.evidence, evidence);
  assert.equal(result.shape, ["VALID_PRODUCT", "CONTRACT_ABSENCE_ONLY"].includes(evidence) ? "SHAPE_COMPATIBLE" : "STRUCTURAL_FAILURE");
  assert.deepEqual(Object.keys(result).sort(), keys);
  for (const key of ["authenticity", "attestation", "freshness", "manualIntent"]) assert.equal(result[key], "NOT_VERIFIED");
  assert.equal(result.expiry, "NOT_EVALUABLE");
  assert.equal(result.effectiveAvailability, "NOT_EVALUATED");
  for (const key of ["trustedForLiveUse", "publicationAuthorized", "checkoutAuthorized"]) assert.equal(result[key], false);
  assert.ok(result.blockers.includes("COMMERCE_AUTHORITY_ABSENT"));
  assert.ok(result.blockers.includes("FRESHNESS_NOT_VERIFIED"));
  if (evidence !== "VALID_PRODUCT") assert.equal(result.erpFacts, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|retail_price_huf|basePriceHuf|actorId|signature|timestamp|ORDERABLE|CAN_CHECKOUT|PRODUCTION_READY/);
  return result;
}

test("valid v1 facts remain diagnostic, including zero and false independently", () => {
  for (const [stock, ready] of [[7,true],[0,true],[7,false],[0,false]]) {
    const result = check(200, envelope({ product: raw({ sellable_stock: stock, operational_ready: ready }) }), "VALID_PRODUCT");
    assert.deepEqual(result.erpFacts, { sellableStock: stock, operationalReady: ready });
  }
});
for (const [field, values] of [["sellable_stock", [undefined, null, -1, "7", NaN, Infinity]],
  ["operational_ready", [undefined, null, "true", 1]], ["retail_price_huf", [undefined, "1000", NaN, Infinity]]]) {
  for (const [index, value] of values.entries()) test(`canonical validator rejects ${field} case ${index}`, () => {
    check(200, envelope({ product: raw({ [field]: value }) }), "INVALID_PRODUCT");
  });
}
test("base price semantics delegated, no new positive-price sales rule", () => {
  for (const price of [0, -1]) check(200, envelope({ product: raw({ retail_price_huf: price }) }), "VALID_PRODUCT");
});
test("absent malformed and array envelopes/products fail closed", () => {
  for (const body of [undefined, null, [], "{", 7]) check(200, body, "INVALID_ENVELOPE");
  for (const product of [undefined, null, [], "PRIVATE_SECRET", {}]) check(200, envelope({ product }), "INVALID_PRODUCT");
  check(200, envelope({ error: null }), "INVALID_ENVELOPE");
});
test("versions and canonical exact identity, including case, cannot be substituted", () => {
  for (const version of [undefined, null, 1, "2", ""]) check(200, envelope({ version }), "UNSUPPORTED_VERSION");
  for (const public_id of [id.toUpperCase(), "b1234567-1234-4321-8123-123456789abc"]) {
    check(200, envelope({ product: raw({ public_id }) }), "IDENTITY_MISMATCH");
    check(200, envelope({ public_id }), "IDENTITY_MISMATCH");
  }
  for (const selected of ["slug", "SKU-1", "../private"]) check(200, envelope(), "INVALID_SELECTION", selected);
});
test("404 contract shape is not authenticated business absence; other errors unavailable", () => {
  const absent = { version: "1", public_id: id, error: { code: "product_not_found" } };
  check(404, absent, "CONTRACT_ABSENCE_ONLY");
  for (const body of [{ version: "1" }, { ...absent, product: raw() }, { ...absent, error: {} }]) check(404, body, "SOURCE_UNAVAILABLE");
  for (const status of [0, 401, 403, 429, 500, 503]) check(status, absent, "SOURCE_UNAVAILABLE");
  check(503, { ...absent, error: { code: "temporarily_busy" } }, "SOURCE_UNAVAILABLE");
});
test("forged provenance, clocks and manual intent never promote trust or replace facts", () => {
  for (const product of [raw(), raw({ sellable_stock: 0 }), raw({ operational_ready: false }), null]) {
    for (const timestamp of [undefined, "2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z"]) {
      const body = envelope({ product, trusted: true, source: "PRIVATE_SECRET", issuer: "PRIVATE_SECRET",
        signature: "PRIVATE_SECRET", timestamp, override: { mode: "FORCE_AVAILABLE", actorId: "PRIVATE_SECRET" } });
      const result = check(200, body, product ? "VALID_PRODUCT" : "INVALID_PRODUCT");
      assert.deepEqual(result.erpFacts, product ? { sellableStock: product.sellable_stock, operationalReady: product.operational_ready } : null);
    }
  }
});
test("accessors are not invoked, thrown structural inspection is safe, inputs unchanged", () => {
  const product = raw(); Object.defineProperty(product, "sellable_stock", { get() { assert.fail("getter invoked"); } });
  check(200, envelope({ product }), "INVALID_PRODUCT");
  check(200, new Proxy({}, { getPrototypeOf() { throw Error("PRIVATE_SECRET"); } }), "INVALID_ENVELOPE");
  const body = envelope(), before = JSON.stringify(body); inspect(id, 200, body); assert.equal(JSON.stringify(body), before);
});
test("pure execution does not call global fetch; no I/O or mutable shared trust source", t => {
  const mock = t.mock.method(globalThis, "fetch", () => assert.fail("network forbidden"));
  check(200, envelope(), "VALID_PRODUCT"); assert.equal(mock.mock.callCount(), 0);
  const source = readFileSync(new URL("../lib/storefront/first-sku-trusted-operational-readiness.ts", import.meta.url), "utf8");
  assert.ok(source.startsWith('import "server-only";'));
  assert.doesNotMatch(source, /node:|\bfetch\s*\(|process\.|Date\.|setTimeout|\.write\(|\.save\(/);
  assert.match(readFileSync(new URL("../data/catalogue.ts", import.meta.url), "utf8"), /Object\.freeze\(\[\]\)/);
});
test("real server-only guard rejects client-context import", () => {
  const child = spawnSync(process.execPath, ["--import", new URL("./server-only-loader.mjs", import.meta.url).href,
    "--input-type=module", "--eval", `await import(${JSON.stringify(new URL("../lib/storefront/first-sku-trusted-operational-readiness.ts", import.meta.url).href)})`],
  { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error); assert.notEqual(child.status, 0);
  assert.match(child.stderr, /cannot be imported from a Client Component module/);
});
