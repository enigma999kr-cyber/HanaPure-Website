"use client";

import { changeBrowserCart } from "./browser-cart";
import { CART_STORAGE_KEY, inspectStoredCart, reconcileCart, serializeCart, validCartId, type CartLine } from "./cart-state";
import { sameCartSelection } from "./cart-undo";
import { changeBrowserFavorite, getFavoriteSnapshot } from "../favorites/browser-favorites";
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, inspectStoredFavorites } from "../favorites/favorite-state";

export type SaveForLaterResult = "moved" | "blocked" | "conflict" | "partial";
type CartSnapshot = Readonly<{ lines: readonly CartLine[]; ready: boolean; persistent: boolean; invalid: boolean }>;

/** Synchronous two-key best effort, NOT an atomic transaction or cross-tab CAS. */
export function saveCartLineForLater(publicId: string, cart: CartSnapshot,
  products: readonly Readonly<{ publicId: string }>[]): SaveForLaterResult {
  if (typeof window === "undefined" || !validCartId(publicId) || !cart.ready || !cart.persistent || cart.invalid) return "blocked";
  const identity = publicId.toLowerCase();
  let confirmedSaved = false;
  try {
    const checked = inspectStoredCart(serializeCart(cart.lines));
    if (checked.invalid || !reconcileCart(checked.lines, products).some(({ line, product }) =>
      line.publicId.toLowerCase() === identity && product !== null)) return "blocked";
    const favorites = getFavoriteSnapshot();
    if (!favorites.ready || !favorites.persistent || favorites.invalid) return "blocked";
    const storedCart = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
    if (storedCart.invalid) return "blocked";
    if (!sameCartSelection(storedCart.lines, checked.lines)) return "conflict";
    const storedFavorites = inspectStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
    if (storedFavorites.invalid) return "blocked";
    const includesIdentity = (ids: readonly string[]) => ids.some(id => id.toLowerCase() === identity);
    if (!includesIdentity(storedFavorites.ids)) {
      if (storedFavorites.ids.length >= MAX_FAVORITES) return "blocked";
      // The existing store rereads Favorites before adding; never toggle or copy quantity.
      confirmedSaved = changeBrowserFavorite(publicId, true);
    }
    const savedSnapshot = getFavoriteSnapshot();
    const saved = inspectStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
    if (!savedSnapshot.persistent || savedSnapshot.invalid || saved.invalid || !includesIdentity(saved.ids)) return confirmedSaved ? "partial" : "blocked";
    confirmedSaved = true;
    const after = storedCart.lines.filter(line => line.publicId.toLowerCase() !== identity);
    const result = changeBrowserCart(current => {
      const latestFavorites = inspectStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
      const latestCart = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
      if (latestFavorites.invalid || !includesIdentity(latestFavorites.ids) || latestCart.invalid ||
        !sameCartSelection(latestCart.lines, storedCart.lines) || !sameCartSelection(current, checked.lines)) {
        // Throw inside the callback: returning unchanged lines would still cause a store write.
        throw new Error("Save-for-later selection changed");
      }
      return after;
    });
    if (!result?.persistent) return "partial";
    const persisted = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
    return !persisted.invalid && sameCartSelection(persisted.lines, after) ? "moved" : "partial";
  } catch {
    return confirmedSaved ? "partial" : "blocked";
  }
}
