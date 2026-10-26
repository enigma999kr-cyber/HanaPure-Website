import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { CART_STORAGE_KEY, serializeCart } from "../lib/cart/cart-state.ts";
import { canUndoCart } from "../lib/cart/cart-undo.ts";
import { formatCartShoppingList } from "../lib/cart/cart-shopping-list.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";

const hook = "data:text/javascript," + encodeURIComponent(
  "export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return {subscribe,getSnapshot,getServerSnapshot};}");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "react" && context.parentURL?.endsWith("/lib/cart/browser-cart.ts")) return { url: hook, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const store = await import("../lib/cart/browser-cart.ts");
const { selectedCartLines, readBulkSelection, removeSelectedCartLines } = await import("../lib/cart/cart-bulk-actions.ts");
const access = store.useBrowserCart();
const id = "12345678-ABCD-1234-ABCD-123456789ABC";
const other = "22345678-abcd-1234-abcd-123456789abc";
const stale = "32345678-abcd-1234-abcd-123456789abc";
const unknown = "42345678-abcd-1234-abcd-123456789abc";
const lines = Object.freeze([Object.freeze({ publicId: id, quantity: 2 }), Object.freeze({ publicId: other, quantity: 5 }),
  Object.freeze({ publicId: stale, quantity: 9 })]);

function withStorage(run, initial = lines) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart(initial)], ["hanapure.favorites.v1", "untouched"]]);
  const writes = [], attempts = [], events = new Set();
  const control = { readDenied: false, writeDenied: false, beforeRead: null, afterWrite: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) { assert.equal(key, CART_STORAGE_KEY); control.beforeRead?.(); if (control.readDenied) throw new Error("test read denial"); return values.get(key) ?? null; },
      setItem(key, value) {
        attempts.push(key); assert.equal(key, CART_STORAGE_KEY);
        if (control.writeDenied) throw new Error("test write denial");
        writes.push(key); values.set(key, value); control.afterWrite?.();
      },
    },
    addEventListener(type, listener) { if (type === "storage") events.add(listener); },
    removeEventListener(type, listener) { if (type === "storage") events.delete(listener); },
  } });
  const notify = () => events.forEach(listener => listener({ key: CART_STORAGE_KEY }));
  let unsubscribe;
  try {
    unsubscribe = access.subscribe(() => {}); notify();
    run({ values, writes, attempts, control, notify, snapshot: access.getSnapshot });
    assert.equal(values.get("hanapure.favorites.v1"), "untouched");
  } finally {
    unsubscribe?.();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
}

test("shared: SSR/import safety and pure selection validates identities, deduplicates aliases and retains cart order", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(removeSelectedCartLines(access.getServerSnapshot(), [id]).status, "unavailable");
  assert.deepEqual(selectedCartLines(lines, []), []);
  assert.deepEqual(selectedCartLines(lines, [stale, id.toLowerCase(), id]), [lines[0], lines[2]]);
  assert.strictEqual(selectedCartLines(lines, [id])[0], lines[0]);
  assert.equal(selectedCartLines(lines, [unknown]), null);
  assert.equal(selectedCartLines(lines, ["bad-id"]), null);
  assert.equal(selectedCartLines([{ publicId: id, quantity: 0 }], [id]), null);
});

test("A: zero selection never writes; one/many/all remove exactly one persisted selection with one complete Undo", () => {
  for (const ids of [[id.toLowerCase()], [stale, id.toLowerCase(), id], [other, stale, id]]) withStorage(({ snapshot, values, writes }) => {
    const before = snapshot();
    assert.equal(removeSelectedCartLines(before, []).status, "empty");
    assert.deepEqual(writes, []);
    const result = removeSelectedCartLines(before, ids);
    assert.equal(result.status, "removed");
    const set = new Set(ids.map(value => value.toLowerCase()));
    const after = lines.filter(line => !set.has(line.publicId.toLowerCase()));
    assert.deepEqual(snapshot().lines, after);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(after));
    assert.deepEqual(writes, [CART_STORAGE_KEY]);
    assert.ok(canUndoCart(result.plan, snapshot().lines));
    assert.deepEqual(before.lines, lines);
    assert.equal(store.restoreBrowserCart(result.plan), "restored");
    assert.deepEqual(snapshot().lines, lines);
    assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
    assert.equal(store.restoreBrowserCart(result.plan), "changed");
    assert.equal(writes.length, 2); // One removal + one Undo, never a second historical Undo.
  });
});

