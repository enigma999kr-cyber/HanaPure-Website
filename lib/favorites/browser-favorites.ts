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

export type FavoriteChangeResult = "updated" | "unchanged" | "unavailable" | "write-failed" | "unconfirmed";
export function changeBrowserFavorite(publicId: string, saved: boolean): boolean {
  return changeBrowserFavoriteResult(publicId, saved) === "updated";
}
/** Detailed result keeps cross-key callers honest about an unconfirmed write. */
export function changeBrowserFavoriteResult(publicId: string, saved: boolean): FavoriteChangeResult {
  if (typeof window === "undefined") return "unavailable";
  // Re-read immediately before writing, including changes from another tab.
  readStorage();
  if (!snapshot.persistent || snapshot.invalid) return "unavailable";
  const ids = setFavorite(snapshot.ids, publicId, saved);
  if (ids === snapshot.ids) return "unchanged";
  return save(ids);
}
export function resetBrowserFavorites(): boolean {
  if (typeof window === "undefined" || !snapshot.ready) return false;
  const recovering = snapshot.invalid;
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    snapshot = { ...inspectStoredFavorites(raw), ready: true, persistent: true };
    emit();
    // A stale corrupt-state Reset must not erase another tab's valid recovery.
    if (recovering && !snapshot.invalid) return false;
    if (window.localStorage.getItem(FAVORITES_STORAGE_KEY) !== raw) { readStorage(); return false; }
    return save([]) === "updated";
  } catch {
    // Keep the known recovery state so a read denial never removes its retry.
    snapshot = { ...snapshot, persistent: false }; emit();
    return false;
  }
}
export function sameFavoriteIds(left: FavoriteIds, right: FavoriteIds): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
/** Guarded bulk path retains full snapshot witnesses and post-write confirmation. */
export function mutateBrowserFavorites(expected: FavoriteIds, change: (ids: FavoriteIds) => FavoriteIds):
  "updated" | "unchanged" | "conflict" | "unavailable" | "write-failed" | "unconfirmed" {
  if (typeof window === "undefined" || !snapshot.ready || !snapshot.persistent || snapshot.invalid) return "unavailable";
  if (snapshot.ids !== expected) return "conflict";
  let written = false;
  try {
    const stored = inspectStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
    if (stored.invalid) return "unavailable";
    if (!sameFavoriteIds(stored.ids, expected)) { readStorage(); return "conflict"; }
    const after = change(expected);
    const serialized = serializeFavorites(after);
    const latest = inspectStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
    if (latest.invalid) return "unavailable";
    if (snapshot.ids !== expected || !sameFavoriteIds(latest.ids, expected)) return "conflict";
    if (sameFavoriteIds(after, expected)) return "unchanged";
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, serialized);
    written = true;
    const confirmedRaw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    const confirmed = inspectStoredFavorites(confirmedRaw);
    if (confirmedRaw === null || confirmed.invalid || !sameFavoriteIds(confirmed.ids, after)) throw new Error("Favorites confirmation failed");
    snapshot = { ids: confirmed.ids, ready: true, persistent: true, invalid: false };
    emit();
    return "updated";
  } catch {
    snapshot = { ids: [], ready: true, persistent: false, invalid: false }; emit();
    return written ? "unconfirmed" : "write-failed";
  }
}
function save(ids: FavoriteIds): "updated" | "write-failed" | "unconfirmed" {
  let written = false;
  try {
    const serialized = serializeFavorites(ids);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, serialized);
    written = true;
    if (window.localStorage.getItem(FAVORITES_STORAGE_KEY) !== serialized) throw new Error("Favorite write not confirmed");
  }
  catch {
    snapshot = { ...snapshot, persistent: false };
    emit();
    return written ? "unconfirmed" : "write-failed";
  }
  snapshot = { ids, ready: true, persistent: true, invalid: false };
  emit();
  return "updated";
}
