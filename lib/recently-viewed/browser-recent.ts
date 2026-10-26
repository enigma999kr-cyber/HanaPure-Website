"use client";

import { useSyncExternalStore } from "react";
import { RECENT_STORAGE_KEY, inspectStoredRecent, serializeRecent, recordRecent, clearRecent, removeRecent, validRecentId, type RecentIds } from "./recent-state";

type Snapshot = Readonly<{ ids: RecentIds; ready: boolean; persistent: boolean; invalid: boolean }>;
const serverSnapshot: Snapshot = Object.freeze({ ids: Object.freeze([]), ready: false, persistent: true, invalid: false });
let snapshot = serverSnapshot;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
function readStorage() {
  try {
    snapshot = { ...inspectStoredRecent(window.localStorage.getItem(RECENT_STORAGE_KEY)), ready: true, persistent: true };
  } catch { snapshot = { ids: [], ready: true, persistent: false, invalid: false }; }
  emit();
}
function storageChanged(event: StorageEvent) {
  if (event.key === RECENT_STORAGE_KEY || event.key === null) readStorage();
}
function subscribe(listener: () => void) {
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
export function useBrowserRecent() {
  return useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
}
/** Read-only witness for explicit actions; does not read or change persisted history. */
export function getRecentSnapshot() { return snapshot; }
/** A successful write only; a repeated newest visit is a deliberate no-op. */
export function recordRecentVisit(publicId: string): boolean {
  if (!validRecentId(publicId)) return false;
  // Merge the latest persisted history before writing; localStorage has no atomic cross-tab CAS.
  readStorage();
  if (!snapshot.persistent || snapshot.invalid) return false;
  const ids = recordRecent(snapshot.ids, publicId);
  return ids === snapshot.ids ? false : save(ids);
}
export function clearBrowserRecent(): boolean {
  readStorage();
  if (!snapshot.persistent || (!snapshot.invalid && snapshot.ids.length === 0)) return false;
  // Explicit clear/reset is the only operation allowed to replace malformed history.
  const ids = clearRecent();
  try {
    const cleared = serializeRecent(ids);
    window.localStorage.setItem(RECENT_STORAGE_KEY, cleared);
    if (window.localStorage.getItem(RECENT_STORAGE_KEY) !== cleared) throw new Error("Recent clear not confirmed");
  } catch {
    snapshot = { ...snapshot, persistent: false };
    emit();
    return false;
  }
  snapshot = { ids, ready: true, persistent: true, invalid: false };
  emit();
  return true;
}
export function removeBrowserRecent(publicId: string, expected: RecentIds): "removed" | "unchanged" | "conflict" | "unavailable" | "write-failed" {
  if (typeof window === "undefined" || !snapshot.ready || !snapshot.persistent || snapshot.invalid || !validRecentId(publicId)) return "unavailable";
  if (snapshot.ids !== expected) return "conflict";
  const same = (left: RecentIds, right: RecentIds) => left.length === right.length && left.every((id, index) => id === right[index]);
  try {
    const stored = inspectStoredRecent(window.localStorage.getItem(RECENT_STORAGE_KEY));
    if (stored.invalid) return "unavailable";
    if (!same(stored.ids, expected)) { readStorage(); return "conflict"; }
    const after = removeRecent(expected, publicId);
    if (after === expected) return "unchanged";
    const latest = inspectStoredRecent(window.localStorage.getItem(RECENT_STORAGE_KEY));
    if (latest.invalid) return "unavailable";
    if (snapshot.ids !== expected || !same(latest.ids, expected)) return "conflict";
    if (!save(after)) return "write-failed";
    const confirmedRaw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    const confirmed = inspectStoredRecent(confirmedRaw);
    if (confirmedRaw === null || confirmed.invalid || !same(confirmed.ids, after)) throw new Error("Recent removal confirmation failed");
    return "removed";
  } catch {
    snapshot = { ids: [], ready: true, persistent: false, invalid: false }; emit();
    return "write-failed";
  }
}
function save(ids: RecentIds): boolean {
  try { window.localStorage.setItem(RECENT_STORAGE_KEY, serializeRecent(ids)); }
  catch {
    snapshot = { ...snapshot, persistent: false };
    emit();
    return false;
  }
  snapshot = { ids, ready: true, persistent: true, invalid: false };
  emit();
  return true;
}
