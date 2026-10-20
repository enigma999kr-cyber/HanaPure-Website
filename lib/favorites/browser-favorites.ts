"use client";

import { useSyncExternalStore } from "react";
import { FAVORITES_STORAGE_KEY, inspectStoredFavorites, serializeFavorites, setFavorite, type FavoriteIds } from "./favorite-state";

type Snapshot = Readonly<{ ids: FavoriteIds; ready: boolean; persistent: boolean; invalid: boolean }>;
const serverSnapshot: Snapshot = Object.freeze({ ids: Object.freeze([]), ready: false, persistent: true, invalid: false });
let snapshot = serverSnapshot;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
export function getFavoriteSnapshot() { return snapshot; }
export function getServerFavoriteSnapshot() { return serverSnapshot; }

function readStorage() {
  try {
    snapshot = { ...inspectStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY)), ready: true, persistent: true };
  } catch {
    // Do not expose stale saved confirmations when storage cannot be read.
    snapshot = { ids: [], ready: true, persistent: false, invalid: false };
  }
  emit();
}
function storageChanged(event: StorageEvent) {
  if (event.key === FAVORITES_STORAGE_KEY || event.key === null) readStorage();
}
export function subscribeFavorites(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    readStorage();
    window.addEventListener("storage", storageChanged);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
}
export function useBrowserFavorites() {
  return useSyncExternalStore(subscribeFavorites, getFavoriteSnapshot, getServerFavoriteSnapshot);
}

export function changeBrowserFavorite(publicId: string, saved: boolean): boolean {
  // Re-read immediately before writing, including changes from another tab.
  readStorage();
  if (!snapshot.persistent || snapshot.invalid) return false;
  const ids = setFavorite(snapshot.ids, publicId, saved);
  if (ids === snapshot.ids) return false;
  return save(ids);
}
export function resetBrowserFavorites(): boolean { return save([]); }
function save(ids: FavoriteIds): boolean {
  try { window.localStorage.setItem(FAVORITES_STORAGE_KEY, serializeFavorites(ids)); }
  catch {
    snapshot = { ...snapshot, persistent: false };
    emit();
    return false;
  }
  snapshot = { ids, ready: true, persistent: true, invalid: false };
  emit();
  return true;
}
