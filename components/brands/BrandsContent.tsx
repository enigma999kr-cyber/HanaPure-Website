import BrandDirectory from "./BrandDirectory";
import Header from "@/components/layout/Header";
import { marketingCopy } from "@/lib/storefront/marketing-copy";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { brandNames } from "@/data/brands";
import { catalogueQueryString } from "@/lib/catalog/catalogue-discovery";
import { storefrontHref } from "@/lib/storefront/localization";

export default function BrandsContent({ locale = "en", routeLocale = null }: {
  locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
}) {
  const copy = marketingCopy[locale];
  const catalogueLinks = Object.fromEntries(brandNames.map((brand) => [brand,
    storefrontHref("/products", routeLocale) + catalogueQueryString({ query: "", brand }),
  ]));
  return (
    <main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />
      <div className="bg-gradient-to-b from-hanapure-ivory to-hanapure-warm-white px-5 pb-12 pt-36 sm:px-6 sm:pb-16 sm:pt-40">
        <div className="mx-auto max-w-7xl">
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-hanapure-muted sm:text-sm">{copy.brands.eyebrow}</p>
          <h1 id="main-content" tabIndex={-1} className="max-w-3xl text-5xl font-light leading-tight sm:text-6xl">{copy.brands.heading}</h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-hanapure-muted sm:text-lg">{copy.brands.description}</p>
        </div>
      </div>
      <BrandDirectory labels={copy.directory} catalogueLinks={catalogueLinks} />
    </main>
  );
}
