import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  decideOverrideMutation, isOverrideRevision, mutateEmergencyOverride,
} from "../lib/erp/emergency-override-mutations.ts";
import { readEffectiveOperationalState } from "../lib/erp/effective-operational-state.ts";

const id = "a1234567-1234-4321-8123-123456789abc";
const otherId = "b1234567-1234-4321-8123-123456789abc";
const at = "2026-09-30T10:00:00Z";
const later = "2026-09-30T11:00:00Z";
const expiry = "2026-09-30T12:00:00Z";
const context = (time = at, actorId = "operator-A") => ({ actorId, clock: () => time });
const command = (changes = {}) => ({ publicId: id, operationId: "operation-create",
  action: "CREATE", expectedRevision: null, mode: "SALES_PAUSED", reason: "incident", ...changes });
const replace = (changes = {}) => command({ action: "REPLACE", operationId: "operation-replace",
  expectedRevision: "1", mode: "FORCE_OUT_OF_STOCK", ...changes });
const revoke = (changes = {}) => ({ publicId: id, operationId: "operation-revoke",
  action: "REVOKE", expectedRevision: "2", reason: "incident resolved", ...changes });

/** Test-only transaction reference. No production storage/default instance. */
class AtomicTestStore {
  entries = new Map();
  receipts = new Map();
  events = [];
  calls = 0;
  failBeforeCommit = false;
  async getCurrent(publicId) {
    return structuredClone(this.entries.get(publicId) ?? { record: null, revision: null });
  }
  async mutateAtomically(value) {
    this.calls++;
    // No await from reading through committing: one in-process atomic section.
    const decision = decideOverrideMutation(
      this.entries.get(value.publicId) ?? { record: null, revision: null },
      this.receipts.get(value.operationId) ?? null, value,
    );
    if (decision.write) {
      if (this.failBeforeCommit) throw new Error("private transaction details");
      this.entries.set(value.publicId, decision.snapshot);
      this.events.push(decision.result.event);
      this.receipts.set(value.operationId, decision.receipt);
    }
    return decision.result;
  }
}
const mutate = (store, input = command(), ctx = context()) => mutateEmergencyOverride(store, input, ctx);

test("create/replace/revoke use revisions 1/2/3 and immutable before/after audit", async () => {
  const store = new AtomicTestStore();
  const created = await mutate(store);
  const replaced = await mutate(store, replace(), context(later, "operator-B"));
  const revoked = await mutate(store, revoke(), context(later, "operator-C"));
  assert.deepEqual([created.revision, replaced.revision, revoked.revision], ["1", "2", "3"]);
  assert.deepEqual(store.events.map((event) => event.action), ["created", "replaced", "revoked"]);
  assert.deepEqual(store.events.map((event) => event.previousRevision), [null, "1", "2"]);
  assert.equal(created.event.before, null);
  assert.equal(replaced.event.before.mode, "SALES_PAUSED");
  assert.equal(replaced.event.after.mode, "FORCE_OUT_OF_STOCK");
  assert.equal(replaced.event.actorId, "operator-B");
  assert.equal(replaced.event.reason, "incident");
  assert.equal(replaced.event.at, later);
  assert.equal(revoked.event.after.status, "REVOKED");
  assert.deepEqual(revoked.event.after.revocation, {
    actorId: "operator-C", reason: "incident resolved", at: later,
  });
  assert.equal(revoked.event.after.actorId, "operator-B");
  assert.equal(revoked.event.after.createdAt, later);
  assert.equal(Object.isFrozen(created), true);
  assert.equal(Object.isFrozen(created.event), true);
  assert.equal(Object.isFrozen(replaced.event.before), true);
  assert.equal(Object.isFrozen(revoked.event.after.revocation), true);
  assert.throws(() => { replaced.event.reason = "changed"; }, TypeError);
  const recreated = await mutate(store, command({ operationId: "recreate", expectedRevision: "3" }), context(later));
  assert.equal(recreated.revision, "4");
  assert.equal(recreated.event.before.status, "REVOKED");
});

