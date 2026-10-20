"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { recentPublishedProducts } from "@/lib/recently-viewed/recent-state";
import { useBrowserRecent, recordRecentVisit, clearBrowserRecent } from "@/lib/recently-viewed/browser-recent";

export const recentlyViewedLabels = {
  en: {
    heading: "Recently viewed", clear: "Clear recently viewed", cleared: "Recently viewed history cleared.",
    empty: "No recently viewed products from the current catalogue.",
    invalid: "Recently viewed history could not be read. Clear it to start again.",
    storage: "Recently viewed history cannot be read or stored in this browser. Changes may not be saved.",
  },
  hu: {
    heading: "Legutóbb megtekintett termékek", clear: "Megtekintési előzmények törlése", cleared: "A megtekintési előzményeket töröltük.",
    empty: "Nincs nemrég megtekintett termék a jelenlegi katalógusból.",
    invalid: "A megtekintési előzmények nem olvashatók. Az újrakezdéshez törölje őket.",
    storage: "Ebben a böngészőben a megtekintési előzmények nem olvashatók vagy tárolhatók. A módosítások mentése nem garantált.",
  },
  ko: {
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

export default function RecentlyViewedProducts({ products, locale, routeLocale }: {
  products: readonly Readonly<{ publicId: string; slug: string; name: string }>[];
  locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const state = useBrowserRecent();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [cleared, setCleared] = useState(false);
  const labels = recentlyViewedLabels[locale];
  const selected = recentPublishedProducts(state.ids, products);
  if (!state.ready || (state.persistent && !state.invalid && state.ids.length === 0 && !cleared)) return null;
  const message = !state.persistent ? labels.storage : state.invalid ? labels.invalid
    : cleared && state.ids.length === 0 ? labels.cleared : selected.length === 0 ? labels.empty : "";
  return <section aria-labelledby={id} className="mt-8 min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
    <h2 ref={heading} id={id} tabIndex={-1} className="break-words text-xl font-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.heading}</h2>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
    {state.persistent && !state.invalid && selected.length > 0 && <ul className="mt-3 flex flex-wrap gap-3">
      {selected.map(product => <li key={product.publicId} className="min-w-0 max-w-full">
        <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)}
          className="inline-flex min-h-11 max-w-full items-center rounded-xl border border-hanapure-border px-4 py-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
          <span className="min-w-0 break-words">{product.name}</span>
        </Link>
      </li>)}
    </ul>}
    {(state.invalid || state.ids.length > 0) && <button type="button"
      className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
      onClick={() => {
        const success = clearBrowserRecent();
        setCleared(success);
        if (success) heading.current?.focus();
      }}>{labels.clear}</button>}
  </section>;
}
