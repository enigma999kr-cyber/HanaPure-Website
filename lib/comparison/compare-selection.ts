/** Selected-locale editorial projection only; the caller supplies published records. */
export type ComparisonProduct = Readonly<{
  publicId: string;
  slug: string;
  brand: string;
  name: string | null;
  description: string | null;
  usage: string | null;
  caution: string | null;
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