test("stale replace/revoke fail with conflict and leave revision/history unchanged", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  await mutate(store, replace());
  for (const value of [replace({ operationId: "stale-replace" }), revoke({ expectedRevision: "1" })]) {
    assert.deepEqual(await mutate(store, value), { ok: false, code: "conflict" });
  }
  assert.equal((await store.getCurrent(id)).revision, "2");
  assert.equal(store.events.length, 2);
  assert.equal(store.receipts.size, 2);
});

test("two operators with the same expected revision cannot both replace successfully", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  const results = await Promise.all([
    mutate(store, replace({ operationId: "operator-A-edit" })),
    mutate(store, replace({ operationId: "operator-B-edit", mode: "FORCE_AVAILABLE" }), context(at, "operator-B")),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.find((result) => !result.ok), { ok: false, code: "conflict" });
  assert.equal((await store.getCurrent(id)).record.mode, "FORCE_OUT_OF_STOCK");
  assert.equal(store.events.length, 2);
});

test("replace/revoke race at one revision has exactly one winner", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  const results = await Promise.all([
    mutate(store, revoke({ expectedRevision: "1" })),
    mutate(store, replace()),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).code, "conflict");
  assert.equal((await store.getCurrent(id)).revision, "2");
});

test("create requires no active manual override and the exact current revision", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  assert.equal((await mutate(store, command({ operationId: "second", expectedRevision: "1" }))).code, "conflict");
  assert.equal((await mutate(store, command({ operationId: "second" }))).code, "conflict");
  assert.equal(store.events.length, 1);
});

test("replay of create/replace/revoke returns original result after clock/current state advances", async () => {
  const store = new AtomicTestStore();
  const requests = [command({ expiresAt: expiry }), replace(), revoke()];
  const originals = [];
  for (const value of requests) originals.push(await mutate(store, value));
  for (let i = 0; i < requests.length; i++) {
    assert.deepEqual(await mutate(store, requests[i], context("2026-10-01T10:00:00Z")), originals[i]);
  }
  assert.equal(store.events.length, 3);
  assert.equal(store.receipts.size, 3);
  assert.equal((await store.getCurrent(id)).revision, "3");
});

test("concurrent identical retries produce one revision and one audit event", async () => {
  const store = new AtomicTestStore();
  const results = await Promise.all([mutate(store), mutate(store)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(store.events.length, 1);
  assert.equal(store.receipts.size, 1);
});

test("reusing an operation ID for a changed semantic payload/actor/product is rejected", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  for (const changes of [{ mode: "FORCE_AVAILABLE" }, { reason: "other incident" },
    { expectedRevision: "1" }, { publicId: otherId }, { expiresAt: expiry },
    { action: "REPLACE", expectedRevision: "1" }]) {
    assert.deepEqual(await mutate(store, command(changes)), { ok: false, code: "idempotency_conflict" });
  }
  assert.equal((await mutate(store, command(), context(at, "operator-B"))).code, "idempotency_conflict");
  assert.equal(store.events.length, 1);
});

test("invalid requests cannot reach the store or supply actor/time/quantity/price", async () => {
  const store = new AtomicTestStore();
  for (const changes of [{ publicId: "sku" }, { operationId: " " }, { reason: " " },
    { expectedRevision: undefined }, { expectedRevision: 1 }, { expectedRevision: "0" },
    { expectedRevision: "01" }, { expectedRevision: "revision-1" },
    { action: "UNKNOWN" }, { mode: "UNKNOWN" }, { expiresAt: "2026-02-30T10:00:00Z" },
    { actorId: "spoofed" }, { at }, { manualSellableStock: 9 }, { basePriceHuf: 10 }]) {
    assert.equal((await mutate(store, command(changes))).code, "validation_error");
  }
  for (const value of [null, [], {}, revoke({ expectedRevision: null }),
    revoke({ mode: "AUTO" }), replace({ expectedRevision: null })]) {
    assert.equal((await mutate(store, value)).code, "validation_error");
  }
  assert.equal(store.calls, 0);
});

test("invalid trusted actor/clock is rejected and unknown errors remain sanitized", async () => {
  const store = new AtomicTestStore();
  for (const ctx of [context(at, " "), context("invalid"), {
    actorId: "operator", clock() { throw new Error("clock secret"); },
  }]) assert.equal((await mutate(store, command(), ctx)).code, "validation_error");
  assert.equal(store.calls, 0);
  const result = await mutate({ async mutateAtomically() { throw new Error("private credential"); } });
  assert.deepEqual(result, { ok: false, code: "store_failure" });
  assert.doesNotMatch(JSON.stringify(result), /credential/);
});

test("expiry at/before creation fails without revision/event and does not reserve operation ID", async () => {
  const store = new AtomicTestStore();
  for (const expiresAt of [at, "2026-09-30T09:00:00Z"]) {
    assert.equal((await mutate(store, command({ expiresAt }))).code, "validation_error");
  }
  assert.equal(store.events.length, 0);
  assert.equal(store.receipts.size, 0);
  assert.equal((await mutate(store)).revision, "1");
});

test("missing record and inactive revoke have distinct errors", async () => {
  const store = new AtomicTestStore();
  // Tombstone/revision may remain from legacy audited reset; not a new active record.
  store.entries.set(id, { record: null, revision: "1" });
  assert.equal((await mutate(store, replace())).code, "override_not_found");
  assert.equal((await mutate(store, revoke({ expectedRevision: "1" }))).code, "no_active_override");
  assert.equal(store.events.length, 0);
  await mutate(store, command({ operationId: "auto", expectedRevision: "1", mode: "AUTO", reason: "" }));
  assert.equal((await mutate(store, revoke())).code, "no_active_override");
});

test("AUTO replacement returns to ERP semantics and allows subsequent create", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  const result = await mutate(store, replace({ mode: "AUTO", reason: "" }));
  assert.equal(result.event.after.mode, "AUTO");
  assert.equal(result.revision, "2");
  assert.equal((await mutate(store, command({ operationId: "new", expectedRevision: "2" }))).revision, "3");
});

