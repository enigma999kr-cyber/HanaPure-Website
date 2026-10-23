"use client";

import { useEffect, useRef, useState } from "react";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontLabels } from "@/lib/storefront/localization";

/** Accept only the server's canonical relative listing path and allowed criteria. */
export function canonicalSearchLink(relativeHref: string, origin: string): string | null {
  try {
    if (relativeHref.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(relativeHref) ||
      !/^\/(?:(?:en|hu|ko)\/)?products\?/.test(relativeHref)) return null;
    const base = new URL(origin);
    if (!/^https?:$/.test(base.protocol) || base.href !== `${base.origin}/`) return null;
    const url = new URL(relativeHref, base.origin);
    if (url.origin !== base.origin || url.hash || url.username || url.password ||
      !/^\/(?:(?:en|hu|ko)\/)?products$/.test(url.pathname)) return null;
    const params = new URLSearchParams();
    const query = (url.searchParams.get("q") ?? "").trim();
    const brand = (url.searchParams.get("brand") ?? "").trim();
    const sort = url.searchParams.get("sort");
    if (query) params.set("q", query);
    if (brand) params.set("brand", brand);
    if (sort === "name-asc" || sort === "name-desc") params.set("sort", sort);
    const canonical = `${url.pathname}?${params.toString()}`;
    if (!params.size || relativeHref !== canonical || url.href.length > 8192) return null;
    return url.href;
  } catch { return null; }
}

export default function CopySearchLink({ relativeHref, locale }: { relativeHref: string; locale: EditorialLocale }) {
  const labels = storefrontLabels[locale];
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const live = useRef<{ context: string; location: string } | null>(null);
  const context = JSON.stringify([relativeHref, locale]);
  const [messageContext, setMessageContext] = useState(context);
  if (messageContext !== context) {
    setMessageContext(context);
    setMessage("");
  }
  useEffect(() => {
    live.current = { context, location: window.location.href };
    return () => { live.current = null; };
  }, [context]);
  return <div className="mt-4 min-w-0">
    <button type="button" disabled={copying}
      className="min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50"
      onClick={async () => {
        if (pending.current || !live.current || live.current.context !== context) return;
        const owner = live.current;
        const current = () => live.current === owner && owner.location === window.location.href;
        pending.current = true; setCopying(true); setMessage("");
        try {
          const href = canonicalSearchLink(relativeHref, window.location.origin);
          if (!href || typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Search link copy unavailable");
          await navigator.clipboard.writeText(href);
          if (current()) setMessage(labels.searchLinkCopied);
        } catch {
          if (current()) setMessage(labels.searchLinkFailed);
        } finally {
          pending.current = false; if (live.current) setCopying(false);
        }
      }}>{labels.copySearchLink}</button>
    <p role="status" className="mt-2 break-words text-sm text-hanapure-muted">{message}</p>
  </div>;
}
