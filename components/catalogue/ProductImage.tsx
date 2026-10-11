"use client";

import { useCallback, useState } from "react";

function ImageFrame({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const inspect = useCallback((image: HTMLImageElement | null) => {
    // A cached load/error can finish before hydration attaches event handlers.
    if (image?.complete) setStatus(image.naturalWidth > 0 ? "loaded" : "failed");
  }, []);
  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-hanapure-ivory">
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element -- Native image preserves the pre-existing no-JavaScript behavior. */}
        <img src={src} alt={alt} loading="lazy" decoding="async"
          className="absolute inset-0 h-full w-full object-contain" />
      </noscript>
      {status === "failed" ? (
        <div role="img" aria-label={alt} className="flex h-full items-center justify-center p-4">
          <span aria-hidden="true" className="break-words text-center text-sm text-hanapure-muted">{alt}</span>
        </div>
      ) : (
        // Keep the image invisible until loaded, including pre-hydration failures.
        // eslint-disable-next-line @next/next/no-img-element -- Preserve native editorial URLs; no provider policy is introduced.
        <img ref={inspect} src={src} alt={alt} loading="lazy" decoding="async" aria-hidden={status !== "loaded"}
          onLoad={event => setStatus(event.currentTarget.naturalWidth > 0 ? "loaded" : "failed")}
          onError={() => setStatus("failed")}
          className={`h-full w-full object-contain ${status === "loaded" ? "" : "opacity-0"}`} />
      )}
    </div>
  );
}

export default function ProductImage({ src, alt }: { src: string; alt: string }) {
  // A new source gets fresh state; an old error cannot hide the replacement.
  return <ImageFrame key={src} src={src} alt={alt} />;
}
