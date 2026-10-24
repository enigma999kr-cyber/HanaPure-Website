"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { comparisonHref, comparisonOptions, publishedComparison, COMPARISON_DESTINATION } from "@/lib/comparison/compare-selection";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";

type Option = Readonly<{ publicId: string; name: string }>;
type Selection = Readonly<{ options: readonly Option[]; ids: readonly string[]; locale: EditorialLocale;
  toggle: (id: string, checked: boolean) => void }>;
const PairSelection = createContext<Selection | null>(null);

/** Small client island around server-rendered cards, never a catalogue reader or store. */
export default function CatalogueResultPairPicker({ products, locale, routeLocale, catalogueQuery, children }: {
  products: readonly Option[]; locale: EditorialLocale; routeLocale: EditorialLocale | null;
  catalogueQuery: string; children: ReactNode;
}) {
  const options = comparisonOptions(products);
  const context = JSON.stringify([locale, routeLocale, catalogueQuery, options]);
  const [selection, setSelection] = useState<{ context: string; ids: readonly string[] }>({ context, ids: [] });
  const ids = selection.context === context ? selection.ids : [];
  const pair = ids.length === 2 ? publishedComparison(options, { first: ids[0], second: ids[1] }) : null;
  const href = pair ? comparisonHref(storefrontHref("/products", routeLocale), pair, catalogueQuery) : null;
  const labels = storefrontLabels[locale];
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const attempt = {};
  const live = useRef<{ attempt: object; location: string } | null>(null);
  useEffect(() => {
    live.current = { attempt, location: window.location.href };
    return () => { live.current = null; };
  });
  if (options.length < 2) return <>{children}</>;
  const toggle = (publicId: string, checked: boolean) => {
    const id = publicId.toLowerCase();
    if (!options.some(product => product.publicId.toLowerCase() === id)) return;
    setSelection(previous => {
      const current = previous.context === context ? previous.ids : [];
      if (checked && current.includes(id)) return previous;
      const remaining = current.filter(value => value !== id);
      if (checked && !current.includes(id) && current.length >= 2) return previous;
      return { context, ids: checked ? [...remaining, id] : remaining };
    });
  };
  return <PairSelection.Provider value={{ options, ids, locale, toggle }}>
    {children}
    <div className="mt-5 min-w-0">
      <p role="status" className="break-words text-sm">{labels.resultComparisonCount}: {ids.length} / 2</p>
      <button type="button" disabled={!href}
        className="mt-3 min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
        onClick={() => {
          if (!href || pending.current) return;
          if (live.current?.attempt !== attempt || live.current.location !== window.location.href) {
            if (live.current) setMessage(labels.comparisonSelectionChanged);
            return;
          }
          setMessage("");
          try { pending.current = true; window.location.assign(`${href}#${COMPARISON_DESTINATION}`); }
          catch { pending.current = false; setMessage(labels.comparisonNavigationFailed); }
        }}>{labels.compareSelectedResults}</button>
      <p role="status" className="mt-2 break-words text-sm">{message}</p>
    </div>
  </PairSelection.Provider>;
}

export function CatalogueResultPairCheckbox({ publicId }: { publicId: string }) {
  const selection = useContext(PairSelection);
  const product = selection?.options.find(item => item.publicId.toLowerCase() === publicId.toLowerCase());
  if (!selection || !product) return null;
  const checked = selection.ids.includes(product.publicId.toLowerCase());
  return <label className="mb-3 flex min-h-11 min-w-0 items-center gap-3 break-words">
    <input type="checkbox" checked={checked} disabled={!checked && selection.ids.length >= 2}
      className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
      onChange={event => selection.toggle(product.publicId, event.target.checked)} />
    <span className="min-w-0 break-words">{storefrontLabels[selection.locale].selectResultComparison}: {product.name}</span>
  </label>;
}
