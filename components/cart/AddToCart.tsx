"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import { addCartLine, CART_STORAGE_KEY, inspectStoredCart, serializeCart, validCartId } from "@/lib/cart/cart-state";
import { parseQuickAddQuantity } from "@/lib/cart/quick-add-quantity";
import { sameCartSelection } from "@/lib/cart/cart-undo";
import { changeBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { detailCartQuantity, detailSelectionNeedsReload, setDetailCartQuantity, type DetailCartSnapshot, type DetailSelectionResult } from "@/lib/cart/detail-cart-selection";

export const cartControl = "min-h-11 min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] rounded-xl border border-hanapure-border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
/** Detail-only additive action using the same conservative witnesses as QuickAdd.
 * Synchronous read/write/readback is not atomic cross-tab CAS. */
function addConfirmed(publicId: string, raw: string, cart: DetailCartSnapshot): DetailSelectionResult | "added" | "overflow" {
  const quantity = parseQuickAddQuantity(raw);
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
      if (refusal) throw new Error("Detail selection changed before mutation");
      attempted = true;
      return after;
    });
    if (!result) return "unavailable";
    if (!result.persistent) return "write-failed";
    const saved = window.localStorage.getItem(CART_STORAGE_KEY);
    const confirmed = inspectStoredCart(saved);
    return saved !== null && !confirmed.invalid && sameCartSelection(confirmed.lines, after) ? "added" : "write-failed";
  } catch { return refusal ?? (attempted ? "write-failed" : "unavailable"); }
}
function ExistingQuantityForm({ publicId, quantity, cart, locale, announce }: {
  publicId: string; quantity: number; cart: DetailCartSnapshot; locale: EditorialLocale; announce: (result: DetailSelectionResult) => void;
}) {
  const labels = cartLabels[locale];
  const id = useId();
  const [draft, setDraft] = useState({ quantity, value: String(quantity) });
  if (draft.quantity !== quantity) setDraft({ quantity, value: String(quantity) });
  return <form className="mt-4 flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault();
    announce(setDetailCartQuantity(publicId, draft.value, cart));
  }}>
    <div className="min-w-0 max-w-full"><label htmlFor={id} className="mb-2 block break-words text-sm">{labels.setCartQuantity}</label>
      <input id={id} type="number" min="1" step="1" required value={draft.value}
        onChange={event => setDraft({ quantity, value: event.target.value })} className={`${cartControl} w-28 max-w-full bg-hanapure-white`} />
    </div>
    <button type="submit" className={`${cartControl} max-w-full break-words`}>{labels.setCartQuantity}</button>
  </form>;
}
export default function AddToCart({ publicId, locale, routeLocale }: {
  publicId: string; locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const cart = useBrowserCart();
  const labels = cartLabels[locale];
  const id = useId();
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("");
  const [selectionMessage, setSelectionMessage] = useState("");
  const [selectionTrusted, setSelectionTrusted] = useState(true);
  const trustGuard = useRef(true);
  const healthy = selectionTrusted && cart.ready && !cart.invalid && cart.persistent && validCartId(publicId);
  const selectedQuantity = detailCartQuantity(publicId, cart, selectionTrusted);
  return <section className="mt-8 min-w-0 rounded-xl border border-hanapure-border p-4">
    <p className="text-sm leading-6 text-hanapure-muted">{labels.notice}</p>
    <form className="mt-4 flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      if (!healthy || !trustGuard.current) return;
      const result = addConfirmed(publicId, quantity, cart);
      if (result !== "added" && result !== "overflow" && detailSelectionNeedsReload(result)) {
        trustGuard.current = false; setSelectionTrusted(false);
      }
      setMessage(result === "added" ? labels.added : result === "overflow" ? labels.addOverflow :
        result === "invalid" ? labels.invalid : result === "conflict" ? labels.selectionConflict :
          result === "write-failed" ? labels.selectionWriteFailed : labels.selectionUnavailable);
    }}>
      <div className="min-w-0 max-w-full"><label htmlFor={id} className="mb-2 block break-words text-sm">{labels.quantity}</label>
        <input id={id} type="number" min="1" step="1" required value={quantity}
          onChange={event => setQuantity(event.target.value)} className={`${cartControl} w-28 bg-hanapure-white`} />
      </div>
      <fieldset className="flex min-w-0 max-w-full flex-wrap gap-2">
        <legend className="mb-2 break-words text-sm">{labels.draftPresets}</legend>
        {[1, 2, 3].map(value => <button key={value} type="button" aria-label={`${labels.presetQuantity}: ${value}`}
          className={`${cartControl} bg-hanapure-white`} onClick={() => setQuantity(String(value))}>{value}</button>)}
      </fieldset>
      <button type="submit" disabled={!healthy} className={`${cartControl} bg-hanapure-text text-hanapure-white disabled:opacity-50`}>{labels.add}</button>
      <Link href={storefrontHref("/cart", routeLocale)} className={`${cartControl} inline-flex items-center`}>{labels.cart}</Link>
    </form>
    <p role="status" className="mt-3 text-sm">{message}</p>
    {selectionTrusted && cart.ready && !cart.invalid && cart.persistent && <p role="status" className="mt-4 break-words text-sm">
      {selectedQuantity === null ? labels.notInBrowserCart : `${labels.inBrowserCart}: ${selectedQuantity}`}
    </p>}
    {selectedQuantity !== null && <ExistingQuantityForm key={publicId} publicId={publicId}
      quantity={selectedQuantity} cart={cart} locale={locale} announce={result => {
        // A persistent in-memory flag cannot override a failed confirmation/conflict.
        // Keep both confirmed display and Set hidden until the detail island reloads.
        if (detailSelectionNeedsReload(result)) { trustGuard.current = false; setSelectionTrusted(false); }
        setSelectionMessage(result === "updated" ? labels.selectionUpdated : result === "unchanged" ? labels.selectionUnchanged :
          result === "invalid" ? labels.invalid : result === "conflict" ? labels.selectionConflict :
            result === "write-failed" ? labels.selectionWriteFailed : labels.selectionUnavailable);
      }} />}
    <p role="status" className="mt-3 break-words text-sm">{selectionMessage}</p>
    {cart.invalid && <p role="status" className="mt-3 text-sm">{labels.invalidStorage}</p>}
    {!cart.persistent && message !== labels.storage && <p className="mt-3 text-sm">{labels.storage}</p>}
  </section>;
}
