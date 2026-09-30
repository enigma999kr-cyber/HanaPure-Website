import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readEffectiveOperationalState } from "../lib/erp/effective-operational-state.ts";
import { OperationalSourceError } from "../lib/erp/product-operational.ts";
import { createHttpsOperationalSource } from "../lib/erp/https-operational-source.ts";

const id = "a1234567-1234-4321-8123-123456789abc";
const otherId = "b1234567-1234-4321-8123-123456789abc";
const now = "2026-09-30T11:00:00Z";
const raw = (changes = {}) => Object.freeze({
  public_id: id, retail_price_huf: 12990.5, sellable_stock: 7,
  operational_ready: true, ...changes,
});
const record = (mode, changes = {}) => Object.freeze({
  publicId: id, mode, actorId: "test-operator", reason: "test incident",
  createdAt: "2026-09-30T10:00:00Z", status: "ACTIVE", ...changes,
});
const failedSource = (code) => ({ async readProduct() { throw new OperationalSourceError(code); } });

function providers(payload = raw(), override = null) {
  const calls = [];
  return {
    calls,
    erpSource: { async readProduct(publicId, options) {
      calls.push({ kind: "erp", publicId, signal: options?.signal });
      return payload;
    } },
    overrideStore: {
      async getCurrent(publicId) {
        calls.push({ kind: "override", publicId });
        return { record: override, revision: override ? "revision-1" : null };
      },
      async save() { assert.fail("composition must not save"); },
      async revoke() { assert.fail("composition must not revoke"); },
    },
  };
}
const read = (dependencies, options = {}) => readEffectiveOperationalState(id, dependencies, { now, ...options });
const assertUnknownFacts = (state) => {
  assert.equal(state.basePriceHuf, null);
  assert.equal(state.sellableStock, null);
  assert.equal(state.operationalReady, null);
  assert.equal(state.checkoutAuthorization, "NOT_EVALUATED");
};

test("normal ERP states with absent/AUTO override preserve canonical facts", async () => {
  for (const override of [null, record("AUTO")]) {
    for (const [payload, expected] of [[raw(), "AVAILABLE"],
      [raw({ sellable_stock: 0 }), "OUT_OF_STOCK"],
      [raw({ operational_ready: false }), "NOT_READY"]]) {
      const deps = providers(payload, override);
      const state = await read(deps);
      assert.equal(state.publicId, id);
      assert.equal(state.availability, expected);
      assert.equal(state.provenance, "ERP");
      assert.equal(state.basePriceHuf, payload.retail_price_huf);
      assert.equal(state.sellableStock, payload.sellable_stock);
      assert.equal(state.operationalReady, payload.operational_ready);
      assert.equal(state.activeOverride, null);
      assert.equal(state.overrideRevision, override ? "revision-1" : null);
      assert.equal(state.overrideDisposition, override ? "AUTO" : "NONE");
      assert.equal(state.checkoutAuthorization, "NOT_EVALUATED");
      assert.deepEqual(deps.calls.map(({ publicId }) => publicId), [id, id]);
    }
  }
});

test("ERP error taxonomy is retained, never synthetic business facts", async () => {
  for (const code of ["timeout", "cancelled", "network_error", "authentication_error",
    "rate_limited", "upstream_unavailable", "temporarily_busy", "erp_read_unavailable",
    "malformed_response", "contract_mismatch", "configuration_error", "source_internal_error"]) {
    const state = await read({ ...providers(), erpSource: failedSource(code) });
    assert.equal(state.availability, "TEMPORARILY_UNAVAILABLE");
    assert.equal(state.provenance, "UNAVAILABLE");
    assert.deepEqual(state.erp, { ok: false, error: { code } });
    assertUnknownFacts(state);
  }
  for (const erpSource of [undefined, { async readProduct() { throw new Error("private secret"); } }]) {
    const state = await read({ ...providers(), erpSource });
    assert.equal(state.erp.error.code, erpSource ? "source_unavailable" : "source_not_configured");
    assert.equal(state.availability, "TEMPORARILY_UNAVAILABLE");
    assertUnknownFacts(state);
    assert.doesNotMatch(JSON.stringify(state), /private secret/);
  }
});

test("invalid payload and mismatched identity stay adapter failures", async () => {
  for (const [payload, code] of [[null, "invalid_payload"],
    [raw({ operational_ready: "true" }), "invalid_fields"],
    [raw({ public_id: otherId }), "identity_mismatch"]]) {
    const state = await read(providers(payload));
    assert.equal(state.erp.error.code, code);
    assert.equal(state.availability, "TEMPORARILY_UNAVAILABLE");
    assertUnknownFacts(state);
  }
});

