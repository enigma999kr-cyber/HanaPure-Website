"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { addPlanProducts, setPlanQuantity, shoppingPlanHref, shoppingPlanCartHref, planIntakeHref, shoppingPlanShareLink, type PlanIntakeContext, type ShoppingPlan, type PlanChange } from "@/lib/catalog/catalogue-shopping-plan";
import { resolvePortableLines } from "@/lib/cart/cart-portable-handoff";
import { validCartId, type CartLine } from "@/lib/cart/cart-state";

export type PlanProduct = Readonly<{ publicId: string; slug: string; brand: string; name: string | null }>;
const control = "min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50";
type Selection = { ids: readonly string[]; visible: readonly PlanProduct[]; locale: EditorialLocale; disabled: boolean;
  toggle: (id: string, checked: boolean) => void; add: (ids: readonly string[]) => void };
const PlanContext = createContext<Selection | null>(null);
const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function PlannedQuantity({ line, locale, name, apply }: { line: CartLine; locale: EditorialLocale; name: string; apply: (raw: string) => void }) {
  const id = useId(), labels = storefrontLabels[locale];
  const [draft, setDraft] = useState(String(line.quantity));
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  return <form className="mt-3 flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (ready) apply(draft); }}>
    <div className="min-w-0"><label htmlFor={id} className="mb-2 block break-words text-sm">{labels.planQuantity}: {name}</label>
      <input id={id} type="number" min="1" step="1" required disabled={!ready} value={draft} onChange={event => setDraft(event.target.value)} className={`${control} w-28`} /></div>
    <button type="submit" disabled={!ready} className={control}>{labels.planSet}</button>
  </form>;
}

