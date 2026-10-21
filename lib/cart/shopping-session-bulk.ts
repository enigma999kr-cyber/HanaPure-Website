"use client";

import { changeBrowserCart } from "./browser-cart";
import { CART_STORAGE_KEY, addCartLine, inspectStoredCart, serializeCart, type CartLine } from "./cart-state";
import { sameCartSelection } from "./cart-undo";
import { readBulkSelection } from "./cart-bulk-actions";
import { getFavoriteSnapshot, mutateBrowserFavorites, sameFavoriteIds } from "../favorites/browser-favorites";
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, inspectStoredFavorites, serializeFavorites, validFavoriteId, type FavoriteIds } from "../favorites/favorite-state";

type Cart = Readonly<{ lines: readonly CartLine[]; ready: boolean; persistent: boolean; invalid: boolean }>;
type Product = Readonly<{ publicId: string }>;
export type SessionResult = "updated" | "moved" | "partial" | "empty" | "invalid" | "conflict" | "unavailable" | "overflow" | "write-failed";

/** Only selected public identities already present in this exact Favorites snapshot. */
export function selectedSavedProducts<T extends Product>(expected: FavoriteIds, ids: FavoriteIds, products: readonly T[]): readonly T[] | null {
  try {
    serializeFavorites(expected);
    if (ids.some(id => !validFavoriteId(id))) return null;
    const selected = new Set(ids.map(id => id.toLowerCase()));
    const result = expected.filter(id => selected.has(id.toLowerCase())).map(id => products.find(product => product.publicId.toLowerCase() === id.toLowerCase()));
    if (result.length !== selected.size || result.some(product => !product)) return null;
    return result as readonly T[];
  } catch { return null; }
}

function favoriteGuard(expected: FavoriteIds): "ready" | "conflict" | "unavailable" {
  const snapshot = getFavoriteSnapshot();
  if (typeof window === "undefined" || !snapshot.ready || !snapshot.persistent || snapshot.invalid) return "unavailable";
  if (snapshot.ids !== expected) return "conflict";
  try {
    const stored = inspectStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
    if (stored.invalid) return "unavailable";
    return sameFavoriteIds(stored.ids, expected) ? "ready" : "conflict";
  } catch { return "unavailable"; }
}

export function moveCartSelectionToSaved(cart: Cart, ids: FavoriteIds, products: readonly Product[]): SessionResult {
  const selection = readBulkSelection(cart, ids);
  if (selection.status !== "ready") return selection.status;
  if (selection.lines.some(line => !products.some(product => product.publicId.toLowerCase() === line.publicId.toLowerCase()))) return "invalid";
  const expected = getFavoriteSnapshot().ids;
  const guard = favoriteGuard(expected);
  if (guard !== "ready") return guard;
  const after = [...expected];
  for (const line of selection.lines) if (!after.some(id => id.toLowerCase() === line.publicId.toLowerCase())) after.push(line.publicId);
  if (after.length > MAX_FAVORITES) return "overflow";
  // Validate both keys again before the first write, not an uncontrolled per-item loop.
  const current = readBulkSelection(cart, ids);
  if (current.status !== "ready") return current.status;
  const saved = mutateBrowserFavorites(expected, () => after);
  if (saved === "unconfirmed") return "partial";
  if (saved !== "updated" && saved !== "unchanged") return saved;
  const confirmedFavorites = getFavoriteSnapshot().ids;
  const confirmed = favoriteGuard(confirmedFavorites);
  if (confirmed !== "ready" || !selection.lines.every(line => confirmedFavorites.some(id => id.toLowerCase() === line.publicId.toLowerCase()))) return "partial";
  const identities = new Set(selection.lines.map(line => line.publicId.toLowerCase()));
  const removed = writeSessionCart(cart, cart.lines.filter(line => !identities.has(line.publicId.toLowerCase())), () => favoriteGuard(confirmedFavorites));
  // No cart-only Undo witness: this operation changes two keys.
  return removed === "updated" ? "moved" : "partial";
}

export function removeSavedSelection(expected: FavoriteIds, ids: FavoriteIds, products: readonly Product[]): SessionResult {
  const selected = selectedSavedProducts(expected, ids, products);
  if (!selected) return "invalid";
  if (!selected.length) return "empty";
  const identities = new Set(selected.map(product => product.publicId.toLowerCase()));
  const result = mutateBrowserFavorites(expected, before => before.filter(id => !identities.has(id.toLowerCase())));
  return result === "updated" ? "updated" : result === "unconfirmed" ? "write-failed" : result === "unchanged" ? "empty" : result;
}

/** Add exactly one per identity in one existing cart write; no Favorites mutation. */
export function addSavedSelectionToCart(cart: Cart, expected: FavoriteIds, ids: FavoriteIds, products: readonly Product[]): SessionResult {
  const selected = selectedSavedProducts(expected, ids, products);
  if (!selected) return "invalid";
  if (!selected.length) return "empty";
  const guard = favoriteGuard(expected);
  if (guard !== "ready") return guard;
  if (typeof window === "undefined" || !cart.ready || !cart.persistent || cart.invalid) return "unavailable";
  try {
    const stored = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
    if (stored.invalid) return "unavailable";
    if (inspectStoredCart(serializeCart(cart.lines)).invalid) return "unavailable";
    if (!sameCartSelection(stored.lines, cart.lines)) return "conflict";
    let after = cart.lines;
    for (const product of selected) {
      const next = addCartLine(after, product.publicId, 1);
      if (next === after) return "overflow";
      after = next;
    }
    return writeSessionCart(cart, after, () => favoriteGuard(expected));
  } catch { return "unavailable"; }
}

function writeSessionCart(cart: Cart, after: readonly CartLine[], extraGuard: () => "ready" | "conflict" | "unavailable"): SessionResult {
  let refusal: SessionResult | null = null;
  let attempted = false;
  try {
    const result = changeBrowserCart(current => {
      const latest = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
      const savedGuard = extraGuard();
      if (latest.invalid || savedGuard === "unavailable") refusal = "unavailable";
      else if (current !== cart.lines || !sameCartSelection(current, cart.lines) || !sameCartSelection(latest.lines, cart.lines) || savedGuard !== "ready") refusal = "conflict";
      if (refusal) throw new Error("Saved selection changed");
      attempted = true;
      return after;
    });
    if (!result) return "unavailable";
    if (!result.persistent) return "write-failed";
    const confirmedRaw = window.localStorage.getItem(CART_STORAGE_KEY);
    const confirmed = inspectStoredCart(confirmedRaw);
    return confirmedRaw !== null && !confirmed.invalid && sameCartSelection(confirmed.lines, after) ? "updated" : "write-failed";
  } catch { return refusal ?? (attempted ? "write-failed" : "unavailable"); }
}
