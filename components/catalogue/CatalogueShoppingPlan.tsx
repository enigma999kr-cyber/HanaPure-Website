"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels, shoppingReadingClass } from "@/lib/storefront/localization";
import { addPlanProducts, setPlanQuantity, shoppingPlanHref, shoppingPlanCartHref, planIntakeHref, shoppingPlanShareLink, PLAN_RECOVERY_KEY, readPlanRecovery, savePlanRecovery, forgetPlanRecovery, type Recovery, type PlanIntakeContext, type ShoppingPlan, type PlanChange } from "@/lib/catalog/catalogue-shopping-plan";
import { resolvePortableLines } from "@/lib/cart/cart-portable-handoff";
import { validCartId, cartQuantity, type CartLine } from "@/lib/cart/cart-state";
import { useBrowserCart } from "@/lib/cart/browser-cart";
import { cartDraftImpact } from "@/lib/cart/cart-draft-impact";
import { plannedReview, changePlannedLines, readFreshPlanCart, EMPTY_PLAN_VIEW, type PlanReviewView } from "@/lib/catalog/shopping-plan-workspace";



/** An explicit restore intent lives only in this client module, never in storage/URL.
 * It is consumed once after the target URL AND published plan props have committed. */
let restoreIntent: { target: string; from: string; lines: string; expires: number; anchorTop: number | null } | null = null;

