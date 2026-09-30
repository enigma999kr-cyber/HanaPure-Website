import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateOverride, resolveEffectiveAvailability } from "../lib/erp/emergency-override.ts";
import {
  readCurrentOverride, saveEmergencyOverride, revokeEmergencyOverride,
} from "../lib/erp/emergency-override-store.ts";

const id = "a1234567-1234-4321-8123-123456789abc";
const otherId = "b1234567-1234-4321-8123-123456789abc";
const createdAt = "2026-09-30T10:00:00Z";
const now = "2026-09-30T11:00:00Z";
const expiresAt = "2026-09-30T12:00:00Z";
const record = (mode = "FORCE_AVAILABLE", overrides = {}) => ({
  publicId: id, mode, actorId: "test-operator", reason: "test incident",
  createdAt, status: "ACTIVE", ...overrides,
});
const erpFound = (overrides = {}) => ({ ok: true, product: Object.freeze({
  publicId: id, basePriceHuf: 12990.5, sellableStock: 7, operationalReady: true, ...overrides,
}) });
const erpError = (code = "upstream_unavailable") => ({ ok: false, error: { code } });
const noOverride = () => ({ ok: true, record: null, revision: null });
const current = (value) => ({ ok: true, record: value, revision: "revision-1" });
const resolve = (erp, override = noOverride(), at = now) => resolveEffectiveAvailability(id, erp, override, at);

/** Test-only provider: no production/default in-memory override state. */
class TestStore {
  entries = new Map();
  history = [];
  counter = 0;
  async getCurrent(publicId) {
    return structuredClone(this.entries.get(publicId) ?? { record: null, revision: null });
  }
  async save(publicId, value, expectedRevision) {
    const prior = await this.getCurrent(publicId);
    // Compare and write synchronously after the read, including a fresh revision.
    if ((this.entries.get(publicId)?.revision ?? null) !== expectedRevision) return { ok: false, code: "conflict" };
    const revision = `revision-${++this.counter}`;
    this.entries.set(publicId, { record: structuredClone(value), revision });
    this.history.push({ action: "save", before: prior.record, after: structuredClone(value) });
    return { ok: true, revision };
  }
  async revoke(publicId, mutation, expectedRevision) {
    const prior = await this.getCurrent(publicId);
    if ((this.entries.get(publicId)?.revision ?? null) !== expectedRevision) return { ok: false, code: "conflict" };
    const revision = `revision-${++this.counter}`;
    const value = prior.record ? { ...prior.record, status: "REVOKED", revocation: mutation } : null;
    this.entries.set(publicId, { record: structuredClone(value), revision });
    this.history.push({ action: "revoke", before: prior.record, after: structuredClone(value), mutation });
    return { ok: true, revision };
  }
}

test("valid AUTO and all manual modes retain reason/actor/UTC metadata", () => {
  for (const mode of ["AUTO", "FORCE_AVAILABLE", "FORCE_OUT_OF_STOCK", "SALES_PAUSED"]) {
    const input = record(mode, { reason: mode === "AUTO" ? "" : "incident", expiresAt });
    assert.deepEqual(validateOverride(input), { ok: true, record: input });
    assert.equal(Object.isFrozen(validateOverride(input).record), true);
  }
});

test("manual modes require nonempty reason and all records require actor and UUID", () => {
  for (const mode of ["FORCE_AVAILABLE", "FORCE_OUT_OF_STOCK", "SALES_PAUSED"]) {
    assert.equal(validateOverride(record(mode, { reason: " \t" })).ok, false);
  }
  for (const override of [{ publicId: "sku" }, { actorId: "" }, { actorId: " " },
    { actorId: 1 }, { mode: "UNKNOWN" }, { reason: undefined }, { status: "unknown" }]) {
    assert.equal(validateOverride(record("FORCE_AVAILABLE", override)).ok, false);
  }
});

test("dates must be real unambiguous UTC; expiry must follow creation", () => {
  for (const override of [{ expiresAt: createdAt }, { expiresAt: "2026-09-30T09:00:00Z" },
    { createdAt: "2026-02-30T10:00:00Z" }, { createdAt: "2026-09-30T10:00:00+00:00" },
    { expiresAt: "invalid" }]) assert.equal(validateOverride(record("SALES_PAUSED", override)).ok, false);
  assert.equal(validateOverride(record("SALES_PAUSED", { createdAt: "2026-09-30T10:00:00.123Z" })).ok, true);
});

