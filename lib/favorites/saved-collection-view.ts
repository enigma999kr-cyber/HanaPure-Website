import { savedPublishedProducts, serializeFavorites, validFavoriteId, type FavoriteIds } from "./favorite-state";
import { resolveComparison, type ComparisonProduct } from "../comparison/compare-selection";

export type SavedViewProduct = Readonly<{ publicId: string; slug: string; name: string; brand: string }>;
export type SavedView = Readonly<{ query: string; brand: string; sort: "saved" | "name-asc" | "name-desc" }>;
export const emptySavedView: SavedView = { query: "", brand: "", sort: "saved" };
export function normalizeSavedSearch(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 200).toLowerCase();
}
/** Only the complete public projection supplied by the server can supply rows/options. */
export function savedCollectionView(ids: FavoriteIds, products: readonly SavedViewProduct[], view: SavedView, locale: string) {
  const saved = savedPublishedProducts(ids, products);
  const brands = [...new Set(saved.map(product => product.brand))];
  const query = normalizeSavedSearch(view.query);
  const rows = saved.filter(product => (!view.brand || product.brand.toLowerCase() === view.brand.toLowerCase()) &&
    (!query || normalizeSavedSearch(`${product.name} ${product.brand} ${product.slug}`).includes(query)));
  if (view.sort === "name-asc" || view.sort === "name-desc") {
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    const positions = new Map(saved.map((product, index) => [product.publicId.toLowerCase(), index]));
    rows.sort((left, right) => (view.sort === "name-desc" ? -1 : 1) * collator.compare(left.name, right.name) ||
      positions.get(left.publicId.toLowerCase())! - positions.get(right.publicId.toLowerCase())!);
  }
  return { rows, brands, total: saved.length };
}
/** Unlike the general comparison UI, this entry must never fall back to unselected products. */
export function savedComparisonPair(ids: FavoriteIds, saved: FavoriteIds, visible: readonly SavedViewProduct[], products: readonly ComparisonProduct[]) {
  try {
    serializeFavorites(saved);
    if (!Array.isArray(ids) || ids.some(id => !validFavoriteId(id))) return null;
    const selected = [...new Set(ids.map(id => id.toLowerCase()))];
    if (selected.length !== 2 || selected.some(id => !saved.some(value => value.toLowerCase() === id) ||
      !visible.some(product => product.publicId.toLowerCase() === id))) return null;
    const exact = selected.map(id => products.find(product => product.publicId.toLowerCase() === id));
    if (!exact[0] || !exact[1]) return null;
    return resolveComparison([exact[0], exact[1]], selected[0], selected[1]);
  } catch { return null; }
}
