"use client";

import { useId, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { addCartLine } from "@/lib/cart/cart-state";
import { changeBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { cartLabels } from "@/lib/cart/labels";
import { parseQuickAddQuantity } from "@/lib/cart/quick-add-quantity";
import { cartControl } from "./AddToCart";

export default function QuickAdd({ publicId, locale, name }: {
  publicId: string; locale: EditorialLocale; name: string;
}) {
  const cart = useBrowserCart();
  const labels = cartLabels[locale];
  const id = useId();
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("");
  return <div className="mt-5">
    <form className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        if (!cart.ready || cart.invalid || !cart.persistent) return;
        const parsedQuantity = parseQuickAddQuantity(quantity);
        if (parsedQuantity === null) { setMessage(labels.invalid); return; }
        let changed = false;
        const result = changeBrowserCart(lines => {
          const next = addCartLine(lines, publicId, parsedQuantity);
          changed = next !== lines;
          return next;
        });
        setMessage(!changed ? labels.invalid : result?.persistent ? labels.added : labels.storage);
      }}>
      <div className="min-w-0 max-w-full">
        <label htmlFor={id} className="mb-2 block break-words text-sm font-medium">{labels.quantity}: {name}</label>
        <input id={id} type="number" min="1" step="1" required value={quantity}
          onChange={event => setQuantity(event.target.value)} className={`${cartControl} w-28 max-w-full`} />
      </div>
      <button type="submit" aria-label={`${labels.add}: ${name}`}
        disabled={!cart.ready || cart.invalid || !cart.persistent}
        className={`${cartControl} max-w-full break-words disabled:opacity-50`}>{labels.add}</button>
    </form>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">
      {cart.invalid ? labels.invalidStorage : !cart.persistent ? labels.storage : message}
    </p>
  </div>;
}