test("expired override is inactive on Unit 2C reads, without automatic writes/events", async () => {
  const store = new AtomicTestStore();
  await mutate(store, command({ expiresAt: expiry }));
  const erpSource = { async readProduct() { return {
    public_id: id, retail_price_huf: 12990.5, sellable_stock: 7, operational_ready: false,
  }; } };
  for (let i = 0; i < 2; i++) {
    const state = await readEffectiveOperationalState(id, { erpSource, overrideStore: store }, { now: expiry });
    assert.equal(state.overrideDisposition, "EXPIRED");
    assert.equal(state.availability, "NOT_READY");
    assert.equal(state.basePriceHuf, 12990.5);
    assert.equal(state.sellableStock, 7);
    assert.equal(state.operationalReady, false);
    assert.equal(state.checkoutAuthorization, "NOT_EVALUATED");
  }
  assert.equal(store.calls, 1);
  assert.equal(store.events.length, 1);
  assert.equal((await store.getCurrent(id)).revision, "1");
  assert.equal((await mutate(store, revoke({ expectedRevision: "1" }), context(expiry))).code, "no_active_override");
  const recreated = await mutate(store, command({ operationId: "after-expiry", expectedRevision: "1" }), context(expiry));
  assert.equal(recreated.revision, "2");
  assert.equal(recreated.event.before.expiresAt, expiry);
});

test("Unit 2C composition retains force-available intent without readiness/stock changes", async () => {
  const store = new AtomicTestStore();
  await mutate(store, command({ mode: "FORCE_AVAILABLE" }));
  const erpSource = { async readProduct() { return {
    public_id: id, retail_price_huf: 12990.5, sellable_stock: 0, operational_ready: false,
  }; } };
  const state = await readEffectiveOperationalState(id, { erpSource, overrideStore: store }, { now: at });
  assert.equal(state.availability, "AVAILABLE");
  assert.equal(state.sellableStock, 0);
  assert.equal(state.operationalReady, false);
  assert.equal(state.basePriceHuf, 12990.5);
  assert.equal(state.overrideRevision, "1");
  assert.equal(state.checkoutAuthorization, "NOT_EVALUATED");
});

test("test transaction failure commits neither state nor audit nor replay receipt", async () => {
  const store = new AtomicTestStore();
  store.failBeforeCommit = true;
  assert.equal((await mutate(store)).code, "store_failure");
  assert.equal(store.entries.size, 0);
  assert.equal(store.events.length, 0);
  assert.equal(store.receipts.size, 0);
  store.failBeforeCommit = false;
  assert.equal((await mutate(store)).revision, "1");
});

