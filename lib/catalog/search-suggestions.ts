/** Published-only, selected-locale editorial projection supplied by the server. */
export type SearchSuggestionProduct = Readonly<{
  publicId: string;
  slug: string;
  brand: string;
  name: string | null;
  description: string | null;
}>;
export const MAX_SEARCH_SUGGESTIONS = 5;
/** Suggestions can decline oversized input; native GET search still accepts the original value. */
export const MAX_SUGGESTION_QUERY_LENGTH = 4_096;

export function searchSuggestions(products: readonly SearchSuggestionProduct[], query: unknown): readonly SearchSuggestionProduct[] {
  if (typeof query !== "string" || query.length > MAX_SUGGESTION_QUERY_LENGTH) return [];
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results: SearchSuggestionProduct[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(product.publicId) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug)) continue;
    const identity = product.publicId.toLowerCase();
    if (seen.has(identity)) continue;
    const fields = [product.brand, product.name ?? "", product.description ?? ""].map(normalize);
    if (!terms.every(term => fields.some(field => field.includes(term)))) continue;
    seen.add(identity);
    results.push(product);
    if (results.length === MAX_SEARCH_SUGGESTIONS) break;
  }
  return results;
}
