import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { RECENT_STORAGE_KEY, MAX_RECENT, MAX_RECENT_BYTES, inspectStoredRecent,
  serializeRecent, recordRecent, clearRecent, recentPublishedProducts } from "../lib/recently-viewed/recent-state.ts";

const id = "12345678-abcd-1234-abcd-123456789abc";
const other = "22345678-abcd-1234-abcd-123456789abc";
const third = "32345678-abcd-1234-abcd-123456789abc";
const payload = ids => JSON.stringify({ version: 1, ids });

test("MRU records at most eight identities, reorders revisits, preserves casing and skips repeated newest visits", () => {
  let ids = clearRecent();
  const original = ids;
  for (let index = 1; index <= 10; index++) ids = recordRecent(ids, `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`);
  assert.equal(ids.length, MAX_RECENT);
  assert.deepEqual(ids.map(value => Number(value.slice(0, 8))), [10, 9, 8, 7, 6, 5, 4, 3]);
  assert.strictEqual(recordRecent(ids, ids[0].toUpperCase()), ids);
  const older = ids[7];
  const changed = recordRecent(ids, older.toUpperCase());
  assert.deepEqual(changed, [older, ...ids.slice(0, 7)]);
  assert.equal(changed[0], older);
  assert.deepEqual(original, []);
  assert.equal(ids[0].slice(0, 8), "00000010");
  assert.ok(Object.isFrozen(changed));
  assert.deepEqual(inspectStoredRecent(serializeRecent(changed)), { ids: changed, invalid: false });
  assert.deepEqual(Object.keys(JSON.parse(serializeRecent(changed))), ["version", "ids"]);
  assert.ok(new TextEncoder().encode(serializeRecent(changed)).byteLength < MAX_RECENT_BYTES);
});

test("invalid JSON, aliases, extra fields, unsafe array shapes and oversized UTF-8 payloads are rejected", () => {
  assert.deepEqual(inspectStoredRecent(null), { ids: [], invalid: false });
  for (const raw of ["", "{", "null", "[]", "{}", JSON.stringify({ version: 2, ids: [] }),
    JSON.stringify({ version: 1, ids: [], name: "private" }), payload([id, id.toUpperCase()]), payload(["bad"]),
    payload([null]), payload([{ publicId: id }]), payload({}), " ".repeat(MAX_RECENT_BYTES + 1),
    JSON.stringify({ version: 1, ids: ["가".repeat(400)] }),
    payload(Array.from({ length: 9 }, (_, index) => `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`)),
    '{"version":1,"ids":[],"__proto__":{}}']) assert.equal(inspectStoredRecent(raw).invalid, true);
  let called = false;
  const accessor = [];
  Object.defineProperty(accessor, "0", { get() { called = true; return id; } });
  const proxy = new Proxy([], { getPrototypeOf() { throw new Error("synthetic"); } });
  for (const value of [accessor, proxy, new Array(1), Object.assign([id], { extra: 1 }), Object.setPrototypeOf([id], {})]) {
    assert.throws(() => serializeRecent(value), TypeError);
    assert.strictEqual(recordRecent(value, other), value);
  }
  assert.equal(called, false);
  const valid = Object.freeze([id]);
  assert.strictEqual(recordRecent(valid, "invalid"), valid);
});

test("quick return resolves only current public products in MRU order without rewriting stale stored history", () => {
  const ids = Object.freeze([third, other.toUpperCase(), id]);
  const first = Object.freeze({ publicId: id, slug: "first", name: "Synthetic first" });
  const second = Object.freeze({ publicId: other, slug: "second", name: "Synthetic second" });
  assert.deepEqual(recentPublishedProducts(ids, [first, second]), [second, first]);
  assert.deepEqual(recentPublishedProducts(ids, []), []);
  assert.deepEqual(ids, [third, other.toUpperCase(), id]);
});

const hook = "data:text/javascript," + encodeURIComponent(
  "export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return {subscribe,getSnapshot,getServerSnapshot};}");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "react" && context.parentURL?.endsWith("/lib/recently-viewed/browser-recent.ts")) return { url: hook, shortCircuit: true };
  return nextResolve(specifier, context);
} });

test("WEB24 explicit Recent clear refuses no-op, denied or replaced readback without altering visit semantics", async () => {
  const store = await import("../lib/recently-viewed/browser-recent.ts"), access = store.useBrowserRecent();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let raw = payload([id, other]), mode = "normal", denied = false, writes = 0;
  const events = new Map();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) { assert.equal(key, RECENT_STORAGE_KEY); if (denied) throw new Error("synthetic denied"); return raw; },
      setItem(key, value) {
        assert.equal(key, RECENT_STORAGE_KEY); writes++;
        if (mode !== "noop") raw = value;
        if (mode === "denied") denied = true;
        if (mode === "changed") raw = payload([third]);
      },
    },
    addEventListener(type, listener) { events.set(type, listener); }, removeEventListener(type) { events.delete(type); },
  } });
  const unsubscribe = access.subscribe(() => {});
  try {
    for (mode of ["noop", "denied", "changed"]) {
      denied = false; raw = payload([id, other]); events.get("storage")({ key: RECENT_STORAGE_KEY });
      const count = writes;
      assert.equal(store.clearBrowserRecent(), false, mode);
      assert.equal(access.getSnapshot().persistent, false);
      assert.deepEqual(access.getSnapshot().ids, [id, other]);
      assert.equal(writes, count + 1);
    }
    denied = false; mode = "normal"; raw = "synthetic-invalid";
    assert.equal(store.clearBrowserRecent(), true);
    assert.equal(raw, serializeRecent([]));
    assert.equal(access.getSnapshot().invalid, false);
    const count = writes;
    assert.equal(store.clearBrowserRecent(), false); assert.equal(writes, count);
    assert.equal(store.recordRecentVisit(id), true);
    assert.equal(store.recordRecentVisit(id.toUpperCase()), false);
    assert.deepEqual(access.getSnapshot().ids, [id]);
  } finally {
    unsubscribe();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
});

