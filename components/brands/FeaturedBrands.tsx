import BrandCard from "./BrandCard";
import { marketingCopy } from "@/lib/storefront/marketing-copy";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";

const brands = [
  {
    name: "Round Lab",
    copyKey: "roundLab",
    accent:
      "bg-gradient-to-br from-hanapure-beige-light to-hanapure-white",
  },
  {
    name: "Anua",
    copyKey: "anua",
    accent:
      "bg-gradient-to-br from-hanapure-beige to-hanapure-warm-white",
  },
  {
    name: "SKIN1004",
    copyKey: "skin1004",
    accent: "bg-gradient-to-br from-hanapure-ivory to-hanapure-white",
  },
] as const;

export default function FeaturedBrands({ locale = "en" }: { locale?: EditorialLocale }) {
  const copy = marketingCopy[locale].featured;
  return (
    <section className="bg-hanapure-ivory py-28">
      <div className="mx-auto max-w-7xl px-6">
        <p className="mb-4 text-center text-sm uppercase tracking-[0.3em] text-hanapure-muted">
          {copy.eyebrow}
        </p>

        <h2 className="mx-auto mb-6 max-w-3xl text-center text-5xl font-light text-hanapure-text">
          {copy.heading}
          <br />
          {copy.headingEnd}
        </h2>

        <p className="mx-auto mb-16 max-w-2xl text-center text-lg leading-8 text-hanapure-muted">
          {copy.description}
        </p>

        <div className="grid gap-8 md:grid-cols-3">
          {brands.map((brand) => (
            <BrandCard
              key={brand.name}
              name={brand.name}
              tagline={copy[brand.copyKey].tagline}
              description={copy[brand.copyKey].description}
              discover={copy.discover}
              accent={brand.accent}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
