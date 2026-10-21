import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { CART_STORAGE_KEY, inspectStoredCart, serializeCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, inspectStoredFavorites, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";

// Reuse the store subscription-hook convention in existing cart/favorites tests.
// Exercise the actual stores/coordinator with synthetic storage, not hydrated UI.
const hook = "data:text/javascript," + encodeURIComponent(
  "export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return {subscribe,getSnapshot,getServerSnapshot};}");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "react" && /\/lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts$/.test(context.parentURL ?? "")) {
    return { url: hook, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const cartStore = await import("../lib/cart/browser-cart.ts");
const favoritesStore = await import("../lib/favorites/browser-favorites.ts");
const { saveCartLineForLater } = await import("../lib/cart/save-for-later.ts");
const access = cartStore.useBrowserCart();
const id = "12345678-ABCD-1234-ABCD-123456789ABC";
const other = "22345678-abcd-1234-abcd-123456789abc";
const stale = "32345678-abcd-1234-abcd-123456789abc";
const lines = [{ publicId: other, quantity: 3 }, { publicId: id, quantity: 7 }, { publicId: stale, quantity: 2 }];
const published = [{ publicId: id.toLowerCase() }, { publicId: other }];
const ids = count => Array.from({ length: count }, (_, n) => `${String(n).padStart(8, "0")}-abcd-1234-abcd-123456789abc`);

function withStorage(options, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart(options.lines ?? lines)],
    [FAVORITES_STORAGE_KEY, serializeFavorites(options.ids ?? [])], ["unrelated-key", "untouched"]]);
  const writes = [], attempts = [], events = new Set();
  const control = { deniedRead: null, deniedWrite: null, afterWrite: null, beforeRead: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) {
        control.beforeRead?.(key);
        if (control.deniedRead === key || control.deniedRead === "all") throw new Error("synthetic read denial");
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        attempts.push(key);
        if (control.deniedWrite === key) throw new Error("synthetic write denial");
        writes.push(key); values.set(key, value); control.afterWrite?.(key);
      },
    },
    addEventListener(type, listener) { if (type === "storage") events.add(listener); },
    removeEventListener(type, listener) { if (type === "storage") events.delete(listener); },
  } });
  let unsubscribeCart, unsubscribeFavorites;
  try {
    unsubscribeCart = access.subscribe(() => {});
    unsubscribeFavorites = favoritesStore.subscribeFavorites(() => {});
    run({ values, writes, attempts, control, snapshot: () => access.getSnapshot(),
      notify: key => events.forEach(listener => listener({ key })) });
    assert.equal(values.get("unrelated-key"), "untouched");
    assert.ok(writes.every(key => key === CART_STORAGE_KEY || key === FAVORITES_STORAGE_KEY));
  } finally {
    unsubscribeFavorites?.(); unsubscribeCart?.();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
}

test("module import and server snapshots never access browser storage; SSR action is blocked", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(access.getServerSnapshot().ready, false);
  assert.equal(favoritesStore.getServerFavoriteSnapshot().ready, false);
  assert.equal(saveCartLineForLater(id, access.getServerSnapshot(), published), "blocked");
});

test("save happens before whole-line removal, case-insensitive identity preserves other rows and both schemas", () => {
  withStorage({}, ({ values, writes, snapshot }) => {
    const before = snapshot();
    assert.equal(saveCartLineForLater(id.toLowerCase(), before, published), "moved");
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY, CART_STORAGE_KEY]);
    const saved = JSON.parse(values.get(FAVORITES_STORAGE_KEY));
    assert.deepEqual(saved, { version: 1, ids: [id.toLowerCase()] });
    const remaining = [lines[0], lines[2]];
    assert.deepEqual(JSON.parse(values.get(CART_STORAGE_KEY)), { version: 1, lines: remaining });
    assert.deepEqual(snapshot().lines, remaining);
    assert.deepEqual(before.lines, lines);
    assert.equal(saveCartLineForLater(id, snapshot(), published), "blocked");
    assert.equal(writes.length, 2);
  });
});

test("already saved identity can move at capacity without duplicates or a Favorites write", () => {
  const full = [...ids(MAX_FAVORITES - 1), id.toLowerCase()];
  withStorage({ ids: full }, ({ values, writes, snapshot }) => {
    assert.equal(saveCartLineForLater(id, snapshot(), published), "moved");
    assert.deepEqual(writes, [CART_STORAGE_KEY]);
    assert.deepEqual(inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids, full);
  });
});

test("full unsaved Favorites, stale/unknown identities, absent rows and corrupt quantities never mutate", () => {
  withStorage({ ids: ids(MAX_FAVORITES) }, ({ writes, snapshot }) => {
    assert.equal(saveCartLineForLater(id, snapshot(), published), "blocked");
    assert.deepEqual(writes, []);
  });
  withStorage({}, ({ writes, snapshot }) => {
    for (const target of [stale, "bad-id", "42345678-abcd-1234-abcd-123456789abc"]) {
      assert.equal(saveCartLineForLater(target, snapshot(), published), "blocked");
    }
    assert.equal(saveCartLineForLater(id, snapshot(), []), "blocked");
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(saveCartLineForLater(id, { ...snapshot(), lines: [{ publicId: id, quantity }] }, published), "blocked");
    }
    for (const patch of [{ ready: false }, { persistent: false }, { invalid: true }]) {
      assert.equal(saveCartLineForLater(id, { ...snapshot(), ...patch }, published), "blocked");
    }
    assert.deepEqual(writes, []);
  });
});

