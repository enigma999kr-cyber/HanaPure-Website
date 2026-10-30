import type { EditorialLocale, EditorialProduct } from "./editorial-catalogue";
import { comparisonOptions } from "../comparison/compare-selection";

export const CATALOGUE_PAGE_SIZE = 12;
export type CatalogueBrowse = Readonly<{ page: number; pageSpecified: boolean; withLocaleInfo: boolean; withLocaleImage: boolean; pickFirst?: string; view?: "list" }>;
const publicIdentity = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/** Repeated/noncanonical/oversize presentation parameters never broaden authority. */
export function readCatalogueBrowse(params: Readonly<Record<string, unknown>> = {}): CatalogueBrowse {
  const raw = params.page;
  const pageSpecified = typeof raw === "string" && /^[1-9][0-9]{0,5}$/.test(raw);
  return { page: pageSpecified ? Number(raw) : 1, pageSpecified,
    ...(params.view === "list" ? { view: "list" as const } : {}),
    withLocaleInfo: params.withLocaleInfo === "1", withLocaleImage: params.withLocaleImage === "1",
    ...(publicIdentity(params.pickFirst) ? { pickFirst: params.pickFirst } : {}) };
}

/** Existing discovery runs first; only selected-locale presence is refined here. */
export function catalogueResultPage(results: readonly EditorialProduct[], locale: EditorialLocale, browse: CatalogueBrowse) {
  const all = comparisonOptions(results).filter(product => {
    const content = product.translations[locale];
    return (!browse.withLocaleInfo || content != null) && (!browse.withLocaleImage || Boolean(content?.images.length));
  });
  const pages = Math.max(1, Math.ceil(all.length / CATALOGUE_PAGE_SIZE));
  const requested = Number.isSafeInteger(browse.page) && browse.page > 0 ? browse.page : 1;
  const page = Math.min(requested, pages), offset = (page - 1) * CATALOGUE_PAGE_SIZE;
  return { all, items: all.slice(offset, offset + CATALOGUE_PAGE_SIZE), page, pages, total: all.length,
    from: all.length ? offset + 1 : 0, to: Math.min(offset + CATALOGUE_PAGE_SIZE, all.length) };
}

/** Receives the CLOSED q/brand/sort serializer; never changes its semantics. */
export function catalogueBrowseQuery(query: string, browse: CatalogueBrowse, forcePage = false): string | null {
  if (query.length > 8192) return null;
  const source = new URLSearchParams(query), params = new URLSearchParams();
  for (const key of ["q", "brand", "sort"]) {
    const values = source.getAll(key);
    if (values.length === 1 && values[0] && (key !== "sort" || values[0] === "name-asc" || values[0] === "name-desc")) params.set(key, values[0]);
  }
  if (browse.withLocaleInfo) params.set("withLocaleInfo", "1");
  if (browse.view === "list") params.set("view", "list");
  if (browse.withLocaleImage) params.set("withLocaleImage", "1");
  const page = Number.isSafeInteger(browse.page) && browse.page > 0 && browse.page <= 999999 ? browse.page : 1;
  if (page > 1 || forcePage) params.set("page", String(page));
  if (publicIdentity(browse.pickFirst)) params.set("pickFirst", browse.pickFirst);
  const value = params.toString(), result = value ? `?${value}` : "";
  return result.length <= 8192 ? result : null;
}

export function catalogueCardId(publicId: string): string | null {
  return publicIdentity(publicId.toLowerCase()) ? `catalogue-result-${publicId.toLowerCase()}` : null;
}

export function catalogueBrowseHref(path: string, query: string, browse: CatalogueBrowse, options: { forcePage?: boolean; card?: string } = {}): string | null {
  if (!/^\/(?:(?:en|hu|ko)\/)?products(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(path)) return null;
  const suffix = catalogueBrowseQuery(query, browse, options.forcePage);
  if (suffix === null) return null;
  const card = options.card ? catalogueCardId(options.card) : null;
  if (options.card && !card) return null;
  const href = path + suffix + (card ? `#${card}` : "");
  return href.length <= 8192 ? href : null;
}
