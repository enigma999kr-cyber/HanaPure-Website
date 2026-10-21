"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import { addCartLine, validQuantity } from "@/lib/cart/cart-state";
import { changeBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { detailCartQuantity, detailSelectionNeedsReload, setDetailCartQuantity, type DetailCartSnapshot, type DetailSelectionResult } from "@/lib/cart/detail-cart-selection";

export const cartControl = "min-h-11 rounded-xl border border-hanapure-border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
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
  const selectedQuantity = detailCartQuantity(publicId, cart, selectionTrusted);
  return <section className="mt-8 rounded-xl border border-hanapure-border p-4">
    <p className="text-sm leading-6 text-hanapure-muted">{labels.notice}</p>
    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      const value = Number(quantity);
      if (!validQuantity(value)) { setMessage(labels.invalid); return; }
      let accepted = false;
      const result = changeBrowserCart(lines => {
        const next = addCartLine(lines, publicId, value);
        accepted = next !== lines;
        return next;
      });
      setMessage(!accepted ? labels.invalid : result?.persistent ? labels.added : labels.storage);
    }}>
      <div><label htmlFor={id} className="mb-2 block text-sm">{labels.quantity}</label>
        <input id={id} type="number" min="1" step="1" required value={quantity}
          onChange={event => setQuantity(event.target.value)} className={`${cartControl} w-28 bg-hanapure-white`} />
      </div>
      <fieldset className="flex min-w-0 max-w-full flex-wrap gap-2">
        <legend className="mb-2 break-words text-sm">{labels.draftPresets}</legend>
        {[1, 2, 3].map(value => <button key={value} type="button" aria-label={`${labels.presetQuantity}: ${value}`}
          className={`${cartControl} bg-hanapure-white`} onClick={() => setQuantity(String(value))}>{value}</button>)}
      </fieldset>
      <button type="submit" disabled={!cart.ready || cart.invalid} className={`${cartControl} bg-hanapure-text text-hanapure-white disabled:opacity-50`}>{labels.add}</button>
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
        if (detailSelectionNeedsReload(result)) setSelectionTrusted(false);
        setSelectionMessage(result === "updated" ? labels.selectionUpdated : result === "unchanged" ? labels.selectionUnchanged :
          result === "invalid" ? labels.invalid : result === "conflict" ? labels.selectionConflict :
            result === "write-failed" ? labels.selectionWriteFailed : labels.selectionUnavailable);
      }} />}
    <p role="status" className="mt-3 break-words text-sm">{selectionMessage}</p>
    {cart.invalid && <p role="status" className="mt-3 text-sm">{labels.invalidStorage}</p>}
    {!cart.persistent && message !== labels.storage && <p className="mt-3 text-sm">{labels.storage}</p>}
  </section>;
}
