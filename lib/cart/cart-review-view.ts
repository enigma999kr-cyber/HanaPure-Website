import type { EditorialLocale } from "../catalog/editorial-catalogue";
import { cartQuantity, reconcileCart, type CartLine } from "./cart-state";

type PublicProduct = Readonly<{ publicId: string; slug: string; brand: string;
  names: Readonly<Record<EditorialLocale, string | null>> }>;
export type CartReviewCriteria = Readonly<{ query: string; brand: string;
  sort: "original" | "name" | "quantity"; unpublishedOnly: boolean }>;
export const EMPTY_CART_REVIEW: CartReviewCriteria = Object.freeze({ query: "", brand: "", sort: "original", unpublishedOnly: false });
export const CART_REVIEW_QUERY_LIMIT = 200;
export const CART_REVIEW_BRAND_LIMIT = 100;

/** Derived public-only view; original row references and stored order never change. */
export function cartReviewView(lines: readonly CartLine[], products: readonly PublicProduct[], locale: EditorialLocale, criteria: CartReviewCriteria) {
  const all = reconcileCart(lines, products).map((item, originalIndex) => ({ ...item, originalIndex }));
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase(locale);
  const terms = normalize(criteria.query.slice(0, CART_REVIEW_QUERY_LIMIT).trim()).split(/\s+/).filter(Boolean);
  const brand = criteria.brand.slice(0, CART_REVIEW_BRAND_LIMIT);
  const rows = all.filter(({ product }) => {
    if (criteria.unpublishedOnly && product) return false;
    if (!product) return !terms.length && !brand;
    if (brand && product.brand !== brand) return false;
    const fields = [product.names[locale] ?? "", product.brand].map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  });
  const names = new Intl.Collator(locale, { sensitivity: "base" });
  if (criteria.sort === "name") rows.sort((a, b) => {
    const left = a.product?.names[locale], right = b.product?.names[locale];
    if (left && !right) return -1;
    if (!left && right) return 1;
    return (left && right ? names.compare(left, right) : 0) || a.originalIndex - b.originalIndex;
  });
  if (criteria.sort === "quantity") rows.sort((a, b) =>
    (a.line.quantity === b.line.quantity ? 0 : a.line.quantity > b.line.quantity ? -1 : 1) || a.originalIndex - b.originalIndex);
  const brands = [...new Set(all.flatMap(({ product }) => product ? [product.brand] : []))].sort(names.compare);
  return { rows, brands, total: all.length, units: cartQuantity(rows.map(({ line }) => line)),
    unpublished: rows.filter(({ product }) => !product).length, unpublishedTotal: all.filter(({ product }) => !product).length };
}

/** A navigation hint only, never proof of membership, authority or an arbitrary URL. */
export function readCartReturn(value: unknown): boolean { return value === "1"; }
