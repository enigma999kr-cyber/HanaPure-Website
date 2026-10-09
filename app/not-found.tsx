"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import Container from "@/components/ui/Container";
import { localeFromPath, storefrontHref, storefrontLabels } from "@/lib/storefront/localization";

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
const browserPath = () => window.location.pathname;
const serverPath = () => "/";

/** General unmatched routes recover independently of product-specific 404s. */
export default function StorefrontNotFound() {
  // Next's root fallback reports /_not-found rather than the requested route.
  // Read the browser URL after hydration; SSR retains a usable English Home link.
  const pathname = useSyncExternalStore(subscribeLocation, browserPath, serverPath);
  const locale = localeFromPath(pathname);
  const labels = storefrontLabels[locale ?? "en"];
  return (
      <main lang={locale ?? "en"} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
        <Container className="pb-20 pt-32 sm:pt-36">
          <h1 id="main-content" tabIndex={-1} className="text-4xl font-light">404</h1>
          <Link href={storefrontHref("/", locale)}
            className="mt-6 inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
            {labels.home}
          </Link>
        </Container>
      </main>
  );
}
