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
  routeLocale?: EditorialLocale | null;
};

export default function BrandCard({
  name,
  tagline,
  description,
  accent,
  discover,
  routeLocale = null,
}: BrandCardProps) {
  return (
    <article className="group overflow-hidden rounded-[2rem] border border-hanapure-border bg-hanapure-warm-white shadow-sm transition duration-300 hover:-translate-y-1 hover:bg-hanapure-white hover:shadow-lg">
      <div className={`h-40 ${accent}`} />

      <div className="p-8">
        <h3 className="mb-3 text-2xl font-light text-hanapure-text">{name}</h3>

        <p className="mb-6 text-sm font-medium text-hanapure-text">{tagline}</p>

        <p className="mb-8 leading-7 text-hanapure-muted">{description}</p>

        <Link
          href={storefrontHref("/products", routeLocale) + catalogueQueryString({ query: "", brand: name })}
          className="text-sm font-medium text-hanapure-text transition group-hover:tracking-wide"
        >
          {discover} →
        </Link>
      </div>
    </article>
  );
}