test("manual quantities, price, and unknown fields are rejected", () => {
  for (const field of ["manualSellableStock", "sellableStock", "basePriceHuf", "manualPrice", "published"]) {
    assert.equal(validateOverride(record("FORCE_AVAILABLE", { [field]: 1 })).ok, false);
  }
});

test("revoked records require valid revocation actor/reason/time", () => {
  const revocation = { actorId: "test-revoker", reason: "incident ended", at: now };
  assert.equal(validateOverride(record("SALES_PAUSED", { status: "REVOKED", revocation })).ok, true);
  for (const value of [undefined, { ...revocation, actorId: "" }, { ...revocation, reason: "" },
    { ...revocation, at: "2026-09-30T09:00:00Z" }]) {
    assert.equal(validateOverride(record("SALES_PAUSED", { status: "REVOKED", revocation: value })).ok, false);
  }
  assert.equal(validateOverride(record("SALES_PAUSED", { revocation })).ok, false);
});

test("no override and AUTO resolve normal ERP state", () => {
  for (const input of [noOverride(), current(record("AUTO", { reason: "" }))]) {
    const result = resolve(erpFound(), input);
    assert.equal(result.availability, "AVAILABLE");
    assert.equal(result.provenance, "ERP");
    assert.equal(result.activeOverride, null);
    assert.equal(result.checkoutAuthorization, "NOT_EVALUATED");
  }
});

test("all ERP failures without override remain unavailable, with unknown facts", () => {
  for (const code of ["configuration_error", "authentication_error", "rate_limited", "timeout",
    "network_error", "upstream_unavailable", "temporarily_busy", "erp_read_unavailable",
    "malformed_response", "contract_mismatch", "source_unavailable", "source_not_configured", "cancelled"]) {
    const erp = erpError(code);
    const result = resolve(erp);
    assert.equal(result.availability, "TEMPORARILY_UNAVAILABLE");
    assert.equal(result.provenance, "UNAVAILABLE");
    assert.equal(result.sellableStock, null);
    assert.equal(result.operationalReady, null);
    assert.equal(result.erp, erp);
  }
});

test("SALES_PAUSED takes precedence for both ERP available and unavailable", () => {
  for (const erp of [erpFound(), erpError()]) {
    const result = resolve(erp, current(record("SALES_PAUSED")));
    assert.equal(result.availability, "SALES_PAUSED");
    assert.equal(result.provenance, "MANUAL_OVERRIDE");
    assert.equal(result.erp, erp);
  }
});

test("FORCE_OUT_OF_STOCK overrides presentation and preserves positive canonical stock", () => {
  const result = resolve(erpFound(), current(record("FORCE_OUT_OF_STOCK")));
  assert.equal(result.availability, "OUT_OF_STOCK");
  assert.equal(result.sellableStock, 7);
  assert.equal(result.operationalReady, true);
  assert.equal(result.provenance, "MANUAL_OVERRIDE");
});

test("FORCE_AVAILABLE expresses intent but preserves true/false/unknown readiness", () => {
  for (const erp of [erpFound({ sellableStock: 0 }), erpFound({ operationalReady: false }), erpError()]) {
    const before = structuredClone(erp);
    const result = resolve(erp, current(record()));
    assert.equal(result.availability, "AVAILABLE");
    assert.equal(result.provenance, "MANUAL_OVERRIDE");
    assert.equal(result.operationalReady, erp.ok ? erp.product.operationalReady : null);
    assert.equal(result.sellableStock, erp.ok ? erp.product.sellableStock : null);
    assert.equal(result.checkoutAuthorization, "NOT_EVALUATED");
    assert.deepEqual(erp, before);
    assert.equal(result.erp, erp);
  }
});

test("genuine stock zero and not-ready are distinct successful ERP business facts", () => {
  const out = resolve(erpFound({ sellableStock: 0 }));
  assert.equal(out.availability, "OUT_OF_STOCK");
  assert.equal(out.erp.ok, true);
  assert.equal(out.operationalReady, true);
  const notReady = resolve(erpFound({ operationalReady: false }));
  assert.equal(notReady.availability, "NOT_READY");
  assert.equal(notReady.sellableStock, 7);
  assert.equal(notReady.erp.ok, true);
});