test("malformed and inaccessible persisted state, including stale corrupt Favorites, cannot remove cart rows", () => {
  for (const key of [CART_STORAGE_KEY, FAVORITES_STORAGE_KEY]) {
    withStorage({}, ({ values, writes, snapshot }) => {
      values.set(key, "synthetic-corruption");
      assert.equal(saveCartLineForLater(id, snapshot(), published), "blocked");
      assert.equal(values.get(key), "synthetic-corruption");
      assert.deepEqual(writes, []);
    });
    withStorage({}, ({ writes, control, snapshot }) => {
      control.deniedRead = key;
      assert.equal(saveCartLineForLater(id, snapshot(), published), "blocked");
      assert.deepEqual(writes, []);
    });
  }
  withStorage({}, ({ values, writes, notify, snapshot }) => {
    values.set(FAVORITES_STORAGE_KEY, "broken"); notify(FAVORITES_STORAGE_KEY);
    assert.equal(saveCartLineForLater(id, snapshot(), published), "blocked");
    assert.deepEqual(writes, []);
  });
});

test("failed favorite write leaves persisted and in-memory cart untouched, without cart write attempts", () => {
  withStorage({}, ({ values, writes, attempts, control, snapshot }) => {
    const before = snapshot();
    control.deniedWrite = FAVORITES_STORAGE_KEY;
    assert.equal(saveCartLineForLater(id, before, published), "blocked");
    assert.deepEqual(writes, []);
    assert.deepEqual(attempts, [FAVORITES_STORAGE_KEY]);
    assert.strictEqual(snapshot().lines, before.lines);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
  });
});

test("failed cart write is partial, retains both persisted selections and safely retries after refresh", () => {
  withStorage({}, ({ values, writes, control, notify, snapshot }) => {
    control.deniedWrite = CART_STORAGE_KEY;
    assert.equal(saveCartLineForLater(id, snapshot(), published), "partial");
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
    assert.deepEqual(inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids, [id]);
    // Existing cart store retains a nonpersistent current-tab selection after a failed write.
    assert.equal(snapshot().persistent, false);
    assert.equal(saveCartLineForLater(id, snapshot(), published), "blocked");
    control.deniedWrite = null; notify(CART_STORAGE_KEY);
    assert.equal(saveCartLineForLater(id, snapshot(), published), "moved");
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY, CART_STORAGE_KEY]);
  });
});

test("unobserved different-tab cart edits conflict before any mutation", () => {
  withStorage({}, ({ values, writes, snapshot }) => {
    const external = [{ publicId: other, quantity: 25 }];
    values.set(CART_STORAGE_KEY, serializeCart(external));
    assert.equal(saveCartLineForLater(id, snapshot(), published), "conflict");
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(external));
    assert.deepEqual(writes, []);
  });
});

test("cart change or Favorites loss during saving aborts cart write and reports partial", () => {
  for (const changedKey of [CART_STORAGE_KEY, FAVORITES_STORAGE_KEY]) withStorage({}, ({ values, writes, attempts, control, snapshot }) => {
    control.afterWrite = key => {
      if (key === FAVORITES_STORAGE_KEY) values.set(changedKey,
        changedKey === CART_STORAGE_KEY ? serializeCart([{ publicId: other, quantity: 25 }]) : serializeFavorites([]));
    };
    assert.equal(saveCartLineForLater(id, snapshot(), published), "partial");
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
    assert.deepEqual(attempts, [FAVORITES_STORAGE_KEY]);
    assert.ok(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines.length > 0);
  });
});

test("read denial after a confirmed favorite write stays partial and never attempts cart removal", () => {
  withStorage({}, ({ writes, attempts, control, snapshot }) => {
    control.afterWrite = key => { if (key === FAVORITES_STORAGE_KEY) control.deniedRead = "all"; };
    assert.equal(saveCartLineForLater(id, snapshot(), published), "partial");
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
    assert.deepEqual(attempts, [FAVORITES_STORAGE_KEY]);
  });
});

test("a fresh favorite addition from another tab is preserved by the existing store reread", () => {
  withStorage({}, ({ values, snapshot }) => {
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites([other]));
    assert.equal(saveCartLineForLater(id, snapshot(), published), "moved");
    assert.deepEqual(inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids, [other, id]);
  });
});

test("localized action/status contract and scoped UI retain publication guard, focus, Undo and browser-only boundaries", () => {
  const keys = ["saveForLater", "savedForLater", "saveForLaterBlocked", "saveForLaterConflict", "saveForLaterPartial"];
  for (const locale of ["en", "hu", "ko"]) for (const key of keys) assert.ok(cartLabels[locale][key].trim());
  for (const key of keys) assert.notEqual(cartLabels.hu[key], cartLabels.ko[key]);
  const source = readFileSync(new URL("../components/cart/ShoppingCart.tsx", import.meta.url), "utf8");
  assert.match(source, /\{product && <button/);
  assert.match(source, /aria-label=\{`\$\{labels.saveForLater\}: \$\{name\}`\}/);
  assert.match(source, /setUndo\(null\);\s*const result = saveCartLineForLater/);
  assert.match(source, /neighbour \? removeRefs.current.get\(neighbour.publicId\) : browseRef.current/);
  assert.match(source, /max-w-full break-words disabled:opacity-50/);
  assert.match(source, /favorites.ids.length >= MAX_FAVORITES/);
  assert.match(source, /canUndoCart\(undo, cart.lines\)/);
  const coordinator = readFileSync(new URL("../lib/cart/save-for-later.ts", import.meta.url), "utf8");
  assert.doesNotMatch(coordinator, /server-only|local-catalogue|fetch\(|sessionStorage|document\./);
  assert.equal(CART_STORAGE_KEY, "hanapure.cart.v1");
  assert.equal(FAVORITES_STORAGE_KEY, "hanapure.favorites.v1");
});