/** Manual last-saved copy only. A refreshed summary is not user acknowledgement. */
export function ShoppingPlanRecovery({ plan, path, query, publishedIds, locale, disabled }: {
  plan: ShoppingPlan; path: string; query: string; publishedIds: readonly string[]; locale: EditorialLocale; disabled: boolean;
}) {
  const labels = storefrontLabels[locale];
  const [saved, setSaved] = useState<Recovery | null>(null), [location, setLocation] = useState("");
  const [message, setMessage] = useState(""), [needsReview, setNeedsReview] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoringCopy = useRef<{ target: string; from: string; lines: string; expires: number } | null>(null);
  const [activation, setActivation] = useState<"check" | "save" | null>(null);
  const activationTimer = useRef<ReturnType<typeof setTimeout> | null>(null), activationSequence = useRef(0);
  const confirmedSave = useRef<{ raw: string; href: string } | null>(null);
  const locked = useRef(false), revision = useRef(0), checks = useRef(0), observed = useRef<string | null | undefined>(undefined);
  const recoveryRegion = useRef<HTMLElement>(null);
  const renderRevision = revision.current;
  const active = useRef<{ witness: string; location: string } | null>(null);
  const witness = JSON.stringify([plan, path, query, publishedIds, locale, disabled]);
  const products = publishedIds.map(publicId => ({ publicId }));
  const lock = (unavailable = false) => { locked.current = true; revision.current++; setNeedsReview(true); setMessage(unavailable ? labels.planRecoveryUnavailable : labels.planRecoveryConflict); };
  const load = () => {
    let next: Recovery;
    try { next = readPlanRecovery(window.localStorage, products); }
    catch { next = { status: "unavailable", raw: null }; }
    observed.current = next.raw; setSaved(next); setLocation(window.location.href);
    return next;
  };
  useEffect(() => {
    active.current = { witness, location: window.location.href };
    setActivation(null);
    const before = observed.current, next = load();
    if (before !== undefined && before !== next.raw) lock();
    // A committed target remount/render ends only the intentional Restore's busy state.
    const completed = restoringCopy.current;
    if (completed) {
      if (Date.now() > completed.expires || (window.location.href !== completed.from && window.location.href !== completed.target)) {
        setRestoring(false); setMessage(labels.planChanged); restoringCopy.current = null;
      } else if (completed.target === window.location.href && plan.status === "ready" &&
        completed.lines === JSON.stringify(plan.lines) && resolvePortableLines(plan.lines, products)) {
        setRestoring(false); setMessage(labels.planRestored); restoringCopy.current = null;
      } // URL alone or mismatched server props is still unconfirmed, not success.
    } else if (plan.status === "ready" && new URL(window.location.href).searchParams.has("cartPlan")) setRestoring(false);
    const changed = (event: StorageEvent) => {
      if (event.key !== PLAN_RECOVERY_KEY && event.key !== null) return;
      load(); lock(); // Read-only summary refresh must NEVER re-arm destructive actions.
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = null; window.removeEventListener("storage", changed);
      activationSequence.current++;
      if (activationTimer.current !== null) clearTimeout(activationTimer.current);
      activationTimer.current = null;
    };
  }, [witness]);
  const guard = (allowBusy = false) => !disabled && (allowBusy || !restoring) && renderRevision === revision.current &&
    active.current?.witness === witness && active.current.location === window.location.href;
  const href = plan.status === "ready" ? shoppingPlanHref(path, query, plan.lines) : null;
  const urlOwnsPlan = Boolean(location && new URL(location).searchParams.has("cartPlan"));
  const canRestore = saved?.status === "ready" && plan.status === "empty" && !urlOwnsPlan;
  function reviewed() {
    if (!guard() || locked.current || !saved) return false;
    let fresh: Recovery;
    try { fresh = readPlanRecovery(window.localStorage, products); } catch { lock(true); load(); return false; }
    if (fresh.status === "unavailable") { lock(true); load(); return false; }
    if (fresh.raw !== saved.raw || fresh.status !== saved.status) { lock(); load(); return false; }
    return true;
  }
  // Native click covers Enter, Space and pointer. CSS :active alone need not
  // survive Enter's click long enough to paint. This cue never grants a write.
  function acknowledge(control: "check" | "save") {
    if (disabled || active.current?.witness !== witness || active.current.location !== window.location.href ||
      (control === "save" && (restoring || locked.current || needsReview || !href || !saved || !["ready", "absent"].includes(saved.status)))) return;
    if (activationTimer.current !== null) clearTimeout(activationTimer.current);
    const sequence = ++activationSequence.current;
    setActivation(control);
    activationTimer.current = setTimeout(() => {
      if (activationSequence.current !== sequence || active.current?.witness !== witness) return;
      activationTimer.current = null; setActivation(null);
    }, 450);
  }
  // Inline transitionProperty wins over the ancestor's transition utility.
  // The acknowledgement is non-motion in both normal and reduced-motion modes.
  const idleActivationStyle = { transitionProperty: "none" };
  const activationStyle = { ...idleActivationStyle, backgroundColor: "var(--hanapure-beige)", color: "var(--hanapure-text)", boxShadow: "inset 0 -3px 0 var(--hanapure-text)" };
  const control = "min-h-11 max-w-full rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  return <section ref={recoveryRegion} data-plan-recovery tabIndex={-1} aria-label={labels.planRecoveryHeading} aria-busy={restoring}
    className={`mt-5 min-w-0 border-t border-hanapure-border pt-5 focus-visible:outline-2 focus-visible:outline-offset-2 ${shoppingReadingClass(locale)}`}>
    <h3 className="break-words text-lg">{labels.planRecoveryHeading}</h3>
    <p className="mt-2 break-words text-sm">{labels.planRecoveryNotice}</p>
    {saved && <p role="status" className="mt-3 rounded-xl border border-hanapure-border bg-hanapure-warm-white p-4 break-words text-base font-bold">{
      saved.status === "ready" ? `${labels.planRecoveryReady} · ${saved.lines.length} / ${cartQuantity(saved.lines)}` :
      saved.status === "absent" ? labels.planRecoveryAbsent : saved.status === "stale" ? labels.planRecoveryStale :
      saved.status === "invalid" ? labels.planRecoveryInvalid : labels.planRecoveryUnavailable
    }</p>}
    {urlOwnsPlan && <p className="mt-2 break-words text-sm">{labels.planRecoveryUrlPriority}</p>}
    <div className="mt-3 flex min-w-0 flex-wrap gap-3">
      <button type="button" className={`${control} motion-reduce:transition-none`} data-activation-feedback={activation === "save" ? "save" : undefined}
        style={activation === "save" ? activationStyle : idleActivationStyle} disabled={disabled || restoring || needsReview || !href || !saved || !["ready", "absent"].includes(saved.status)} onClick={() => {
        acknowledge("save");
        if (!href || !saved || !reviewed()) return;
        // Repeated native clicks after a render must not recommit our unchanged
        // confirmed copy. A different current plan or stored copy is a new intent.
        if (confirmedSave.current?.href === href && confirmedSave.current.raw === saved.raw) return;
        revision.current++;
        try {
          const result = savePlanRecovery(window.localStorage, saved.raw, href, products);
          if (result === "conflict") lock();
          else setMessage(result === "saved" ? labels.planRecoverySaved : result === "invalid" ? labels.planRecoveryInvalid : labels.planRecoveryUnavailable);
          const next = load();
          if (result === "saved" && next.status === "ready" && next.href === href) confirmedSave.current = { raw: next.raw, href };
        } catch { setMessage(labels.planRecoveryUnavailable); }
      }}>{saved?.status === "ready" ? labels.planRecoveryReplace : labels.planRecoverySave}</button>
      {canRestore && !disabled && <Link href={saved.href} scroll={false} aria-disabled={needsReview || restoring} className={`${control} ${needsReview || restoring ? "opacity-50" : ""}`}
        onClick={event => { if (!reviewed() || new URL(window.location.href).searchParams.has("cartPlan")) event.preventDefault(); }}
        onNavigate={event => {
          if (!reviewed() || new URL(window.location.href).searchParams.has("cartPlan")) { event.preventDefault(); return; }
          revision.current++;
          restoreIntent = { target: new URL(saved.href, window.location.href).href, from: window.location.href,
            lines: JSON.stringify(saved.lines), expires: Date.now() + 30_000,
            anchorTop: recoveryRegion.current?.getBoundingClientRect().top ?? null };
          restoringCopy.current = restoreIntent;
          setRestoring(true); setMessage(labels.planPending);
        }}>{labels.planRecoveryRestore}</Link>}
      <button type="button" className={control} disabled={disabled || restoring || needsReview || !saved || saved.raw === null} onClick={() => {
        if (!saved || saved.raw === null || !reviewed()) return;
        revision.current++;
        try {
          const result = forgetPlanRecovery(window.localStorage, saved.raw);
          if (result === "conflict") lock();
          else setMessage(result === "forgotten" ? labels.planRecoveryForgotten : labels.planRecoveryUnavailable);
          load();
          if (result === "forgotten") recoveryRegion.current?.focus({ preventScroll: true });
        } catch { setMessage(labels.planRecoveryUnavailable); }
      }}>{labels.planRecoveryForget}</button>
      <button type="button" className={`${control} motion-reduce:transition-none`} data-activation-feedback={activation === "check" ? "check" : undefined}
        style={activation === "check" ? activationStyle : idleActivationStyle} disabled={disabled} onClick={() => {
        acknowledge("check");
        if (!guard(true)) return;
        revision.current++;
        if (restoring) { restoreIntent = null; restoringCopy.current = null; setRestoring(false); }
        const next = load();
        // Only an explicit successful read is acknowledgement. Denied reads stay locked.
        locked.current = next.status === "unavailable"; setNeedsReview(locked.current);
        setMessage(next.status === "unavailable" ? labels.planRecoveryCheckFailed : `${labels.planRecoveryChecked} (${++checks.current}): ${next.status === "ready" ? labels.planRecoveryReady :
          next.status === "absent" ? labels.planRecoveryAbsent : next.status === "invalid" ? labels.planRecoveryInvalid :
          labels.planRecoveryStale}`);
      }}>{labels.planRecoveryReload}</button>
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 min-h-6 break-words text-sm font-semibold">{message}</p>
  </section>;
}


