"use client";

import { useSyncExternalStore } from "react";
import { CART_STORAGE_KEY, parseCart, serializeCart, type CartLine } from "./cart-state";

type Snapshot = Readonly<{ lines: readonly CartLine[]; ready: boolean; persistent: boolean }>;
const serverSnapshot: Snapshot = { lines: [], ready: false, persistent: true };
let snapshot = serverSnapshot;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
function readStorage() {
  try { snapshot = { lines: parseCart(window.localStorage.getItem(CART_STORAGE_KEY)), ready: true, persistent: true }; }
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
  // Storage can be blocked; keep the current tab usable without promising persistence.
  const lines = change(snapshot.lines);
  let persistent = true;
  try { window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(lines)); }
  catch { persistent = false; }
  snapshot = { lines, ready: true, persistent };
  emit();
}
