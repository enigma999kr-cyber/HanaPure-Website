"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { useBrowserFavorites, resetBrowserFavorites, getFavoriteSnapshot } from "@/lib/favorites/browser-favorites";
import { favoriteLabels } from "@/lib/favorites/labels";
import QuickAdd from "@/components/cart/QuickAdd";
import { useBrowserCart } from "@/lib/cart/browser-cart";
import { addSavedSelectionToCart, removeSavedSelection } from "@/lib/cart/shopping-session-bulk";
import { emptySavedView, savedCollectionView, savedComparisonPair, type SavedView, type SavedViewProduct } from "@/lib/favorites/saved-collection-view";
import type { ComparisonProduct } from "@/lib/comparison/compare-selection";
import { browserCartOverlap } from "@/lib/cart/cart-selection-summary";
import ProductComparison from "./ProductComparison";

export default function SavedProductsBar({ products, comparisonProducts = [], locale, routeLocale }: {
  products: readonly SavedViewProduct[]; comparisonProducts?: readonly ComparisonProduct[];
  locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const state = useBrowserFavorites();
  const labels = favoriteLabels[locale];
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const cart = useBrowserCart();
  const [checked, setChecked] = useState<{ baseline: readonly string[]; ids: readonly string[] }>({ baseline: state.ids, ids: [] });
  const [bulkMessage, setBulkMessage] = useState("");
  const [view, setView] = useState<SavedView>(emptySavedView);
  const [comparisonRequest, setComparisonRequest] = useState<{
    baseline: readonly string[]; selection: readonly string[]; view: SavedView;
  } | null>(null);
  const collection = savedCollectionView(state.ids, products, view, locale);
  const selected = collection.rows;
  const healthy = state.ready && state.persistent && !state.invalid;
  const coherent = checked.baseline === state.ids && checked.ids.every(id => selected.some(product => product.publicId.toLowerCase() === id.toLowerCase()));
  const checkedIds = coherent ? checked.ids : [];
  const usable = state.ready && state.persistent && !state.invalid && checkedIds.length > 0;
  const pair = healthy && coherent ? savedComparisonPair(checkedIds, state.ids, selected, comparisonProducts) : null;
  const activePair = comparisonRequest?.baseline === state.ids && comparisonRequest?.selection === checked.ids && comparisonRequest?.view === view ? pair : null;
  function changeView(next: SavedView) {
    setView(next); setChecked({ baseline: state.ids, ids: [] }); setComparisonRequest(null); setBulkMessage("");
  }
  const message = !state.ready ? labels.loading : !state.persistent ? labels.storage
    : state.invalid ? labels.invalid : collection.total === 0 ? labels.empty : selected.length === 0 ? labels.noMatches : "";
  const control = "min-h-11 w-full min-w-0 max-w-full rounded-xl border border-hanapure-border bg-hanapure-white px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
  return <section aria-labelledby={headingId} className="mt-8 min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-warm-white p-5">
    <h2 ref={heading} tabIndex={-1} id={headingId} className="text-xl font-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.heading}</h2>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
    {healthy && collection.total > 0 && <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0"><label htmlFor={`${headingId}-search`} className="mb-2 block break-words text-sm">{labels.searchSaved}</label>
        <input id={`${headingId}-search`} type="search" maxLength={200} value={view.query} className={control}
          onChange={event => changeView({ ...view, query: event.target.value.slice(0, 200) })} /></div>
      <div className="min-w-0"><label htmlFor={`${headingId}-brand`} className="mb-2 block break-words text-sm">{labels.savedBrand}</label>
        <select id={`${headingId}-brand`} value={view.brand} className={control} onChange={event => changeView({ ...view, brand: event.target.value })}>
          <option value="">{labels.allSavedBrands}</option>{collection.brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
        </select></div>
      <div className="min-w-0"><label htmlFor={`${headingId}-sort`} className="mb-2 block break-words text-sm">{labels.sortSaved}</label>
        <select id={`${headingId}-sort`} value={view.sort} className={control} onChange={event => changeView({ ...view, sort: event.target.value === "name-asc" ? "name-asc" : event.target.value === "name-desc" ? "name-desc" : "saved" })}>
          <option value="saved">{labels.savedOrder}</option><option value="name-asc">{labels.nameAscending}</option><option value="name-desc">{labels.nameDescending}</option>
        </select></div>
      <button type="button" className={control} onClick={() => changeView(emptySavedView)}>{labels.resetView}</button>
      <p role="status" className="min-w-0 break-words text-sm">{labels.matches}: {selected.length} / {collection.total}</p>
    </div>}
    {state.ready && state.persistent && !state.invalid && selected.length > 0 &&
      <ul className="mt-3 flex flex-wrap gap-3">{selected.map(product => <li key={product.publicId} className="min-w-0 max-w-full">
        <label className="mb-2 flex min-h-11 min-w-0 items-center gap-3 break-words">
          <input type="checkbox" checked={checkedIds.some(id => id.toLowerCase() === product.publicId.toLowerCase())}
            className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
            onChange={event => {
              const enabled = event.target.checked;
              setChecked(previous => {
                const ids = (previous.baseline === state.ids ? previous.ids.filter(id => selected.some(product => product.publicId.toLowerCase() === id.toLowerCase())) : []).filter(id => id.toLowerCase() !== product.publicId.toLowerCase());
                return { baseline: state.ids, ids: enabled ? [...ids, product.publicId] : ids };
              });
              setBulkMessage("");
              setComparisonRequest(null);
            }} />
          <span className="min-w-0 break-words">{labels.select}: {product.name}</span>
        </label>
        <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)}
          className="inline-flex min-h-11 max-w-full items-center break-words rounded-xl border border-hanapure-border bg-hanapure-white px-4 py-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          <span className="min-w-0 break-words">{product.name}</span>
        </Link>
        {browserCartOverlap(cart, product.publicId) !== null && <p className="mt-2 break-words text-sm">{labels.inBrowserCart}: {browserCartOverlap(cart, product.publicId)}</p>}
        <QuickAdd publicId={product.publicId} locale={locale} name={product.name} />
      </li>)}</ul>}
    <div className="mt-3 flex min-w-0 flex-wrap gap-3">
      <p className="w-full break-words text-sm">{labels.selectedCount}: {checkedIds.length}</p>
      <button type="button" disabled={!pair} className={`${control} disabled:opacity-50`} onClick={() => {
        const current = getFavoriteSnapshot();
        if (pair && current.ids === state.ids && current.ready && current.persistent && !current.invalid) {
          setComparisonRequest({ baseline: state.ids, selection: checked.ids, view });
        } else { setComparisonRequest(null); setBulkMessage(labels.bulkChanged); }
      }}>{labels.compareSelected}</button>
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
    {activePair && <ProductComparison key={`${locale}:${activePair.map(product => product.publicId).join(":")}`} products={activePair}
      locale={locale} routeLocale={routeLocale} initialPublicId={activePair[0].publicId} />}
    {state.invalid && <button type="button" onClick={() => resetBrowserFavorites()}
      className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.reset}</button>}
  </section>;
}