export type PlanProduct = Readonly<{ publicId: string; slug: string; brand: string; name: string | null }>;
const control = "min-h-11 max-w-full break-words min-w-0 rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50";
type Selection = { ids: readonly string[]; visible: readonly PlanProduct[]; locale: EditorialLocale; disabled: boolean;
  toggle: (id: string, checked: boolean) => void; add: (ids: readonly string[]) => void };
const PlanContext = createContext<Selection | null>(null);
const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function PlannedQuantity({ line, locale, name, apply, disabled }: { line: CartLine; locale: EditorialLocale; name: string; apply: (raw: string) => void; disabled: boolean }) {
  const id = useId(), labels = storefrontLabels[locale];
  const [draft, setDraft] = useState(String(line.quantity));
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  return <form className="mt-3 flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (ready && !disabled) apply(draft); }}>
    <div className="min-w-0"><label htmlFor={id} className="mb-2 block break-words text-sm">{labels.planQuantity}: {name}</label>
      <input id={id} type="number" min="1" step="1" required disabled={!ready || disabled} value={draft} onChange={event => setDraft(event.target.value)} className={`${control} w-28`} /></div>
    <button type="submit" disabled={!ready || disabled} className={control}>{labels.planSet}</button>
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
  const router = useRouter(), [transitionPending, startTransition] = useTransition();
  const region = useRef<HTMLElement>(null);
  const navigation = useRef<{ target: string; lines: string; witness: string; from: string; focus: Element | null; observed: boolean; failed: boolean } | null>(null);
  const currentHref = valid ? shoppingPlanHref(path, query, plan.lines) : null;
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const cart = useBrowserCart();
  const [view, setView] = useState<PlanReviewView>(EMPTY_PLAN_VIEW);
  const review = plannedReview(valid ? plan : { status: "invalid", lines: [] }, products, locale, view);
  const reviewWitness = JSON.stringify([path, query, plan, products, publishedIds, locale, view]);
  const [checked, setChecked] = useState<{ witness: string; ids: readonly string[] }>({ witness: reviewWitness, ids: [] });
  const checkedIds = checked.witness === reviewWitness ? checked.ids.filter(id => review.rows.some(row => row.line.publicId === id)) : [];
  const [bulkDraft, setBulkDraft] = useState("1");
  const storedCart = readFreshPlanCart(cart);
  const fresh = valid && plan.status === "ready" ? storedCart : null;
  const impact = fresh && plan.status === "ready" ? cartDraftImpact(fresh, plan.lines, publicProducts) : null;
  const fullOrder = !view.query && !view.brand && view.sort === "order";
  const attempt = { reviewWitness, cart };
  const active = useRef<{ attempt: typeof attempt; location: string } | null>(null);
  useEffect(() => {
    const cancelRestore = () => { restoreIntent = null; };
    window.addEventListener?.("popstate", cancelRestore);
    return () => window.removeEventListener?.("popstate", cancelRestore);
  }, []);
  useEffect(() => {
    const location = typeof window === "undefined" ? "" : window.location.href;
    active.current = { attempt, location };
    const restore = restoreIntent;
    if (restore) {
      if (Date.now() > restore.expires || (location !== restore.from && location !== restore.target)) restoreIntent = null;
      else if (location === restore.target && valid && plan.status === "ready" && JSON.stringify(plan.lines) === restore.lines &&
        currentHref && new URL(currentHref, location).href === restore.target && region.current) {
        restoreIntent = null; // Consume before DOM effects: never replay on Back/Forward/render.
        const recoveryRegion = region.current.querySelector<HTMLElement>("[data-plan-recovery]");
        // Retain the Recovery viewport context when restored Plan rows change layout.
        // Read the newly committed node, never a detached pre-navigation element.
        if (recoveryRegion && restore.anchorTop !== null && Number.isFinite(restore.anchorTop)) {
          const offset = recoveryRegion.getBoundingClientRect().top - restore.anchorTop;
          if (Number.isFinite(offset) && Math.abs(offset) > 1) window.scrollBy({ top: offset, behavior: "instant" });
        }
        (recoveryRegion ?? region.current).focus({ preventScroll: true });
        setMessage(labels.planRestored);
      }
    }
    const next = navigation.current;
    if (next && !next.failed) {
      if (transitionPending) next.observed = true;
      // Neither router.push returning nor an unrelated render proves RSC state committed.
      if (location === next.target && valid && witness !== next.witness && JSON.stringify(plan.lines) === next.lines) {
        navigation.current = null;
        pending.current = false;
        setMessage(`${labels.planLines}: ${plan.lines.length} · ${labels.planUnits}: ${plan.lines.reduce((sum, line) => sum + BigInt(line.quantity), BigInt(0))}`);
        if (next.focus && !next.focus.isConnected && document.activeElement === document.body) region.current?.focus({ preventScroll: true });
      } else if ((location !== next.from && location !== next.target) || (next.observed && !transitionPending)) {
        // Failed/aborted navigation stays locked until this workspace is remounted.
        next.failed = true;
        setMessage(labels.planChanged);
      }
    }
    return () => { active.current = null; };
  });
  function currentWorkspace() {
    return ready && valid && currentHref && active.current?.attempt === attempt && active.current.location === window.location.href;
  }
  function allowAction() {
    if (!currentWorkspace() || pending.current) { if (active.current) setMessage(labels.planChanged); return false; }
    return true;
  }
  function bulk(action: Parameters<typeof changePlannedLines>[4], ids = checkedIds) {
    if (!allowAction()) return;
    change(changePlannedLines(plan, ids, review.rows.map(row => row.line.publicId), publicProducts, action));
  }
  function changeView(next: PlanReviewView) { setView(next); setChecked({ witness: "", ids: [] }); }
  function navigate(next: readonly CartLine[]) {
    if (!allowAction()) return;
    const href = shoppingPlanHref(path, query, next);
    if (!href || !currentHref) { setMessage(labels.planLimit); return; }
    if (pending.current) return;
    try {
      const target = new URL(href, window.location.href), current = new URL(window.location.href);
      if (target.origin !== current.origin || target.pathname !== current.pathname || target.hash) { setMessage(labels.planChanged); return; }
      pending.current = true;
      navigation.current = { target: target.href, lines: JSON.stringify(next), witness, from: current.href,
        focus: document.activeElement, observed: false, failed: false };
      setMessage(labels.planPending);
      startTransition(() => router.push(href, { scroll: false }));
    } catch {
      if (navigation.current) navigation.current.failed = true;
      setMessage(labels.planChanged);
    }
  }
  function change(result: PlanChange) {
    if (!allowAction()) return;
    if (result.status === "invalid") setMessage(labels.planInvalidQuantity);
    else if (result.status === "limit") setMessage(labels.planLimit);
    else if (result.status === "unchanged") setMessage(labels.planUnchanged);
    else if ("lines" in result) navigate(result.lines);
  }
  const listingPath = storefrontHref("/products", routeLocale);
  const clear = shoppingPlanHref(listingPath, query, []) ?? listingPath;
  const cartHref = valid ? shoppingPlanCartHref(storefrontHref("/cart", routeLocale), plan, publicProducts) : null;
  return <PlanContext.Provider value={{ ids, visible, locale, disabled: !ready || !valid || !currentHref || pending.current || transitionPending,
    toggle: (id, checked) => {
      if (!valid || !visible.some(product => product.publicId === id)) return;
      setSelection(previous => {
        const retained = previous.witness === witness ? previous.ids.filter(value => value !== id) : [];
        return { witness, ids: checked ? [...retained, id] : retained };
      });
    }, add: chosen => change(addPlanProducts(plan, chosen, visibleIds, publicProducts)) }}>
    {children}
    <section ref={region} tabIndex={-1} aria-labelledby={heading} aria-busy={pending.current || transitionPending}
      className={`mt-8 min-w-0 scroll-mt-24 rounded-2xl border border-hanapure-border bg-hanapure-white p-5 focus-visible:outline-2 focus-visible:outline-offset-2 ${shoppingReadingClass(locale)}`}>
      <h2 id={heading} className="break-words text-2xl">{labels.planHeading}</h2>
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-hanapure-border bg-hanapure-warm-white p-4">
          <p className="break-words text-sm font-semibold">{labels.planCurrentSummary}</p>
          <p role="status" className="mt-2 break-words text-base font-bold">{labels.planLines}: {valid ? plan.lines.length : "—"} · {labels.planUnits}: {valid ? cartQuantity(plan.lines) : "—"}</p>
        </div>
        <p className="min-w-0 rounded-xl border border-hanapure-border p-4 break-words text-base font-semibold">{storedCart ? `${labels.planStoredCart}: ${storedCart.length} / ${cartQuantity(storedCart)}` : labels.planCartUnconfirmed}</p>
      </div>
      <p className="mt-3 break-words text-sm">{labels.planNotice}</p>
      {!valid ? <><p role="status" className="mt-3 break-words">{labels.planInvalid}</p><a href={clear} className={`${control} mt-3 inline-flex`}>{labels.planDiscard}</a></> : <>
        {!currentHref && <p role="status" className="mt-3 break-words">{labels.planLimit}</p>}
        {visible.length > 0 && <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3">
          <p className="rounded-xl border border-hanapure-border p-3 break-words text-base font-bold">{labels.planPageSelection}: {ids.length} / {visible.length}</p>
          <button type="button" disabled={!ids.length || !currentHref || pending.current || transitionPending} className={control}
            onClick={() => change(addPlanProducts(plan, visibleIds.filter(id => ids.includes(id)), visibleIds, publicProducts))}>{labels.planAddSelected}</button>
        </div>}
        {plan.status === "ready" && <div className="mt-4 min-w-0 space-y-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="min-w-0 break-words">{labels.planSearch}<input type="search" maxLength={200} value={view.query} className={`${control} mt-2 w-full`}
              onChange={event => changeView({ ...view, query: event.target.value.slice(0, 200) })} /></label>
            <label className="min-w-0 break-words">{labels.planBrand}<select value={view.brand} className={`${control} mt-2 w-full`} onChange={event => changeView({ ...view, brand: event.target.value })}>
              <option value="">{labels.allBrands}</option>{review.brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}</select></label>
            <label className="min-w-0 break-words">{labels.planSort}<select value={view.sort} className={`${control} mt-2 w-full`} onChange={event => changeView({ ...view, sort: event.target.value === "name" ? "name" : event.target.value === "brand" ? "brand" : "order" })}>
              <option value="order">{labels.planOriginal}</option><option value="name">{labels.nameAscending}</option><option value="brand">{labels.planBrand}</option></select></label>
            <button type="button" className={control} onClick={() => changeView(EMPTY_PLAN_VIEW)}>{labels.planResetView}</button>
          </div>
          <p role="status" className="rounded-xl border-2 border-hanapure-text bg-hanapure-warm-white p-4 break-words text-base font-bold">{labels.visibleResults}: {review.rows.length} / {review.total} · {labels.planSelected}: {checkedIds.length}</p>
          <div className="flex min-w-0 flex-wrap gap-3">
            <button type="button" className={control} disabled={!ready || !review.rows.length || pending.current || transitionPending} onClick={() => { if (allowAction()) setChecked({ witness: reviewWitness, ids: review.rows.map(row => row.line.publicId) }); }}>{labels.planSelectDisplayed}</button>
            <button type="button" className={control} disabled={!checkedIds.length} onClick={() => setChecked({ witness: reviewWitness, ids: [] })}>{labels.planClearSelection}</button>
            <button type="button" className={control} disabled={!ready || !checkedIds.length || !currentHref || pending.current || transitionPending} onClick={() => bulk({ kind: "remove" })}>{labels.planRemoveSelected} ({checkedIds.length})</button>
          </div>
          <form className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); bulk({ kind: "set", raw: bulkDraft }); }}>
            <label className="min-w-0 break-words">{labels.planBulkQuantity}<input type="number" min="1" step="1" required value={bulkDraft} disabled={!ready}
              className={`${control} mt-2 block w-28`} onChange={event => setBulkDraft(event.target.value)} /></label>
            <button type="submit" className={control} disabled={!ready || !checkedIds.length || !currentHref || pending.current || transitionPending}>{labels.planSetSelected}</button>
          </form>
          {!fullOrder && <p className="break-words text-sm">{labels.planReorderHint}</p>}
          <section aria-label={labels.planImpact} className="min-w-0 break-words text-sm">
            <h3>{labels.planImpact}</h3>
            {impact?.status === "ready" ? <>
              <p>{labels.planExistingLines}: {impact.existingLines} · {labels.planNewLines}: {impact.newLines} · {labels.planImpactUnits}: {impact.units}</p>
              <p>{labels.planNewOnlyNotice}: {impact.existingLines} / {impact.newLines}</p>
              <button type="button" className={`${control} mt-3`} disabled={!ready || !currentHref || !impact.existingLines || !impact.newLines} onClick={() => {
                if (!currentWorkspace() || !fresh || impact.status !== "ready") return;
                const latest = readFreshPlanCart(cart);
                if (!latest || latest !== fresh) { setMessage(labels.planImpactUnsafe); return; }
                const checkedImpact = cartDraftImpact(latest, plan.lines, publicProducts);
                if (checkedImpact.status !== "ready" || !checkedImpact.newLines || !checkedImpact.existingLines) { setMessage(labels.planImpactUnsafe); return; }
                const next = plan.lines.filter(line => !latest.some(item => item.publicId.toLowerCase() === line.publicId));
                if (!readFreshPlanCart(cart) || !currentWorkspace()) { setMessage(labels.planImpactUnsafe); return; }
                navigate(next);
              }}>{labels.planNewOnly}</button>
              {!impact.newLines && <p role="status">{labels.planAllOverlap}</p>}
            </> : <p role="status">{labels.planImpactUnsafe}</p>}
          </section>
        </div>}
        {plan.status === "empty" ? <p className="mt-3 break-words">{labels.planEmpty}</p> : <ul className="mt-4 min-w-0 space-y-5">
          {review.rows.map(({ product, line, index }) => {
            const name = product.name ?? labels.details;
            const detailQuery = new URLSearchParams(query);
            detailQuery.delete("pickFirst"); detailQuery.set("page", detailQuery.get("page") ?? "1");
            const detailHref = shoppingPlanHref(storefrontHref(`/products/${product.slug}`, routeLocale), `?${detailQuery}`, plan.lines);
            return <li key={line.publicId} className={`min-w-0 rounded-xl border-2 p-3 break-words ${checkedIds.includes(line.publicId) ? "border-hanapure-text bg-hanapure-warm-white" : "border-transparent"}`}>
              <label className="flex min-h-11 items-center gap-3 break-words"><input type="checkbox" disabled={!ready} checked={checkedIds.includes(line.publicId)} className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2"
                onChange={event => {
                  const enabled = event.target.checked;
                  if (currentWorkspace()) setChecked(previous => {
                    const ids = previous.witness === reviewWitness ? previous.ids.filter(id => id !== line.publicId && review.rows.some(row => row.line.publicId === id)) : [];
                    return { witness: reviewWitness, ids: enabled ? [...ids, line.publicId] : ids };
                  });
                }} /><span className="min-w-0 break-words">{labels.planSelectLine}: {name}</span></label>
              <p className="text-sm">{product.brand}</p>
              {detailHref ? <a href={detailHref} className={`${control} inline-flex`} onClick={event => { if (!allowAction()) event.preventDefault(); }}>{name}</a> : <p>{name}</p>}
              <p className="mt-2">{labels.planQuantity}: {line.quantity}</p>
              {impact?.status === "ready" && <p className="mt-2 break-words text-sm">{labels.planCurrent}: {impact.rows[index].current ?? labels.planAbsent} · {labels.planIncoming}: {impact.rows[index].added} · {labels.planExpected}: {impact.rows[index].expected}</p>}
              <PlannedQuantity key={`${line.publicId}-${line.quantity}`} line={line} name={name} locale={locale} disabled={pending.current || transitionPending} apply={raw => change(setPlanQuantity(plan, line.publicId, raw, publicProducts))} />
              <button type="button" className={`${control} mt-3`} disabled={!ready || pending.current || transitionPending} aria-label={`${labels.planRemove}: ${name}`}
                onClick={() => navigate(plan.lines.filter(item => item.publicId !== line.publicId))}>{labels.planRemove}</button>
              <div className="mt-3 flex min-w-0 flex-wrap gap-3">{([-1, 1] as const).map(direction => <button key={direction} type="button" className={control}
                disabled={!ready || !fullOrder || (direction === -1 ? index === 0 : index === plan.lines.length - 1)} aria-label={`${direction === -1 ? labels.planMoveUp : labels.planMoveDown}: ${name}`}
                onClick={() => { if (fullOrder) bulk({ kind: "move", direction }, [line.publicId]); }}>{direction === -1 ? labels.planMoveUp : labels.planMoveDown}</button>)}</div>
            </li>;
          })}
        </ul>}
        {plan.status === "ready" && !review.rows.length && <p role="status" className="mt-3 break-words">{labels.noResults}</p>}
        {plan.status === "ready" && <div className="mt-5 flex min-w-0 flex-wrap gap-3">
          <a href={clear} className={control} onClick={event => { if (!allowAction()) event.preventDefault(); }}>{labels.planClear}</a>
          {cartHref && <a href={cartHref} className={control} onClick={event => { if (!allowAction()) event.preventDefault(); }}>{labels.planReviewCart}</a>}
          <CopyShoppingPlan key={`${witness}:${locale}`} context={{ plan, publishedIds, path: listingPath, query }} locale={locale} />
        </div>}
      </>}
      <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 min-h-6 break-words text-sm font-semibold">{message}</p>
      <ShoppingPlanRecovery plan={plan} path={path} query={query} publishedIds={publishedIds} locale={locale}
        disabled={!ready || !valid || !currentHref || pending.current} />
    </section>
  </PlanContext.Provider>;
}

