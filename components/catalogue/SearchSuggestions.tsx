"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { searchSuggestions, type SearchSuggestionProduct } from "@/lib/catalog/search-suggestions";
import { searchSuggestionLabels } from "@/lib/catalog/search-suggestion-labels";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { carryShoppingPlan, type ShoppingPlan } from "@/lib/catalog/catalogue-shopping-plan";

/** Live input wins over submitted q; unsafe/oversized context keeps a clean detail link. */
export function suggestionDetailHref(slug: string, routeLocale: EditorialLocale | null, query: string, brand = "", sort?: string, view?: "list"): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return storefrontHref("/products", routeLocale);
  const base = storefrontHref(`/products/${slug}`, routeLocale);
  try {
    if (query.length > 4096 || brand.length > 4096) return base;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (brand.trim()) params.set("brand", brand.trim());
    if (sort === "name-asc" || sort === "name-desc") params.set("sort", sort);
    if (view === "list") params.set("view", "list");
    const value = params.toString();
    const href = base + (value ? `?${value}` : "");
    return href.length <= 8192 ? href : base;
  } catch { return base; }
}

export default function SearchSuggestions({ products, initialQuery, locale, routeLocale, appliedCriteria, plan, view, children }: {
  products: readonly SearchSuggestionProduct[]; initialQuery: string;
  locale: EditorialLocale; routeLocale: EditorialLocale | null; children: ReactNode;
  appliedCriteria: Readonly<{ brand: string; sort?: "name-asc" | "name-desc" }>;
  plan?: ShoppingPlan;
  view?: "list";
}) {
  const [query, setQuery] = useState(initialQuery);
  const [dismissed, setDismissed] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The uncontrolled input may already contain text entered before hydration.
    const input = field.current?.querySelector<HTMLInputElement>("#catalogue-search");
    if (input) {
      const value = input.value;
      setQuery(current => current === value ? current : value);
    }
  }, []);
  const matches = searchSuggestions(products, query);
  const visible = products.length > 0 && Boolean(query.trim()) && !dismissed;
  const labels = searchSuggestionLabels[locale];
  const existing = storefrontLabels[locale];
  const suggestionsId = useId();
  const statusId = `${suggestionsId}-status`;
  // Keep the native search input and ordinary links; this is not a combobox.
  const input = isValidElement<InputHTMLAttributes<HTMLInputElement>>(children) && children.type === "input"
    ? cloneElement(children, {
      "aria-controls": suggestionsId,
      "aria-describedby": [children.props["aria-describedby"], statusId].filter(Boolean).join(" "),
    }) : children;
  return <div ref={field} className="min-w-0" onChange={event => {
    if (event.target instanceof HTMLInputElement && event.target === field.current?.querySelector("#catalogue-search")) {
      setQuery(event.target.value);
      setDismissed(false);
    }
  }} onKeyDown={event => {
    if (!visible || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    const input = field.current?.querySelector<HTMLInputElement>("#catalogue-search");
    const allowed = new Set(matches.map(product => {
      const detail = suggestionDetailHref(product.slug, routeLocale, query, appliedCriteria.brand, appliedCriteria.sort, view);
      return plan ? carryShoppingPlan(detail, plan) : detail;
    }).filter(href => href !== null));
    const links = Array.from(field.current?.querySelectorAll<HTMLAnchorElement>("a[data-search-suggestion]") ?? [])
      .filter(link => allowed.has(link.getAttribute("href") ?? "") && link.getAttribute("aria-disabled") !== "true");
    const index = links.findIndex(link => link === event.target);
    if (event.target !== input && index < 0) return;
    if (event.key === "Escape") {
      // Native search inputs may clear on Escape: preserve the query and return from a link.
      event.preventDefault();
      setDismissed(true);
      input?.focus();
    } else if (event.key === "ArrowDown") {
      const next = links[index + 1];
      if (next) { event.preventDefault(); next.focus(); }
    } else if (event.key === "ArrowUp" && index >= 0) {
      const previous = index === 0 ? input : links[index - 1];
      if (previous) { event.preventDefault(); previous.focus(); }
    }
  }}>
    {input}
    <div id={suggestionsId} hidden={!visible} className="mt-2 min-w-0 rounded-xl border border-hanapure-border bg-hanapure-white p-3">
      <p id={statusId} role="status" className="break-words text-sm text-hanapure-muted">
        {visible ? matches.length ? `${labels.heading}: ${matches.length}` : labels.none : ""}
      </p>
      {visible && matches.length > 0 && <ul aria-label={labels.heading} className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {matches.map(product => {
          const detail = suggestionDetailHref(product.slug, routeLocale, query, appliedCriteria.brand, appliedCriteria.sort, view);
          const href = plan ? carryShoppingPlan(detail, plan) : detail;
          return <li key={product.publicId} className="min-w-0">
          {href === null ? <span role="status" className="block break-words text-sm">{existing.planLimit}</span> : <Link href={href} data-search-suggestion=""
            className="block min-h-11 min-w-0 max-w-full rounded-lg px-2 py-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-4! focus-visible:outline-hanapure-text focus-visible:bg-hanapure-beige-light forced-colors:focus-visible:outline-[Highlight]!">
            <span className="block break-words">{product.name ?? `${existing.details}: ${product.brand} (${product.slug})`}</span>
            <span className="block break-words text-hanapure-muted">{product.brand}</span>
            {product.name === null && <span className="block break-words text-hanapure-muted">{existing.missing}</span>}
          </Link>}
        </li>;
        })}
      </ul>}
    </div>
  </div>;
}
