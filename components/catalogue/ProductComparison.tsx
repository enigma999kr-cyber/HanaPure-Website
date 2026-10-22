"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { COMPARISON_DESTINATION, comparisonFieldState, comparisonHref, comparisonOptions, comparisonShareLink, resolveComparison, type ComparisonProduct } from "@/lib/comparison/compare-selection";
import { comparisonLabels } from "@/lib/comparison/labels";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import QuickAdd from "@/components/cart/QuickAdd";
import { useBrowserCart } from "@/lib/cart/browser-cart";
import { useBrowserFavorites } from "@/lib/favorites/browser-favorites";
import { browserCartOverlap, savedProductOverlap } from "@/lib/cart/cart-selection-summary";
import SaveProductButton from "./SaveProductButton";
import ProductImage from "./ProductImage";
import { ShoppingPlanIntake } from "./CatalogueShoppingPlan";
import type { PlanIntakeContext } from "@/lib/catalog/catalogue-shopping-plan";

/** Keyed to the current pair/context: obsolete asynchronous writes cannot announce success. */
function CopyComparisonLink({ relativeHref, products, locale }: {
  relativeHref: string; products: readonly ComparisonProduct[]; locale: EditorialLocale;
}) {
  const labels = comparisonLabels[locale];
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const lifecycle = useRef({ active: true, generation: 0 });
  useEffect(() => {
    const owner = lifecycle.current;
    owner.active = true;
    return () => { owner.active = false; owner.generation++; };
  }, [products]);
  return <div className="mt-4 min-w-0">
    <button type="button" disabled={copying}
      className="min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
      onClick={async () => {
        if (pending.current || !lifecycle.current.active) return;
        const attempt = lifecycle.current.generation;
        pending.current = true; setCopying(true); setMessage("");
        try {
          const href = comparisonShareLink(relativeHref, window.location.origin, products);
          if (!href || typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Comparison copy unavailable");
          await navigator.clipboard.writeText(href);
          if (lifecycle.current.active && lifecycle.current.generation === attempt) setMessage(labels.copied);
        } catch { if (lifecycle.current.active && lifecycle.current.generation === attempt) setMessage(labels.copyFailed); }
        finally { pending.current = false; if (lifecycle.current.active) setCopying(false); }
      }}>{labels.copyLink}</button>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
  </div>;
}

export default function ProductComparison({ products, locale, routeLocale, initialPublicId, initialSecondPublicId, destinationId, catalogueQuery = "", planContext }: {
  products: readonly ComparisonProduct[]; locale: EditorialLocale; routeLocale: EditorialLocale | null;
  initialPublicId?: string;
  initialSecondPublicId?: string;
  destinationId?: string;
  catalogueQuery?: string;
  planContext?: PlanIntakeContext;
}) {
  const [selection, setSelection] = useState<readonly [string, string]>(() => [initialPublicId ?? "", initialSecondPublicId ?? ""]);
  const [focusedPair, setFocusedPair] = useState("");
  const id = useId();
  const cart = useBrowserCart();
  const favorites = useBrowserFavorites();
  const pair = resolveComparison(products, selection[0], selection[1]);
  if (!pair) return null;
  const labels = comparisonLabels[locale];
  const existing = storefrontLabels[locale];
  const options = comparisonOptions(products);
  const pairKey = JSON.stringify(pair.map(product => product.publicId));
  const focused = focusedPair === pairKey;
  const shareHref = comparisonHref(storefrontHref("/products", routeLocale), pair, catalogueQuery);
  const selectPair = (next: readonly [ComparisonProduct, ComparisonProduct]) => {
    setFocusedPair(""); setSelection([next[0].publicId, next[1].publicId]);
  };
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
          if (next) selectPair(next);
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
      onClick={() => selectPair([pair[1], pair[0]])}>{labels.swap}</button>
    <button type="button" aria-pressed={focused}
      className="mt-4 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
      onClick={() => setFocusedPair(focused ? "" : pairKey)}>{focused ? labels.showAll : labels.focusDifferences}</button>
    {shareHref && <CopyComparisonLink key={`${locale}-${shareHref}`} relativeHref={`${shareHref}#${COMPARISON_DESTINATION}`} products={products} locale={locale} />}
    <ShoppingPlanIntake context={planContext} ids={pair.map(product => product.publicId)} locale={locale} pair
      guard={() => resolveComparison(products, pair[0].publicId, pair[1].publicId) !== null} />
    <p className="mt-4 break-words text-sm leading-6 text-hanapure-muted">{cartLabels[locale].notice}</p>
    <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">
      {pair.map((product, slot) => <article key={product.publicId} id={`${id}-panel-${slot}`} tabIndex={-1} aria-labelledby={`${id}-panel-${slot}-heading`}
        className="min-w-0 scroll-mt-24 rounded-xl border border-hanapure-border bg-hanapure-white p-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
        <h3 id={`${id}-panel-${slot}-heading`} className="break-words text-xl font-medium">{displayName(product)}</h3>
        {product.image && <div className="mt-4 w-full min-w-0 max-w-64"><ProductImage {...product.image} /></div>}
        {browserCartOverlap(cart, product.publicId) !== null && <p className="mt-3 break-words text-sm">{labels.inBrowserCart}: {browserCartOverlap(cart, product.publicId)}</p>}
        {savedProductOverlap(favorites, product.publicId) && <p className="mt-2 break-words text-sm">{labels.saved}</p>}
        <dl className="mt-4 space-y-4">
          {(["brand", "description", "usage"] as const).map(field => {
            const value = product[field];
            const state = comparisonFieldState(value, pair[1 - slot][field]);
            if (!focused && !value) return null;
            return <div key={field} className={focused ? state === "different" ? "border-l-2 border-hanapure-text pl-3" : "rounded-lg bg-hanapure-warm-white p-3" : undefined}>
              <dt className="text-sm font-medium">{field === "usage" ? existing.usage : labels[field]}</dt>
              {focused && <dd className="mt-1 break-words text-sm">{labels[state]}</dd>}
              <dd className="mt-1 whitespace-pre-line break-words leading-7">{value || existing.missing}</dd>
            </div>;
          })}
          {product.caution && <div><dt className="text-sm font-medium">{existing.caution}</dt>
            <dd className="mt-1 whitespace-pre-line break-words leading-7">{product.caution}</dd></div>}
        </dl>
        {product.name === null && <p className="mt-4 break-words leading-7 text-hanapure-muted">{existing.missing}</p>}
        <Link href={comparisonHref(storefrontHref(`/products/${product.slug}`, routeLocale), pair, catalogueQuery) ?? storefrontHref(`/products/${product.slug}`, routeLocale)} aria-label={`${existing.details}: ${displayName(product)}`}
          className="mt-4 inline-flex min-h-11 max-w-full items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          {existing.details}
        </Link>
        <SaveProductButton publicId={product.publicId} locale={locale} name={displayName(product)} />
        <QuickAdd publicId={product.publicId} locale={locale} name={displayName(product)} />
      </article>)}
    </div>
  </section>;
}
