"use client";

import { useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { addCartLine } from "@/lib/cart/cart-state";
import { changeBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { cartLabels } from "@/lib/cart/labels";
import { cartControl } from "./AddToCart";

export default function QuickAdd({ publicId, locale, name }: {
  publicId: string; locale: EditorialLocale; name: string;
}) {
  const cart = useBrowserCart();
  const labels = cartLabels[locale];
  const [message, setMessage] = useState("");
  return <div className="mt-5">
    <button type="button" aria-label={`${labels.add}: ${name}`}
      disabled={!cart.ready || cart.invalid || !cart.persistent}
      className={`${cartControl} max-w-full break-words disabled:opacity-50`} onClick={() => {
        if (!cart.ready || cart.invalid || !cart.persistent) return;
        let changed = false;
        const result = changeBrowserCart(lines => {
          const next = addCartLine(lines, publicId, 1);
          changed = next !== lines;
          return next;
        });
        setMessage(!changed ? labels.invalid : result?.persistent ? labels.added : labels.storage);
      }}>{labels.add}</button>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">
      {cart.invalid ? labels.invalidStorage : !cart.persistent ? labels.storage : message}
    </p>
  </div>;
}
