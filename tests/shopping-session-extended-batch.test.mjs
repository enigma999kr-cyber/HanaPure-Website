import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, serializeFavorites, inspectStoredFavorites } from "../lib/favorites/favorite-state.ts";
import { RECENT_STORAGE_KEY, serializeRecent, inspectStoredRecent, removeRecent } from "../lib/recently-viewed/recent-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { favoriteLabels } from "../lib/favorites/labels.ts";

const hook = "data:text/javascript," + encodeURIComponent(
  "export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return {subscribe,getSnapshot,getServerSnapshot};}");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "react" && /\/lib\/(cart\/browser-cart|favorites\/browser-favorites|recently-viewed\/browser-recent)\.ts$/.test(context.parentURL ?? "")) return { url: hook, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const cartStore = await import("../lib/cart/browser-cart.ts");
const favorites = await import("../lib/favorites/browser-favorites.ts");
const recent = await import("../lib/recently-viewed/browser-recent.ts");
const { moveCartSelectionToSaved, addSavedSelectionToCart, removeSavedSelection, selectedSavedProducts } = await import("../lib/cart/shopping-session-bulk.ts");
const cartAccess = cartStore.useBrowserCart();
const recentAccess = recent.useBrowserRecent();
const id = "12345678-abcd-1234-abcd-123456789abc";
const other = "22345678-abcd-1234-abcd-123456789abc";
const hidden = "32345678-abcd-1234-abcd-123456789abc";
const products = [{ publicId: id }, { publicId: other }];
const lines = [{ publicId: id, quantity: 3 }, { publicId: other, quantity: 2 }, { publicId: hidden, quantity: 7 }];

function fixture(run, { cart = lines, saved = [hidden], history = [id, hidden, other] } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart(cart)], [FAVORITES_STORAGE_KEY, serializeFavorites(saved)], [RECENT_STORAGE_KEY, serializeRecent(history)]]);
  const listeners = new Set();
  const writes = [];
  const controls = { failWrite: null, failRead: null, afterWrite: null, beforeRead: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) { controls.beforeRead?.(key); if (controls.failRead === key) throw new Error("synthetic denied"); return values.get(key) ?? null; },
      setItem(key, value) { if (controls.failWrite === key) throw new Error("synthetic denied"); writes.push(key); values.set(key, value); controls.afterWrite?.(key); },
    },
    addEventListener(type, callback) { assert.equal(type, "storage"); listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, "storage"); listeners.delete(callback); },
  } });
  const unsubscribers = [cartAccess.subscribe(() => {}), favorites.subscribeFavorites(() => {}), recentAccess.subscribe(() => {})];
  const notify = key => { for (const callback of listeners) callback({ key }); };
  notify(null);
  try {
    run({ values, writes, controls, notify, cart: () => cartAccess.getSnapshot(), saved: () => favorites.getFavoriteSnapshot().ids, history: () => recentAccess.getSnapshot() });
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}
const storedCart = values => inspectStoredCart(values.get(CART_STORAGE_KEY)).lines;
const storedSaved = values => inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids;

test("SSR snapshots are inert and bulk operations do not touch browser storage", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(cartAccess.getServerSnapshot().ready, false);
  assert.equal(favorites.getServerFavoriteSnapshot().ready, false);
  assert.equal(recentAccess.getServerSnapshot().ready, false);
  assert.equal(moveCartSelectionToSaved(cartAccess.getServerSnapshot(), [id], products), "unavailable");
  assert.equal(addSavedSelectionToCart(cartAccess.getServerSnapshot(), [], [id], products), "invalid");
});

test("A moves selected public identities favorite-first with one write per key and leaves other cart quantities intact", () => fixture(({ cart, values, writes }) => {
  assert.equal(moveCartSelectionToSaved(cart(), [id.toUpperCase(), other, id], products), "moved");
  assert.deepEqual(writes, [FAVORITES_STORAGE_KEY, CART_STORAGE_KEY]);
  assert.deepEqual(storedSaved(values), [hidden, id, other]);
  assert.deepEqual(storedCart(values), [lines[2]]);
}));

