import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { CART_STORAGE_KEY, serializeCart, addCartLine } from "../lib/cart/cart-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";

// Existing actual-store subscription convention; synthetic storage is not hydration.
const hook = "data:text/javascript," + encodeURIComponent(
  "export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return {subscribe,getSnapshot,getServerSnapshot};}");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "react" && context.parentURL?.endsWith("/lib/cart/browser-cart.ts")) return { url: hook, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const store = await import("../lib/cart/browser-cart.ts");
const { detailCartQuantity, detailSelectionNeedsReload, setDetailCartQuantity } = await import("../lib/cart/detail-cart-selection.ts");
const access = store.useBrowserCart();
const id = "12345678-ABCD-1234-ABCD-123456789ABC";
const other = "22345678-abcd-1234-abcd-123456789abc";
const lines = [{ publicId: other, quantity: 3 }, { publicId: id, quantity: 7 }];

function withStorage(selection, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const original = serializeCart(selection);
  const values = new Map([[CART_STORAGE_KEY, original], ["hanapure.favorites.v1", "untouched-test-only-favorites"]]);
  const writes = [], attempts = [], events = new Set();
  const control = { readDenied: false, writeDenied: false, beforeRead: null, afterWrite: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) { assert.equal(key, CART_STORAGE_KEY); control.beforeRead?.(); if (control.readDenied) throw new Error("synthetic read denial"); return values.get(key) ?? null; },
      setItem(key, value) {
        attempts.push(key); assert.equal(key, CART_STORAGE_KEY);
        if (control.writeDenied) throw new Error("synthetic write denial");
        writes.push(key); values.set(key, value); control.afterWrite?.();
      },
    },
    addEventListener(type, listener) { if (type === "storage") events.add(listener); },
    removeEventListener(type, listener) { if (type === "storage") events.delete(listener); },
  } });
  let unsubscribe;
  try {
    unsubscribe = access.subscribe(() => {});
    // A prior denial deliberately leaves the real store nonpersistent until a refresh.
    // Refresh each independent fixture rather than changing production store semantics.
    events.forEach(listener => listener({ key: CART_STORAGE_KEY }));
    run({ values, writes, attempts, control, snapshot: access.getSnapshot,
      notify: () => events.forEach(listener => listener({ key: CART_STORAGE_KEY })) });
    assert.equal(values.get("hanapure.favorites.v1"), "untouched-test-only-favorites");
  } finally {
    unsubscribe?.();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
}

test("A: imports and server snapshot are browser-safe, never show a saved quantity before readiness", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(detailCartQuantity(id, access.getServerSnapshot()), null);
  assert.equal(setDetailCartQuantity(id, "2", access.getServerSnapshot()), "unavailable");
});

test("A: zero/one/multiple lines, case aliases and original Add/storage events refresh the selected quantity", () => {
  for (const selection of [[], [lines[1]], lines]) withStorage(selection, ({ snapshot, values, notify }) => {
    assert.equal(detailCartQuantity(id.toLowerCase(), snapshot()), selection.length ? 7 : null);
    store.changeBrowserCart(current => addCartLine(current, id.toLowerCase(), 2));
    assert.equal(detailCartQuantity(id, snapshot()), selection.length ? 9 : 2);
    values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id, quantity: 12 }])); notify();
    assert.equal(detailCartQuantity(id.toLowerCase(), snapshot()), 12);
    values.set(CART_STORAGE_KEY, serializeCart([])); notify();
    assert.equal(detailCartQuantity(id, snapshot()), null);
  });
});

test("A: corrupt, unready, read-blocked or nonpersistent snapshots never expose a stale stored quantity", () => {
  withStorage(lines, ({ snapshot, values, control, notify }) => {
    for (const patch of [{ ready: false }, { invalid: true }, { persistent: false }]) assert.equal(detailCartQuantity(id, { ...snapshot(), ...patch }), null);
    values.set(CART_STORAGE_KEY, "bad-json"); notify();
    assert.equal(detailCartQuantity(id, snapshot()), null);
    values.set(CART_STORAGE_KEY, serializeCart(lines)); notify();
    control.readDenied = true; notify();
    assert.equal(detailCartQuantity(id, snapshot()), null);
  });
});

test("B: absolute set is not Add, retains stored casing/order/unrelated quantities and confirms persistence", () => {
  withStorage(lines, ({ snapshot, values, writes }) => {
    const before = snapshot();
    assert.equal(setDetailCartQuantity(id.toLowerCase(), "002", before), "updated");
    const expected = [lines[0], { publicId: id, quantity: 2 }];
    assert.deepEqual(snapshot().lines, expected);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(expected));
    assert.deepEqual(before.lines, lines);
    assert.deepEqual(writes, [CART_STORAGE_KEY]);
    assert.equal(detailCartQuantity(id, snapshot()), 2);
  });
});

test("B: identical quantity is a no-write only after fresh stored state is checked", () => {
  withStorage(lines, ({ snapshot, values, writes, attempts }) => {
    assert.equal(setDetailCartQuantity(id, "007", snapshot()), "unchanged");
    assert.deepEqual(writes, []); assert.deepEqual(attempts, []);
    values.set(CART_STORAGE_KEY, serializeCart([lines[0]]));
    assert.equal(setDetailCartQuantity(id, "7", snapshot()), "conflict");
    assert.deepEqual(attempts, []);
  });
});