test("lost acknowledgement after commit is recovered by replay without duplicate writes", async () => {
  const store = new AtomicTestStore();
  let loseReply = true;
  const boundary = { async mutateAtomically(value) {
    const result = await store.mutateAtomically(value);
    if (loseReply) { loseReply = false; throw new Error("connection lost after commit"); }
    return result;
  } };
  assert.equal((await mutate(boundary)).code, "store_failure");
  const replay = await mutate(boundary, command(), context(later));
  assert.equal(replay.ok, true);
  assert.equal(replay.revision, "1");
  assert.equal(replay.event.at, at);
  assert.equal(store.events.length, 1);
  assert.equal(store.receipts.size, 1);
});

test("transaction decision rejects forbidden fields and cannot move audit time backwards", async () => {
  const store = new AtomicTestStore();
  await mutate(store, command(), context(later));
  assert.equal((await mutate(store, replace(), context(at))).code, "store_failure");
  const decision = decideOverrideMutation({ record: null, revision: null }, null, {
    ...command(), actorId: "trusted", at, sellableStock: 10,
  });
  assert.deepEqual(decision, { write: false, result: { ok: false, code: "validation_error" } });
  assert.equal(store.events.length, 1);
});

test("provider unavailable/conflict/idempotency errors are distinct and sanitized", async () => {
  for (const code of ["store_unavailable", "store_failure", "conflict", "idempotency_conflict"]) {
    const result = await mutate({ async mutateAtomically() { return { ok: false, code, privateData: "secret" }; } });
    assert.deepEqual(result, { ok: false, code });
  }
  for (const result of [null, {}, { ok: false, code: "unknown" }, { ok: true, revision: "1" }]) {
    assert.equal((await mutate({ async mutateAtomically() { return result; } })).code, "store_failure");
  }
});

test("provider success acknowledgement is validated and stripped of infrastructure fields", async () => {
  const store = new AtomicTestStore();
  const original = await mutate(store);
  const extra = { ...original, privateData: "secret", event: { ...original.event, credential: "secret" } };
  assert.deepEqual(await mutate({ async mutateAtomically() { return extra; } }), original);
  for (const changes of [{ revision: "2" }, { event: { ...original.event, actorId: "spoofed" } },
    { event: { ...original.event, after: { ...original.event.after, mode: "FORCE_AVAILABLE" } } },
    { event: { ...original.event, at: "invalid" } }]) {
    const result = await mutate({ async mutateAtomically() { return { ...original, ...changes }; } });
    assert.equal(result.code, "store_failure");
  }
});

test("revision overflow and malformed/cross-product stored state fail without writes", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  const record = (await store.getCurrent(id)).record;
  for (const snapshot of [{ record, revision: String(Number.MAX_SAFE_INTEGER) },
    { record, revision: "opaque-old" }, { record: { ...record, publicId: otherId }, revision: "1" },
    { record, revision: null }]) {
    store.entries.set(id, snapshot);
    const result = await mutate(store, replace({ expectedRevision: snapshot.revision === String(Number.MAX_SAFE_INTEGER)
      ? snapshot.revision : "1" }));
    assert.equal(result.code, "store_failure");
  }
  assert.equal(store.events.length, 1);
  for (const value of ["0", "01", "1.0", "1e3", "-1", "9007199254740992", 1]) assert.equal(isOverrideRevision(value), false);
});

test("independent products have independent monotonic revisions but shared operation IDs", async () => {
  const store = new AtomicTestStore();
  await mutate(store);
  const other = await mutate(store, command({ publicId: otherId, operationId: "other-create" }));
  assert.equal(other.revision, "1");
  await mutate(store, replace());
  assert.equal((await store.getCurrent(otherId)).revision, "1");
  assert.equal(store.events.length, 3);
});

test("mutation module rejects imports outside the server condition", () => {
  const loader = new URL("./server-only-loader.mjs", import.meta.url).href;
  const url = new URL("../lib/erp/emergency-override-mutations.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval",
    `await import(${JSON.stringify(url)})`], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /cannot be imported from a Client Component module/);
});
