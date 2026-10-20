/** Browser interest only. Never stores editorial or ERP operational facts. */
export const FAVORITES_STORAGE_KEY = "hanapure.favorites.v1";
export const MAX_FAVORITES = 100;
export const MAX_FAVORITES_BYTES = 8_192;
export type FavoriteIds = readonly string[];
const empty: FavoriteIds = Object.freeze([]);

export function validFavoriteId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Inspect descriptors before values: getters and inherited/unexpected fields are rejected. */
function inspectIds(value: unknown): FavoriteIds | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_FAVORITES ||
      Reflect.ownKeys(value).length !== value.length + 1) return null;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !validFavoriteId(descriptor.value)) return null;
      const id: string = descriptor.value;
      if (seen.has(id.toLowerCase())) return null;
      seen.add(id.toLowerCase());
      ids.push(id);
    }
    return Object.freeze(ids);
  } catch { return null; }
}

export function inspectStoredFavorites(raw: string | null): Readonly<{ ids: FavoriteIds; invalid: boolean }> {
  if (raw === null) return { ids: empty, invalid: false };
  const rejected = { ids: empty, invalid: true };
  if (typeof raw !== "string" || !raw || raw.length > MAX_FAVORITES_BYTES) return rejected;
  try {
    const value = JSON.parse(raw);
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).sort().join(",") !== "ids,version" || value.version !== 1) return rejected;
    const ids = inspectIds(value.ids);
    return ids ? { ids, invalid: false } : rejected;
  } catch { return rejected; }
}

export function serializeFavorites(value: FavoriteIds): string {
  const ids = inspectIds(value);
  if (!ids) throw new TypeError("Invalid saved product identities");
  return JSON.stringify({ version: 1, ids });
}

/** Explicit desired state makes repeated actions idempotent; retain first-stored casing/order. */
export function setFavorite(value: FavoriteIds, publicId: string, saved: boolean): FavoriteIds {
  const ids = inspectIds(value);
  if (!ids || !validFavoriteId(publicId) || typeof saved !== "boolean") return value;
  const exists = ids.some(id => id.toLowerCase() === publicId.toLowerCase());
  if (exists === saved || (saved && ids.length >= MAX_FAVORITES)) return value;
  return Object.freeze(saved ? [...ids, publicId] : ids.filter(id => id.toLowerCase() !== publicId.toLowerCase()));
}

/** Projection is supplied by the public server reader; stale selections stay stored but invisible. */
export function savedPublishedProducts<T extends Readonly<{ publicId: string }>>(ids: FavoriteIds, products: readonly T[]): readonly T[] {
  const valid = inspectIds(ids);
  if (!valid) return [];
  return valid.flatMap(id => {
    const product = products.find(item => item.publicId.toLowerCase() === id.toLowerCase());
    return product ? [product] : [];
  });
}