export default function CatalogueShoppingPlan({ plan, products, publishedIds, visibleIds, locale, routeLocale, path, query, children }: {
  plan: ShoppingPlan; products: readonly PlanProduct[]; publishedIds: readonly string[]; visibleIds: readonly string[];
  locale: EditorialLocale; routeLocale: EditorialLocale | null; path: string; query: string; children?: ReactNode;
}) {
  const labels = storefrontLabels[locale], heading = useId();
  const publicProducts = publishedIds.map(publicId => ({ publicId }));
  const resolved = plan.status === "ready" ? resolvePortableLines(plan.lines, products) : null;
  const valid = plan.status !== "invalid" && (plan.status === "empty" || Boolean(resolved && resolvePortableLines(plan.lines, publicProducts)));
  const visible = products.filter(product => visibleIds.includes(product.publicId) && validCartId(product.publicId) && publishedIds.filter(id => id === product.publicId).length === 1);
  const witness = JSON.stringify([path, query, plan, visibleIds, publishedIds]);
  const [selection, setSelection] = useState<{ witness: string; ids: readonly string[] }>({ witness, ids: [] });
  const ids = selection.witness === witness ? selection.ids : [];
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const currentHref = valid ? shoppingPlanHref(path, query, plan.lines) : null;
  function navigate(next: readonly CartLine[]) {
    const href = shoppingPlanHref(path, query, next);
    if (!href || !currentHref) { setMessage(labels.planLimit); return; }
    if (pending.current) return;
    try { pending.current = true; window.location.assign(href); }
    catch { pending.current = false; setMessage(labels.planLimit); }
  }
  function change(result: PlanChange) {
    if (result.status === "invalid") setMessage(labels.planInvalidQuantity);
    else if (result.status === "limit") setMessage(labels.planLimit);
    else if (result.status === "unchanged") setMessage(labels.planUnchanged);
    else if ("lines" in result) navigate(result.lines);
  }
  const listingPath = storefrontHref("/products", routeLocale);
  const clear = shoppingPlanHref(listingPath, query, []) ?? listingPath;
  const cartHref = valid ? shoppingPlanCartHref(storefrontHref("/cart", routeLocale), plan, publicProducts) : null;
  return <PlanContext.Provider value={{ ids, visible, locale, disabled: !valid || !currentHref,
    toggle: (id, checked) => {
      if (!valid || !visible.some(product => product.publicId === id)) return;
      setSelection(previous => {
        const retained = previous.witness === witness ? previous.ids.filter(value => value !== id) : [];
        return { witness, ids: checked ? [...retained, id] : retained };
      });
    }, add: chosen => change(addPlanProducts(plan, chosen, visibleIds, publicProducts)) }}>
    {children}
    <section aria-labelledby={heading} className="mt-8 min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
      <h2 id={heading} className="break-words text-2xl">{labels.planHeading}</h2>
      <p className="mt-3 break-words text-sm">{labels.planNotice}</p>
      {!valid ? <><p role="status" className="mt-3 break-words">{labels.planInvalid}</p><a href={clear} className={`${control} mt-3 inline-flex`}>{labels.planDiscard}</a></> : <>
        {!currentHref && <p role="status" className="mt-3 break-words">{labels.planLimit}</p>}
        {visible.length > 0 && <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3">
          <p className="break-words text-sm">{labels.planPageSelection}: {ids.length} / {visible.length}</p>
          <button type="button" disabled={!ids.length || !currentHref} className={control}
            onClick={() => change(addPlanProducts(plan, visibleIds.filter(id => ids.includes(id)), visibleIds, publicProducts))}>{labels.planAddSelected}</button>
        </div>}
        <p className="mt-4 break-words text-sm">{labels.planLines}: {plan.lines.length} · {labels.planUnits}: {plan.lines.reduce((sum, line) => sum + BigInt(line.quantity), BigInt(0)).toString()}</p>
        {plan.status === "empty" ? <p className="mt-3 break-words">{labels.planEmpty}</p> : <ul className="mt-4 min-w-0 space-y-5">
          {resolved?.map((product, index) => {
            const line = plan.lines[index], name = product.name ?? labels.details;
            const detailQuery = new URLSearchParams(query);
            detailQuery.delete("pickFirst"); detailQuery.set("page", detailQuery.get("page") ?? "1");
            const detailHref = shoppingPlanHref(storefrontHref(`/products/${product.slug}`, routeLocale), `?${detailQuery}`, plan.lines);
            return <li key={line.publicId} className="min-w-0 break-words">
              <p className="text-sm">{product.brand}</p>
              {detailHref ? <a href={detailHref} className={`${control} inline-flex`}>{name}</a> : <p>{name}</p>}
              <p className="mt-2">{labels.planQuantity}: {line.quantity}</p>
              <PlannedQuantity key={`${line.publicId}-${line.quantity}`} line={line} name={name} locale={locale} apply={raw => change(setPlanQuantity(plan, line.publicId, raw, publicProducts))} />
              <button type="button" className={`${control} mt-3`} aria-label={`${labels.planRemove}: ${name}`}
                onClick={() => navigate(plan.lines.filter(item => item.publicId !== line.publicId))}>{labels.planRemove}</button>
            </li>;
          })}
        </ul>}
        {plan.status === "ready" && <div className="mt-5 flex min-w-0 flex-wrap gap-3">
          <a href={clear} className={control}>{labels.planClear}</a>
          {cartHref && <a href={cartHref} className={control}>{labels.planReviewCart}</a>}
          <CopyShoppingPlan key={`${witness}:${locale}`} context={{ plan, publishedIds, path: listingPath, query }} locale={locale} />
        </div>}
      </>}
      <p role="status" className="mt-3 break-words text-sm">{message}</p>
    </section>
  </PlanContext.Provider>;
}

