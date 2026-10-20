import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, MAX_FAVORITES_BYTES, inspectStoredFavorites,
  serializeFavorites, setFavorite, savedPublishedProducts } from "../lib/favorites/favorite-state.ts";
import { favoriteLabels } from "../lib/favorites/labels.ts";

const id = "12345678-abcd-1234-abcd-123456789abc";
const other = "22345678-abcd-1234-abcd-123456789abc";
const payload = ids => JSON.stringify({ version: 1, ids });
const identities = count => Array.from({ length: count }, (_, index) => `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`);

test("favorites round-trip only identities with deterministic order, preserving first casing and immutable inputs", () => {
  const empty = Object.freeze([]);
  const first = setFavorite(empty, id.toUpperCase(), true);
  assert.deepEqual(first, [id.toUpperCase()]);
  assert.strictEqual(setFavorite(first, id, true), first);
  const both = setFavorite(first, other, true);
  assert.deepEqual(inspectStoredFavorites(serializeFavorites(both)), { ids: [id.toUpperCase(), other], invalid: false });
  assert.deepEqual(Object.keys(JSON.parse(serializeFavorites(both))), ["version", "ids"]);
  assert.deepEqual(setFavorite(both, id, false), [other]);
  assert.strictEqual(setFavorite(first, other, false), first);
  assert.deepEqual(first, [id.toUpperCase()]);
  assert.deepEqual(empty, []);
});

test("untrusted JSON rejects malformed shapes, operational fields, duplicates and oversized input", () => {
  assert.deepEqual(inspectStoredFavorites(null), { ids: [], invalid: false });
  assert.deepEqual(inspectStoredFavorites(payload([])), { ids: [], invalid: false });
  for (const raw of ["", "{", "null", "[]", "{}", "true", JSON.stringify({ version: 2, ids: [] }),
    JSON.stringify({ version: 1, ids: [], price: 1 }), payload([id, id.toUpperCase()]), payload(["bad"]),
    payload([null]), payload([{ publicId: id }]), payload([1]), payload({}),
    " ".repeat(MAX_FAVORITES_BYTES + 1)]) {
    assert.equal(inspectStoredFavorites(raw).invalid, true, raw.slice(0, 100));
  }
  assert.equal(inspectStoredFavorites('{"version":1,"ids":[],"__proto__":{}}').invalid, true);
  assert.equal(inspectStoredFavorites(payload(identities(MAX_FAVORITES + 1))).invalid, true);
});

test("bounds, invalid IDs, getters, inherited arrays and hostile proxies cannot corrupt selection", () => {
  const full = Object.freeze(identities(MAX_FAVORITES));
  assert.equal(inspectStoredFavorites(serializeFavorites(full)).ids.length, MAX_FAVORITES);
  assert.strictEqual(setFavorite(full, id, true), full);
  assert.equal(setFavorite(full, full[0], false).length, MAX_FAVORITES - 1);
  for (const bad of ["bad", "", null, 1, `${id} `]) assert.strictEqual(setFavorite(full, bad, true), full);
  let calls = 0;
  const getter = [];
  Object.defineProperty(getter, "0", { get() { calls++; return id; } });
  const inherited = Object.setPrototypeOf([id], { 0: id });
  const proxy = new Proxy([], { getPrototypeOf() { throw new Error("test-only"); } });
  for (const value of [getter, inherited, proxy, new Array(1), Object.assign([id], { price: 1 })]) {
    assert.throws(() => serializeFavorites(value), TypeError);
    assert.strictEqual(setFavorite(value, other, true), value);
  }
  assert.equal(calls, 0);
});

test("saved projection hides stale/unpublished identities without rewriting stored order or casing", () => {
  const ids = Object.freeze([other, id.toUpperCase()]);
  const published = Object.freeze({ publicId: id, slug: "synthetic-only", name: "Fixture" });
  assert.deepEqual(savedPublishedProducts(ids, [published]), [published]);
  assert.deepEqual(savedPublishedProducts(ids, []), []);
  assert.deepEqual(ids, [other, id.toUpperCase()]);
});

test("every supported locale has actual storage, empty and action labels", () => {
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(favoriteLabels[locale]), Object.keys(favoriteLabels.en));
    for (const value of Object.values(favoriteLabels[locale])) assert.ok(value.trim());
  }
  assert.notEqual(favoriteLabels.hu.save, favoriteLabels.en.save);
  assert.notEqual(favoriteLabels.ko.save, favoriteLabels.en.save);
});