for (const [mode, expected] of [["SALES_PAUSED", "SALES_PAUSED"],
  ["FORCE_OUT_OF_STOCK", "OUT_OF_STOCK"], ["FORCE_AVAILABLE", "AVAILABLE"]]) {
  test(`${mode} preserves healthy, zero-stock, and not-ready ERP facts`, async () => {
    for (const payload of [raw(), raw({ sellable_stock: 0 }),
      raw({ operational_ready: false }), raw({ retail_price_huf: 0 })]) {
      const override = record(mode, { expiresAt: "2026-09-30T12:00:00Z" });
      const deps = providers(payload, override);
      const state = await read(deps);
      assert.equal(state.availability, expected);
      assert.equal(state.provenance, "MANUAL_OVERRIDE");
      assert.equal(state.sellableStock, payload.sellable_stock);
      assert.equal(state.operationalReady, payload.operational_ready);
      assert.equal(state.basePriceHuf, payload.retail_price_huf);
      assert.deepEqual(state.activeOverride, override);
      assert.equal(state.overrideRevision, "revision-1");
      assert.equal(state.checkoutAuthorization, "NOT_EVALUATED");
      assert.equal(deps.calls.length, 2);
      assert.equal(state.erp.product.sellableStock, payload.sellable_stock);
    }
  });
  test(`${mode} during outage expresses intent without inventing facts`, async () => {
    const state = await read({ ...providers(raw(), record(mode)), erpSource: failedSource("timeout") });
    assert.equal(state.availability, expected);
    assert.equal(state.provenance, "MANUAL_OVERRIDE");
    assert.equal(state.erp.error.code, "timeout");
    assertUnknownFacts(state);
  });
}

test("trusted product-not-found cannot be overridden into existence", async () => {
  for (const mode of [null, "AUTO", "FORCE_AVAILABLE", "FORCE_OUT_OF_STOCK", "SALES_PAUSED"]) {
    const state = await read({ ...providers(raw(), mode ? record(mode) : null),
      erpSource: failedSource("product_not_found") });
    assert.equal(state.availability, "PRODUCT_NOT_FOUND");
    assert.equal(state.provenance, "ERP");
    assert.equal(state.erp.error.code, "product_not_found");
    assert.equal(state.activeOverride, null);
    assertUnknownFacts(state);
  }
});

test("expired, revoked and AUTO fall back to healthy ERP or explicit outage", async () => {
  const inactive = [
    [record("SALES_PAUSED", { expiresAt: now }), "EXPIRED"],
    [record("FORCE_AVAILABLE", { status: "REVOKED", revocation: {
      actorId: "test-revoker", reason: "resolved", at: now,
    } }), "REVOKED"],
    [record("AUTO"), "AUTO"],
  ];
  for (const [override, disposition] of inactive) {
    for (const outage of [false, true]) {
      const deps = providers(raw(), override);
      if (outage) deps.erpSource = failedSource("timeout");
      const state = await read(deps);
      assert.equal(state.availability, outage ? "TEMPORARILY_UNAVAILABLE" : "AVAILABLE");
      assert.equal(state.provenance, outage ? "UNAVAILABLE" : "ERP");
      assert.equal(state.activeOverride, null);
      assert.equal(state.overrideDisposition, disposition);
      assert.equal(state.overrideRevision, "revision-1");
    }
  }
});

test("store outage preserves successful ERP, simultaneous ERP failure and trusted absence", async () => {
  for (const code of [null, "timeout", "product_not_found"]) {
    const deps = providers();
    if (code) deps.erpSource = failedSource(code);
    deps.overrideStore.getCurrent = async () => { throw new Error("storage credential"); };
    const state = await read(deps);
    assert.equal(state.availability, "OPERATIONAL_FAILURE");
    assert.equal(state.provenance, "UNAVAILABLE");
    assert.equal(state.overrideError, "override_store_failure");
    assert.equal(state.overrideDisposition, "ERROR");
    assert.equal(state.overrideRevision, null);
    if (code) { assert.equal(state.erp.error.code, code); assertUnknownFacts(state); }
    else {
      assert.equal(state.erp.ok, true);
      assert.equal(state.basePriceHuf, 12990.5);
      assert.equal(state.sellableStock, 7);
      assert.equal(state.operationalReady, true);
    }
    assert.doesNotMatch(JSON.stringify(state), /storage credential/);
  }
});

test("invalid/cross-product store records cannot silently become AUTO", async () => {
  for (const override of [record("SALES_PAUSED", { publicId: otherId }),
    record("FORCE_AVAILABLE", { manualSellableStock: 9 }),
    record("FORCE_AVAILABLE", { createdAt: "2026-09-30T12:00:00Z" })]) {
    const state = await read(providers(raw(), override));
    assert.equal(state.overrideError, "invalid_override");
    assert.equal(state.availability, "OPERATIONAL_FAILURE");
    assert.equal(state.sellableStock, 7);
  }
});

