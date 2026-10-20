"use client";

import { useSyncExternalStore } from "react";
import { RECENT_STORAGE_KEY, inspectStoredRecent, serializeRecent, recordRecent, clearRecent, validRecentId, type RecentIds } from "./recent-state";

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
  return save(clearRecent());
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