test("A: malformed, absent, corrupt, missing and blocked selections do not write or arm Undo", () => {
  withStorage(({ snapshot, values, control, attempts }) => {
    for (const selected of [[unknown], ["bad-id"]]) {
      const result = removeSelectedCartLines(snapshot(), selected);
      assert.equal(result.status, "invalid"); assert.ok(!("plan" in result));
    }
    for (const raw of ["corrupt", serializeCart([lines[0], lines[0]]), null]) {
      if (raw === null) values.delete(CART_STORAGE_KEY); else values.set(CART_STORAGE_KEY, raw);
      const result = removeSelectedCartLines(snapshot(), [id]);
      assert.equal(result.status, "unavailable"); assert.ok(!("plan" in result));
    }
    values.set(CART_STORAGE_KEY, serializeCart(lines)); control.readDenied = true;
    assert.equal(removeSelectedCartLines(snapshot(), [id]).status, "unavailable");
    assert.deepEqual(attempts, []);
  });
  withStorage(({ snapshot, attempts }) => {
    for (const patch of [{ ready: false }, { persistent: false }, { invalid: true }]) {
      assert.equal(removeSelectedCartLines({ ...snapshot(), ...patch }, [id]).status, "unavailable");
    }
    assert.deepEqual(attempts, []);
  });
});

test("A: unseen external quantities/order/casing/target removal conflict before mutation", () => {
  for (const changed of [[{ ...lines[0], quantity: 8 }, ...lines.slice(1)], [...lines].reverse(),
    [{ ...lines[0], publicId: id.toLowerCase() }, ...lines.slice(1)], lines.slice(1)]) {
    withStorage(({ snapshot, values, attempts }) => {
      const raw = serializeCart(changed); values.set(CART_STORAGE_KEY, raw);
      const result = removeSelectedCartLines(snapshot(), [id]);
      assert.equal(result.status, "conflict"); assert.ok(!("plan" in result));
      assert.deepEqual(attempts, []); assert.equal(values.get(CART_STORAGE_KEY), raw);
    });
  }
});

test("A: final inside-callback guard throws on changed/missing/blocked persistence without store write", () => {
  for (const mode of ["changed", "missing", "blocked"]) withStorage(({ snapshot, values, control, attempts }) => {
    let reads = 0;
    control.beforeRead = () => {
      if (++reads !== 2) return;
      if (mode === "changed") values.set(CART_STORAGE_KEY, serializeCart(lines.slice(1)));
      else if (mode === "missing") values.delete(CART_STORAGE_KEY);
      else control.readDenied = true;
    };
    const result = removeSelectedCartLines(snapshot(), [id]);
    assert.equal(result.status, mode === "changed" ? "conflict" : "unavailable");
    assert.ok(!("plan" in result)); assert.deepEqual(attempts, []);
  });
});

test("A: failed write and postwrite unconfirmed persistence never grant success/Undo or claim rollback", () => {
  for (const mode of ["write-denied", "confirm-denied", "confirm-missing", "confirm-changed"]) withStorage(({ snapshot, values, control }) => {
    if (mode === "write-denied") control.writeDenied = true;
    else control.afterWrite = () => {
      if (mode === "confirm-denied") control.readDenied = true;
      else if (mode === "confirm-missing") values.delete(CART_STORAGE_KEY);
      else values.set(CART_STORAGE_KEY, serializeCart(lines));
    };
    const result = removeSelectedCartLines(snapshot(), [id]);
    assert.equal(result.status, "write-failed"); assert.ok(!("plan" in result));
    if (mode === "write-denied") {
      assert.equal(snapshot().persistent, false);
      assert.equal(values.get(CART_STORAGE_KEY), serializeCart(lines));
    }
  });
});

test("shared: a current-tab/storage refresh invalidates transient snapshot selection; failed prewrite action does not damage prior Undo", () => {
  withStorage(({ snapshot, values, notify, attempts }) => {
    const selectedAt = snapshot().lines;
    values.set(CART_STORAGE_KEY, serializeCart(lines)); notify();
    assert.notStrictEqual(snapshot().lines, selectedAt); // Even equal data is a new selection witness.
    const first = removeSelectedCartLines(snapshot(), [stale]);
    assert.equal(first.status, "removed");
    assert.ok(canUndoCart(first.plan, snapshot().lines));
    const count = attempts.length;
    assert.equal(removeSelectedCartLines(snapshot(), [unknown]).status, "invalid");
    assert.ok(canUndoCart(first.plan, snapshot().lines));
    assert.equal(attempts.length, count);
  });
});

