"use client";

import { useSyncExternalStore } from "react";
import { CART_STORAGE_KEY, inspectStoredCart, serializeCart, type CartLine } from "./cart-state";
import { canUndoCart, createCartUndoPlan, sameCartSelection, type CartUndoPlan } from "./cart-undo";

type Snapshot = Readonly<{ lines: readonly CartLine[]; ready: boolean; persistent: boolean; invalid: boolean }>;
const serverSnapshot: Snapshot = { lines: [], ready: false, persistent: true, invalid: false };
let snapshot = serverSnapshot;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
function readStorage() {
  try { snapshot = { ...inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)), ready: true, persistent: true }; }
  catch { snapshot = { ...snapshot, ready: true, persistent: false }; }
  emit();
}
function storageChanged(event: StorageEvent) {
  if (event.key === CART_STORAGE_KEY || event.key === null) readStorage();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    // Browser reads start only after hydration; SSR never touches storage.
    if (!snapshot.ready || snapshot.persistent) readStorage();
    window.addEventListener("storage", storageChanged);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
}
export function useBrowserCart() {
  return useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
}
export function changeBrowserCart(change: (lines: readonly CartLine[]) => readonly CartLine[]) {
  // Malformed persisted data requires an explicit reset, never a silent overwrite.
  if (snapshot.invalid) return null;
  return saveSelection(change(snapshot.lines));
}
export function resetBrowserCart() {
  // Explicit corrupt-storage recovery only; do not overwrite a newly changed cart.
  if (!snapshot.ready || !snapshot.invalid) return false;
  try {
    const before = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!inspectStoredCart(before).invalid || window.localStorage.getItem(CART_STORAGE_KEY) !== before) return false;
    const empty = serializeCart([]);
    window.localStorage.setItem(CART_STORAGE_KEY, empty);
    if (window.localStorage.getItem(CART_STORAGE_KEY) !== empty) throw new Error("Reset not confirmed");
    snapshot = { lines: [], ready: true, persistent: true, invalid: false };
    emit();
    return true;
  } catch {
    snapshot = { ...snapshot, persistent: false };
    emit();
    return false;
  }
}
/** No atomic cross-tab CAS is available: keep the final read and write synchronous and adjacent. */
export function restoreBrowserCart(plan: CartUndoPlan): "restored" | "changed" | "unavailable" {
  if (!snapshot.ready || snapshot.invalid || !snapshot.persistent || !createCartUndoPlan(plan.before, plan.after)) return "unavailable";
  if (!canUndoCart(plan, snapshot.lines)) return "changed";
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw === null) return "unavailable";
    const stored = inspectStoredCart(raw);
    if (stored.invalid) return "unavailable";
    if (!sameCartSelection(stored.lines, plan.after)) return "changed";
    window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(plan.before));
  } catch {
    snapshot = { ...snapshot, persistent: false };
    emit();
    return "unavailable";
  }
  snapshot = { lines: plan.before, ready: true, persistent: true, invalid: false };
  emit();
  return "restored";
}
function saveSelection(lines: readonly CartLine[]) {
  // Storage can be blocked; keep the current tab usable without promising persistence.
  let persistent = true;
  try { window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(lines)); }
  catch { persistent = false; }
  snapshot = { lines, ready: true, persistent, invalid: false };
  emit();
  return { persistent };
}
