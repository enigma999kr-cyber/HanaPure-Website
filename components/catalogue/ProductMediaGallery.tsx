"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import type { EditorialImage, EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import ProductImage from "./ProductImage";
import { storefrontLabels } from "@/lib/storefront/localization";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function Gallery({ images, locale }: { images: readonly EditorialImage[]; locale: EditorialLocale }) {
  const [selected, setSelected] = useState(0);
  const [readiness, setReadiness] = useState<{ src: string; loaded: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const image = images[selected];
  const labels = storefrontLabels[locale];
  const loaded = readiness?.src === image.src && readiness.loaded;
  const closeInspection = useCallback(() => {
    if (dialog.current?.open) dialog.current.close();
    setExpanded(false);
    if (launcher.current && !launcher.current.disabled) launcher.current.focus();
    else frame.current?.focus();
  }, []);
  const recordImage = useCallback((target: HTMLImageElement) => {
    if (target.tagName !== "IMG" || target.getAttribute("src") !== image.src) return;
    const loaded = target.complete && target.naturalWidth > 0;
    setReadiness(previous => previous?.src === image.src && previous.loaded === loaded ? previous : { src: image.src, loaded });
    if (!loaded && dialog.current?.open) closeInspection();
  }, [image.src, closeInspection]);
  const attachFrame = useCallback((node: HTMLDivElement | null) => {
    frame.current = node;
    const target = node?.querySelector<HTMLImageElement>("img:not(noscript img)");
    if (target?.complete) recordImage(target);
  }, [recordImage]);
  useEffect(() => {
    const inspection = dialog.current;
    return () => { if (inspection?.open) inspection.close(); };
  }, [hydrated]);
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setSelected(index => Math.max(0, Math.min(images.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
    }
  }
  const control = "min-h-11 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text disabled:opacity-50";
  const navigation = () => images.length > 1 && <div className="flex min-w-0 flex-wrap items-center gap-3">
    <button type="button" className={control} disabled={selected === 0} onClick={() => setSelected(index => Math.max(0, index - 1))}>{labels.previousImage}</button>
    <p aria-live="polite" className="text-sm text-hanapure-muted">{selected + 1} / {images.length}</p>
    <button type="button" className={control} disabled={selected === images.length - 1} onClick={() => setSelected(index => Math.min(images.length - 1, index + 1))}>{labels.nextImage}</button>
  </div>;
  return <div className="col-span-full min-w-0 space-y-4" role="group" aria-label={labels.gallery} onKeyDown={keyboard}>
    <div ref={attachFrame} tabIndex={-1} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
      onLoadCapture={event => recordImage(event.target as HTMLImageElement)} onErrorCapture={event => recordImage(event.target as HTMLImageElement)}>
    {hydrated ? <ProductImage {...image} /> :
      <div className="aspect-square overflow-hidden rounded-2xl bg-hanapure-ivory">
        {/* eslint-disable-next-line @next/next/no-img-element -- Initial SSR and no-JS retain a visible native editorial image. */}
        <img src={image.src} alt={image.alt} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      </div>}
    </div>
    {hydrated && <>
      <button ref={launcher} type="button" className={control} aria-haspopup="dialog" aria-controls={dialogId} disabled={!loaded}
        onClick={() => {
          const target = frame.current?.querySelector<HTMLImageElement>("img:not(noscript img)");
          if (!loaded || !target?.complete || target.naturalWidth <= 0 || target.getAttribute("src") !== image.src || !dialog.current) return;
          dialog.current.showModal(); setExpanded(true); closeButton.current?.focus();
        }}>{labels.inspectImage}</button>
      {navigation()}
      {images.length > 1 && <ul className="flex flex-wrap gap-3">
        {images.map((thumbnail, index) => <li key={index}>
          <button type="button" aria-label={`${thumbnail.alt} (${index + 1}/${images.length})`}
            aria-pressed={selected === index} onClick={() => setSelected(index)}
            className="block w-20 rounded-2xl border-2 border-transparent p-1 aria-pressed:border-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
            <span aria-hidden="true" className="block"><ProductImage {...thumbnail} /></span>
          </button>
        </li>)}
      </ul>}
      <dialog ref={dialog} id={dialogId} aria-label={`${labels.inspectImage}: ${image.alt}`}
        className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-2xl border border-hanapure-border bg-hanapure-white p-4 text-hanapure-text backdrop:bg-black/50 sm:p-6"
        onCancel={event => { event.preventDefault(); closeInspection(); }} onClose={closeInspection}>
        <button ref={closeButton} type="button" className={control} onClick={closeInspection}>{labels.closeImage}</button>
        {expanded && <div className="mx-auto my-4 w-full max-w-[min(80vw,65dvh)]" onErrorCapture={() => {
          setReadiness({ src: image.src, loaded: false }); closeInspection();
        }}><ProductImage {...image} /></div>}
        {navigation()}
      </dialog>
    </>}
  </div>;
}

export default function ProductMediaGallery({ images, locale = "en" }: { images: readonly EditorialImage[]; locale?: EditorialLocale }) {
  if (!images.length) return null;
  // New product/locale/image arrays reset selection without carrying old failures.
  return <Gallery key={JSON.stringify([locale, images])} images={images} locale={locale} />;
}
