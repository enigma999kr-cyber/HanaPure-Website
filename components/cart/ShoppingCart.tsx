"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { EditorialImage, EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import { CART_STORAGE_KEY, inspectStoredCart, reconcileCart } from "@/lib/cart/cart-state";
import type { CartLine } from "@/lib/cart/cart-state";
import { changeBrowserCart, resetBrowserCart, restoreBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { canUndoCart, createCartUndoPlan, sameCartSelection, type CartUndoPlan } from "@/lib/cart/cart-undo";
import { useBrowserFavorites } from "@/lib/favorites/browser-favorites";
import { MAX_FAVORITES } from "@/lib/favorites/favorite-state";
import { saveCartLineForLater } from "@/lib/cart/save-for-later";
import { formatCartShoppingList } from "@/lib/cart/cart-shopping-list";
import { selectedCartLines, readBulkSelection, removeSelectedCartLines } from "@/lib/cart/cart-bulk-actions";
import { moveCartSelectionToSaved } from "@/lib/cart/shopping-session-bulk";
import { cartSelectionSummary, savedProductOverlap } from "@/lib/cart/cart-selection-summary";
import { cartControl } from "./AddToCart";
import { setDetailCartQuantity, detailSelectionNeedsReload, type DetailCartSnapshot, type DetailSelectionResult } from "@/lib/cart/detail-cart-selection";
import { stepQuantityDraft } from "@/lib/cart/quantity-draft-controls";
import { cartReviewView, EMPTY_CART_REVIEW, CART_REVIEW_QUERY_LIMIT, CART_REVIEW_BRAND_LIMIT, type CartReviewCriteria } from "@/lib/cart/cart-review-view";
import { COMPARISON_DESTINATION, comparisonHref, publishedComparison } from "@/lib/comparison/compare-selection";
import ProductImage from "@/components/catalogue/ProductImage";
import { cartRowId, cartRowFromHash } from "@/lib/cart/quick-add-continuity";
import { portableCartLink, readPortableLink, resolvePortableLines, planPortableMerge } from "@/lib/cart/cart-portable-handoff";
import { shoppingPlanHref } from "@/lib/catalog/catalogue-shopping-plan";
import { cartDraftImpact } from "@/lib/cart/cart-draft-impact";
import { currentCartPlanHref } from "@/lib/catalog/shopping-plan-workspace";

export type CartProduct = Readonly<{ publicId: string; slug: string; brand: string;
  names: Readonly<Record<EditorialLocale, string | null>>; image?: EditorialImage | null }>;

function portableLocation() { return typeof window === "undefined" ? "" : window.location?.href ?? ""; }
function subscribePortableLocation(notify: () => void) {
  window.addEventListener("popstate", notify); window.addEventListener("hashchange", notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener("hashchange", notify); };
}
function portableServerLocation() { return ""; }
type PortableFailure = "conflict" | "unavailable" | "write-failed" | "invalid" | "overflow";

/** Read the entire persisted selection, allowing a virgin key only for an empty witness. */
function readPortableSnapshot(cart: DetailCartSnapshot): { status: "ready"; lines: readonly CartLine[] } | { status: "conflict" | "unavailable" } {
  if (typeof window === "undefined" || !cart.ready || cart.invalid || !cart.persistent) return { status: "unavailable" };
  try {
    const expected = inspectStoredCart(JSON.stringify({ version: 1, lines: cart.lines }));
    const stored = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
    if (expected.invalid || stored.invalid) return { status: "unavailable" };
    return sameCartSelection(stored.lines, expected.lines) ? { status: "ready", lines: stored.lines } : { status: "conflict" };
  } catch { return { status: "unavailable" }; }
}

/** Existing store pathway + full witnesses/readback. localStorage is NOT atomic cross-tab CAS. */
function mergePortableDraft(href: string, cart: DetailCartSnapshot, products: readonly CartProduct[], publicationCurrent: () => boolean):
  { status: "merged"; after: readonly CartLine[] } | { status: PortableFailure } {
  const incoming = readPortableLink(href);
  if (incoming.status !== "ready" || !resolvePortableLines(incoming.lines, products)) return { status: "invalid" };
  if (portableLocation() !== href || !publicationCurrent()) return { status: "conflict" };
  const fresh = readPortableSnapshot(cart);
  if (fresh.status !== "ready") return fresh;
  const planned = planPortableMerge(fresh.lines, incoming.lines, products);
  if (planned.status !== "ready") return planned;
  let refusal: PortableFailure | null = null;
  let attempted = false;
  try {
    const result = changeBrowserCart(current => {
      const latest = readPortableSnapshot(cart);
      const draft = readPortableLink(portableLocation());
      if (latest.status !== "ready") refusal = latest.status;
      else if (current !== cart.lines || !sameCartSelection(current, fresh.lines) || portableLocation() !== href || !publicationCurrent() ||
        draft.status !== "ready" || draft.signature !== incoming.signature || !resolvePortableLines(draft.lines, products)) refusal = "conflict";
      if (refusal) throw new Error("Portable draft witness changed");
      attempted = true;
      return planned.after;
    });
    if (!result) return { status: "unavailable" };
    if (!result.persistent) return { status: "write-failed" };
    const raw = window.localStorage.getItem(CART_STORAGE_KEY), confirmed = inspectStoredCart(raw);
    if (raw === null || confirmed.invalid || !sameCartSelection(confirmed.lines, planned.after) || portableLocation() !== href ||
      !publicationCurrent() || !resolvePortableLines(incoming.lines, products)) return { status: "write-failed" };
    return { status: "merged", after: planned.after };
  } catch { return { status: refusal ?? (attempted ? "write-failed" : "unavailable") }; }
}

type PortableCartProps = Readonly<{ products: readonly CartProduct[]; cart: DetailCartSnapshot;
  locale: EditorialLocale; routeLocale: EditorialLocale | null; visiblePublicIds?: readonly string[];
  onMerged: (after: readonly CartLine[]) => void; onUncertain: () => void }>;

function PortableCartHandoff(props: PortableCartProps) {
  const href = useSyncExternalStore(subscribePortableLocation, portableLocation, portableServerLocation);
  // In-page row/navigation hashes must never reset an already consumed draft.
  return <PortableCartPanel key={href.split("#")[0]} {...props} href={href} />;
}

function PortableCartPanel({ products, cart, locale, routeLocale, href, onMerged, onUncertain, visiblePublicIds = [] }: PortableCartProps & { href: string }) {
  const labels = cartLabels[locale], headingId = useId();
  const planLabels = storefrontLabels[locale];
  const incoming = readPortableLink(href);
  const resolved = incoming.status === "ready" ? resolvePortableLines(incoming.lines, products) : null;
  const healthy = cart.ready && !cart.invalid && cart.persistent;
  const hasPublicItems = cart.lines.some(line => products.some(product => product.publicId.toLowerCase() === line.publicId.toLowerCase()));
  const [copyingDraft, setCopyingDraft] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [mergeFeedback, setMergeFeedback] = useState("");
  const [locked, setLocked] = useState(false);
  const [mergedReview, setMergedReview] = useState<{ after: readonly CartLine[]; products: readonly CartProduct[];
    locale: EditorialLocale; routeLocale: EditorialLocale | null; signature: string } | null>(null);
  const fresh = healthy ? readPortableSnapshot(cart) : null;
  const impact = !locked && incoming.status === "ready" && resolved && fresh?.status === "ready" ? cartDraftImpact(fresh.lines, incoming.lines, products) : null;
  const editHref = !locked && incoming.status === "ready" && resolved ? shoppingPlanHref(storefrontHref("/products", routeLocale), "", incoming.lines) : null;
  const reviewCurrent = mergedReview && healthy && incoming.status === "ready" && resolved &&
    mergedReview.signature === incoming.signature && mergedReview.after === cart.lines && mergedReview.products === products &&
    mergedReview.locale === locale && mergedReview.routeLocale === routeLocale && fresh?.status === "ready";
  const reviewRows = reviewCurrent && incoming.status === "ready" ? incoming.lines.filter(line => visiblePublicIds.includes(line.publicId)) : [];
  const copyPending = useRef(false), confirmationUsed = useRef(false);
  const live = useRef<null | { cart: DetailCartSnapshot; products: readonly CartProduct[]; locale: EditorialLocale; routeLocale: EditorialLocale | null; href: string }>(null);
  useEffect(() => {
    live.current = { cart, products, locale, routeLocale, href };
    return () => { live.current = null; };
  }, [cart, products, locale, routeLocale, href]);
  function contextIsCurrent() {
    const current = live.current;
    return current && current.cart.lines === cart.lines && current.cart.ready && current.cart.persistent && !current.cart.invalid &&
      current.products === products && current.locale === locale && current.routeLocale === routeLocale && current.href === href && portableLocation() === href;
  }
  function copyResult(status: string) {
    return status === "empty" ? labels.portableEmpty : status === "too-large" ? labels.portableTooLarge :
      status === "conflict" ? labels.portableConflict : labels.portableCopyFailed;
  }
  return <section aria-labelledby={headingId} className="mt-6 min-w-0 rounded-2xl border border-hanapure-border p-4">
    <h2 id={headingId} className="break-words text-xl">{labels.portableTitle}</h2>
    <p className="mt-3 break-words text-sm">{labels.portableNotice}</p>
    <button type="button" disabled={!healthy || !href || copyingDraft || !hasPublicItems}
      className={`${cartControl} mt-4 max-w-full whitespace-normal break-words disabled:opacity-50`} onClick={async () => {
        if (copyPending.current || !healthy || !contextIsCurrent()) return;
        const fresh = readPortableSnapshot(cart);
        if (fresh.status !== "ready") { setCopyFeedback(copyResult(fresh.status)); return; }
        let origin: string;
        try { origin = new URL(href).origin; } catch { setCopyFeedback(labels.portableCopyFailed); return; }
        const path = storefrontHref("/cart", routeLocale);
        const link = portableCartLink(origin, path, fresh.lines, products);
        if (link.status !== "ready") { setCopyFeedback(copyResult(link.status)); return; }
        copyPending.current = true; setCopyingDraft(true); setCopyFeedback("");
        try {
          if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(link.url);
          if (!live.current) return;
          const current = readPortableSnapshot(cart);
          const checked = current.status === "ready" ? portableCartLink(origin, path, current.lines, products) : null;
          setCopyFeedback(contextIsCurrent() && checked?.status === "ready" && checked.url === link.url && checked.omitted === link.omitted ?
            `${labels.portableCopied} ${labels.portableOmitted}: ${link.omitted}.` : labels.portableConflict);
        } catch { if (live.current) setCopyFeedback(labels.portableCopyFailed); }
        finally { copyPending.current = false; if (live.current) setCopyingDraft(false); }
      }}>{labels.portableCopy}</button>
    <p role="status" className="mt-3 break-words text-sm">{copyFeedback || (!cart.ready ? labels.loading : !healthy ? labels.portableUnavailable : !hasPublicItems ? labels.portableEmpty : "")}</p>
    {incoming.status !== "none" && <div className="mt-5 min-w-0 border-t border-hanapure-border pt-4">
      <h3 className="break-words text-lg">{labels.portablePreview}</h3>
      {incoming.status !== "ready" || !resolved ? <p role="status" className="mt-3 break-words">{labels.portableInvalid}</p> : <>
        <dl className="mt-3 break-words text-sm"><div><dt>{labels.portableLines}</dt><dd>{incoming.lines.length}</dd></div>
          <div><dt>{labels.portableUnits}</dt><dd>{incoming.units}</dd></div></dl>
        <ul aria-label={labels.portablePreview} className="mt-3 min-w-0 space-y-2">
          {resolved.map((product, index) => <li key={incoming.lines[index].publicId} className="min-w-0 break-words">
            {product.names[locale] ?? storefrontLabels[locale].details} — {labels.quantity}: {incoming.lines[index].quantity}
          </li>)}
        </ul>
        {!locked && <section aria-label={planLabels.planImpact} className="mt-4 min-w-0 break-words text-sm">
          <h4>{planLabels.planImpact}</h4>
          {impact?.status === "ready" ? <>
            <p>{planLabels.planNewLines}: {impact.newLines} · {planLabels.planExistingLines}: {impact.existingLines} · {planLabels.planImpactUnits}: {impact.units}</p>
            <ul className="mt-3 min-w-0 space-y-3">{impact.rows.map((row, index) => <li key={row.publicId} className="min-w-0 break-words">
              <p>{resolved[index].names[locale] ?? planLabels.details}</p>
              <dl><div><dt>{planLabels.planCurrent}</dt><dd>{row.current ?? planLabels.planAbsent}</dd></div>
                <div><dt>{planLabels.planIncoming}</dt><dd>{row.added}</dd></div><div><dt>{planLabels.planExpected}</dt><dd>{row.expected}</dd></div></dl>
            </li>)}</ul>
          </> : <p role="status">{planLabels.planImpactUnsafe}</p>}
        </section>}
        {editHref && <a href={editHref} className={`${cartControl} mt-4 inline-flex max-w-full break-words`}>{planLabels.planEditDraft}</a>}
        <button type="button" disabled={!healthy || locked} className={`${cartControl} mt-4 max-w-full whitespace-normal break-words disabled:opacity-50`}
          onClick={() => {
            if (!healthy || confirmationUsed.current) return;
            confirmationUsed.current = true; setLocked(true);
            if (!contextIsCurrent()) { setMergeFeedback(labels.portableConflict); return; }
            const result = mergePortableDraft(href, cart, products, () => {
              const current = live.current;
              return current !== null && current.products === products && current.href === href && current.locale === locale && current.routeLocale === routeLocale;
            });
            if (result.status === "merged") {
              setMergedReview({ after: result.after, products, locale, routeLocale, signature: incoming.signature });
              onMerged(result.after); setMergeFeedback(labels.portableMerged);
            }
            else {
              if (result.status === "write-failed" || result.status === "unavailable" || result.status === "conflict") onUncertain();
              setMergeFeedback(result.status === "overflow" ? labels.portableOverflow : result.status === "conflict" ? labels.portableConflict :
                result.status === "write-failed" ? labels.portableWriteFailed : result.status === "invalid" ? labels.portableInvalid : labels.portableUnavailable);
            }
          }}>{labels.portableMerge}</button>
        <p role="status" className="mt-3 break-words text-sm">{mergeFeedback}</p>
        {reviewCurrent && incoming.status === "ready" && <nav aria-label={planLabels.planReviewSaved} className="mt-4 flex min-w-0 flex-wrap gap-3">
          {reviewRows.map(line => {
            const target = cartRowId(line.publicId), product = products.find(item => item.publicId.toLowerCase() === line.publicId);
            return target && product ? <a key={line.publicId} href={`#${target}`} className={`${cartControl} max-w-full break-words`}>
              {product.names[locale] ?? planLabels.details}</a> : null;
          })}
          {reviewRows.length < incoming.lines.length && <p role="status" className="w-full break-words text-sm">{planLabels.planReviewHidden}</p>}
        </nav>}
      </>}
    </div>}
  </section>;
}

function QuantityForm({ publicId, quantity, name, locale, cart, announce }: {
  publicId: string; quantity: number; name: string; locale: EditorialLocale; cart: DetailCartSnapshot; announce: (result: DetailSelectionResult) => void;
}) {
  const labels = cartLabels[locale];
  const [draft, setDraft] = useState({ quantity, value: String(quantity) });
  const editable = cart.ready && !cart.invalid && cart.persistent;
  if (editable && draft.quantity !== quantity) setDraft({ quantity, value: String(quantity) });
  const id = `cart-${publicId}`;
  return <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault();
    if (!editable) return;
    announce(setDetailCartQuantity(publicId, draft.value, cart));
  }}>
    <div className="min-w-0 max-w-full"><label htmlFor={id} className="mb-2 block break-words text-sm">{labels.draftQuantity}: {name}</label>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <button type="button" disabled={!editable || stepQuantityDraft(draft.value, -1) === null}
          aria-label={`${labels.decreaseDraft}: ${name}`} className={`${cartControl} min-w-11 disabled:opacity-50`} onClick={() => {
            const value = stepQuantityDraft(draft.value, -1); if (editable && value !== null) setDraft({ quantity, value });
          }}>−</button>
      <input id={id} type="number" min="1" step="1" required value={draft.value}
        onChange={event => setDraft({ quantity, value: event.target.value })} className={`${cartControl} w-28 max-w-full bg-hanapure-white`} />
        <button type="button" disabled={!editable || stepQuantityDraft(draft.value, 1) === null} aria-label={`${labels.increaseDraft}: ${name}`}
          className={`${cartControl} min-w-11 disabled:opacity-50`} onClick={() => {
            const value = stepQuantityDraft(draft.value, 1); if (editable && value !== null) setDraft({ quantity, value });
          }}>+</button>
      </div>
    </div>
    <button type="submit" disabled={!editable} className={`${cartControl} disabled:opacity-50`}>{labels.update}</button>
  </form>;
}
export default function ShoppingCart({ products, locale, routeLocale }: {
  products: readonly CartProduct[]; locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const snapshot = useBrowserCart();
  const [quantityTrusted, setQuantityTrusted] = useState(true);
  const cart = quantityTrusted ? snapshot : { ...snapshot, persistent: false };
  const [review, setReview] = useState<CartReviewCriteria>(EMPTY_CART_REVIEW);
  const view = cartReviewView(cart.lines, products, locale, review);
  const viewReady = cart.ready && !cart.invalid && cart.persistent;
  const visibleIds = new Set(view.rows.map(({ line }) => line.publicId.toLowerCase()));
  const navigationId = useId();
  const canNavigate = cart.ready && !cart.invalid && cart.persistent && cart.lines.length > 0;
  const favorites = useBrowserFavorites();
  const labels = cartLabels[locale];
  const [message, setMessage] = useState("");
  const resumeWitness = { cart, products, locale, routeLocale };
  const resumeLive = useRef<{ witness: typeof resumeWitness; href: string } | null>(null);
  useEffect(() => { resumeLive.current = { witness: resumeWitness, href: portableLocation() }; return () => { resumeLive.current = null; }; });
  const [undo, setUndo] = useState<CartUndoPlan | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const copyPending = useRef(false);
  const [checked, setChecked] = useState<{ lines: readonly CartLine[]; ids: readonly string[] }>({ lines: cart.lines, ids: [] });
  const [bulkMessage, setBulkMessage] = useState("");
  const [selectedCopyMessage, setSelectedCopyMessage] = useState("");
  const [copyingSelected, setCopyingSelected] = useState(false);
  const selectedCopyPending = useRef(false);
  const coherentSelection = checked.lines === cart.lines && checked.ids.every(id => visibleIds.has(id.toLowerCase()));
  const selected = coherentSelection ? selectedCartLines(cart.lines, checked.ids) ?? [] : [];
  const bulkReady = coherentSelection && cart.ready && !cart.invalid && cart.persistent && selected.length > 0;
  const selectedPublic = reconcileCart(selected, products).some(item => item.product !== null);
  const summary = coherentSelection ? cartSelectionSummary(cart, checked.lines, checked.ids, products) : null;
  const compared = bulkReady && selected.length === 2 ? publishedComparison(products,
    { first: selected[0].publicId, second: selected[1].publicId }) : null;
  const compareHref = compared ? comparisonHref(storefrontHref("/products", routeLocale), compared) : null;
  const browseRef = useRef<HTMLAnchorElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoredFocus = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const handledRowHash = useRef("");
  const items = reconcileCart(cart.lines, products);
  const undoAvailable = undo && cart.ready && cart.persistent && !cart.invalid && canUndoCart(undo, cart.lines);
  function changeReview(next: CartReviewCriteria) {
    if (!viewReady) return;
    setReview(next);
    if (next.query !== review.query || next.brand !== review.brand || next.unpublishedOnly !== review.unpublishedOnly) setChecked({ lines: cart.lines, ids: [] });
    setBulkMessage(""); setSelectedCopyMessage("");
  }
  useEffect(() => {
    if (restoredFocus.current) {
      (removeRefs.current.get(restoredFocus.current) ?? browseRef.current)?.focus();
      restoredFocus.current = null;
    }
  }, [cart.lines]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    function focusRequestedRow() {
      if (!cart.ready || cart.invalid || !cart.persistent || !window.location) return;
      const hash = window.location.hash;
      if (typeof hash !== "string") return;
      if (handledRowHash.current === hash) return;
      handledRowHash.current = hash;
      const target = cartRowFromHash(hash);
      const row = target ? rowRefs.current.get(target) : null;
      if (row) { row.scrollIntoView({ block: "nearest" }); row.focus({ preventScroll: true }); }
    }
    focusRequestedRow();
    const onHashChange = () => { handledRowHash.current = ""; focusRequestedRow(); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [cart.ready, cart.invalid, cart.persistent, cart.lines, products, review]);
  function removeSelection(change: (lines: readonly CartLine[]) => readonly CartLine[], success: string) {
    if (!cart.ready || cart.invalid || !cart.persistent) return;
    let plan: CartUndoPlan | null = null;
    const result = changeBrowserCart(lines => {
      const after = change(lines);
      if (cart.ready && cart.persistent && !cart.invalid) plan = createCartUndoPlan(lines, after);
      // The stored post-action array is also the reference witness for this single Undo.
      return plan?.after ?? after;
    });
    setUndo(result?.persistent ? plan : null);
    setMessage(!result ? labels.undoChanged : !result.persistent ? labels.storage : plan ? success : labels.updated);
  }
  return <>
    <p className="mt-5 leading-7 text-hanapure-muted">{labels.notice}</p>
    {!cart.persistent && <p role="status" className="mt-4">{labels.storage}</p>}
    {cart.invalid && <div className="mt-4">
      <p role="status">{labels.invalidStorage}</p>
      <button type="button" className={`${cartControl} mt-3`} onClick={() => {
        browseRef.current?.focus(); setUndo(null); resetBrowserCart(); setMessage(labels.updated);
      }}>{labels.reset}</button>
    </div>}
    <section aria-labelledby={`${navigationId}-review`} className="mt-6 min-w-0 rounded-2xl border border-hanapure-border p-4">
      <h2 id={`${navigationId}-review`} className="break-words text-xl">{labels.review}</h2>
      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-3">
        <div className="min-w-0"><label htmlFor={`${navigationId}-search`} className="mb-2 block break-words text-sm">{labels.find}</label>
          <input id={`${navigationId}-search`} type="search" maxLength={CART_REVIEW_QUERY_LIMIT} value={review.query} disabled={!viewReady}
            className={`${cartControl} w-full min-w-0 max-w-full disabled:opacity-50`}
            onChange={event => changeReview({ ...review, query: event.target.value.slice(0, CART_REVIEW_QUERY_LIMIT) })} /></div>
        <div className="min-w-0"><label htmlFor={`${navigationId}-brand`} className="mb-2 block break-words text-sm">{labels.reviewBrand}</label>
          <select id={`${navigationId}-brand`} value={review.brand} disabled={!viewReady} className={`${cartControl} w-full min-w-0 max-w-full disabled:opacity-50`}
            onChange={event => changeReview({ ...review, brand: event.target.value.slice(0, CART_REVIEW_BRAND_LIMIT) })}>
            <option value="">{labels.allReviewBrands}</option>{view.brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
          </select></div>
        <div className="min-w-0"><label htmlFor={`${navigationId}-sort`} className="mb-2 block break-words text-sm">{labels.reviewSort}</label>
          <select id={`${navigationId}-sort`} value={review.sort} disabled={!viewReady} className={`${cartControl} w-full min-w-0 max-w-full disabled:opacity-50`}
            onChange={event => changeReview({ ...review, sort: event.target.value === "name" || event.target.value === "quantity" ? event.target.value : "original" })}>
            <option value="original">{labels.originalOrder}</option><option value="name">{labels.nameOrder}</option><option value="quantity">{labels.quantityOrder}</option>
          </select></div>
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap gap-3">
        <button type="button" disabled={!viewReady} className={`${cartControl} max-w-full break-words disabled:opacity-50`}
          onClick={() => changeReview(EMPTY_CART_REVIEW)}>{labels.resetReview}</button>
        <button type="button" disabled={!viewReady || view.unpublishedTotal === 0} aria-pressed={review.unpublishedOnly}
          className={`${cartControl} max-w-full break-words disabled:opacity-50`}
          onClick={() => { if (viewReady && view.unpublishedTotal > 0) changeReview({ ...review, query: "", brand: "", unpublishedOnly: !review.unpublishedOnly }); }}>{labels.reviewUnpublished}</button>
        <button type="button" disabled={!viewReady || view.unpublishedTotal === 0} className={`${cartControl} max-w-full break-words disabled:opacity-50`}
          onClick={() => {
            if (!viewReady || view.unpublishedTotal === 0) return;
            setReview({ ...review, query: "", brand: "", unpublishedOnly: true });
            setChecked({ lines: cart.lines, ids: items.filter(item => !item.product).map(item => item.line.publicId) });
            setBulkMessage(""); setSelectedCopyMessage("");
          }}>{labels.selectUnpublished}</button>
      </div>
      {viewReady ? <dl aria-label={labels.review} className="mt-4 min-w-0 space-y-2 break-words text-sm" aria-live="polite">
        <div><dt>{labels.visibleLines}</dt><dd>{view.rows.length} / {view.total}</dd></div>
        <div><dt>{labels.visibleUnits}</dt><dd>{view.units}</dd></div>
        <div><dt>{labels.visibleUnpublished}</dt><dd>{view.unpublished}</dd></div>
        <div><dt>{labels.unpublishedCount}</dt><dd>{view.unpublishedTotal}</dd></div>
      </dl> : <p role="status" className="mt-4 break-words text-sm">{labels.selectionUnknown}</p>}
    </section>
    {!cart.ready ? <p className="mt-8">{labels.loading}</p> : cart.lines.length === 0 ? <p className="mt-8 text-xl">{labels.empty}</p> : <>
      {canNavigate && <nav aria-label={labels.cartNavigation} className="mt-6 flex min-w-0 flex-wrap gap-3">
        <a href={`#${navigationId}-actions`} className={`${cartControl} inline-flex min-w-0 max-w-full items-center break-words`}>{labels.jumpToActions}</a>
      </nav>}
      <ul id={canNavigate ? `${navigationId}-rows` : undefined} tabIndex={canNavigate ? -1 : undefined} aria-label={labels.cartRows}
        className="mt-8 scroll-mt-24 space-y-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
        {view.rows.map(({ line, product, originalIndex }, visibleIndex) => {
          const name = product?.names[locale] ?? storefrontLabels[locale].details;
          const image = product ? products.find(item => item.publicId.toLowerCase() === line.publicId.toLowerCase())?.image : null;
          const rowId = product && viewReady ? cartRowId(product.publicId) : null;
          return <li key={line.publicId} id={rowId ?? undefined} tabIndex={rowId ? -1 : undefined}
            ref={node => { if (rowId) { if (node) rowRefs.current.set(rowId, node); else rowRefs.current.delete(rowId); } }}
            className="min-w-0 scroll-mt-24 rounded-2xl border border-hanapure-border bg-hanapure-white p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
            <label className="mb-3 flex min-h-11 min-w-0 items-center gap-3 break-words">
              <input type="checkbox" checked={selected.some(item => item.publicId.toLowerCase() === line.publicId.toLowerCase())}
                disabled={!cart.ready || cart.invalid || !cart.persistent}
                className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
                onChange={event => {
                  if (!viewReady) return;
                  const enabled = event.target.checked;
                  setChecked(previous => {
                    const remaining = (previous.lines === cart.lines ? previous.ids : []).filter(id => visibleIds.has(id.toLowerCase()) && id.toLowerCase() !== line.publicId.toLowerCase());
                    return { lines: cart.lines, ids: enabled ? [...remaining, line.publicId] : remaining };
                  });
                  setBulkMessage(""); setSelectedCopyMessage("");
                }} />
              <span className="min-w-0 break-words">{labels.selectCartItem}: {product ? name : `${labels.unavailable} (${originalIndex + 1})`}</span>
            </label>
            {product ? <>
              {image && <Link href={`${storefrontHref(`/products/${product.slug}`, routeLocale)}?cartReturn=1`}
                className="mb-3 block w-24 max-w-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
                <ProductImage {...image} />
              </Link>}
              <p className="text-sm text-hanapure-muted">{product.brand}</p>
              <Link href={`${storefrontHref(`/products/${product.slug}`, routeLocale)}?cartReturn=1`} className={`${cartControl} mt-2 block max-w-full break-words text-xl`}>{name}</Link>
              {!product.names[locale] && <p className="mt-3">{storefrontLabels[locale].missing}</p>}
              {savedProductOverlap(favorites, line.publicId) && <p className="mt-3 break-words text-sm">{labels.alsoSaved}</p>}
            </> : <p>{labels.unavailable}</p>}
            {product ? <QuantityForm {...line} name={name} locale={locale} cart={cart} announce={result => {
              setUndo(null);
              if (detailSelectionNeedsReload(result)) setQuantityTrusted(false);
              setMessage(result === "updated" ? labels.selectionUpdated : result === "unchanged" ? labels.selectionUnchanged :
                result === "invalid" ? labels.invalid : result === "conflict" ? labels.selectionConflict :
                  result === "write-failed" ? labels.selectionWriteFailed : labels.selectionUnavailable);
            }} />
              : <p className="mt-4">{labels.quantity}: {line.quantity}</p>}
            {product && <button type="button" className={`${cartControl} mt-4 max-w-full break-words disabled:opacity-50`}
              aria-label={`${labels.saveForLater}: ${name}`}
              disabled={!cart.ready || cart.invalid || !cart.persistent || !favorites.ready || favorites.invalid || !favorites.persistent ||
                (favorites.ids.length >= MAX_FAVORITES && !favorites.ids.some(id => id.toLowerCase() === line.publicId.toLowerCase()))}
              onClick={() => {
                setUndo(null);
                const result = saveCartLineForLater(line.publicId, cart, products);
                setMessage(result === "moved" ? labels.savedForLater : result === "partial" ? labels.saveForLaterPartial :
                  result === "conflict" ? labels.saveForLaterConflict : labels.saveForLaterBlocked);
                if (result === "moved" || result === "partial") {
                  const neighbour = view.rows[visibleIndex + 1]?.line ?? view.rows[visibleIndex - 1]?.line;
                  (neighbour ? removeRefs.current.get(neighbour.publicId) : browseRef.current)?.focus();
                }
              }}>{labels.saveForLater}</button>}
            <button ref={button => {
              if (button) removeRefs.current.set(line.publicId, button);
              else removeRefs.current.delete(line.publicId);
            }} type="button" disabled={!cart.ready || cart.invalid || !cart.persistent}
              className={`${cartControl} mt-4 disabled:opacity-50`} aria-label={`${labels.remove}: ${name}`} onClick={() => {
              const neighbour = view.rows[visibleIndex + 1]?.line ?? view.rows[visibleIndex - 1]?.line;
              if (neighbour) removeRefs.current.get(neighbour.publicId)?.focus();
              else browseRef.current?.focus();
              removeSelection(lines => lines.filter(item => item.publicId !== line.publicId), labels.removed);
            }}>{labels.remove}</button>
          </li>;
        })}
      </ul>
      {view.rows.length === 0 && <p role="status" className="mt-5 break-words">{labels.noReviewResults}</p>}
      <button type="button" disabled={!cart.ready || cart.invalid || !cart.persistent} className={`${cartControl} mt-6 disabled:opacity-50`}
        onClick={() => { browseRef.current?.focus(); removeSelection(() => [], labels.cleared); }}>{labels.clear}</button>
    </>}
    <section id={canNavigate ? `${navigationId}-actions` : undefined} tabIndex={canNavigate ? -1 : undefined}
      aria-label={labels.selectedItems} className="mt-6 min-w-0 scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
      {canNavigate && <a href={`#${navigationId}-rows`} className={`${cartControl} mb-3 inline-flex min-w-0 max-w-full items-center break-words`}>{labels.backToRows}</a>}
      <p className="break-words text-sm">{labels.selectedItems}: {summary ? summary.lines : labels.selectionUnknown}</p>
      {summary && <dl aria-label={labels.selectionOverview} className="mt-2 min-w-0 space-y-2 break-words text-sm" aria-live="polite">
        <div><dt>{labels.selectedUnits}</dt><dd>{summary.units}</dd></div>
        <div><dt>{labels.selectedUnavailable}</dt><dd>{summary.unavailable}</dd></div>
      </dl>}
      <div className="mt-3 flex min-w-0 flex-wrap gap-3">
        <button type="button" disabled={!viewReady || view.rows.length === 0}
          className={`${cartControl} max-w-full break-words disabled:opacity-50`} onClick={() => {
            if (!viewReady || view.rows.length === 0) return;
            setChecked({ lines: cart.lines, ids: view.rows.map(item => item.line.publicId) }); setBulkMessage(""); setSelectedCopyMessage("");
          }}>{labels.selectDisplayed}</button>
        <button type="button" disabled={!bulkReady} className={`${cartControl} max-w-full break-words disabled:opacity-50`} onClick={() => {
          setChecked({ lines: cart.lines, ids: [] }); setBulkMessage(""); setSelectedCopyMessage("");
        }}>{labels.clearSelection}</button>
        <button type="button" disabled={!bulkReady || !favorites.ready || favorites.invalid || !favorites.persistent ||
          selected.some(line => !products.some(product => product.publicId.toLowerCase() === line.publicId.toLowerCase()))}
          className={`${cartControl} max-w-full break-words disabled:opacity-50`} onClick={() => {
            if (!bulkReady) return;
            const result = moveCartSelectionToSaved(cart, checked.ids, products);
            if (result === "moved" || result === "partial") {
              setUndo(null); // Never expose cart-only Undo for a cross-key operation.
              setChecked({ lines: cart.lines, ids: [] });
              browseRef.current?.focus();
            }
            setBulkMessage(result === "moved" ? labels.selectedMoved : result === "partial" ? labels.selectedMovePartial :
              result === "conflict" ? labels.bulkSelectionChanged : labels.selectedMoveFailed);
          }}>{labels.moveSelectedToSaved}</button>
        <button type="button" disabled={!bulkReady} className={`${cartControl} max-w-full break-words disabled:opacity-50`}
          onClick={() => {
            if (!bulkReady) return;
            const result = removeSelectedCartLines(cart, checked.ids);
            if (result.status === "removed") {
              setUndo(result.plan);
              setChecked({ lines: result.plan.after, ids: [] });
              setBulkMessage(labels.selectedRemoved);
              const survivor = view.rows.find(item => result.plan.after.some(line => line.publicId === item.line.publicId))?.line;
              (survivor ? removeRefs.current.get(survivor.publicId) ?? browseRef.current : browseRef.current)?.focus();
            } else {
              setChecked({ lines: cart.lines, ids: [] });
              setBulkMessage(result.status === "conflict" ? labels.bulkSelectionChanged :
                result.status === "empty" ? labels.bulkSelectionEmpty : labels.bulkRemovalFailed);
            }
          }}>{labels.removeSelected}</button>
        <button type="button" disabled={!bulkReady || !selectedPublic || copyingSelected}
          className={`${cartControl} max-w-full break-words disabled:opacity-50`} onClick={async () => {
            if (selectedCopyPending.current || !bulkReady) return;
            const selection = readBulkSelection(cart, checked.ids);
            if (selection.status !== "ready") {
              setSelectedCopyMessage(selection.status === "conflict" ? labels.bulkSelectionChanged : labels.shoppingListFailed); return;
            }
            const list = formatCartShoppingList(selection.lines, products, locale);
            if (list.status !== "ready") {
              setSelectedCopyMessage(list.status === "empty" ? labels.shoppingListEmpty : list.status === "too-large" ? labels.shoppingListTooLarge : labels.shoppingListFailed); return;
            }
            selectedCopyPending.current = true; setCopyingSelected(true); setSelectedCopyMessage("");
            try {
              if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
              await navigator.clipboard.writeText(list.text);
              setSelectedCopyMessage(list.omitted ? `${labels.selectedListCopiedOmitted} ${list.omitted}.` : labels.selectedListCopied);
            } catch { setSelectedCopyMessage(labels.shoppingListFailed); }
            finally { selectedCopyPending.current = false; setCopyingSelected(false); }
          }}>{labels.copySelectedList}</button>
      </div>
      <p role="status" className="mt-3 break-words text-sm">{checked.ids.length > 0 && !coherentSelection ? labels.bulkSelectionChanged : bulkMessage}</p>
      <p role="status" className="mt-3 break-words text-sm">{selectedCopyMessage}</p>
      {compareHref && <button type="button" className={`${cartControl} mt-3 max-w-full break-words`} onClick={() => {
        if (!bulkReady) return;
        const current = readBulkSelection(cart, checked.ids);
        const pair = current.status === "ready" && current.lines.length === 2 ? publishedComparison(products,
          { first: current.lines[0].publicId, second: current.lines[1].publicId }) : null;
        const href = pair && comparisonHref(storefrontHref("/products", routeLocale), pair);
        if (!href || href !== compareHref) { setBulkMessage(labels.bulkSelectionChanged); return; }
        window.location.assign(`${href}#${COMPARISON_DESTINATION}`);
      }}>{labels.compareSelected}</button>}
    </section>
    <button type="button" className={`${cartControl} mt-4 max-w-full break-words disabled:opacity-50`}
      disabled={copying || !cart.ready || cart.invalid || !cart.persistent || !items.some(item => item.product !== null)}
      onClick={async () => {
        if (copyPending.current || !cart.ready || cart.invalid || !cart.persistent) return;
        const list = formatCartShoppingList(cart.lines, products, locale);
        if (list.status !== "ready") {
          setCopyMessage(list.status === "empty" ? labels.shoppingListEmpty : list.status === "too-large" ? labels.shoppingListTooLarge : labels.shoppingListFailed);
          return;
        }
        copyPending.current = true; setCopying(true); setCopyMessage("");
        try {
          if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(list.text);
          setCopyMessage(list.omitted ? `${labels.shoppingListCopiedOmitted} ${list.omitted}.` : labels.shoppingListCopied);
        } catch {
          setCopyMessage(labels.shoppingListFailed);
        } finally {
          copyPending.current = false; setCopying(false);
        }
      }}>{labels.copyShoppingList}</button>
    <p role="status" className="mt-3 break-words text-sm text-hanapure-muted">{copyMessage}</p>
    <button type="button" disabled={!cart.ready || !cart.persistent || cart.invalid || !cart.lines.length} className={`${cartControl} mt-4 max-w-full break-words disabled:opacity-50`}
      onClick={() => {
        if (resumeLive.current?.witness !== resumeWitness || resumeLive.current.href !== portableLocation()) return;
        const fresh = readPortableSnapshot(cart);
        const href = fresh.status === "ready" ? currentCartPlanHref(storefrontHref("/products", routeLocale), fresh.lines, products) : null;
        if (!href || readPortableSnapshot(cart).status !== "ready" || resumeLive.current?.witness !== resumeWitness) { setMessage(storefrontLabels[locale].planCartResumeFailed); return; }
        try { window.location.assign(href); }
        catch { setMessage(storefrontLabels[locale].planCartResumeFailed); }
      }}>{storefrontLabels[locale].planCartResume}</button>
    <PortableCartHandoff products={products} cart={cart} locale={locale} routeLocale={routeLocale}
      visiblePublicIds={viewReady ? view.rows.flatMap(row => row.product ? [row.line.publicId.toLowerCase()] : []) : []}
      onMerged={after => { setUndo(null); setChecked({ lines: after, ids: [] }); }}
      onUncertain={() => { setUndo(null); setQuantityTrusted(false); }} />
    {undoAvailable && <button type="button" className={`${cartControl} mt-4`} onClick={() => {
      setUndo(null);
      restoredFocus.current = undo.before[0].publicId;
      const result = restoreBrowserCart(undo);
      setMessage(result === "restored" ? labels.restored : result === "changed" ? labels.undoChanged : labels.undoStorage);
      if (result !== "restored") { restoredFocus.current = null; browseRef.current?.focus(); }
    }}>{labels.undo}</button>}
    <p role="status" className="mt-4">{undo && !undoAvailable ? labels.undoChanged : message}</p>
    <Link ref={browseRef} href={storefrontHref("/products", routeLocale)} className={`${cartControl} mt-6 inline-flex items-center`}>{labels.browse}</Link>
  </>;
}
