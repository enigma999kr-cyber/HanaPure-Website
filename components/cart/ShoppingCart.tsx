"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";
import { reconcileCart } from "@/lib/cart/cart-state";
import type { CartLine } from "@/lib/cart/cart-state";
import { changeBrowserCart, resetBrowserCart, restoreBrowserCart, useBrowserCart } from "@/lib/cart/browser-cart";
import { canUndoCart, createCartUndoPlan, type CartUndoPlan } from "@/lib/cart/cart-undo";
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

export type CartProduct = Readonly<{ publicId: string; slug: string; brand: string;
  names: Readonly<Record<EditorialLocale, string | null>> }>;

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
  const navigationId = useId();
  const canNavigate = cart.ready && !cart.invalid && cart.persistent && cart.lines.length > 0;
  const favorites = useBrowserFavorites();
  const labels = cartLabels[locale];
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<CartUndoPlan | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const copyPending = useRef(false);
  const [checked, setChecked] = useState<{ lines: readonly CartLine[]; ids: readonly string[] }>({ lines: cart.lines, ids: [] });
  const [bulkMessage, setBulkMessage] = useState("");
  const [selectedCopyMessage, setSelectedCopyMessage] = useState("");
  const [copyingSelected, setCopyingSelected] = useState(false);
  const selectedCopyPending = useRef(false);
  const coherentSelection = checked.lines === cart.lines;
  const selected = coherentSelection ? selectedCartLines(cart.lines, checked.ids) ?? [] : [];
  const bulkReady = coherentSelection && cart.ready && !cart.invalid && cart.persistent && selected.length > 0;
  const selectedPublic = reconcileCart(selected, products).some(item => item.product !== null);
  const summary = cartSelectionSummary(cart, checked.lines, checked.ids, products);
  const browseRef = useRef<HTMLAnchorElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoredFocus = useRef<string | null>(null);
  const items = reconcileCart(cart.lines, products);
  const undoAvailable = undo && cart.ready && cart.persistent && !cart.invalid && canUndoCart(undo, cart.lines);
  useEffect(() => {
    if (restoredFocus.current) {
      (removeRefs.current.get(restoredFocus.current) ?? browseRef.current)?.focus();
      restoredFocus.current = null;
    }
  }, [cart.lines]);
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
    {!cart.ready ? <p className="mt-8">{labels.loading}</p> : cart.lines.length === 0 ? <p className="mt-8 text-xl">{labels.empty}</p> : <>
      {canNavigate && <nav aria-label={labels.cartNavigation} className="mt-6 flex min-w-0 flex-wrap gap-3">
        <a href={`#${navigationId}-actions`} className={`${cartControl} inline-flex min-w-0 max-w-full items-center break-words`}>{labels.jumpToActions}</a>
      </nav>}
      <ul id={canNavigate ? `${navigationId}-rows` : undefined} tabIndex={canNavigate ? -1 : undefined} aria-label={labels.cartRows}
        className="mt-8 scroll-mt-24 space-y-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
        {items.map(({ line, product }, index) => {
          const name = product?.names[locale] ?? storefrontLabels[locale].details;
          return <li key={line.publicId} className="min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
            <label className="mb-3 flex min-h-11 min-w-0 items-center gap-3 break-words">
              <input type="checkbox" checked={selected.some(item => item.publicId.toLowerCase() === line.publicId.toLowerCase())}
                disabled={!cart.ready || cart.invalid || !cart.persistent}
                className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
                onChange={event => {
                  const enabled = event.target.checked;
                  setChecked(previous => {
                    const remaining = (previous.lines === cart.lines ? previous.ids : []).filter(id => id.toLowerCase() !== line.publicId.toLowerCase());
                    return { lines: cart.lines, ids: enabled ? [...remaining, line.publicId] : remaining };
                  });
                  setBulkMessage(""); setSelectedCopyMessage("");
                }} />
              <span className="min-w-0 break-words">{labels.selectCartItem}: {product ? name : `${labels.unavailable} (${index + 1})`}</span>
            </label>
            {product ? <>
              <p className="text-sm text-hanapure-muted">{product.brand}</p>
              <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)} className={`${cartControl} mt-2 block max-w-full break-words text-xl`}>{name}</Link>
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
                  const neighbour = cart.lines[index + 1] ?? cart.lines[index - 1];
                  (neighbour ? removeRefs.current.get(neighbour.publicId) : browseRef.current)?.focus();
                }
              }}>{labels.saveForLater}</button>}
            <button ref={button => {
              if (button) removeRefs.current.set(line.publicId, button);
              else removeRefs.current.delete(line.publicId);
            }} type="button" disabled={!cart.ready || cart.invalid || !cart.persistent}
              className={`${cartControl} mt-4 disabled:opacity-50`} aria-label={`${labels.remove}: ${name}`} onClick={() => {
              const neighbour = cart.lines[index + 1] ?? cart.lines[index - 1];
              if (neighbour) removeRefs.current.get(neighbour.publicId)?.focus();
              else browseRef.current?.focus();
              removeSelection(lines => lines.filter(item => item.publicId !== line.publicId), labels.removed);
            }}>{labels.remove}</button>
          </li>;
        })}
      </ul>
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
        <button type="button" disabled={!cart.ready || cart.invalid || !cart.persistent || cart.lines.length === 0}
          className={`${cartControl} max-w-full break-words disabled:opacity-50`} onClick={() => {
            setChecked({ lines: cart.lines, ids: cart.lines.map(line => line.publicId) }); setBulkMessage(""); setSelectedCopyMessage("");
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
              const survivor = result.plan.after[0];
              (survivor ? removeRefs.current.get(survivor.publicId) : browseRef.current)?.focus();
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
