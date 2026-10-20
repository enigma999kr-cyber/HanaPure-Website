"use client";

import { useId } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { useBrowserFavorites, changeBrowserFavorite } from "@/lib/favorites/browser-favorites";
import { MAX_FAVORITES } from "@/lib/favorites/favorite-state";
import { favoriteLabels } from "@/lib/favorites/labels";

export default function SaveProductButton({ publicId, locale, name }: {
  publicId: string; locale: EditorialLocale; name: string;
}) {
  const state = useBrowserFavorites();
  const labels = favoriteLabels[locale];
  const messageId = useId();
  const saved = state.ids.some(id => id.toLowerCase() === publicId.toLowerCase());
  const full = state.ids.length >= MAX_FAVORITES && !saved;
  const message = !state.ready ? labels.loading : !state.persistent ? labels.storage
    : state.invalid ? labels.invalid : full ? labels.limit : "";
  return <div className="mt-4 min-w-0">
    <button type="button" aria-pressed={saved} aria-label={`${saved ? labels.remove : labels.save}: ${name}`}
      aria-describedby={message ? messageId : undefined}
      disabled={!state.ready || !state.persistent || state.invalid || full}
      className="min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
      onClick={() => changeBrowserFavorite(publicId, !saved)}>{saved ? labels.remove : labels.save}</button>
    <p id={messageId} role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
  </div>;
}
