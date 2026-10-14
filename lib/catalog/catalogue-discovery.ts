import "server-only";

import type { EditorialLocale } from "./editorial-catalogue";
import type { localCatalogue } from "./local-catalogue";

export type CatalogueSearchParams = Record<string, string | string[] | undefined>;
export type CatalogueSort = "name-asc" | "name-desc";
export type CatalogueCriteria = Readonly<{ query: string; brand: string; sort?: CatalogueSort }>;
function validSort(value: unknown): value is CatalogueSort {
  return value === "name-asc" || value === "name-desc";
}

/** Publication only, independent of locale/search and never a stock assertion. */
export function publishedCatalogueBrands(catalogue: typeof localCatalogue) {
  return [...new Set(catalogue.listPublished().map(product => product.brand))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en"));
}

/** q/brand retain first-value handling; ambiguous repeated sort defaults safely. */
export function readCatalogueCriteria(params: CatalogueSearchParams = {}): CatalogueCriteria {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const sort = Array.isArray(params.sort) ? (params.sort.length === 1 ? params.sort[0] : undefined) : params.sort;
  return { query: first(params.q).trim(), brand: first(params.brand).trim(),
    ...(validSort(sort) ? { sort } : {}) };
}

export function catalogueQueryString(criteria: CatalogueCriteria): string {
  const params = new URLSearchParams();
  if (criteria.query) params.set("q", criteria.query);
  if (criteria.brand) params.set("brand", criteria.brand);
  if (validSort(criteria.sort)) params.set("sort", criteria.sort);
  const value = params.toString();
  return value ? `?${value}` : "";
}

/** Derive results from the existing public reader; never index drafts or operational data. */
export function discoverCatalogue(catalogue: typeof localCatalogue, locale: EditorialLocale,
  criteria: CatalogueCriteria) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const terms = normalize(criteria.query.trim()).split(/\s+/).filter(Boolean);
  const results = catalogue.listPublished().filter((product) => {
    if (criteria.brand && product.brand !== criteria.brand) return false;
    const content = product.translations[locale];
    // Missing translations contribute no text. Brand identity remains searchable.
    const fields = [product.brand, content?.name ?? "", content?.description ?? ""].map(normalize);
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
  if (!validSort(criteria.sort)) return results;
  const names = new Intl.Collator(locale, { sensitivity: "base" });
  const stable = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  // filter creates a new array. Missing selected-locale names stay last in both
  // directions; equal names use immutable slug/publicId ascending, never EN fallback.
  return results.sort((a, b) => {
    const left = a.translations[locale]?.name;
    const right = b.translations[locale]?.name;
    if (left === undefined && right !== undefined) return 1;
    if (left !== undefined && right === undefined) return -1;
    const comparison = left !== undefined && right !== undefined ? names.compare(left, right) : 0;
    return (criteria.sort === "name-desc" ? -comparison : comparison) ||
      stable(a.slug, b.slug) || stable(a.publicId, b.publicId);
  });
}