test("B: invalid raw quantities and IDs never read/write storage; maximum safe quantity is allowed", () => {
  withStorage(lines, ({ snapshot, control, attempts }) => {
    control.readDenied = true;
    for (const raw of ["", " ", "0", "000", "-1", "+2", "1.5", "1e2", "1\n", "１２", "9".repeat(33), "9007199254740992"]) {
      assert.equal(setDetailCartQuantity(id, raw, snapshot()), "invalid", raw);
    }
    assert.equal(setDetailCartQuantity("bad-id", "1", snapshot()), "invalid");
    assert.deepEqual(attempts, []);
    control.readDenied = false;
    assert.equal(setDetailCartQuantity(id, String(Number.MAX_SAFE_INTEGER), snapshot()), "updated");
    assert.equal(detailCartQuantity(id, snapshot()), Number.MAX_SAFE_INTEGER);
  });
});

test("B: stale quantities, casing, reordering and target removal conflict without overwriting external state", () => {
  for (const external of [[{ ...lines[0], quantity: 9 }, lines[1]], [lines[1], lines[0]],
    [lines[0], { ...lines[1], publicId: id.toLowerCase() }], [lines[0]]]) {
    withStorage(lines, ({ values, snapshot, attempts }) => {
      const raw = serializeCart(external); values.set(CART_STORAGE_KEY, raw);
      assert.equal(setDetailCartQuantity(id, "4", snapshot()), "conflict");
      assert.deepEqual(attempts, []); assert.equal(values.get(CART_STORAGE_KEY), raw);
    });
  }
});

test("B: malformed/missing/duplicate persisted cart, access denial and unavailable snapshots fail closed", () => {
  for (const raw of ["broken", serializeCart([lines[1], { ...lines[1], publicId: id.toLowerCase() }]), null]) {
    withStorage(lines, ({ values, snapshot, attempts }) => {
      if (raw === null) values.delete(CART_STORAGE_KEY); else values.set(CART_STORAGE_KEY, raw);
      assert.equal(setDetailCartQuantity(id, "4", snapshot()), "unavailable");
      assert.deepEqual(attempts, []); assert.equal(values.get(CART_STORAGE_KEY) ?? null, raw);
    });
  }
  withStorage(lines, ({ control, snapshot, attempts }) => {
    for (const patch of [{ ready: false }, { invalid: true }, { persistent: false }]) assert.equal(setDetailCartQuantity(id, "4", { ...snapshot(), ...patch }), "unavailable");
    control.readDenied = true;
    assert.equal(setDetailCartQuantity(id, "4", snapshot()), "unavailable");
    assert.deepEqual(attempts, []);
  });
  withStorage([lines[0]], ({ snapshot, attempts }) => {
    assert.equal(setDetailCartQuantity(id, "4", snapshot()), "conflict");
    assert.deepEqual(attempts, []);
  });
});

test("B: final prewrite reread rejects a mutation or read failure between initial read and store callback", () => {
  for (const mode of ["changed", "blocked", "missing"]) withStorage(lines, ({ control, values, snapshot, attempts }) => {
    let reads = 0;
    control.beforeRead = () => {
      if (++reads !== 2) return;
      if (mode === "changed") values.set(CART_STORAGE_KEY, serializeCart([lines[0]]));
      else if (mode === "missing") values.delete(CART_STORAGE_KEY);
      else control.readDenied = true;
    };
    assert.equal(setDetailCartQuantity(id, "4", snapshot()), mode === "changed" ? "conflict" : "unavailable");
    assert.deepEqual(attempts, []);
  });
});

test("B: failed persistence is never updated; existing current-tab nonpersistent behavior is not called rollback", () => {
  withStorage(lines, ({ control, snapshot, values, notify }) => {
    control.writeDenied = true;
    assert.equal(setDetailCartQuantity(id, "4", snapshot()), "write-failed");
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
    assert.equal(snapshot().persistent, false);
    assert.equal(detailCartQuantity(id, snapshot()), null);
    assert.equal(setDetailCartQuantity(id, "4", snapshot()), "unavailable");
    control.writeDenied = false; notify();
    assert.equal(detailCartQuantity(id, snapshot()), 7);
    assert.equal(setDetailCartQuantity(id, "4", snapshot()), "updated");
  });
});

test("B: postwrite read denial or overwritten persisted result cannot announce confirmed update", () => {
  for (const mode of ["blocked", "changed"]) withStorage(lines, ({ control, snapshot, values }) => {
    control.afterWrite = () => {
      if (mode === "blocked") control.readDenied = true;
      else values.set(CART_STORAGE_KEY, serializeCart([lines[0]]));
    };
    assert.equal(setDetailCartQuantity(id, "4", snapshot()), "write-failed");
  });
});

