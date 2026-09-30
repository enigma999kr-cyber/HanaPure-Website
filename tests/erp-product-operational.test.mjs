import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  normalizeOperationalProduct,
  readOperationalProduct,
} from "../lib/erp/product-operational.ts";

// Fixtures are test-only; no production product or transport is fabricated.
const publicId = "a1234567-1234-4321-8123-123456789abc";
const fixture = (overrides = {}) => ({
  public_id: publicId,
  retail_price_huf: 12990.5,
  sellable_stock: 7,
  operational_ready: true,
  ...overrides,
});

test("preserves the four ERP facts without price math or extra operational/editorial data", () => {
  const payload = Object.freeze(fixture({
    sku: "OTHER", ean: "123", slug: "not-an-identity", id: 42,
    lots: [{ quantity: 999 }], warehouses: [{ quantity: 999 }], reservations: 998,
    cpnp: "Non-compliant", pif: "Non-compliant", active: false,
    responsible_person: "", promotion_percent: 90, vat_rate: 27,
    title: "Website content must not enter operational data",
  }));
  assert.deepEqual(normalizeOperationalProduct(payload), {
    ok: true,
    product: { publicId, basePriceHuf: 12990.5, sellableStock: 7, operationalReady: true },
  });
});

test("genuine zero and false remain successful operational values", () => {
  assert.deepEqual(normalizeOperationalProduct(fixture({
    retail_price_huf: 0, sellable_stock: 0, operational_ready: false,
  })), {
    ok: true,
    product: { publicId, basePriceHuf: 0, sellableStock: 0, operationalReady: false },
  });
});

test("does not derive readiness from price or compliance", () => {
  assert.equal(normalizeOperationalProduct(fixture({ retail_price_huf: 0 })).product.operationalReady, true);
  assert.equal(normalizeOperationalProduct(fixture({
    operational_ready: false, active: true, cpnp: "Compliant", pif: "Compliant",
  })).product.operationalReady, false);
});

test("preserves UUID spelling and does not substitute SKU/EAN/slug/internal IDs", () => {
  assert.equal(normalizeOperationalProduct(fixture({ public_id: publicId.toUpperCase() })).product.publicId,
    publicId.toUpperCase());
  for (const alternate of ["sku", "ean", "slug", "id"]) {
    const payload = fixture({ [alternate]: publicId });
    delete payload.public_id;
    assert.deepEqual(normalizeOperationalProduct(payload), {
      ok: false, error: { code: "invalid_fields", fields: ["public_id"] },
    });
  }
});

test("malformed payloads fail explicitly", () => {
  for (const payload of [null, undefined, [], "product", 0, false]) {
    assert.deepEqual(normalizeOperationalProduct(payload), {
      ok: false, error: { code: "invalid_payload" },
    });
  }
});

test("each missing required field is rejected", () => {
  for (const field of Object.keys(fixture())) {
    const payload = fixture();
    delete payload[field];
    assert.deepEqual(normalizeOperationalProduct(payload), {
      ok: false, error: { code: "invalid_fields", fields: [field] },
    });
  }
});

test("invalid field types/numerics are not coerced into valid values", () => {
  const invalid = {
    public_id: ["", "sku-1", 42, null],
    retail_price_huf: ["12990", null, false, NaN, Infinity, -Infinity],
    sellable_stock: ["0", null, false, NaN, Infinity, -1],
    operational_ready: ["false", 0, 1, null],
  };
  for (const [field, values] of Object.entries(invalid)) {
    for (const value of values) {
      assert.deepEqual(normalizeOperationalProduct(fixture({ [field]: value })), {
        ok: false, error: { code: "invalid_fields", fields: [field] },
      });
    }
  }
});

test("source is called only with the immutable public ID", async () => {
  const calls = [];
  const result = await readOperationalProduct(publicId, {
    async readProduct(id) { calls.push(id); return fixture(); },
  });
  assert.deepEqual(calls, [publicId]);
  assert.deepEqual(result, normalizeOperationalProduct(fixture()));
});

test("invalid lookup identity cannot call the source", async () => {
  const result = await readOperationalProduct("product-slug", {
    async readProduct() { assert.fail("source must not be called"); },
  });
  assert.deepEqual(result, { ok: false, error: { code: "invalid_public_id" } });
});

test("missing source and unavailable source are errors, not zero/not-ready", async () => {
  assert.deepEqual(await readOperationalProduct(publicId), {
    ok: false, error: { code: "source_not_configured" },
  });
  assert.deepEqual(await readOperationalProduct(publicId, {
    async readProduct() { throw new Error("private endpoint/credential details"); },
  }), { ok: false, error: { code: "source_unavailable" } });
});

test("source data errors stay separate from transport failures", async () => {
  assert.deepEqual(await readOperationalProduct(publicId, {
    async readProduct() { return null; },
  }), { ok: false, error: { code: "invalid_payload" } });
});

test("mismatched ERP identity is rejected even when alternate keys match", async () => {
  assert.deepEqual(await readOperationalProduct(publicId, {
    async readProduct() { return fixture({
      public_id: "b1234567-1234-4321-8123-123456789abc", sku: publicId, slug: publicId,
    }); },
  }), { ok: false, error: { code: "identity_mismatch" } });
  assert.equal((await readOperationalProduct(publicId, {
    async readProduct() { return fixture({ public_id: publicId.toUpperCase() }); },
  })).ok, true);
});

test("real Next server-only guard rejects import outside the server condition", () => {
  const loader = new URL("./server-only-loader.mjs", import.meta.url).href;
  const moduleUrl = new URL("../lib/erp/product-operational.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, [
    "--import", loader, "--input-type=module", "--eval", `await import(${JSON.stringify(moduleUrl)})`,
  ], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /cannot be imported from a Client Component module/);
});