test("trusted product-not-found survives every manual mode", () => {
  for (const mode of ["AUTO", "FORCE_AVAILABLE", "FORCE_OUT_OF_STOCK", "SALES_PAUSED"]) {
    const result = resolve(erpError("product_not_found"), current(record(mode)));
    assert.equal(result.availability, "PRODUCT_NOT_FOUND");
    assert.equal(result.provenance, "ERP");
    assert.equal(result.erp.ok, false);
    assert.equal(result.activeOverride, null);
    assert.equal(result.operationalReady, null);
  }
});

test("future expiry is active; exact expiry and past expiry fall back without mutation", () => {
  const input = Object.freeze(record("SALES_PAUSED", { expiresAt }));
  assert.equal(resolve(erpFound(), current(input)).availability, "SALES_PAUSED");
  for (const at of [expiresAt, "2026-09-30T13:00:00Z"]) {
    const result = resolve(erpFound(), current(input), at);
    assert.equal(result.availability, "AVAILABLE");
    assert.equal(result.overrideDisposition, "EXPIRED");
    assert.equal(result.activeOverride, null);
    assert.equal(resolve(erpError(), current(input), at).availability, "TEMPORARILY_UNAVAILABLE");
  }
  assert.equal(input.status, "ACTIVE");
});

test("invalid time, cross-product override or future-created record fails explicitly", () => {
  for (const input of [record("SALES_PAUSED", { publicId: otherId }),
    record("SALES_PAUSED", { createdAt: expiresAt })]) {
    assert.equal(resolve(erpFound(), current(input)).overrideError, "invalid_override");
  }
  assert.equal(resolve(erpFound(), noOverride(), "not-a-time").overrideError, "invalid_resolution_input");
  assert.equal(resolve(erpFound({ publicId: otherId })).overrideError, "invalid_resolution_input");
});

test("resolver preserves active audit metadata without exposing mutable input", () => {
  const input = record("SALES_PAUSED", { expiresAt });
  const result = resolve(erpFound(), current(input));
  assert.deepEqual(result.activeOverride, input);
  input.reason = "changed";
  assert.equal(result.activeOverride.reason, "test incident");
  assert.equal(Object.isFrozen(result.activeOverride), true);
});

test("store create/replace/revoke and AUTO lifecycle retains mutation provenance", async () => {
  const store = new TestStore();
  assert.deepEqual(await readCurrentOverride(store, id), noOverride());
  const first = await saveEmergencyOverride(store, record("SALES_PAUSED"), null);
  const second = await saveEmergencyOverride(store, record("FORCE_OUT_OF_STOCK"), first.revision);
  const revoked = await revokeEmergencyOverride(store, id, {
    actorId: "test-revoker", reason: "incident ended", at: now,
  }, second.revision);
  assert.equal(revoked.ok, true);
  const read = await readCurrentOverride(store, id);
  assert.equal(read.record.status, "REVOKED");
  assert.equal(read.record.revocation.actorId, "test-revoker");
  assert.equal(resolve(erpFound(), read).availability, "AVAILABLE");
  assert.equal(resolve(erpError(), read).availability, "TEMPORARILY_UNAVAILABLE");
  assert.equal(resolve(erpFound(), read).overrideDisposition, "REVOKED");
  const auto = await saveEmergencyOverride(store, record("AUTO", { reason: "" }), revoked.revision);
  assert.equal(auto.ok, true);
  assert.equal(resolve(erpFound(), await readCurrentOverride(store, id)).overrideDisposition, "AUTO");
  assert.equal(store.history.length, 4);
  assert.equal(store.history[1].before.mode, "SALES_PAUSED");
});