test("A already-saved identities need no Favorites rewrite; capacity checks occur before any write", () => {
  fixture(({ cart, writes, values }) => {
    assert.equal(moveCartSelectionToSaved(cart(), [id], products), "moved");
    assert.deepEqual(writes, [CART_STORAGE_KEY]);
    assert.deepEqual(storedSaved(values), [id.toUpperCase(), hidden]);
  }, { saved: [id.toUpperCase(), hidden] });
  const full = Array.from({ length: MAX_FAVORITES }, (_, n) => `${String(n).padStart(8, "0")}-eeee-1234-abcd-123456789abc`);
  fixture(({ cart, writes }) => {
    assert.equal(moveCartSelectionToSaved(cart(), [id], products), "overflow");
    assert.deepEqual(writes, []);
  }, { saved: full });
  fixture(({ cart, writes, values }) => {
    assert.equal(moveCartSelectionToSaved(cart(), [id], products), "moved");
    assert.deepEqual(writes, [CART_STORAGE_KEY]);
    assert.equal(storedSaved(values).length, MAX_FAVORITES);
  }, { saved: [id, ...full.slice(1)] });
});

test("A rejects empty, stale/unpublished or invalid selections and malformed Favorites without writes", () => fixture(({ cart, values, writes }) => {
  assert.equal(moveCartSelectionToSaved(cart(), [], products), "empty");
  assert.equal(moveCartSelectionToSaved(cart(), [id, hidden], products), "invalid");
  assert.equal(moveCartSelectionToSaved(cart(), ["invalid"], products), "invalid");
  values.set(FAVORITES_STORAGE_KEY, "{");
  assert.equal(moveCartSelectionToSaved(cart(), [id], products), "unavailable");
  assert.deepEqual(writes, []);
}));

test("A Favorites write failure never removes cart items or reports success", () => fixture(({ cart, controls, writes, values }) => {
  controls.failWrite = FAVORITES_STORAGE_KEY;
  assert.equal(moveCartSelectionToSaved(cart(), [id], products), "write-failed");
  assert.deepEqual(writes, []);
  assert.deepEqual(storedCart(values), lines);
}));

test("A confirmed Favorites plus failed cart write is partial, never a cross-key Undo or false success", () => fixture(({ cart, controls, writes, values }) => {
  controls.failWrite = CART_STORAGE_KEY;
  assert.equal(moveCartSelectionToSaved(cart(), [id], products), "partial");
  assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
  assert.deepEqual(storedSaved(values), [hidden, id]);
  assert.deepEqual(storedCart(values), lines);
}));

test("A post-save confirmation failure or concurrent cart change retains saved items and stops deletion", () => {
  fixture(({ cart, controls, writes, values }) => {
    controls.afterWrite = key => { if (key === FAVORITES_STORAGE_KEY) controls.failRead = key; };
    assert.equal(moveCartSelectionToSaved(cart(), [id], products), "partial");
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
    assert.deepEqual(storedCart(values), lines);
  });
  fixture(({ cart, controls, writes, values }) => {
    controls.afterWrite = key => { if (key === FAVORITES_STORAGE_KEY) values.set(CART_STORAGE_KEY, serializeCart([lines[1]])); };
    assert.equal(moveCartSelectionToSaved(cart(), [id], products), "partial");
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
    assert.deepEqual(storedCart(values), [lines[1]]);
  });
});

test("A refuses unobserved tab changes in either storage key before writing", () => fixture(({ cart, values, writes }) => {
  const expected = cart();
  values.set(CART_STORAGE_KEY, serializeCart([lines[0]]));
  assert.equal(moveCartSelectionToSaved(expected, [id], products), "conflict");
  values.set(CART_STORAGE_KEY, serializeCart(lines));
  values.set(FAVORITES_STORAGE_KEY, serializeFavorites([other]));
  assert.equal(moveCartSelectionToSaved(expected, [id], products), "conflict");
  assert.deepEqual(writes, []);
}));