test("B: copy subset follows cart order, omits stale/draft identities, preserves locales/fallbacks and writes nothing", () => {
  const products = [{ publicId: id.toLowerCase(), slug: "test-first", brand: "beplain", names: { en: "First", hu: "Első", ko: "첫 상품" } },
    { publicId: other, slug: "test-second", brand: "Anua", names: { en: "Second", hu: null, ko: null } }];
  for (const locale of ["en", "hu", "ko"]) withStorage(({ snapshot, writes, values }) => {
    const before = values.get(CART_STORAGE_KEY);
    const selected = readBulkSelection(snapshot(), [stale, other, id.toLowerCase()]);
    assert.equal(selected.status, "ready");
    assert.deepEqual(selected.lines, lines);
    const list = formatCartShoppingList(selected.lines, products, locale);
    assert.equal(list.status, "ready"); assert.equal(list.omitted, 1);
    assert.ok(list.text.indexOf(products[0].names[locale]) < list.text.indexOf(locale === "en" ? "Second" : storefrontLabels[locale].details));
    assert.ok(list.text.includes(`${cartLabels[locale].quantity}: 2`));
    assert.ok(list.text.includes(`${cartLabels[locale].quantity}: 5`));
    if (locale !== "en") { assert.ok(list.text.includes("Anua (test-second)")); assert.ok(!list.text.includes("Second")); }
    for (const identity of [id, other, stale]) assert.ok(!list.text.includes(identity));
    assert.ok(list.text.includes(cartLabels[locale].shoppingListNotice));
    const one = readBulkSelection(snapshot(), [other]);
    const single = formatCartShoppingList(one.lines, products, locale);
    assert.equal(single.text.split("\n").filter(row => row.startsWith("- ")).length, 1);
    assert.ok(!single.text.includes(products[0].names[locale]));
    assert.equal(readBulkSelection(snapshot(), []).status, "empty");
    const hidden = readBulkSelection(snapshot(), [stale]);
    assert.equal(formatCartShoppingList(hidden.lines, products, locale).status, "empty");
    assert.equal(formatCartShoppingList(one.lines, [{ ...products[1], names: { en: "X".repeat(16_001), hu: "X".repeat(16_001), ko: "X".repeat(16_001) } }], locale).status, "too-large");
    assert.deepEqual(writes, []); assert.equal(values.get(CART_STORAGE_KEY), before);
  });
});

test("integration: native transient selection, separate clipboard statuses and existing actions are retained", () => {
  const source = readFileSync(new URL("../components/cart/ShoppingCart.tsx", import.meta.url), "utf8");
  assert.match(source, /checked.lines === cart.lines/);
  assert.match(source, /<label[^>]*>[\s\S]*?<input type="checkbox"/);
  assert.match(source, /previous.lines === cart.lines \? previous.ids : \[\]/);
  assert.match(source, /setUndo\(result.plan\)/);
  assert.match(source, /setChecked\(\{ lines: result.plan.after, ids: \[\] \}\)/);
  // Visible ordered survivor, including Browse fallback when its ref is absent.
  assert.match(source, /view.rows.find\(item => result.plan.after.some/);
  assert.match(source, /survivor \? removeRefs.current.get\(survivor.publicId\) \?\? browseRef.current : browseRef.current/);
  const copy = source.slice(source.indexOf("if (selectedCopyPending.current"), source.indexOf("}>{labels.copySelectedList}</button>"));
  assert.match(copy, /formatCartShoppingList\(selection.lines, products, locale\)/);
  assert.match(copy, /await navigator.clipboard.writeText\(list.text\);\s*if \(currentCopy\(owner\)\) setSelectedCopyMessage\(list.omitted/);
  assert.match(copy, /catch \{ if \(currentCopy\(owner\)\) setSelectedCopyMessage\(labels.shoppingListFailed\)/);
  assert.match(copy, /finally \{ selectedCopyPending.current = false; if \(copyLive.current\) setCopyingSelected\(false\)/);
  assert.doesNotMatch(copy, /changeBrowser|resetBrowser|setUndo|execCommand|textarea|fetch\(/);
  for (const action of ["labels.remove", "labels.update", "labels.clear", "labels.undo", "labels.saveForLater", "labels.copyShoppingList"]) assert.ok(source.includes(action));
  assert.match(source, /<p role="status"[^>]*>\{copyMessage\}<\/p>/);
  assert.match(source, /<p role="status"[^>]*>\{selectedCopyMessage\}<\/p>/);
  assert.match(source, /min-h-11/); assert.match(source, /focus-visible:outline-2/); assert.match(source, /flex-wrap/);
  for (const locale of ["en", "hu", "ko"]) for (const key of ["selectCartItem", "selectedItems", "removeSelected", "selectedRemoved",
    "bulkSelectionEmpty", "bulkSelectionChanged", "bulkRemovalFailed", "copySelectedList", "selectedListCopied", "selectedListCopiedOmitted"]) assert.ok(cartLabels[locale][key].trim());
  // Source/synthetic-store evidence, not a hydrated/browser pass.
});
