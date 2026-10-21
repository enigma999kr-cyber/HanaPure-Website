"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { searchSuggestions, type SearchSuggestionProduct } from "@/lib/catalog/search-suggestions";
import { searchSuggestionLabels } from "@/lib/catalog/search-suggestion-labels";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";

/** Live input wins over submitted q; unsafe/oversized context keeps a clean detail link. */
export function suggestionDetailHref(slug: string, routeLocale: EditorialLocale | null, query: string, brand = "", sort?: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return storefrontHref("/products", routeLocale);
  const base = storefrontHref(`/products/${slug}`, routeLocale);
  try {
    if (query.length > 4096 || brand.length > 4096) return base;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (brand.trim()) params.set("brand", brand.trim());
    if (sort === "name-asc" || sort === "name-desc") params.set("sort", sort);
    const value = params.toString();
    const href = base + (value ? `?${value}` : "");
    return href.length <= 8192 ? href : base;
  } catch { return base; }
}

export default function SearchSuggestions({ products, initialQuery, locale, routeLocale, appliedCriteria, children }: {
  products: readonly SearchSuggestionProduct[]; initialQuery: string;
  locale: EditorialLocale; routeLocale: EditorialLocale | null; children: ReactNode;
  appliedCriteria: Readonly<{ brand: string; sort?: "name-asc" | "name-desc" }>;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [dismissed, setDismissed] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const matches = searchSuggestions(products, query);
  const visible = products.length > 0 && Boolean(query.trim()) && !dismissed;
  const labels = searchSuggestionLabels[locale];
  const existing = storefrontLabels[locale];
  return <div ref={field} className="min-w-0" onChange={event => {
    if (event.target instanceof HTMLInputElement && event.target.name === "q") {
      setQuery(event.target.value);
      setDismissed(false);
    }
  }} onKeyDown={event => {
    if (event.key === "Escape") {
      // Native search inputs may clear on Escape: preserve the query and return from a link.
      event.preventDefault();
      setDismissed(true);
      field.current?.querySelector<HTMLInputElement>("#catalogue-search")?.focus();
    }
  }}>
    {children}
    {visible && <div className="mt-2 min-w-0 rounded-xl border border-hanapure-border bg-hanapure-white p-3">
      <p role="status" className="break-words text-sm text-hanapure-muted">
        {matches.length ? `${labels.heading}: ${matches.length}` : labels.none}
      </p>
      {matches.length > 0 && <ul aria-label={labels.heading} className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {matches.map(product => <li key={product.publicId} className="min-w-0">
          <Link href={suggestionDetailHref(product.slug, routeLocale, query, appliedCriteria.brand, appliedCriteria.sort)}
            className="block min-h-11 min-w-0 max-w-full rounded-lg px-2 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
            <span className="block break-words">{product.name ?? `${existing.details}: ${product.brand} (${product.slug})`}</span>
            <span className="block break-words text-hanapure-muted">{product.brand}</span>
            {product.name === null && <span className="block break-words text-hanapure-muted">{existing.missing}</span>}
          </Link>
        </li>)}
      </ul>}
    </div>}
  </div>;
}