test("A partial retry after explicit store refresh is idempotent and never duplicates saved identities", () => fixture(({ cart, values, writes, controls, notify }) => {
  controls.failWrite = CART_STORAGE_KEY;
  assert.equal(moveCartSelectionToSaved(cart(), [id], products), "partial");
  controls.failWrite = null;
  notify(null); // Same recovery as re-reading the page's persisted stores.
  assert.equal(moveCartSelectionToSaved(cart(), [id], products), "moved");
  assert.deepEqual(writes, [FAVORITES_STORAGE_KEY, CART_STORAGE_KEY]);
  assert.deepEqual(storedSaved(values), [hidden, id]);
  assert.deepEqual(storedCart(values), lines.slice(1));
  assert.equal(moveCartSelectionToSaved(cart(), [id], products), "invalid");
  assert.equal(writes.length, 2);
}));

test("B adds one per selected visible saved identity in one cart write, retaining every Favorite", () => fixture(({ cart, saved, values, writes }) => {
  assert.equal(addSavedSelectionToCart(cart(), saved(), [other.toUpperCase(), id, id], products), "updated");
  assert.deepEqual(writes, [CART_STORAGE_KEY]);
  assert.deepEqual(storedSaved(values), [id.toUpperCase(), hidden, other]);
  assert.deepEqual(storedCart(values), [{ publicId: id, quantity: 4 }, { publicId: other, quantity: 3 }, lines[2]]);
}, { saved: [id.toUpperCase(), hidden, other] }));

test("B rejects stale selections, unavailable/malformed storage and overflow without partial additions", () => {
  fixture(({ cart, saved, writes, values }) => {
    assert.equal(addSavedSelectionToCart(cart(), saved(), [], products), "empty");
    assert.equal(addSavedSelectionToCart(cart(), saved(), [hidden], products), "invalid");
    assert.equal(addSavedSelectionToCart(cart(), saved(), [other], products), "invalid");
    values.set(CART_STORAGE_KEY, "{");
    assert.equal(addSavedSelectionToCart(cart(), saved(), [id], products), "unavailable");
    assert.deepEqual(writes, []);
  }, { saved: [id, hidden] });
  fixture(({ cart, saved, writes }) => {
    assert.equal(addSavedSelectionToCart(cart(), saved(), [other, id], products), "overflow");
    assert.deepEqual(writes, []);
  }, { cart: [{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }], saved: [other, id] });
});

test("B rejects cart/Favorites conflicts and write/confirmation failures without success messages", () => {
  fixture(({ cart, saved, writes, values }) => {
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites([id, other]));
    assert.equal(addSavedSelectionToCart(cart(), saved(), [id], products), "conflict");
    assert.deepEqual(writes, []);
  }, { saved: [id] });
  fixture(({ cart, saved, controls, values }) => {
    controls.failWrite = CART_STORAGE_KEY;
    assert.equal(addSavedSelectionToCart(cart(), saved(), [id], products), "write-failed");
    assert.deepEqual(storedCart(values), lines);
  }, { saved: [id] });
  fixture(({ cart, saved, controls }) => {
    controls.afterWrite = key => { if (key === CART_STORAGE_KEY) controls.failRead = key; };
    assert.equal(addSavedSelectionToCart(cart(), saved(), [id], products), "write-failed");
  }, { saved: [id] });
});

test("B one saved identity can populate an absent empty cart without changing Favorites", () => fixture(({ cart, saved, values, writes }) => {
  values.delete(CART_STORAGE_KEY);
  assert.equal(addSavedSelectionToCart(cart(), saved(), [id.toUpperCase()], products), "updated");
  assert.deepEqual(storedCart(values), [{ publicId: id, quantity: 1 }]);
  assert.deepEqual(storedSaved(values), [id]);
  assert.deepEqual(writes, [CART_STORAGE_KEY]);
}, { cart: [], saved: [id] }));

test("B final cart recheck rejects concurrent mutations without rewriting either key", () => fixture(({ cart, saved, values, controls, writes }) => {
  let reads = 0;
  controls.beforeRead = key => { if (key === CART_STORAGE_KEY && ++reads === 2) values.set(key, serializeCart([lines[2]])); };
  assert.equal(addSavedSelectionToCart(cart(), saved(), [id], products), "conflict");
  assert.deepEqual(writes, []);
  assert.deepEqual(storedCart(values), [lines[2]]);
}, { saved: [id] }));

