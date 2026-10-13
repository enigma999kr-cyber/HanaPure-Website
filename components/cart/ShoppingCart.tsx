"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import { updateCartLine, validQuantity } from "@/lib/cart/cart-state";
import { changeBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { cartControl } from "./AddToCart";

export type CartProduct = Readonly<{ publicId: string; slug: string; brand: string;
  names: Readonly<Record<EditorialLocale, string | null>> }>;

function QuantityForm({ publicId, quantity, name, locale, announce }: {
  publicId: string; quantity: number; name: string; locale: EditorialLocale; announce: (message: string) => void;
}) {
  const labels = cartLabels[locale];
  const [draft, setDraft] = useState({ quantity, value: String(quantity) });
  if (draft.quantity !== quantity) setDraft({ quantity, value: String(quantity) });
  const id = `cart-${publicId}`;
  return <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault();
    if (!validQuantity(Number(draft.value))) { announce(labels.invalid); return; }
    changeBrowserCart(lines => updateCartLine(lines, publicId, Number(draft.value)));
    announce(labels.updated);
  }}>
    <div className="min-w-0 max-w-full"><label htmlFor={id} className="mb-2 block break-words text-sm">{labels.quantity}: {name}</label>
      <input id={id} type="number" min="1" step="1" required value={draft.value}
        onChange={event => setDraft({ quantity, value: event.target.value })} className={`${cartControl} w-28 bg-hanapure-white`} />
    </div>
    <button type="submit" className={cartControl}>{labels.update}</button>
  </form>;
}
export default function ShoppingCart({ products, locale, routeLocale }: {
  products: readonly CartProduct[]; locale: EditorialLocale; routeLocale: EditorialLocale | null;
}) {
  const cart = useBrowserCart();
  const labels = cartLabels[locale];
  const [message, setMessage] = useState("");
  const browseRef = useRef<HTMLAnchorElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  return <>
    <p className="mt-5 leading-7 text-hanapure-muted">{labels.notice}</p>
    {!cart.persistent && <p role="status" className="mt-4">{labels.storage}</p>}
    {!cart.ready ? <p className="mt-8">{labels.loading}</p> : cart.lines.length === 0 ? <p className="mt-8 text-xl">{labels.empty}</p> : <>
      <ul className="mt-8 space-y-5">
        {cart.lines.map((line, index) => {
          const product = products.find(product => product.publicId === line.publicId);
          const name = product?.names[locale] ?? storefrontLabels[locale].details;
          return <li key={line.publicId} className="min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
            {product ? <>
              <p className="text-sm text-hanapure-muted">{product.brand}</p>
              <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)} className={`${cartControl} mt-2 block max-w-full break-words text-xl`}>{name}</Link>
              {!product.names[locale] && <p className="mt-3">{storefrontLabels[locale].missing}</p>}
            </> : <p>{labels.unavailable}</p>}
            <QuantityForm {...line} name={name} locale={locale} announce={setMessage} />
            <button ref={button => {
              if (button) removeRefs.current.set(line.publicId, button);
              else removeRefs.current.delete(line.publicId);
            }} type="button" className={`${cartControl} mt-4`} aria-label={`${labels.remove}: ${name}`} onClick={() => {
              const neighbour = cart.lines[index + 1] ?? cart.lines[index - 1];
              if (neighbour) removeRefs.current.get(neighbour.publicId)?.focus();
              else browseRef.current?.focus();
              changeBrowserCart(lines => lines.filter(item => item.publicId !== line.publicId)); setMessage(labels.updated);
            }}>{labels.remove}</button>
          </li>;
        })}
      </ul>
      <button type="button" className={`${cartControl} mt-6`} onClick={() => { browseRef.current?.focus(); changeBrowserCart(() => []); setMessage(labels.updated); }}>{labels.clear}</button>
    </>}
    <p role="status" className="mt-4">{message}</p>
    <Link ref={browseRef} href={storefrontHref("/products", routeLocale)} className={`${cartControl} mt-6 inline-flex items-center`}>{labels.browse}</Link>
  </>;
}
