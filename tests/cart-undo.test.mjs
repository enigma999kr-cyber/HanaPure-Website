import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createCartUndoPlan, canUndoCart, sameCartSelection } from "../lib/cart/cart-undo.ts";
import { CART_STORAGE_KEY, serializeCart, updateCartLine, cartQuantity } from "../lib/cart/cart-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";

const id = "12345678-ABCD-1234-ABCD-123456789ABC";
const other = "22345678-abcd-1234-abcd-123456789abc";
const unpublished = "32345678-abcd-1234-abcd-123456789abc";
const lines = Object.freeze([
  Object.freeze({ publicId: id, quantity: 2 }),
  Object.freeze({ publicId: other, quantity: 3 }),
  Object.freeze({ publicId: unpublished, quantity: Number.MAX_SAFE_INTEGER }),
]);

test("remove and clear plans preserve exact ordered IDs, casing, safe quantities and unpublished selections", () => {
  const plan = createCartUndoPlan(lines, [lines[0], lines[2]]);
  assert.deepEqual(plan.before, lines);
  assert.deepEqual(plan.after, [lines[0], lines[2]]);
  assert.equal(plan.before[0].publicId, id);
  assert.equal(plan.before[2].quantity, Number.MAX_SAFE_INTEGER);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.before) && Object.isFrozen(plan.after));
  assert.ok(plan.before.every(Object.isFrozen));
  assert.deepEqual(createCartUndoPlan(lines, []).after, []);
  assert.deepEqual(lines.map(line => line.quantity), [2, 3, Number.MAX_SAFE_INTEGER]);
});

test("no-op, additions, quantity changes, reordering, invalid IDs and unsafe quantities cannot create Undo", () => {
  assert.equal(createCartUndoPlan([], []), null);
  assert.equal(createCartUndoPlan(lines, lines), null);
  assert.equal(createCartUndoPlan([lines[0]], lines), null);
  assert.equal(createCartUndoPlan(lines, [lines[1], lines[0]]), null);
  assert.equal(createCartUndoPlan(lines, [{ ...lines[0], quantity: 3 }]), null);
  assert.equal(createCartUndoPlan(lines, [{ ...lines[0], publicId: id.toLowerCase() }]), null);
  for (const quantity of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(createCartUndoPlan([{ publicId: id, quantity }], []), null);
  }
  assert.equal(createCartUndoPlan([{ publicId: "fake", quantity: 1 }], []), null);
  assert.equal(createCartUndoPlan([{ ...lines[0], price: 1 }], []), null);
  assert.equal(createCartUndoPlan([lines[0], { ...lines[0], publicId: id.toLowerCase() }], []), null);
});

test("selection equality includes exact casing, order, count and individual quantities", () => {
  assert.ok(sameCartSelection(lines, lines.map(line => ({ ...line }))));
  assert.equal(sameCartSelection(lines, [...lines].reverse()), false);
  assert.equal(sameCartSelection(lines, lines.slice(1)), false);
  assert.equal(sameCartSelection(lines, [{ ...lines[0], publicId: id.toLowerCase() }, ...lines.slice(1)]), false);
  assert.equal(sameCartSelection(lines, [{ ...lines[0], quantity: 3 }, { ...lines[1], quantity: 2 }, lines[2]]), false);
});

test("reference witness rejects intervening equal-value mutations and prevents a historical Undo stack", () => {
  const first = createCartUndoPlan(lines, lines.slice(1));
  assert.equal(canUndoCart(first, first.after), true);
  assert.equal(canUndoCart(first, first.after.map(line => ({ ...line }))), false);
  const second = createCartUndoPlan(first.after, [first.after[1]]);
  assert.equal(canUndoCart(first, second.after), false);
  assert.equal(canUndoCart(second, second.after), true);
  assert.equal(canUndoCart(first, second.before), false);
  assert.equal(canUndoCart(second, second.before), false);
});

test("EN/HU/KO Undo labels are complete and existing cart warnings stay available", () => {
  for (const locale of ["en", "hu", "ko"]) {
    for (const key of ["undo", "removed", "cleared", "restored", "undoChanged", "undoStorage", "notice", "storage", "invalidStorage", "browse"]) {
      assert.ok(cartLabels[locale][key].trim());
    }
  }
  assert.notEqual(cartLabels.hu.undo, cartLabels.en.undo);
  assert.notEqual(cartLabels.ko.undo, cartLabels.en.undo);
});