test("B/C stale in-memory selection after a notified external change never targets the new snapshot", () => fixture(({ cart, saved, values, notify, writes }) => {
  const expected = saved();
  values.set(FAVORITES_STORAGE_KEY, serializeFavorites([id, other]));
  notify(FAVORITES_STORAGE_KEY);
  assert.equal(addSavedSelectionToCart(cart(), expected, [id], products), "conflict");
  assert.equal(removeSavedSelection(expected, [id], products), "conflict");
  assert.deepEqual(writes, []);
}, { saved: [id] }));

test("C removes only selected visible saved identities with one write, retaining hidden/stale IDs and cart/history bytes", () => fixture(({ saved, values, writes }) => {
  const beforeCart = values.get(CART_STORAGE_KEY), beforeRecent = values.get(RECENT_STORAGE_KEY);
  assert.equal(removeSavedSelection(saved(), [other, id.toUpperCase(), other], products), "updated");
  assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
  assert.deepEqual(storedSaved(values), [hidden]);
  assert.equal(values.get(CART_STORAGE_KEY), beforeCart);
  assert.equal(values.get(RECENT_STORAGE_KEY), beforeRecent);
}, { saved: [id, hidden, other] }));

test("C invalid selection, read/write failures and recheck conflict do not claim successful cleanup", () => {
  fixture(({ saved, controls, writes, values }) => {
    assert.equal(removeSavedSelection(saved(), [hidden], products), "invalid");
    controls.failWrite = FAVORITES_STORAGE_KEY;
    assert.equal(removeSavedSelection(saved(), [id], products), "write-failed");
    assert.deepEqual(storedSaved(values), [id, hidden]);
    assert.deepEqual(writes, []);
  }, { saved: [id, hidden] });
  fixture(({ saved, controls, writes }) => {
    const expected = saved();
    controls.failRead = FAVORITES_STORAGE_KEY;
    assert.equal(removeSavedSelection(expected, [id], products), "write-failed");
    assert.deepEqual(writes, []);
  }, { saved: [id] });
  fixture(({ saved, controls, writes, values }) => {
    let reads = 0;
    controls.beforeRead = key => { if (key === FAVORITES_STORAGE_KEY && ++reads === 2) values.set(key, serializeFavorites([id, other])); };
    assert.equal(removeSavedSelection(saved(), [id], products), "conflict");
    assert.deepEqual(writes, []);
  }, { saved: [id] });
  fixture(({ saved, controls, values }) => {
    controls.afterWrite = key => { if (key === FAVORITES_STORAGE_KEY) controls.failRead = key; };
    assert.equal(removeSavedSelection(saved(), [id], products), "write-failed");
    assert.deepEqual(storedSaved(values), []); // A write happened; no rollback or "not saved" claim.
    assert.equal(favorites.getFavoriteSnapshot().persistent, false);
    assert.doesNotMatch(favoriteLabels.en.storage, /not saved/);
  }, { saved: [id] });
});

test("selection projection is case-insensitive, bounded to current public data, and rejects malformed inputs", () => {
  assert.deepEqual(selectedSavedProducts([id.toUpperCase(), hidden, other], [other, id, other], products), products);
  for (const selected of [[hidden], ["bad"], [null], null]) assert.equal(selectedSavedProducts([id, hidden], selected, products), null);
  assert.equal(selectedSavedProducts([id, id.toUpperCase()], [id], products), null);
});

test("D pure removal preserves MRU order/casing and returns unchanged for an absent or invalid identity", () => {
  const before = Object.freeze([id.toUpperCase(), hidden, other]);
  assert.deepEqual(removeRecent(before, id), [hidden, other]);
  assert.strictEqual(removeRecent(before, "bad"), before);
  assert.strictEqual(removeRecent(before, "42345678-abcd-1234-abcd-123456789abc"), before);
  assert.deepEqual(before, [id.toUpperCase(), hidden, other]);
});

