"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { comparisonOptions, resolveComparison, type ComparisonProduct } from "@/lib/comparison/compare-selection";
import { comparisonLabels } from "@/lib/comparison/labels";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import QuickAdd from "@/components/cart/QuickAdd";
import { useBrowserCart } from "@/lib/cart/browser-cart";
import { useBrowserFavorites } from "@/lib/favorites/browser-favorites";
import { browserCartOverlap, savedProductOverlap } from "@/lib/cart/cart-selection-summary";

export default function ProductComparison({ products, locale, routeLocale, initialPublicId, destinationId }: {
  products: readonly ComparisonProduct[]; locale: EditorialLocale; routeLocale: EditorialLocale | null;
  initialPublicId?: string;
  destinationId?: string;
}) {
  const [selection, setSelection] = useState<readonly [string, string]>(() => [initialPublicId ?? "", ""]);
  const id = useId();
  const cart = useBrowserCart();
  const favorites = useBrowserFavorites();
  const pair = resolveComparison(products, selection[0], selection[1]);
  if (!pair) return null;
  const labels = comparisonLabels[locale];
  const existing = storefrontLabels[locale];
  const options = comparisonOptions(products);
  const displayName = (product: ComparisonProduct) => product.name ?? `${existing.details}: ${product.brand} (${product.slug})`;
  const controlStyle = "min-h-11 w-full min-w-0 max-w-full rounded-xl border border-hanapure-border bg-hanapure-white px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
  return <section id={destinationId} tabIndex={destinationId ? -1 : undefined} aria-labelledby={`${id}-heading`}
    className="mt-12 min-w-0 scroll-mt-24 rounded-2xl border border-hanapure-border bg-hanapure-warm-white p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text sm:p-6">
    <h2 id={`${id}-heading`} className="break-words text-2xl font-light">{labels.heading}</h2>
    <noscript><p className="mt-3 text-sm">{labels.requiresJs}</p></noscript>
    <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">
      {pair.map((product, slot) => <div key={slot} className="min-w-0">
        <label htmlFor={`${id}-${slot}`} className="mb-2 block text-sm font-medium">{slot === 0 ? labels.first : labels.second}</label>
        <select id={`${id}-${slot}`} value={product.publicId} className={controlStyle} onChange={event => {
          const next = resolveComparison(products, slot === 0 ? event.target.value : pair[0].publicId,
            slot === 1 ? event.target.value : pair[1].publicId);
          if (next) setSelection([next[0].publicId, next[1].publicId]);
        }}>
          {options.map(option => <option key={option.publicId} value={option.publicId}
            disabled={option.publicId.toLowerCase() === pair[1 - slot].publicId.toLowerCase()}>
            {displayName(option)}
          </option>)}
        </select>
      </div>)}
    </div>
    <nav aria-label={labels.panelNavigation} className="mt-4 flex min-w-0 flex-wrap gap-3">
      {[labels.jumpFirst, labels.jumpSecond].map((label, slot) => <a key={slot} href={`#${id}-panel-${slot}`}
        className="inline-flex min-h-11 min-w-0 max-w-full items-center break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{label}</a>)}
    </nav>
    <button type="button" className="mt-4 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
      onClick={() => setSelection([pair[1].publicId, pair[0].publicId])}>{labels.swap}</button>
    <p className="mt-4 break-words text-sm leading-6 text-hanapure-muted">{cartLabels[locale].notice}</p>
    <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">
      {pair.map((product, slot) => <article key={product.publicId} id={`${id}-panel-${slot}`} tabIndex={-1} aria-labelledby={`${id}-panel-${slot}-heading`}
        className="min-w-0 scroll-mt-24 rounded-xl border border-hanapure-border bg-hanapure-white p-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
        <h3 id={`${id}-panel-${slot}-heading`} className="break-words text-xl font-medium">{displayName(product)}</h3>
        {browserCartOverlap(cart, product.publicId) !== null && <p className="mt-3 break-words text-sm">{labels.inBrowserCart}: {browserCartOverlap(cart, product.publicId)}</p>}
        {savedProductOverlap(favorites, product.publicId) && <p className="mt-2 break-words text-sm">{labels.saved}</p>}
        <dl className="mt-4 space-y-4">
          <div><dt className="text-sm font-medium">{labels.brand}</dt><dd className="mt-1 break-words">{product.brand}</dd></div>
          {product.description !== null && <div><dt className="text-sm font-medium">{labels.description}</dt>
            <dd className="mt-1 whitespace-pre-line break-words leading-7">{product.description}</dd></div>}
          {product.usage && <div><dt className="text-sm font-medium">{existing.usage}</dt>
            <dd className="mt-1 whitespace-pre-line break-words leading-7">{product.usage}</dd></div>}
          {product.caution && <div><dt className="text-sm font-medium">{existing.caution}</dt>
            <dd className="mt-1 whitespace-pre-line break-words leading-7">{product.caution}</dd></div>}
        </dl>
        {product.name === null && <p className="mt-4 break-words leading-7 text-hanapure-muted">{existing.missing}</p>}
        <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)} aria-label={`${existing.details}: ${displayName(product)}`}
          className="mt-4 inline-flex min-h-11 max-w-full items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          {existing.details}
        </Link>
        <QuickAdd publicId={product.publicId} locale={locale} name={displayName(product)} />
      </article>)}
    </div>
  </section>;
}
