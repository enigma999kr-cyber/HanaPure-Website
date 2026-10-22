"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { EditorialImage, EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { recentPublishedProducts, inspectStoredRecent, RECENT_STORAGE_KEY } from "@/lib/recently-viewed/recent-state";
import { useBrowserRecent, recordRecentVisit, clearBrowserRecent, removeBrowserRecent, getRecentSnapshot } from "@/lib/recently-viewed/browser-recent";
import QuickAdd from "@/components/cart/QuickAdd";
import SaveProductButton from "./SaveProductButton";
import ProductComparison from "./ProductComparison";
import type { ComparisonProduct } from "@/lib/comparison/compare-selection";
import { recentComparisonPair } from "@/lib/recently-viewed/recent-comparison";
import ProductImage from "./ProductImage";
import { ShoppingPlanIntake } from "./CatalogueShoppingPlan";
import type { PlanIntakeContext } from "@/lib/catalog/catalogue-shopping-plan";

export const recentlyViewedLabels = {
  en: {
    select: "Select recently viewed product", compareSelected: "Compare two selected recent products",
    remove: "Remove from recently viewed", removed: "Removed from recently viewed.", changed: "History changed. Reload and try again.", removeFailed: "Removal could not be confirmed. Reload and check your history.",
    heading: "Recently viewed", clear: "Clear recently viewed", cleared: "Recently viewed history cleared.",
    empty: "No recently viewed products from the current catalogue.",
    invalid: "Recently viewed history could not be read. Clear it to start again.",
    storage: "Recently viewed history cannot be read or stored in this browser. Changes may not be saved.",
  },
  hu: {
    select: "Legutóbb megtekintett termék kiválasztása", compareSelected: "Két kiválasztott megtekintett termék összehasonlítása",
    remove: "Eltávolítás a megtekintési előzményekből", removed: "Eltávolítva a megtekintési előzményekből.", changed: "Az előzmények megváltoztak. Töltse újra az oldalt, és próbálja újra.", removeFailed: "Az eltávolítást nem tudtuk megerősíteni. Töltse újra és ellenőrizze az előzményeket.",
    heading: "Legutóbb megtekintett termékek", clear: "Megtekintési előzmények törlése", cleared: "A megtekintési előzményeket töröltük.",
    empty: "Nincs nemrég megtekintett termék a jelenlegi katalógusból.",
    invalid: "A megtekintési előzmények nem olvashatók. Az újrakezdéshez törölje őket.",
    storage: "Ebben a böngészőben a megtekintési előzmények nem olvashatók vagy tárolhatók. A módosítások mentése nem garantált.",
  },
  ko: {
    select: "최근 본 상품 선택", compareSelected: "선택한 최근 본 상품 두 개 비교",
    remove: "최근 본 기록에서 삭제", removed: "최근 본 기록에서 삭제했습니다.", changed: "기록이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.", removeFailed: "삭제되었는지 확인할 수 없습니다. 새로고침하여 기록을 확인해 주세요.",
    heading: "최근 본 상품", clear: "최근 본 기록 지우기", cleared: "최근 본 상품 기록을 지웠습니다.",
    empty: "현재 카탈로그에 최근 본 상품이 없습니다.",
    invalid: "최근 본 기록을 읽을 수 없습니다. 다시 시작하려면 기록을 지워 주세요.",
    storage: "이 브라우저에서 최근 본 기록을 읽거나 보관할 수 없습니다. 변경사항이 저장되지 않을 수 있습니다.",
  },
} as const;

/** Only mounted by the server after the published detail lookup succeeds. */
export function ProductVisitTracker({ publicId }: { publicId: string }) {
  useEffect(() => { recordRecentVisit(publicId); }, [publicId]);
  return null;
}

