import Link from "next/link";
import { storefrontHref } from "@/lib/storefront/localization";
import { catalogueQueryString } from "@/lib/catalog/catalogue-discovery";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import type { brandNames } from "@/data/brands";

type BrandCardProps = {
  name: (typeof brandNames)[number];
  tagline: string;
  description: string;
  accent: string;
  discover: string;
  hasPublishedProduct: boolean;
  routeLocale?: EditorialLocale | null;
};

export default function BrandCard({
  name,
  tagline,
  description,
  accent,
  discover,
  hasPublishedProduct,
  routeLocale = null,
}: BrandCardProps) {
  return (
    <article className="min-w-0 overflow-hidden rounded-[2rem] border border-hanapure-border bg-hanapure-warm-white shadow-sm transition-colors hover:bg-hanapure-white">
      <div className={`h-40 ${accent}`} />

      <div className="min-w-0 break-words p-5 sm:p-8">
        <h3 className="mb-3 text-2xl font-light text-hanapure-text">{name}</h3>

        <p className="mb-6 text-sm font-medium text-hanapure-text">{tagline}</p>

        <p className="mb-8 leading-7 text-hanapure-muted">{description}</p>

        <div className="min-h-5">
        {hasPublishedProduct && <Link
          href={storefrontHref("/products", routeLocale) + catalogueQueryString({ query: "", brand: name })}
          className="inline-flex min-h-11 min-w-11 max-w-full items-center break-words rounded-sm py-2 text-sm font-medium text-hanapure-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text"
        >
          {discover} →
        </Link>}
        </div>
      </div>
    </article>
  );
}
