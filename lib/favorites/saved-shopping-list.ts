import type { EditorialLocale } from "../catalog/editorial-catalogue";
import { formatCartShoppingList, type ShoppingListResult } from "../cart/cart-shopping-list";
import { serializeFavorites, validFavoriteId, type FavoriteIds } from "./favorite-state";
import type { SavedViewProduct } from "./saved-collection-view";

/** Caller validates the fresh persisted snapshot; one unit denotes saved interest, not cart quantity. */
export function savedShoppingList(saved: FavoriteIds, ids: FavoriteIds, visible: readonly SavedViewProduct[], locale: EditorialLocale): ShoppingListResult {
  try {
    serializeFavorites(saved);
    if (!Array.isArray(ids) || ids.some(id => !validFavoriteId(id))) return { status: "invalid" };
    const selected = new Set(ids.map(id => id.toLowerCase()));
    if ([...selected].some(id => !saved.some(value => value.toLowerCase() === id))) return { status: "invalid" };
    const rows = visible.filter(product => selected.has(product.publicId.toLowerCase()));
    if (rows.length !== selected.size) return { status: "invalid" };
    return formatCartShoppingList(rows.map(product => ({ publicId: product.publicId, quantity: 1 })), rows.map(product => ({
      publicId: product.publicId, slug: product.slug, brand: product.brand,
      names: { en: locale === "en" ? product.name : null, hu: locale === "hu" ? product.name : null, ko: locale === "ko" ? product.name : null },
    })), locale);
  } catch { return { status: "invalid" }; }
}