/** Separate explicit action; no Cart/Favorites/Recent mutation or provider dependency. */
export function ShoppingPlanIntake({ context, ids, guard, locale, pair = false }: {
  context?: PlanIntakeContext; ids: readonly string[]; guard: () => boolean; locale: EditorialLocale; pair?: boolean;
}) {
  const labels = storefrontLabels[locale], ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const witness = { context, ids, guard, locale };
  const live = useRef<{ witness: typeof witness; location: string } | null>(null);
  useEffect(() => { live.current = { witness, location: typeof window === "undefined" ? "" : window.location.href }; return () => { live.current = null; }; });
  if (!context) return null;
  return <div className="mt-3 min-w-0">
    <button type="button" className={control} disabled={!ready || !ids.length || context.plan.status === "invalid"}
      onClick={() => {
        if (!ready || pending.current || live.current?.witness !== witness || live.current.location !== window.location.href) return;
        try {
          if (!guard()) { setMessage(labels.planChanged); return; }
          const result = planIntakeHref(context, ids);
          if (result.status !== "changed") { setMessage(result.status === "unchanged" ? labels.planUnchanged : result.status === "limit" ? labels.planLimit : labels.planInvalid); return; }
          if (live.current?.witness !== witness || live.current.location !== window.location.href || !guard()) { setMessage(labels.planChanged); return; }
          pending.current = true;
          window.location.assign(result.href);
        } catch { pending.current = false; setMessage(labels.planChanged); }
      }}>{pair ? labels.planAddPair : labels.planAddCollection}</button>
    <p role="status" className="mt-2 break-words text-sm">{message}</p>
  </div>;
}

function CopyShoppingPlan({ context, locale }: { context: PlanIntakeContext; locale: EditorialLocale }) {
  const labels = storefrontLabels[locale];
  const [copying, setCopying] = useState(false), [result, setResult] = useState<{ witness: string; message: string } | null>(null);
  const witness = JSON.stringify([context, locale]);
  const owner = useRef<{ witness: string; active: boolean; generation: number }>({ witness, active: false, generation: 0 });
  const pending = useRef(false);
  useEffect(() => {
    const current = owner.current; current.witness = witness; current.active = true; current.generation++;
    return () => { current.active = false; current.generation++; };
  }, [witness]);
  return <div className="min-w-0">
    <button type="button" disabled={copying} className={control} onClick={async () => {
      if (pending.current || !owner.current.active || owner.current.witness !== witness) return;
      const generation = owner.current.generation, location = window.location.href;
      const current = () => owner.current.active && owner.current.generation === generation && owner.current.witness === witness && window.location.href === location;
      const href = shoppingPlanShareLink(window.location.origin, context);
      if (!href) { setResult({ witness, message: labels.planCopyFailed }); return; }
      pending.current = true; setCopying(true); setResult(null);
      try {
        if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(href);
        if (current() && shoppingPlanShareLink(window.location.origin, context) === href) setResult({ witness, message: labels.planCopied });
      } catch { if (current()) setResult({ witness, message: labels.planCopyFailed }); }
      finally { pending.current = false; if (owner.current.active) setCopying(false); }
    }}>{labels.planCopy}</button>
    <p role="status" className="mt-2 break-words text-sm">{result?.witness === witness ? result.message : ""}</p>
  </div>;
}

export function ShoppingPlanCardActions({ publicId }: { publicId: string }) {
  const context = useContext(PlanContext);
  const product = context?.visible.find(product => product.publicId === publicId);
  if (!context || !product || context.disabled) return null;
  const labels = storefrontLabels[context.locale], name = product.name ?? labels.details;
  return <div className="mb-4 min-w-0">
    <label className="flex min-h-11 items-center gap-3 break-words"><input type="checkbox" checked={context.ids.includes(publicId)}
      className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2"
      onChange={event => context.toggle(publicId, event.target.checked)} />{labels.planSelect}: {name}</label>
    <button type="button" className={`${control} mt-2`} aria-label={`${labels.planAdd}: ${name}`} onClick={() => context.add([publicId])}>{labels.planAdd}</button>
  </div>;
}

/** Preserve the native GET form; refuse an oversized generated plan URL before submission. */
export function ShoppingPlanSearchGuard({ path, locale, children }: { path: string; locale: EditorialLocale; children: ReactNode }) {
  const [refused, setRefused] = useState(false);
  return <div className="contents" onSubmit={event => {
    if (!(event.target instanceof HTMLFormElement)) return;
    const values = new URLSearchParams();
    for (const [key, value] of new FormData(event.target)) if (typeof value === "string") values.append(key, value);
    if ((path + `?${values}`).length > 8192) { event.preventDefault(); setRefused(true); }
  }}>{children}{refused && <p role="status" className="mt-3 break-words">{storefrontLabels[locale].planLimit}</p>}</div>;
}
