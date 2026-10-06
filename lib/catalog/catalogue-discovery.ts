import "server-only";

import type { EditorialLocale } from "./editorial-catalogue";
import type { localCatalogue } from "./local-catalogue";

export type CatalogueSearchParams = Record<string, string | string[] | undefined>;
export type CatalogueCriteria = Readonly<{ query: string; brand: string }>;

/** Repeated query parameters consistently use their first value. */
export function readCatalogueCriteria(params: CatalogueSearchParams = {}): CatalogueCriteria {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  return { query: first(params.q).trim(), brand: first(params.brand).trim() };
}

export function catalogueQueryString(criteria: CatalogueCriteria): string {
  const params = new URLSearchParams();
  if (criteria.query) params.set("q", criteria.query);
  if (criteria.brand) params.set("brand", criteria.brand);
  const value = params.toString();
  return value ? `?${value}` : "";
}

/** Derive results from the existing public reader; never index drafts or operational data. */
export function discoverCatalogue(catalogue: typeof localCatalogue, locale: EditorialLocale,
  criteria: CatalogueCriteria) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const terms = normalize(criteria.query.trim()).split(/\s+/).filter(Boolean);
  return catalogue.listPublished().filter((product) => {
    if (criteria.brand && product.brand !== criteria.brand) return false;
    const content = product.translations[locale];
    // Missing translations contribute no text. Brand identity remains searchable.
    const fields = [product.brand, content?.name ?? "", content?.description ?? ""].map(normalize);
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}