test("D removes one identity in one history write; Cart and Favorites are unchanged; last removal permits empty history", () => fixture(({ history, values, writes }) => {
  const beforeCart = values.get(CART_STORAGE_KEY), beforeSaved = values.get(FAVORITES_STORAGE_KEY);
  assert.equal(recent.removeBrowserRecent(id.toUpperCase(), history().ids), "removed");
  assert.deepEqual(inspectStoredRecent(values.get(RECENT_STORAGE_KEY)).ids, [hidden, other]);
  assert.equal(recent.removeBrowserRecent(hidden, history().ids), "removed");
  assert.equal(recent.removeBrowserRecent(other, history().ids), "removed");
  assert.deepEqual(inspectStoredRecent(values.get(RECENT_STORAGE_KEY)).ids, []);
  assert.deepEqual(writes, [RECENT_STORAGE_KEY, RECENT_STORAGE_KEY, RECENT_STORAGE_KEY]);
  assert.equal(values.get(CART_STORAGE_KEY), beforeCart);
  assert.equal(values.get(FAVORITES_STORAGE_KEY), beforeSaved);
}));

test("D refuses stale snapshots, malformed data and write/confirmation failures", () => {
  fixture(({ history, values, writes }) => {
    values.set(RECENT_STORAGE_KEY, serializeRecent([other]));
    assert.equal(recent.removeBrowserRecent(id, history().ids), "conflict");
    assert.deepEqual(writes, []);
  });
  fixture(({ history, controls, values }) => {
    controls.failWrite = RECENT_STORAGE_KEY;
    assert.equal(recent.removeBrowserRecent(id, history().ids), "write-failed");
    assert.deepEqual(inspectStoredRecent(values.get(RECENT_STORAGE_KEY)).ids, [id, hidden, other]);
  });
  fixture(({ history, controls }) => {
    controls.afterWrite = key => { if (key === RECENT_STORAGE_KEY) controls.failRead = key; };
    assert.equal(recent.removeBrowserRecent(id, history().ids), "write-failed");
  });
});

test("D empty/not-present/invalid/malformed/blocked history never writes or implicitly resets", () => {
  fixture(({ history, writes }) => {
    assert.equal(recent.removeBrowserRecent(id, history().ids), "unchanged");
    assert.equal(recent.removeBrowserRecent("invalid", history().ids), "unavailable");
    assert.deepEqual(writes, []);
  }, { history: [] });
  fixture(({ history, values, writes, notify }) => {
    values.set(RECENT_STORAGE_KEY, "{"); notify(RECENT_STORAGE_KEY);
    assert.equal(recent.removeBrowserRecent(id, history().ids), "unavailable");
    assert.deepEqual(writes, []);
    assert.equal(values.get(RECENT_STORAGE_KEY), "{");
  });
  fixture(({ history, controls, writes }) => {
    controls.failRead = RECENT_STORAGE_KEY;
    assert.equal(recent.removeBrowserRecent(id, history().ids), "write-failed");
    assert.deepEqual(writes, []);
  });
});

test("new stores retain strict schemas, ordinary Favorite toggle/reset and Recently Viewed full Clear behavior", () => fixture(({ history, saved, writes }) => {
  assert.equal(favorites.changeBrowserFavorite(id, true), true);
  assert.deepEqual(saved(), [hidden, id]);
  assert.equal(favorites.resetBrowserFavorites(), true);
  assert.deepEqual(saved(), []);
  assert.equal(recent.clearBrowserRecent(), true);
  assert.deepEqual(history().ids, []);
  assert.deepEqual(writes, [FAVORITES_STORAGE_KEY, FAVORITES_STORAGE_KEY, RECENT_STORAGE_KEY]);
}));

test("EN/HU/KO bulk labels have complete identical keys and truthful partial/reload feedback", () => {
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(cartLabels[locale]), Object.keys(cartLabels.en));
    assert.deepEqual(Object.keys(favoriteLabels[locale]), Object.keys(favoriteLabels.en));
    for (const key of ["moveSelectedToSaved", "selectedMoved", "selectedMovePartial", "selectedMoveFailed"]) assert.ok(cartLabels[locale][key].trim());
    for (const key of ["select", "selectedCount", "addSelected", "removeSelected", "bulkAdded", "bulkRemoved", "bulkChanged", "bulkFailed"]) assert.ok(favoriteLabels[locale][key].trim());
  }
  assert.match(cartLabels.en.selectedMovePartial, /part|confirm/i);
  assert.match(favoriteLabels.en.addSelected, /1/);
});

