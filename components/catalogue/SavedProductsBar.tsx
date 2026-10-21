"use client";

import { useId } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { savedPublishedProducts } from "@/lib/favorites/favorite-state";
import { useBrowserFavorites, resetBrowserFavorites } from "@/lib/favorites/browser-favorites";
import { favoriteLabels } from "@/lib/favorites/labels";
import QuickAdd from "@/components/cart/QuickAdd";

export default function SavedProductsBar({ products, locale, routeLocale }: {
  products: readonly Readonly<{ publicId: string; slug: string; name: string }>[];
  locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const state = useBrowserFavorites();
  const labels = favoriteLabels[locale];
  const headingId = useId();
  const selected = savedPublishedProducts(state.ids, products);
  const message = !state.ready ? labels.loading : !state.persistent ? labels.storage
    : state.invalid ? labels.invalid : selected.length === 0 ? labels.empty : "";
  return <section aria-labelledby={headingId} className="mt-8 min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-warm-white p-5">
    <h2 id={headingId} className="text-xl font-light">{labels.heading}</h2>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
    {state.ready && state.persistent && !state.invalid && selected.length > 0 &&
      <ul className="mt-3 flex flex-wrap gap-3">{selected.map(product => <li key={product.publicId} className="min-w-0 max-w-full">
        <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)}
          className="inline-flex min-h-11 max-w-full items-center break-words rounded-xl border border-hanapure-border bg-hanapure-white px-4 py-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          <span className="min-w-0 break-words">{product.name}</span>
        </Link>
        <QuickAdd publicId={product.publicId} locale={locale} name={product.name} />
      </li>)}</ul>}
    {state.invalid && <button type="button" onClick={() => resetBrowserFavorites()}
      className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.reset}</button>}
  </section>;
}