test("correction: failed confirmation marks storage uncertain; conflict/unavailable still require the UI trust latch", () => {
  for (const mode of ["confirmation-denied", "confirmation-changed", "external-conflict", "read-unavailable"]) {
    withStorage(lines, ({ control, snapshot, values, notify }) => {
      let trusted = true;
      if (mode === "external-conflict") values.set(CART_STORAGE_KEY, serializeCart([lines[0]]));
      else if (mode === "read-unavailable") control.readDenied = true;
      else control.afterWrite = () => {
        if (mode === "confirmation-denied") control.readDenied = true;
        else values.set(CART_STORAGE_KEY, serializeCart([lines[0]]));
      };
      const result = setDetailCartQuantity(id, "4", snapshot());
      assert.equal(result, mode === "external-conflict" ? "conflict" : mode === "read-unavailable" ? "unavailable" : "write-failed");
      const unconfirmedWrite = mode.startsWith("confirmation-");
      assert.equal(snapshot().persistent, !unconfirmedWrite);
      assert.equal(detailCartQuantity(id, snapshot()) !== null, !unconfirmedWrite);
      if (detailSelectionNeedsReload(result)) trusted = false;
      assert.equal(detailCartQuantity(id, snapshot(), trusted), null);
      // A normal storage refresh must not silently unlock the failure latch in the mounted UI.
      control.readDenied = false; control.afterWrite = null;
      values.set(CART_STORAGE_KEY, serializeCart(lines)); notify();
      assert.equal(detailCartQuantity(id, snapshot(), trusted), null);
    });
  }
});

test("correction: confirmed update/unchanged and input errors do not invalidate a trusted normal selection", () => {
  withStorage(lines, ({ snapshot, writes }) => {
    assert.equal(detailSelectionNeedsReload("invalid"), false);
    assert.equal(setDetailCartQuantity(id, "bad-input", snapshot()), "invalid");
    const updated = setDetailCartQuantity(id, "4", snapshot());
    assert.equal(updated, "updated");
    assert.equal(detailSelectionNeedsReload(updated), false);
    assert.equal(detailCartQuantity(id, snapshot(), true), 4);
    const unchanged = setDetailCartQuantity(id, "4", snapshot());
    assert.equal(unchanged, "unchanged");
    assert.equal(detailSelectionNeedsReload(unchanged), false);
    assert.equal(writes.length, 1);
  });
});

test("A/B: localized existing Add/Cart props and native separate Set form remain accessible and detail-only", () => {
  const source = readFileSync(new URL("../components/cart/AddToCart.tsx", import.meta.url), "utf8");
  assert.match(source, /publicId: string; locale: EditorialLocale; routeLocale: EditorialLocale \| null/);
  // Add uses validated quantities and a fresh persisted witness, not raw state.
  assert.match(source, /const result = addConfirmed\(publicId, quantity, cart\)/);
  assert.match(source, /const quantity = parseQuickAddQuantity\(raw\)/);
  assert.match(source, /addCartLine\(stored.lines, publicId, quantity\)/);
  assert.match(source, /if \(!result.persistent\) return "write-failed"/);
  assert.match(source, /sameCartSelection\(confirmed.lines, after\) \? "added" : "write-failed"/);
  assert.match(source, /storefrontHref\("\/cart", routeLocale\)/);
  assert.match(source, /cart.ready && !cart.invalid && cart.persistent/);
  assert.match(source, /const \[selectionTrusted, setSelectionTrusted\] = useState\(true\)/);
  assert.match(source, /detailCartQuantity\(publicId, cart, selectionTrusted\)/);
  assert.match(source, /selectionTrusted && cart.ready && !cart.invalid && cart.persistent/);
  assert.match(source, /if \(detailSelectionNeedsReload\(result\)\) \{ trustGuard.current = false; setSelectionTrusted\(false\); \}/);
  assert.doesNotMatch(source, /setSelectionTrusted\(true\)/);
  assert.match(source, /selectedQuantity !== null && <ExistingQuantityForm key=\{publicId\}/);
  assert.match(source, /setDetailCartQuantity\(publicId, draft.value, cart\)/);
  assert.match(source, /type="number" min="1" step="1" required/);
  assert.match(source, /useState\(\{ quantity, value: String\(quantity\) \}\)/);
  assert.match(source, /flex-wrap/); assert.match(source, /min-h-11/); assert.match(source, /focus-visible:outline-2/);
  assert.match(source, /result === "write-failed" \? labels.selectionWriteFailed/);
  const parent = readFileSync(new URL("../components/catalogue/ProductCatalogue.tsx", import.meta.url), "utf8");
  assert.match(parent, /if \(!product\) notFound\(\)/);
  assert.match(parent, /<AddToCart key=\{product.publicId\} publicId=\{product.publicId\}/);
  for (const locale of ["en", "hu", "ko"]) for (const key of ["inBrowserCart", "notInBrowserCart", "setCartQuantity", "selectionUpdated",
    "selectionUnchanged", "selectionConflict", "selectionUnavailable", "selectionWriteFailed", "notice", "invalidStorage", "storage"]) assert.ok(cartLabels[locale][key].trim());
  // Source/synthetic-store checks do not assert hydrated keyboard/focus/320px behavior.
});
