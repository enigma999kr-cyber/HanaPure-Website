"use client";

import { useState, useSyncExternalStore } from "react";
import type { EditorialImage } from "@/lib/catalog/editorial-catalogue";
import ProductImage from "./ProductImage";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function Gallery({ images }: { images: readonly EditorialImage[] }) {
  const [selected, setSelected] = useState(0);
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const image = images[selected];
  return <div className="col-span-full min-w-0 space-y-4">
    {hydrated ? <ProductImage {...image} /> :
      <div className="aspect-square overflow-hidden rounded-2xl bg-hanapure-ivory">
        {/* eslint-disable-next-line @next/next/no-img-element -- Initial SSR and no-JS retain a visible native editorial image. */}
        <img src={image.src} alt={image.alt} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      </div>}
    {hydrated && <>
      <p aria-live="polite" className="text-sm text-hanapure-muted">{selected + 1} / {images.length}</p>
      <ul className="flex flex-wrap gap-3">
        {images.map((thumbnail, index) => <li key={index}>
          <button type="button" aria-label={`${thumbnail.alt} (${index + 1}/${images.length})`}
            aria-pressed={selected === index} onClick={() => setSelected(index)}
            className="block w-20 rounded-2xl border-2 border-transparent p-1 aria-pressed:border-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
            <span aria-hidden="true" className="block"><ProductImage {...thumbnail} /></span>
          </button>
        </li>)}
      </ul>
    </>}
  </div>;
}

export default function ProductMediaGallery({ images }: { images: readonly EditorialImage[] }) {
  if (!images.length) return null;
  if (images.length === 1) return <ProductImage {...images[0]} />;
  // New product/locale/image arrays reset selection without carrying old failures.
  return <Gallery key={JSON.stringify(images)} images={images} />;
}
