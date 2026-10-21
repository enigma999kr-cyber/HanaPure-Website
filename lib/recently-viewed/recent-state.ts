/** Browser-local visits contain identities only, newest first. */
export const RECENT_STORAGE_KEY = "hanapure.recentlyViewed.v1";
export const MAX_RECENT = 8;
export const MAX_RECENT_BYTES = 1_024;
export type RecentIds = readonly string[];
const empty: RecentIds = Object.freeze([]);

export function validRecentId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function inspectIds(value: unknown): RecentIds | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_RECENT ||
      Reflect.ownKeys(value).length !== value.length + 1) return null;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const field = Object.getOwnPropertyDescriptor(value, String(index));
      if (!field || !Object.hasOwn(field, "value") || !validRecentId(field.value)) return null;
      const id: string = field.value;
      if (seen.has(id.toLowerCase())) return null;
      seen.add(id.toLowerCase());
      ids.push(id);
    }
    return Object.freeze(ids);
  } catch { return null; }
}
export function inspectStoredRecent(raw: string | null): Readonly<{ ids: RecentIds; invalid: boolean }> {
  if (raw === null) return { ids: empty, invalid: false };
  const rejected = { ids: empty, invalid: true };
  if (typeof raw !== "string" || !raw || raw.length > MAX_RECENT_BYTES) return rejected;
  try {
    if (new TextEncoder().encode(raw).byteLength > MAX_RECENT_BYTES) return rejected;
    const value = JSON.parse(raw);
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).sort().join(",") !== "ids,version" || value.version !== 1) return rejected;
    const ids = inspectIds(value.ids);
    return ids ? { ids, invalid: false } : rejected;
  } catch { return rejected; }
}
export function serializeRecent(ids: RecentIds): string {
  const valid = inspectIds(ids);
  if (!valid) throw new TypeError("Invalid recently viewed identities");
  return JSON.stringify({ version: 1, ids: valid });
}
export function recordRecent(ids: RecentIds, publicId: string): RecentIds {
  const valid = inspectIds(ids);
  if (!valid || !validRecentId(publicId) || valid[0]?.toLowerCase() === publicId.toLowerCase()) return ids;
  const stored = valid.find(id => id.toLowerCase() === publicId.toLowerCase());
  return Object.freeze([stored ?? publicId, ...valid.filter(id => id.toLowerCase() !== publicId.toLowerCase())].slice(0, MAX_RECENT));
}
export function clearRecent(): RecentIds { return empty; }
export function removeRecent(ids: RecentIds, publicId: string): RecentIds {
  const valid = inspectIds(ids);
  if (!valid || !validRecentId(publicId) || !valid.some(id => id.toLowerCase() === publicId.toLowerCase())) return ids;
  return Object.freeze(valid.filter(id => id.toLowerCase() !== publicId.toLowerCase()));
}
export function recentPublishedProducts<T extends Readonly<{ publicId: string }>>(ids: RecentIds, products: readonly T[]): readonly T[] {
  const valid = inspectIds(ids);
  if (!valid) return [];
  return valid.flatMap(id => {
    const product = products.find(item => item.publicId.toLowerCase() === id.toLowerCase());
    return product ? [product] : [];
  });
}