// Capture the real store's subscription callbacks through the existing mocked-hook convention.
// No React renderer, DOM or new test framework is involved.
const hook = "data:text/javascript," + encodeURIComponent(
  "export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return {subscribe,getSnapshot,getServerSnapshot};}");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "react" && context.parentURL?.endsWith("/lib/cart/browser-cart.ts")) return { url: hook, shortCircuit: true };
  return nextResolve(specifier, context);
} });

async function checkUndoConfirmation() {
  const store = await import("../lib/cart/browser-cart.ts"), access = store.useBrowserCart();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map(), events = new Map();
  let mode = "normal", denied = false, writes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) { if (denied) throw new Error("synthetic read denial"); return values.get(key) ?? null; },
      setItem(key, value) {
        writes++;
        if (mode !== "noop") values.set(key, value);
        if (mode === "denied") denied = true;
        if (mode === "changed") values.set(key, serializeCart([lines[1]]));
      },
    },
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  } });
  const unsubscribe = access.subscribe(() => {});
  try {
    for (const failure of ["noop", "denied", "changed"]) {
      denied = false; mode = "normal";
      values.set(CART_STORAGE_KEY, serializeCart(lines)); events.get("storage")({ key: CART_STORAGE_KEY });
      let plan;
      store.changeBrowserCart(before => { plan = createCartUndoPlan(before, []); return plan.after; });
      const after = access.getSnapshot().lines, count = writes;
      mode = failure;
      assert.equal(store.restoreBrowserCart(plan), "unavailable", failure);
      assert.equal(writes, count + 1);
      assert.equal(access.getSnapshot().persistent, false);
      assert.strictEqual(access.getSnapshot().lines, after);
      assert.equal(store.restoreBrowserCart(plan), "unavailable");
      assert.equal(writes, count + 1); // No automatic retry or rollback.
    }
    denied = false; mode = "normal";
    values.set(CART_STORAGE_KEY, serializeCart(lines)); events.get("storage")({ key: CART_STORAGE_KEY });
    let plan; store.changeBrowserCart(before => { plan = createCartUndoPlan(before, []); return plan.after; });
    assert.equal(store.restoreBrowserCart(plan), "restored");
    assert.deepEqual(access.getSnapshot().lines, lines);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
  } finally {
    unsubscribe();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

async function checkCartSaveConfirmation() {
  const store = await import("../lib/cart/browser-cart.ts"), access = store.useBrowserCart();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let raw = serializeCart([]), mode = "normal";
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem() { if (mode === "read-denied") throw new Error("synthetic read denial"); return raw; },
      setItem(_, value) {
        if (mode === "write-denied") throw new Error("synthetic write denial");
        if (mode !== "noop") raw = value;
      },
    },
    addEventListener() {}, removeEventListener() {},
  } });
  const unsubscribe = access.subscribe(() => {});
  try {
    for (mode of ["noop", "write-denied", "read-denied", "normal"]) {
      const result = store.changeBrowserCart(() => lines);
      assert.equal(result.persistent, mode === "normal", mode);
      assert.deepEqual(access.getSnapshot().lines, lines); // Existing current-tab fallback.
      assert.equal(access.getSnapshot().persistent, mode === "normal");
    }
  } finally {
    unsubscribe();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

test("guarded browser Undo rereads persistence, rejects stale/corrupt/blocked state, restores once and keeps existing store semantics", async () => {
  assert.equal(typeof window, "undefined");
  const store = await import("../lib/cart/browser-cart.ts");
  const access = store.useBrowserCart();
  const arbitraryPlan = createCartUndoPlan(lines, []);
  assert.equal(access.getServerSnapshot().ready, false);
  assert.equal(store.restoreBrowserCart(arbitraryPlan), "unavailable");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map();
  const events = new Map();
  let blockedRead = false, blockedWrite = false, writes = 0;
  const fakeWindow = {
    localStorage: {
      getItem(key) { if (blockedRead) throw new Error("synthetic read denial"); return values.get(key) ?? null; },
      setItem(key, value) { if (blockedWrite) throw new Error("synthetic write denial"); writes++; values.set(key, value); },
    },
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type, listener) { if (events.get(type) === listener) events.delete(type); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  const seed = selection => {
    values.set(CART_STORAGE_KEY, serializeCart(selection));
    events.get("storage")({ key: CART_STORAGE_KEY });
  };
  const remove = (removedId = id) => {
    let plan;
    const result = store.changeBrowserCart(before => {
      plan = createCartUndoPlan(before, before.filter(line => line.publicId !== removedId));
      return plan?.after ?? before;
    });
    return { plan, result };
  };
  let unsubscribe;
  try {
    unsubscribe = access.subscribe(() => {});
    assert.equal(events.size, 1);
    seed(lines);
    let { plan, result } = remove();
    assert.equal(result.persistent, true);
    assert.equal(canUndoCart(plan, access.getSnapshot().lines), true);
    assert.equal(store.restoreBrowserCart(plan), "restored");
    assert.deepEqual(access.getSnapshot().lines, lines);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
    assert.equal(cartQuantity(access.getSnapshot().lines), "9007199254740996");
    let beforeWrites = writes;
    assert.equal(store.restoreBrowserCart(plan), "changed");
    assert.equal(writes, beforeWrites);

    ({ plan } = remove());
    store.changeBrowserCart(current => updateCartLine(current, other.toUpperCase(), 5));
    assert.equal(store.restoreBrowserCart(plan), "changed");

    seed(lines);
    ({ plan } = remove());
    // No storage event yet: matching in-memory state alone must not permit overwrite.
    values.set(CART_STORAGE_KEY, serializeCart([lines[0]]));
    beforeWrites = writes;
    assert.equal(store.restoreBrowserCart(plan), "changed");
    assert.equal(writes, beforeWrites);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart([lines[0]]));

    seed(lines);
    ({ plan } = remove());
    seed(plan.after); // Equal values still came from a different-tab refresh.
    assert.equal(store.restoreBrowserCart(plan), "changed");

    seed(lines);
    ({ plan } = remove(other));
    values.set(CART_STORAGE_KEY, serializeCart([{ ...plan.after[0], publicId: id.toLowerCase() }, plan.after[1]]));
    assert.equal(store.restoreBrowserCart(plan), "changed");

    seed(lines);
    ({ plan } = remove());
    values.set(CART_STORAGE_KEY, "synthetic-corrupt");
    assert.equal(store.restoreBrowserCart(plan), "unavailable");
    assert.equal(values.get(CART_STORAGE_KEY), "synthetic-corrupt");
    values.delete(CART_STORAGE_KEY);
    assert.equal(store.restoreBrowserCart(plan), "unavailable");
    assert.equal(values.has(CART_STORAGE_KEY), false);

    seed(lines);
    ({ plan } = remove());
    blockedRead = true;
    assert.equal(store.restoreBrowserCart(plan), "unavailable");
    assert.equal(access.getSnapshot().persistent, false);
    blockedRead = false;

    seed(lines);
    ({ plan } = remove());
    const after = access.getSnapshot().lines;
    const persistedAfter = values.get(CART_STORAGE_KEY);
    blockedWrite = true;
    beforeWrites = writes;
    assert.equal(store.restoreBrowserCart(plan), "unavailable");
    assert.equal(writes, beforeWrites);
    assert.strictEqual(access.getSnapshot().lines, after);
    assert.equal(access.getSnapshot().persistent, false);
    assert.equal(values.get(CART_STORAGE_KEY), persistedAfter);
    blockedWrite = false;

    seed(lines);
    blockedWrite = true;
    ({ plan, result } = remove());
    assert.equal(result.persistent, false);
    assert.equal(store.restoreBrowserCart(plan), "unavailable");
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
    blockedWrite = false;

    seed(lines);
    let cleared;
    store.changeBrowserCart(before => { cleared = createCartUndoPlan(before, []); return cleared.after; });
    assert.deepEqual(access.getSnapshot().lines, []);
    assert.equal(store.restoreBrowserCart(cleared), "restored");
    assert.deepEqual(access.getSnapshot().lines, lines);
    assert.equal(store.restoreBrowserCart(cleared), "changed");

    values.set(CART_STORAGE_KEY, "synthetic-corrupt");
    events.get("storage")({ key: null });
    assert.equal(access.getSnapshot().invalid, true);
    assert.equal(store.restoreBrowserCart(cleared), "unavailable");
    let called = false;
    assert.equal(store.changeBrowserCart(current => { called = true; return current; }), null);
    assert.equal(called, false);
    assert.equal(values.get(CART_STORAGE_KEY), "synthetic-corrupt");
    store.resetBrowserCart();
    assert.deepEqual(access.getSnapshot().lines, []);
    assert.equal(access.getSnapshot().invalid, false);
    assert.equal(access.getServerSnapshot().ready, false);
    unsubscribe(); unsubscribe = null;
    assert.equal(events.size, 0);
  } finally {
    unsubscribe?.();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});

// Keep the existing fresh-module/SSR assertion first; every later case installs
// and restores its own fake storage rather than relying on initial module state.
test("WEB24 Undo confirms full post-write payload and keeps uncertainty on no-op, denied or changed readback", checkUndoConfirmation);
test("WEB24 ordinary Cart save keeps current-tab fallback but does not confirm unpersisted writes", checkCartSaveConfirmation);
