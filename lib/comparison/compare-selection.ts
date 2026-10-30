import type { EditorialImage } from "../catalog/editorial-catalogue";

/** Selected-locale editorial projection only; the caller supplies published records. */
export type ComparisonProduct = Readonly<{
  publicId: string;
  slug: string;
  brand: string;
  name: string | null;
  description: string | null;
  usage: string | null;
  caution: string | null;
  image?: EditorialImage | null;
}>;

const identity = (value: unknown): string | null => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;

/** Canonical first occurrences only: mixed-case aliases cannot become a second choice. */
export function comparisonOptions<T extends Readonly<{ publicId: string }>>(products: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return products.filter(product => {
    const id = identity(product.publicId);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Unknown/stale selections fall back deterministically to two distinct public options. */
export function resolveComparison<T extends Readonly<{ publicId: string }>>(
  products: readonly T[], first?: unknown, second?: unknown,
): readonly [T, T] | null {
  const options = comparisonOptions(products);
  if (options.length < 2) return null;
  const left = options.find(product => identity(product.publicId) === identity(first)) ?? options[0];
  const remaining = options.filter(product => identity(product.publicId) !== identity(left.publicId));
  const right = remaining.find(product => identity(product.publicId) === identity(second)) ?? remaining[0];
  return [left, right];
}

export type ComparisonContext = Readonly<{ first?: string; second?: string }>;
export const COMPARISON_DESTINATION = "catalogue-comparison";

/** Repeated/partial-invalid pairs are rejected as a whole, never partly restored. */
export function readComparisonContext(params: Readonly<Record<string, unknown>> = {}): ComparisonContext {
  const first = identity(params.compareFirst);
  const second = identity(params.compareSecond);
  if (!first || (params.compareSecond !== undefined && (!second || second === first))) return {};
  return second ? { first, second } : { first };
}

/** Only the caller's current published projection can admit a URL hint. */
export function publishedComparison<T extends Readonly<{ publicId: string }>>(
  products: readonly T[], context: ComparisonContext,
): readonly [T, T] | null {
  const options = comparisonOptions(products);
  const first = identity(context.first), second = identity(context.second);
  if (!first || !options.some(product => identity(product.publicId) === first) ||
    (context.second !== undefined && (!second || first === second || !options.some(product => identity(product.publicId) === second)))) return null;
  return resolveComparison(options, first, second);
}

/** Transport only. Search criteria arrive from the existing catalogue serializer. */
export function comparisonHref(path: string, pair: readonly [{ publicId: string }, { publicId: string }], catalogueQuery = ""): string | null {
  if (!/^\/(?:(?:en|hu|ko)\/)?products(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(path) || catalogueQuery.length > 8192) return null;
  const first = identity(pair[0].publicId), second = identity(pair[1].publicId);
  if (!first || !second || first === second) return null;
  const source = new URLSearchParams(catalogueQuery);
  // A refused parent context must not become a shorter, apparently valid pair URL.
  if ([...source.keys()].some(key => !["q", "brand", "sort", "view", "compareFirst", "compareSecond"].includes(key)) ||
    (source.has("view") && (source.getAll("view").length !== 1 || source.get("view") !== "list"))) return null;
  const params = new URLSearchParams();
  for (const key of ["q", "brand", "sort"]) {
    const values = source.getAll(key);
    if (values.length === 1 && values[0] && (key !== "sort" || values[0] === "name-asc" || values[0] === "name-desc")) params.set(key, values[0]);
  }
  if (source.getAll("view").length === 1 && source.get("view") === "list") params.set("view", "list");
  params.set("compareFirst", first); params.set("compareSecond", second);
  const href = `${path}?${params}`;
  return href.length <= 8192 ? href : null;
}

/** No origin inferred from editorial data, arbitrary redirects, or private browser state. */
export function comparisonShareLink(relativeHref: string, origin: string, products: readonly ComparisonProduct[]): string | null {
  try {
    const base = new URL(origin);
    if (!/^https?:$/.test(base.protocol) || base.href !== `${base.origin}/` || relativeHref.length > 8192) return null;
    const url = new URL(relativeHref, base.origin);
    if (url.origin !== base.origin || url.username || url.password ||
      !/^\/(?:(?:en|hu|ko)\/)?products$/.test(url.pathname) || url.hash !== `#${COMPARISON_DESTINATION}`) return null;
    const context = readComparisonContext(Object.fromEntries([...url.searchParams.keys()].map(key =>
      [key, url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : url.searchParams.getAll(key)])));
    const pair = context.second ? publishedComparison(products, context) : null;
    if (!pair || `${comparisonHref(url.pathname, pair, url.search)}#${COMPARISON_DESTINATION}` !== relativeHref) return null;
    return url.href;
  } catch { return null; }
}

/** Literal editorial text only; unknown is not cosmetic/medical equivalence. */
export function comparisonFieldState(left: string | null, right: string | null): "same" | "different" | "unknown" {
  if (!left?.trim() || !right?.trim()) return "unknown";
  return left === right ? "same" : "different";
}