// Reuse the storefront test convention: real React's client entry, without rendering hooks.
const require = createRequire(import.meta.url);
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "react" ? { url: reactEntry, shortCircuit: true } : nextResolve(specifier, context);
} });

test("browser store is SSR-safe, shared, cross-tab aware, preserves corruption and never confirms failed writes", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  assert.equal(typeof window, "undefined");
  const store = await import("../lib/favorites/browser-favorites.ts");
  assert.equal(store.getServerFavoriteSnapshot().ready, false);
  const values = new Map([["hanapure.cart.v1", "untouched-test-only-cart"]]);
  const events = new Map();
  let blockedRead = false, blockedWrite = false, writes = 0, notifications = 0;
  const fakeWindow = {
    localStorage: {
      getItem(key) { if (blockedRead) throw new Error("blocked"); return values.get(key) ?? null; },
      setItem(key, value) { if (blockedWrite) throw new Error("blocked"); writes++; values.set(key, value); },
    },
    addEventListener(type, handler) { events.set(type, handler); },
    removeEventListener(type, handler) { if (events.get(type) === handler) events.delete(type); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  let unsubscribe, unsubscribeSecond;
  try {
    unsubscribe = store.subscribeFavorites(() => notifications++);
    unsubscribeSecond = store.subscribeFavorites(() => notifications++);
    assert.equal(events.size, 1);
    assert.equal(store.getFavoriteSnapshot().ready, true);
    assert.equal(store.changeBrowserFavorite(id.toUpperCase(), true), true);
    assert.deepEqual(store.getFavoriteSnapshot().ids, [id.toUpperCase()]);
    const before = writes;
    assert.equal(store.changeBrowserFavorite(id, true), false);
    assert.equal(writes, before);
    // Re-read fresh values before a same-tab write: do not overwrite an unseen tab update.
    values.set(FAVORITES_STORAGE_KEY, payload([other]));
    assert.equal(store.changeBrowserFavorite(id, true), true);
    assert.deepEqual(store.getFavoriteSnapshot().ids, [other, id]);
    values.set(FAVORITES_STORAGE_KEY, payload([id]));
    events.get("storage")({ key: FAVORITES_STORAGE_KEY });
    assert.deepEqual(store.getFavoriteSnapshot().ids, [id]);
    assert.equal(store.changeBrowserFavorite(id, false), true);
    assert.deepEqual(store.getFavoriteSnapshot().ids, []);
    values.set(FAVORITES_STORAGE_KEY, "corrupt-test-only");
    events.get("storage")({ key: FAVORITES_STORAGE_KEY });
    assert.equal(store.getFavoriteSnapshot().invalid, true);
    assert.equal(store.changeBrowserFavorite(id, true), false);
    assert.equal(values.get(FAVORITES_STORAGE_KEY), "corrupt-test-only");
    blockedWrite = true;
    assert.equal(store.resetBrowserFavorites(), false);
    assert.equal(values.get(FAVORITES_STORAGE_KEY), "corrupt-test-only");
    blockedWrite = false;
    assert.equal(store.resetBrowserFavorites(), true);
    blockedWrite = true;
    assert.equal(store.changeBrowserFavorite(id, true), false);
    assert.equal(store.getFavoriteSnapshot().persistent, false);
    assert.deepEqual(store.getFavoriteSnapshot().ids, []);
    blockedWrite = false;
    assert.equal(store.changeBrowserFavorite(id, true), true);
    blockedRead = true;
    events.get("storage")({ key: FAVORITES_STORAGE_KEY });
    assert.equal(store.getFavoriteSnapshot().persistent, false);
    assert.deepEqual(store.getFavoriteSnapshot().ids, []);
    assert.equal(store.changeBrowserFavorite(other, true), false);
    blockedRead = false;
    values.delete(FAVORITES_STORAGE_KEY);
    events.get("storage")({ key: null });
    assert.deepEqual(store.getFavoriteSnapshot().ids, []);
    assert.ok(notifications > 0);
    assert.equal(values.get("hanapure.cart.v1"), "untouched-test-only-cart");
    assert.equal(store.getServerFavoriteSnapshot().ready, false);
    unsubscribeSecond(); unsubscribeSecond = null;
    assert.equal(events.size, 1);
    unsubscribe(); unsubscribe = null;
    assert.equal(events.size, 0);
  } finally {
    unsubscribeSecond?.(); unsubscribe?.();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});
