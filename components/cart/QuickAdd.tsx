"use client";

import { useId, useRef, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { addCartLine, CART_STORAGE_KEY, inspectStoredCart, serializeCart, validCartId } from "@/lib/cart/cart-state";
import { changeBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { cartLabels } from "@/lib/cart/labels";
import { parseQuickAddQuantity } from "@/lib/cart/quick-add-quantity";
import { cartControl } from "./AddToCart";
import { stepQuantityDraft } from "@/lib/cart/quantity-draft-controls";
import { detailCartQuantity, detailSelectionNeedsReload, setDetailCartQuantity, type DetailCartSnapshot, type DetailSelectionResult } from "@/lib/cart/detail-cart-selection";
import { sameCartSelection } from "@/lib/cart/cart-undo";
import { cartRowId } from "@/lib/cart/quick-add-continuity";
import { localeFromPath, storefrontHref } from "@/lib/storefront/localization";

/** Reuse the store, with synchronous full-selection witnesses and persisted readback.
 * localStorage has no atomic cross-tab CAS; these checks are best effort only. */
function addConfirmed(publicId: string, rawQuantity: string, cart: DetailCartSnapshot): DetailSelectionResult | "added" | "overflow" {
  const quantity = parseQuickAddQuantity(rawQuantity);
  if (quantity === null || !validCartId(publicId)) return "invalid";
  if (typeof window === "undefined" || !cart.ready || cart.invalid || !cart.persistent) return "unavailable";
  let attempted = false;
  let refusal: DetailSelectionResult | null = null;
  try {
    const expected = inspectStoredCart(serializeCart(cart.lines));
    const stored = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
    if (expected.invalid || stored.invalid) return "unavailable";
    if (!sameCartSelection(stored.lines, expected.lines)) return "conflict";
    const after = addCartLine(stored.lines, publicId, quantity);
    if (after === stored.lines) return "overflow";
    const result = changeBrowserCart(current => {
      const latest = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
      if (latest.invalid) refusal = "unavailable";
      else if (current !== cart.lines || !sameCartSelection(current, expected.lines) || !sameCartSelection(latest.lines, stored.lines)) refusal = "conflict";
      if (refusal) throw new Error("QuickAdd selection changed before mutation");
      attempted = true;
      return after;
    });
    if (!result) return "unavailable";
    if (!result.persistent) return "write-failed";
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    const confirmed = inspectStoredCart(raw);
    return raw !== null && !confirmed.invalid && sameCartSelection(confirmed.lines, after) ? "added" : "write-failed";
  } catch {
    return refusal ?? (attempted ? "write-failed" : "unavailable");
  }
}

function SetQuantity({ publicId, quantity, cart, locale, name, announce, allowed }: {
  publicId: string; quantity: number; cart: DetailCartSnapshot; locale: EditorialLocale; name: string;
  announce: (result: DetailSelectionResult) => void; allowed: () => boolean;
}) {
  const labels = cartLabels[locale], id = useId();
  const [draft, setDraft] = useState({ quantity, value: String(quantity) });
  if (draft.quantity !== quantity) setDraft({ quantity, value: String(quantity) });
  return <form className="mt-3 flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault();
    if (allowed()) announce(setDetailCartQuantity(publicId, draft.value, cart));
  }}>
    <div className="min-w-0 max-w-full"><label htmlFor={id} className="mb-2 block break-words text-sm">{labels.setCartQuantity}: {name}</label>
      <input id={id} type="number" min="1" step="1" required value={draft.value}
        onChange={event => setDraft({ quantity, value: event.target.value })} className={`${cartControl} w-28 max-w-full`} /></div>
    <button type="submit" className={`${cartControl} max-w-full break-words`}>{labels.setCartQuantity}</button>
  </form>;
}

export default function QuickAdd({ publicId, locale, name }: {
  publicId: string; locale: EditorialLocale; name: string;
}) {
  const cart = useBrowserCart();
  const labels = cartLabels[locale];
  const id = useId();
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("");
  const [trusted, setTrusted] = useState(true);
  const trustGuard = useRef(true);
  const healthy = trusted && cart.ready && !cart.invalid && cart.persistent && validCartId(publicId);
  const selectedQuantity = detailCartQuantity(publicId, cart, healthy);
  function announce(result: DetailSelectionResult | "added" | "overflow") {
    if (result !== "added" && result !== "overflow" && detailSelectionNeedsReload(result)) {
      trustGuard.current = false; setTrusted(false);
    }
    const messages = { added: labels.added, overflow: labels.addOverflow, updated: labels.selectionUpdated,
      unchanged: labels.selectionUnchanged, invalid: labels.invalid, conflict: labels.selectionConflict,
      unavailable: labels.selectionUnavailable, "write-failed": labels.selectionWriteFailed };
    setMessage(messages[result]);
  }
  const rowId = cartRowId(publicId);
  const routeLocale = typeof window === "undefined" ? null : localeFromPath(window.location?.pathname ?? "");
  return <div className="mt-5">
    <form className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        if (!healthy || !trustGuard.current) return;
        announce(addConfirmed(publicId, quantity, cart));
      }}>
      <div className="min-w-0 max-w-full">
        <label htmlFor={id} className="mb-2 block break-words text-sm font-medium">{labels.addQuantity}: {name}</label>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <button type="button" aria-label={`${labels.decreaseDraft}: ${name}`}
            disabled={!healthy || stepQuantityDraft(quantity, -1) === null}
            className={`${cartControl} min-w-11 disabled:opacity-50`} onClick={() => {
              const value = stepQuantityDraft(quantity, -1); if (healthy && value !== null) setQuantity(value);
            }}>−</button>
        <input id={id} type="number" min="1" step="1" required value={quantity}
          onChange={event => setQuantity(event.target.value)} className={`${cartControl} w-28 max-w-full`} />
          <button type="button" aria-label={`${labels.increaseDraft}: ${name}`}
            disabled={!healthy || stepQuantityDraft(quantity, 1) === null}
            className={`${cartControl} min-w-11 disabled:opacity-50`} onClick={() => {
              const value = stepQuantityDraft(quantity, 1); if (healthy && value !== null) setQuantity(value);
            }}>+</button>
        </div>
      </div>
      <button type="submit" aria-label={`${labels.add}: ${name}`}
        disabled={!healthy}
        className={`${cartControl} max-w-full break-words disabled:opacity-50`}>{labels.add}</button>
    </form>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">
      {!trusted ? message : cart.invalid ? labels.invalidStorage : !cart.persistent ? labels.storage : !cart.ready ? labels.loading : !healthy ? labels.selectionUnavailable : message}
    </p>
    {healthy && <p className="mt-2 break-words text-sm">{selectedQuantity === null ? labels.notInBrowserCart : `${labels.inBrowserCart}: ${selectedQuantity}`}</p>}
    {healthy && selectedQuantity !== null && <>
      <SetQuantity key={publicId} publicId={publicId} quantity={selectedQuantity} cart={cart} locale={locale} name={name}
        allowed={() => trustGuard.current} announce={announce} />
      {rowId && <a className={`${cartControl} mt-3 inline-flex max-w-full break-words`} href={`${storefrontHref("/cart", routeLocale)}#${rowId}`}>{labels.reviewCartItem}</a>}
    </>}
  </div>;
}