test("revision conflicts prevent stale save/revoke and independent IDs stay isolated", async () => {
  const store = new TestStore();
  const first = await saveEmergencyOverride(store, record("SALES_PAUSED"), null);
  assert.deepEqual(await saveEmergencyOverride(store, record(), null), { ok: false, code: "conflict" });
  assert.deepEqual(await revokeEmergencyOverride(store, id, {
    actorId: "test", reason: "revoke", at: now,
  }, null), { ok: false, code: "conflict" });
  await saveEmergencyOverride(store, record("FORCE_AVAILABLE", { publicId: otherId }), null);
  assert.equal((await readCurrentOverride(store, id)).record.mode, "SALES_PAUSED");
  assert.equal((await readCurrentOverride(store, otherId)).record.mode, "FORCE_AVAILABLE");
  assert.equal((await readCurrentOverride(store, id)).revision, first.revision);
});

test("revoking absent override retains an audit event and revision rather than deleting", async () => {
  const store = new TestStore();
  const result = await revokeEmergencyOverride(store, id, { actorId: "test", reason: "reset", at: now }, null);
  assert.equal(result.ok, true);
  const read = await readCurrentOverride(store, id);
  assert.equal(read.record, null);
  assert.equal(read.revision, result.revision);
  assert.equal(store.history[0].mutation.reason, "reset");
});

test("invalid commands never reach storage mutations", async () => {
  const store = new TestStore();
  assert.equal((await saveEmergencyOverride(store, record("SALES_PAUSED", { reason: "" }), null)).code, "invalid_override");
  assert.equal((await revokeEmergencyOverride(store, id, { actorId: "", reason: "r", at: now }, null)).code, "invalid_mutation");
  const saved = await saveEmergencyOverride(store, record(), null);
  assert.equal((await revokeEmergencyOverride(store, id, {
    actorId: "test", reason: "r", at: "2026-09-30T09:00:00Z",
  }, saved.revision)).code, "invalid_mutation");
  assert.equal(store.history.length, 1);
});

test("storage failures are explicit; ERP failure/readiness/stock remain independent", async () => {
  const store = {
    async getCurrent() { throw new Error("private storage details"); },
    async save() { throw new Error("private write details"); },
    async revoke() { throw new Error("private write details"); },
  };
  const read = await readCurrentOverride(store, id);
  assert.deepEqual(read, { ok: false, code: "override_store_failure" });
  for (const erp of [erpFound(), erpError("timeout"), erpError("product_not_found")]) {
    const result = resolve(erp, read);
    assert.equal(result.availability, "OPERATIONAL_FAILURE");
    assert.equal(result.overrideError, "override_store_failure");
    assert.equal(result.erp, erp);
  }
  assert.deepEqual(await saveEmergencyOverride(store, record(), null), read);
  assert.deepEqual(await revokeEmergencyOverride(store, id, { actorId: "test", reason: "r", at: now }, null), read);
});

test("malformed/cross-product provider records never silently become AUTO", async () => {
  for (const snapshot of [{ record: record("SALES_PAUSED", { publicId: otherId }), revision: "r" },
    { record: record(), revision: null }, { record: {}, revision: "r" }, { record: null, revision: "" }]) {
    const read = await readCurrentOverride({ async getCurrent() { return snapshot; } }, id);
    assert.equal(read.ok, false);
    assert.equal(resolve(erpFound(), read).availability, "OPERATIONAL_FAILURE");
  }
});

test("failed revoke writes and malformed provider acknowledgements are sanitized", async () => {
  const store = new TestStore();
  const saved = await saveEmergencyOverride(store, record(), null);
  store.revoke = async () => { throw new Error("secret"); };
  assert.deepEqual(await revokeEmergencyOverride(store, id, {
    actorId: "test", reason: "r", at: now,
  }, saved.revision), { ok: false, code: "override_store_failure" });
  store.save = async () => ({ ok: true, revision: "" });
  assert.deepEqual(await saveEmergencyOverride(store, record(), saved.revision), { ok: false, code: "override_store_failure" });
  store.save = async () => ({ ok: true, revision: "r", privateData: "secret" });
  assert.deepEqual(await saveEmergencyOverride(store, record(), saved.revision), { ok: true, revision: "r" });
});

test("both domain and store modules reject non-server imports", () => {
  const loader = new URL("./server-only-loader.mjs", import.meta.url).href;
  for (const file of ["emergency-override", "emergency-override-store"]) {
    const url = new URL(`../lib/erp/${file}.ts`, import.meta.url).href;
    const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval",
      `await import(${JSON.stringify(url)})`], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /cannot be imported from a Client Component module/);
  }
});