test("UI uses shared guarded helpers, native labelled checkboxes/status/focus and retains closed QuickAdd/Clear/Undo", () => {
  const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const saved = source("../components/catalogue/SavedProductsBar.tsx");
  const cart = source("../components/cart/ShoppingCart.tsx");
  const viewed = source("../components/catalogue/RecentlyViewedProducts.tsx");
  assert.match(saved, /type="checkbox"/);
  assert.match(saved, /checked\.baseline === state\.ids/);
  assert.match(saved, /addSavedSelectionToCart\(cart, state\.ids, checkedIds, products\)/);
  assert.match(saved, /removeSavedSelection\(state\.ids, checkedIds, products\)/);
  assert.match(saved, /heading\.current\?\.focus\(\)/);
  assert.match(cart, /moveCartSelectionToSaved\(cart, checked\.ids, products\)/);
  assert.match(cart, /setUndo\(null\)/);
  assert.match(cart, /selectedMovePartial/);
  assert.match(cart, /removeSelectedCartLines/);
  assert.match(viewed, /removeBrowserRecent\(product\.publicId, state\.ids\)/);
  assert.match(viewed, /clearBrowserRecent/);
  for (const component of [saved, viewed]) {
    assert.match(component, /<QuickAdd /);
    assert.match(component, /role="status"/);
    assert.match(component, /min-h-11/);
    assert.match(component, /focus-visible:outline/);
    // UI may read a persisted witness; mutations remain owned by shared stores.
    assert.doesNotMatch(component, /localStorage\s*(?:\.\s*(?:setItem|removeItem|clear)\s*\(|\[)|onSubmit/);
  }
});

test("WEB25 Recent Plan guard reads only its owned key and refuses stale, corrupt or unavailable witnesses", () => {
  const source = readFileSync(new URL("../components/catalogue/RecentlyViewedProducts.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("RecentlyViewedProducts.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const guards = [], reads = [];
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "ShoppingPlanIntake") {
      const guard = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === "guard");
      assert.ok(guard?.initializer && ts.isJsxExpression(guard.initializer) && ts.isArrowFunction(guard.initializer.expression));
      guards.push(guard.initializer.expression.getText(file));
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "localStorage") {
      const member = node.parent, call = member.parent;
      assert.ok(ts.isPropertyAccessExpression(member) && member.name.text === "getItem");
      assert.ok(ts.isCallExpression(call) && call.expression === member);
      assert.equal(call.arguments.length, 1);
      assert.equal(call.arguments[0].getText(file), "RECENT_STORAGE_KEY");
      reads.push(call);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(guards.length, 1); assert.equal(reads.length, 1);
  const state = Object.freeze({ ids: Object.freeze([id.toUpperCase(), other]) });
  for (const mode of ["valid", "unhealthy", "incoherent", "empty-selection", "new-snapshot", "changed", "reordered", "casing", "corrupt", "denied"]) {
    let reads = 0, writes = 0;
    const raw = mode === "changed" ? serializeRecent([hidden]) : mode === "reordered" ? serializeRecent([...state.ids].reverse()) :
      mode === "casing" ? serializeRecent([id, other]) : mode === "corrupt" ? "{" : serializeRecent(state.ids);
    const mutate = () => { writes++; throw new Error("UI must not mutate storage"); };
    const guard = runInNewContext(`(${guards[0]})`, {
      healthy: mode !== "unhealthy", coherent: mode !== "incoherent", checked: { ids: mode === "empty-selection" ? [] : [id] }, state,
      getRecentSnapshot: () => mode === "new-snapshot" ? { ...state } : state,
      inspectStoredRecent, RECENT_STORAGE_KEY,
      window: { localStorage: { getItem: key => {
        reads++; assert.equal(key, RECENT_STORAGE_KEY);
        if (mode === "denied") throw new Error("synthetic denied");
        return raw;
      }, setItem: mutate, removeItem: mutate, clear: mutate } },
    });
    assert.equal(guard(), mode === "valid", mode);
    assert.equal(reads, ["unhealthy", "incoherent", "empty-selection", "new-snapshot"].includes(mode) ? 0 : 1);
    assert.equal(writes, 0);
  }
});