export default function RecentlyViewedProducts({ products, comparisonProducts = [], locale, routeLocale, planContext }: {
  products: readonly Readonly<{ publicId: string; slug: string; name: string; image?: EditorialImage | null }>[];
  comparisonProducts?: readonly ComparisonProduct[];
  locale: EditorialLocale; routeLocale: EditorialLocale | null;
  planContext?: PlanIntakeContext;
}) {
  const state = useBrowserRecent();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [cleared, setCleared] = useState(false);
  const [removalMessage, setRemovalMessage] = useState("");
  const labels = recentlyViewedLabels[locale];
  const selected = recentPublishedProducts(state.ids, products);
  const [checked, setChecked] = useState({ baseline: state.ids, products, comparisonProducts, ids: [] as readonly string[] });
  const [request, setRequest] = useState<{ baseline: typeof state.ids; selection: readonly string[];
    products: typeof products; comparisonProducts: typeof comparisonProducts; locale: EditorialLocale } | null>(null);
  const healthy = state.ready && state.persistent && !state.invalid;
  const coherent = checked.baseline === state.ids && checked.products === products && checked.comparisonProducts === comparisonProducts &&
    checked.ids.every(id => selected.some(product => product.publicId.toLowerCase() === id.toLowerCase()));
  const pair = healthy && coherent ? recentComparisonPair(checked.ids, state.ids, selected, comparisonProducts) : null;
  const activePair = request?.baseline === state.ids && request?.selection === checked.ids && request?.products === products &&
    request?.comparisonProducts === comparisonProducts && request?.locale === locale ? pair : null;
  function clearSelection() { setChecked({ baseline: state.ids, products, comparisonProducts, ids: [] }); setRequest(null); }
  if (!state.ready || (state.persistent && !state.invalid && state.ids.length === 0 && !cleared && !removalMessage)) return null;
  const message = !state.persistent ? labels.storage : state.invalid ? labels.invalid
    : cleared && state.ids.length === 0 ? labels.cleared : selected.length === 0 ? labels.empty : "";
  return <section aria-labelledby={id} className="mt-8 min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
    <h2 ref={heading} id={id} tabIndex={-1} className="break-words text-xl font-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.heading}</h2>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
    {state.persistent && !state.invalid && selected.length > 0 && <ul className="mt-3 flex flex-wrap gap-3">
      {selected.map(product => <li key={product.publicId} className="min-w-0 max-w-full">
        <label className="mb-2 flex min-h-11 min-w-0 items-center gap-3 break-words">
          <input type="checkbox" checked={coherent && checked.ids.some(id => id.toLowerCase() === product.publicId.toLowerCase())}
            className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
            onChange={event => {
              const enabled = event.target.checked;
              setChecked(previous => {
                const ids = (previous.baseline === state.ids && previous.products === products && previous.comparisonProducts === comparisonProducts ? previous.ids : []).filter(id => id.toLowerCase() !== product.publicId.toLowerCase());
                return { baseline: state.ids, products, comparisonProducts, ids: enabled ? [...ids, product.publicId] : ids };
              }); setRequest(null);
            }} />
          <span className="min-w-0 break-words">{labels.select}: {product.name}</span>
        </label>
        {product.image && <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)}
          className="mb-3 block w-24 max-w-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          <ProductImage {...product.image} />
        </Link>}
        <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)}
          className="inline-flex min-h-11 max-w-full items-center rounded-xl border border-hanapure-border px-4 py-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          <span className="min-w-0 break-words">{product.name}</span>
        </Link>
        <QuickAdd publicId={product.publicId} locale={locale} name={product.name} />
        <SaveProductButton publicId={product.publicId} locale={locale} name={product.name} />
        <button type="button" aria-label={`${labels.remove}: ${product.name}`}
          className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
          onClick={() => {
            clearSelection();
            const result = removeBrowserRecent(product.publicId, state.ids);
            setRemovalMessage(result === "removed" ? labels.removed : result === "conflict" || result === "unchanged" ? labels.changed : labels.removeFailed);
            if (result === "removed") heading.current?.focus();
          }}>{labels.remove}</button>
      </li>)}
    </ul>}
    {healthy && selected.length > 0 && <button type="button" disabled={!pair}
      className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
      onClick={() => {
        if (pair) setRequest({ baseline: state.ids, selection: checked.ids, products, comparisonProducts, locale });
      }}>{labels.compareSelected}</button>}
    {activePair && <ProductComparison key={`${locale}:${activePair.map(product => product.publicId).join(":")}`} products={activePair}
      locale={locale} routeLocale={routeLocale} initialPublicId={activePair[0].publicId} planContext={planContext} />}
    <ShoppingPlanIntake context={planContext} locale={locale}
      ids={healthy && coherent ? selected.filter(product => checked.ids.some(id => id.toLowerCase() === product.publicId.toLowerCase())).map(product => product.publicId) : []}
      guard={() => {
        if (!healthy || !coherent || !checked.ids.length || getRecentSnapshot() !== state) return false;
        try {
          const fresh = inspectStoredRecent(window.localStorage.getItem(RECENT_STORAGE_KEY));
          return !fresh.invalid && fresh.ids.length === state.ids.length && fresh.ids.every((id, index) => id === state.ids[index]);
        } catch { return false; }
      }} />
    <p role="status" className="mt-2 break-words text-sm">{removalMessage}</p>
    {(state.invalid || state.ids.length > 0) && <button type="button"
      className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
      onClick={() => {
        clearSelection();
        const success = clearBrowserRecent();
        setCleared(success);
        if (success) heading.current?.focus();
      }}>{labels.clear}</button>}
  </section>;
}