test("independent identities stay isolated without service cache or shared state", async () => {
  const deps = providers();
  deps.erpSource.readProduct = async (publicId) => raw({ public_id: publicId });
  deps.overrideStore.getCurrent = async (publicId) => ({
    record: publicId === id ? record("SALES_PAUSED") : null,
    revision: publicId === id ? "revision-A" : "revision-B",
  });
  const [first, second] = await Promise.all([
    read(deps), readEffectiveOperationalState(otherId, deps, { now }),
  ]);
  assert.equal(first.availability, "SALES_PAUSED");
  assert.equal(first.overrideRevision, "revision-A");
  assert.equal(second.publicId, otherId);
  assert.equal(second.availability, "AVAILABLE");
  assert.equal(second.overrideRevision, "revision-B");
  assert.equal(second.activeOverride, null);
});

test("both reads start concurrently; neither manual controls nor store errors skip ERP", async () => {
  const started = [];
  let finishErp;
  let finishOverride;
  const result = read({
    erpSource: { readProduct() { started.push("erp"); return new Promise((resolve) => { finishErp = resolve; }); } },
    overrideStore: { getCurrent() { started.push("override"); return new Promise((resolve) => { finishOverride = resolve; }); } },
  });
  assert.deepEqual(started, ["erp", "override"]);
  finishOverride({ record: record("SALES_PAUSED"), revision: "r" });
  finishErp(raw());
  assert.equal((await result).sellableStock, 7);
});

test("invalid lookup never reaches providers; invalid resolution time is explicit", async () => {
  const deps = providers();
  const invalid = await readEffectiveOperationalState("not-a-uuid", deps, { now });
  assert.equal(deps.calls.length, 0);
  assert.equal(invalid.erp.error.code, "invalid_public_id");
  assert.equal(invalid.overrideError, "invalid_resolution_input");
  const invalidTime = await read(deps, { now: "invalid" });
  assert.equal(invalidTime.overrideError, "invalid_resolution_input");
  assert.equal(invalidTime.availability, "OPERATIONAL_FAILURE");
});

const config = { gatewayOrigin: "https://gateway.test", timeoutMs: 1000,
  authHeaders: () => ({ authorization: "test-only" }) };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("real Unit 2A source composes through fake HTTPS with live/no-store and no retries", async () => {
  let calls = 0;
  const erpSource = createHttpsOperationalSource(config, { fetch: async (url, init) => {
    calls++;
    assert.equal(url, `https://gateway.test/v1/products/${id}/operational`);
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "omit");
    return json({ version: "1", product: raw({ operational_ready: false, sellable_stock: 0 }) });
  } });
  const state = await read({ ...providers(raw(), record("FORCE_AVAILABLE")), erpSource });
  assert.equal(state.availability, "AVAILABLE");
  assert.equal(state.operationalReady, false);
  assert.equal(state.sellableStock, 0);
  assert.equal(state.checkoutAuthorization, "NOT_EVALUATED");
  assert.equal(calls, 1);
});

test("Unit 2A trusted absence, HTTP-only 404 and exact identity mismatch remain distinct", async () => {
  for (const [response, code] of [
    [() => json({ version: "1", public_id: id, error: { code: "product_not_found" } }, 404), "product_not_found"],
    [() => new Response("not found", { status: 404 }), "malformed_response"],
    [() => json({ version: "1", product: raw({ public_id: id.toUpperCase() }) }), "contract_mismatch"],
  ]) {
    const erpSource = createHttpsOperationalSource(config, { fetch: async () => response() });
    const state = await read({ ...providers(), erpSource });
    assert.equal(state.erp.error.code, code);
    assert.equal(state.availability, code === "product_not_found" ? "PRODUCT_NOT_FOUND" : "TEMPORARILY_UNAVAILABLE");
    assertUnknownFacts(state);
  }
});

test("Unit 2A cancellation propagates; store outcome remains separately preserved", async () => {
  const controller = new AbortController();
  const erpSource = createHttpsOperationalSource(config, { fetch: async () => new Promise(() => {}) });
  const result = read({ ...providers(raw(), record("SALES_PAUSED")), erpSource }, { signal: controller.signal });
  controller.abort();
  const state = await result;
  assert.equal(state.erp.error.code, "cancelled");
  assert.equal(state.availability, "SALES_PAUSED");
  assert.equal(state.overrideRevision, "revision-1");
  assertUnknownFacts(state);
});

test("default UTC resolution clock ignores an expired override", async () => {
  const deps = providers(raw(), record("SALES_PAUSED", {
    createdAt: "2000-01-01T00:00:00Z", expiresAt: "2000-01-02T00:00:00Z",
  }));
  const state = await readEffectiveOperationalState(id, deps);
  assert.equal(state.overrideDisposition, "EXPIRED");
  assert.equal(state.availability, "AVAILABLE");
});

test("composition module rejects non-server imports", () => {
  const loader = new URL("./server-only-loader.mjs", import.meta.url).href;
  const url = new URL("../lib/erp/effective-operational-state.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval",
    `await import(${JSON.stringify(url)})`], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /cannot be imported from a Client Component module/);
});
