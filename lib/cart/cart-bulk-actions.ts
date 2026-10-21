"use client";

import { changeBrowserCart } from "./browser-cart";
import { CART_STORAGE_KEY, inspectStoredCart, serializeCart, validCartId, type CartLine } from "./cart-state";
import { createCartUndoPlan, sameCartSelection, type CartUndoPlan } from "./cart-undo";

type CartSnapshot = Readonly<{ lines: readonly CartLine[]; ready: boolean; persistent: boolean; invalid: boolean }>;
type Failure = "empty" | "invalid" | "conflict" | "unavailable" | "write-failed";
export type BulkRemoval = Readonly<{ status: "removed"; plan: CartUndoPlan }> | Readonly<{ status: Failure }>;

/** Identity-only, deduplicated selection; retain actual cart order and original rows. */
export function selectedCartLines(lines: readonly CartLine[], ids: readonly string[]): readonly CartLine[] | null {
  try {
    const checked = inspectStoredCart(serializeCart(lines));
    if (checked.invalid || !Array.isArray(ids) || ids.some(id => !validCartId(id))) return null;
    const identities = new Set(ids.map(id => id.toLowerCase()));
    const selected = lines.filter(line => identities.has(line.publicId.toLowerCase()));
    return selected.length === identities.size ? selected : null;
  } catch { return null; }
}

/** A copy is read-only too, but must not use an unseen changed persisted selection. */
export function readBulkSelection(cart: CartSnapshot, ids: readonly string[]):
  Readonly<{ status: "ready"; lines: readonly CartLine[] }> | Readonly<{ status: Failure }> {
  if (typeof window === "undefined" || !cart.ready || cart.invalid || !cart.persistent) return { status: "unavailable" };
  try {
    const selected = selectedCartLines(cart.lines, ids);
    if (!selected) return { status: "invalid" };
    if (!selected.length) return { status: "empty" };
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    const stored = inspectStoredCart(raw);
    if (raw === null || stored.invalid) return { status: "unavailable" };
    if (!sameCartSelection(stored.lines, cart.lines)) return { status: "conflict" };
    return { status: "ready", lines: selected };
  } catch { return { status: "unavailable" }; }
}

/** Single existing-store write, confirmed before granting its one-step Undo witness. */
export function removeSelectedCartLines(cart: CartSnapshot, ids: readonly string[]): BulkRemoval {
  const selected = readBulkSelection(cart, ids);
  if (selected.status !== "ready") return selected;
  const identities = new Set(selected.lines.map(line => line.publicId.toLowerCase()));
  const plan = createCartUndoPlan(cart.lines, cart.lines.filter(line => !identities.has(line.publicId.toLowerCase())));
  if (!plan) return { status: "invalid" };
  let refusal: Failure | null = null;
  let attempted = false;
  try {
    const result = changeBrowserCart(current => {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      const stored = inspectStoredCart(raw);
      if (raw === null || stored.invalid) refusal = "unavailable";
      else if (current !== cart.lines || !sameCartSelection(current, cart.lines) || !sameCartSelection(stored.lines, cart.lines)) refusal = "conflict";
      // Returning unchanged lines would still write: refuse inside the callback.
      if (refusal) throw new Error("Bulk cart selection changed");
      attempted = true;
      return plan.after;
    });
    if (!result) return { status: "unavailable" };
    if (!result.persistent) return { status: "write-failed" };
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    const confirmed = inspectStoredCart(raw);
    if (raw === null || confirmed.invalid || !sameCartSelection(confirmed.lines, plan.after)) return { status: "write-failed" };
    return { status: "removed", plan };
  } catch { return { status: refusal ?? (attempted ? "write-failed" : "unavailable") }; }
}
