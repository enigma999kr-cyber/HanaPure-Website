"use client";

import { changeBrowserCart } from "./browser-cart";
import { CART_STORAGE_KEY, inspectStoredCart, serializeCart, updateCartLine, validCartId, validQuantity, type CartLine } from "./cart-state";
import { sameCartSelection } from "./cart-undo";
import { parseQuickAddQuantity } from "./quick-add-quantity";

export type DetailCartSnapshot = Readonly<{ lines: readonly CartLine[]; ready: boolean; persistent: boolean; invalid: boolean }>;
export type DetailSelectionResult = "updated" | "unchanged" | "invalid" | "conflict" | "unavailable" | "write-failed";

export function detailSelectionNeedsReload(result: DetailSelectionResult): boolean {
  return result === "write-failed" || result === "conflict" || result === "unavailable";
}

/** Display only a valid, persistent browser selection; never an inventory fact. */
export function detailCartQuantity(publicId: string, cart: DetailCartSnapshot, trusted = true): number | null {
  if (!trusted || !validCartId(publicId) || !cart.ready || cart.invalid || !cart.persistent) return null;
  const line = cart.lines.find(item => item.publicId.toLowerCase() === publicId.toLowerCase());
  return line && validQuantity(line.quantity) ? line.quantity : null;
}

/** Best-effort full-selection guards; localStorage has no atomic cross-tab CAS. */
export function setDetailCartQuantity(publicId: string, rawQuantity: string, cart: DetailCartSnapshot): DetailSelectionResult {
  const quantity = parseQuickAddQuantity(rawQuantity);
  if (quantity === null || !validCartId(publicId)) return "invalid";
  if (typeof window === "undefined" || !cart.ready || cart.invalid || !cart.persistent) return "unavailable";
  let refusal: DetailSelectionResult | null = null;
  let attempted = false;
  try {
    const expected = inspectStoredCart(serializeCart(cart.lines));
    if (expected.invalid) return "unavailable";
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw === null) return "unavailable";
    const stored = inspectStoredCart(raw);
    if (stored.invalid) return "unavailable";
    if (!sameCartSelection(stored.lines, expected.lines)) return "conflict";
    const existing = stored.lines.find(line => line.publicId.toLowerCase() === publicId.toLowerCase());
    if (!existing) return "conflict";
    if (existing.quantity === quantity) return "unchanged";
    const after = updateCartLine(stored.lines, publicId, quantity);
    const result = changeBrowserCart(current => {
      const latestRaw = window.localStorage.getItem(CART_STORAGE_KEY);
      const latest = inspectStoredCart(latestRaw);
      if (latestRaw === null || latest.invalid) refusal = "unavailable";
      else if (current !== cart.lines || !sameCartSelection(current, expected.lines) ||
        !sameCartSelection(latest.lines, stored.lines) || !current.some(line => line.publicId.toLowerCase() === publicId.toLowerCase())) refusal = "conflict";
      // Returning the unchanged array would still write through the existing store.
      if (refusal) throw new Error("Detail cart selection guard refused mutation");
      attempted = true;
      return after;
    });
    if (!result) return "unavailable";
    if (!result.persistent) return "write-failed";
    const confirmedRaw = window.localStorage.getItem(CART_STORAGE_KEY);
    const confirmed = inspectStoredCart(confirmedRaw);
    return confirmedRaw !== null && !confirmed.invalid && sameCartSelection(confirmed.lines, after) ? "updated" : "write-failed";
  } catch {
    return refusal ?? (attempted ? "write-failed" : "unavailable");
  }
}