test("browser history is SSR-safe, strict-repeat idempotent, cross-tab fresh, and honest on invalid or blocked storage", async () => {
  assert.equal(typeof window, "undefined");
  const store = await import("../lib/recently-viewed/browser-recent.ts");
  const access = store.useBrowserRecent();
  assert.equal(access.getServerSnapshot().ready, false);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([["hanapure.cart.v1", "synthetic-cart"], ["hanapure.favorites.v1", "synthetic-favorites"]]);
  const events = new Map();
  let readBlocked = false, writeBlocked = false, writes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) { assert.equal(key, RECENT_STORAGE_KEY); if (readBlocked) throw new Error("denied"); return values.get(key) ?? null; },
      setItem(key, value) { assert.equal(key, RECENT_STORAGE_KEY); if (writeBlocked) throw new Error("denied"); writes++; values.set(key, value); },
    },
    addEventListener(type, callback) { events.set(type, callback); },
    removeEventListener(type, callback) { if (events.get(type) === callback) events.delete(type); },
  } });
  let unsubscribe, secondSubscription;
  try {
    unsubscribe = access.subscribe(() => {});
    secondSubscription = access.subscribe(() => {});
    assert.equal(events.size, 1);
    assert.equal(store.recordRecentVisit(id.toUpperCase()), true);
    let count = writes;
    assert.equal(store.recordRecentVisit(id), false);
    assert.equal(writes, count);
    assert.deepEqual(access.getSnapshot().ids, [id.toUpperCase()]);
    values.set(RECENT_STORAGE_KEY, payload([other, id.toUpperCase()]));
    assert.equal(store.recordRecentVisit(third), true); // A fresh read includes an unobserved tab update.
    assert.deepEqual(access.getSnapshot().ids, [third, other, id.toUpperCase()]);
    values.set(RECENT_STORAGE_KEY, payload([id]));
    events.get("storage")({ key: RECENT_STORAGE_KEY });
    assert.deepEqual(access.getSnapshot().ids, [id]);
    values.delete(RECENT_STORAGE_KEY);
    events.get("storage")({ key: null });
    assert.deepEqual(access.getSnapshot().ids, []);

    values.set(RECENT_STORAGE_KEY, "synthetic-corrupt");
    count = writes;
    assert.equal(store.recordRecentVisit(id), false);
    assert.equal(writes, count);
    assert.equal(access.getSnapshot().invalid, true);
    assert.equal(values.get(RECENT_STORAGE_KEY), "synthetic-corrupt");
    writeBlocked = true;
    assert.equal(store.clearBrowserRecent(), false);
    assert.equal(values.get(RECENT_STORAGE_KEY), "synthetic-corrupt");
    writeBlocked = false;
    assert.equal(store.clearBrowserRecent(), true);
    assert.deepEqual(access.getSnapshot().ids, []);
    assert.equal(access.getSnapshot().invalid, false);

    assert.equal(store.recordRecentVisit(id), true);
    writeBlocked = true;
    assert.equal(store.recordRecentVisit(other), false);
    assert.deepEqual(access.getSnapshot().ids, [id]);
    assert.equal(access.getSnapshot().persistent, false);
    assert.equal(values.get(RECENT_STORAGE_KEY), payload([id]));
    assert.equal(store.clearBrowserRecent(), false);
    assert.equal(values.get(RECENT_STORAGE_KEY), payload([id]));
    writeBlocked = false;
    readBlocked = true;
    count = writes;
    assert.equal(store.recordRecentVisit(other), false);
    assert.equal(store.clearBrowserRecent(), false);
    assert.equal(writes, count);
    assert.equal(access.getSnapshot().persistent, false);
    assert.deepEqual(access.getSnapshot().ids, []);
    readBlocked = false;
    assert.equal(store.clearBrowserRecent(), true);
    assert.equal(values.get("hanapure.cart.v1"), "synthetic-cart");
    assert.equal(values.get("hanapure.favorites.v1"), "synthetic-favorites");
    assert.equal(access.getServerSnapshot().ready, false);
    secondSubscription(); secondSubscription = null;
    assert.equal(events.size, 1);
    unsubscribe(); unsubscribe = null;
    assert.equal(events.size, 0);
  } finally {
    secondSubscription?.(); unsubscribe?.();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});
