"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import { addCartLine, validQuantity } from "@/lib/cart/cart-state";
import { changeBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";

export const cartControl = "min-h-11 rounded-xl border border-hanapure-border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
export default function AddToCart({ publicId, locale, routeLocale }: {
  publicId: string; locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const cart = useBrowserCart();
  const labels = cartLabels[locale];
  const id = useId();
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("");
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
      <button type="submit" disabled={!cart.ready || cart.invalid} className={`${cartControl} bg-hanapure-text text-hanapure-white disabled:opacity-50`}>{labels.add}</button>
      <Link href={storefrontHref("/cart", routeLocale)} className={`${cartControl} inline-flex items-center`}>{labels.cart}</Link>
    </form>
    <p role="status" className="mt-3 text-sm">{message}</p>
    {cart.invalid && <p role="status" className="mt-3 text-sm">{labels.invalidStorage}</p>}
    {!cart.persistent && message !== labels.storage && <p className="mt-3 text-sm">{labels.storage}</p>}
  </section>;
}
