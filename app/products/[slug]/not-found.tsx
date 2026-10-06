"use client";

import Header from "@/components/layout/Header";
import Container from "@/components/ui/Container";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeFromPath, storefrontHref, storefrontLabels } from "@/lib/storefront/localization";

export default function ProductNotFound() {
  const locale = localeFromPath(usePathname() ?? "/");
  const labels = storefrontLabels[locale ?? "en"];
  return (
    <main lang={locale ?? "en"} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />
      <Container className="pb-20 pt-32 sm:pt-36">
        <h1 id="main-content" tabIndex={-1} className="text-4xl font-light">{labels.notFound}</h1>
        <p className="mt-4 leading-7 text-hanapure-muted">{labels.notFoundDescription}</p>
        <Link href={storefrontHref("/products", locale)} className="mt-6 inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">{labels.back}</Link>
      </Container>
    </main>
  );
}
