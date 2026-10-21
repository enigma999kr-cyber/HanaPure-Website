"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { savedPublishedProducts } from "@/lib/favorites/favorite-state";
import { useBrowserFavorites, resetBrowserFavorites } from "@/lib/favorites/browser-favorites";
import { favoriteLabels } from "@/lib/favorites/labels";
import QuickAdd from "@/components/cart/QuickAdd";
import { useBrowserCart } from "@/lib/cart/browser-cart";
import { addSavedSelectionToCart, removeSavedSelection } from "@/lib/cart/shopping-session-bulk";

export default function SavedProductsBar({ products, locale, routeLocale }: {
  products: readonly Readonly<{ publicId: string; slug: string; name: string }>[];
  locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const state = useBrowserFavorites();
  const labels = favoriteLabels[locale];
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const cart = useBrowserCart();
  const [checked, setChecked] = useState<{ baseline: readonly string[]; ids: readonly string[] }>({ baseline: state.ids, ids: [] });
  const [bulkMessage, setBulkMessage] = useState("");
  const coherent = checked.baseline === state.ids;
  const checkedIds = coherent ? checked.ids : [];
  const usable = state.ready && state.persistent && !state.invalid && checkedIds.length > 0;
  const selected = savedPublishedProducts(state.ids, products);
  const message = !state.ready ? labels.loading : !state.persistent ? labels.storage
    : state.invalid ? labels.invalid : selected.length === 0 ? labels.empty : "";
  return <section aria-labelledby={headingId} className="mt-8 min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-warm-white p-5">
    <h2 ref={heading} tabIndex={-1} id={headingId} className="text-xl font-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.heading}</h2>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
    {state.ready && state.persistent && !state.invalid && selected.length > 0 &&
      <ul className="mt-3 flex flex-wrap gap-3">{selected.map(product => <li key={product.publicId} className="min-w-0 max-w-full">
        <label className="mb-2 flex min-h-11 min-w-0 items-center gap-3 break-words">
          <input type="checkbox" checked={checkedIds.some(id => id.toLowerCase() === product.publicId.toLowerCase())}
            className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
            onChange={event => {
              const enabled = event.target.checked;
              setChecked(previous => {
                const ids = (previous.baseline === state.ids ? previous.ids : []).filter(id => id.toLowerCase() !== product.publicId.toLowerCase());
                return { baseline: state.ids, ids: enabled ? [...ids, product.publicId] : ids };
              });
              setBulkMessage("");
            }} />
          <span className="min-w-0 break-words">{labels.select}: {product.name}</span>
        </label>
        <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)}
          className="inline-flex min-h-11 max-w-full items-center break-words rounded-xl border border-hanapure-border bg-hanapure-white px-4 py-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          <span className="min-w-0 break-words">{product.name}</span>
        </Link>
        <QuickAdd publicId={product.publicId} locale={locale} name={product.name} />
      </li>)}</ul>}
    <div className="mt-3 flex min-w-0 flex-wrap gap-3">
      <p className="w-full break-words text-sm">{labels.selectedCount}: {checkedIds.length}</p>
      <button type="button" disabled={!usable || !cart.ready || cart.invalid || !cart.persistent}
        className="min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
        onClick={() => {
          if (!usable) return;
          const result = addSavedSelectionToCart(cart, state.ids, checkedIds, products);
          setBulkMessage(result === "updated" ? labels.bulkAdded : result === "conflict" ? labels.bulkChanged : labels.bulkFailed);
          if (result === "updated") setChecked({ baseline: state.ids, ids: [] });
        }}>{labels.addSelected}</button>
      <button type="button" disabled={!usable}
        className="min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
        onClick={() => {
          if (!usable) return;
          const result = removeSavedSelection(state.ids, checkedIds, products);
          setBulkMessage(result === "updated" ? labels.bulkRemoved : result === "conflict" ? labels.bulkChanged : labels.bulkFailed);
          if (result === "updated") { setChecked({ baseline: state.ids, ids: [] }); heading.current?.focus(); }
        }}>{labels.removeSelected}</button>
    </div>
    <p role="status" className="mt-2 break-words text-sm">{checked.ids.length > 0 && !coherent && !bulkMessage ? labels.bulkChanged : bulkMessage}</p>
    {state.invalid && <button type="button" onClick={() => resetBrowserFavorites()}
      className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.reset}</button>}
  </section>;
}