/** Separate explicit action; no Cart/Favorites/Recent mutation or provider dependency. */
export function ShoppingPlanIntake({ context, ids, guard, locale, pair = false }: {
  context?: PlanIntakeContext; ids: readonly string[]; guard: () => boolean; locale: EditorialLocale; pair?: boolean;
}) {
  const labels = storefrontLabels[locale], ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const [message, setMessage] = useState("");
  const [leaving, setLeaving] = useState(false);
  const pending = useRef(false);
  const witness = { context, ids, guard, locale };
  const live = useRef<{ witness: typeof witness; location: string } | null>(null);
  useEffect(() => { live.current = { witness, location: typeof window === "undefined" ? "" : window.location.href }; return () => { live.current = null; }; });
  if (!context) return null;
  return <div aria-busy={leaving} className={`mt-3 min-w-0 ${shoppingReadingClass(locale)}`}>
    <button type="button" className={control} disabled={!ready || leaving || !ids.length || context.plan.status === "invalid"}
      onClick={() => {
        if (!ready || pending.current || live.current?.witness !== witness || live.current.location !== window.location.href) return;
        try {
          if (!guard()) { setMessage(labels.planChanged); return; }
          const result = planIntakeHref(context, ids);
          if (result.status !== "changed") { setMessage(result.status === "unchanged" ? labels.planUnchanged : result.status === "limit" ? labels.planLimit : labels.planInvalid); return; }
          if (live.current?.witness !== witness || live.current.location !== window.location.href || !guard()) { setMessage(labels.planChanged); return; }
          pending.current = true;
          setLeaving(true); setMessage(labels.planPending);
          window.location.assign(result.href);
        } catch { pending.current = false; setLeaving(false); setMessage(labels.planChanged); }
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
  return <div className={`mb-4 min-w-0 ${shoppingReadingClass(context.locale)} ${context.ids.includes(publicId) ? "rounded-xl border border-hanapure-text bg-hanapure-warm-white p-3" : ""}`}>
    <label className="flex min-h-11 items-center gap-3 break-words"><input type="checkbox" checked={context.ids.includes(publicId)}
      className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2"
      onChange={event => context.toggle(publicId, event.target.checked)} /><span className="min-w-0 break-words">{labels.planSelect}: {name}</span></label>
    <button type="button" className={`${control} mt-2`} aria-label={`${labels.planAdd}: ${name}`} onClick={() => context.add([publicId])}>{labels.planAdd}</button>
  </div>;
}

/** Preserve the native GET form; refuse an oversized generated plan URL before submission. */
export function ShoppingPlanSearchGuard({ path, locale, children }: { path: string; locale: EditorialLocale; children: ReactNode }) {
  const router = useRouter(), [message, setMessage] = useState("");
  const [applying, beginApply] = useTransition();
  const inFlight = useRef<{ target: string; from: string; observed: boolean } | null>(null);
  useEffect(() => {
    const next = inFlight.current;
    if (!next) return;
    if (applying) next.observed = true;
    if (window.location.href === next.target) { inFlight.current = null; setMessage(storefrontLabels[locale].planApplyDone); }
    else if (window.location.href !== next.from || (next.observed && !applying)) {
      inFlight.current = null; setMessage(storefrontLabels[locale].planChanged);
    }
  });
  return <div aria-busy={applying} className={`contents [&[aria-busy=true]_button]:opacity-50 [&_button:active]:bg-hanapure-beige ${shoppingReadingClass(locale)}`} onSubmit={event => {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement) || !event.target.hasAttribute("data-catalogue-search")) return;
    const refuse = () => { event.preventDefault(); setMessage(storefrontLabels[locale].planLimit); };
    try {
      const form = event.target, submitter = (event.nativeEvent as SubmitEvent).submitter;
      if (!/^\/(?:(?:en|hu|ko)\/)?products$/.test(path) || new URL(window.location.href).pathname !== path ||
        !event.currentTarget.contains(form) || form.getAttribute("action") !== path || form.method.toLowerCase() !== "get" ||
        (form.target && form.target !== "_self")) { refuse(); return; }
      if (submitter && (!(submitter instanceof HTMLElement) ||
        (submitter.hasAttribute("formaction") && submitter.getAttribute("formaction") !== path) ||
        (submitter.hasAttribute("formmethod") && submitter.getAttribute("formmethod")?.toLowerCase() !== "get") ||
        (submitter.hasAttribute("formtarget") && submitter.getAttribute("formtarget") !== "_self") ||
        (submitter instanceof HTMLInputElement && submitter.type === "image"))) { refuse(); return; }
      const values = new URLSearchParams();
      for (const [key, value] of new FormData(form, submitter)) {
        if (typeof value !== "string") { refuse(); return; }
        values.append(key, value);
      }
      const href = path + `?${values}`;
      if (href.length > 8192) { refuse(); return; }
      event.preventDefault();
      // Identical pending submits are duplicates; changed filters are a new intent.
      if (inFlight.current?.target === new URL(href, window.location.href).href) return;
      inFlight.current = { target: new URL(href, window.location.href).href, from: window.location.href, observed: false };
      setMessage(storefrontLabels[locale].planApplyPending);
      beginApply(() => router.push(href, { scroll: false }));
    } catch { inFlight.current = null; event.preventDefault(); setMessage(storefrontLabels[locale].planChanged); }
  }}>{children}{message && <p role="status" className="mt-3 break-words">{message}</p>}</div>;
}
