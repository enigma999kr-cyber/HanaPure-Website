import "server-only";

import { notFound } from "next/navigation";
import Link from "next/link";
import Container from "@/components/ui/Container";
import { localCatalogue } from "@/lib/catalog/local-catalogue";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { brandNames } from "@/data/brands";
import { discoverCatalogue, type CatalogueCriteria } from "@/lib/catalog/catalogue-discovery";

type CatalogueReader = typeof localCatalogue;
const linkStyle = "inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text";

/** Native images use editorial URLs directly; no optimizer/provider allowlist is invented. */
function ProductImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="aspect-square overflow-hidden rounded-2xl bg-hanapure-ivory">
      {/* eslint-disable-next-line @next/next/no-img-element -- Editorial v1 has no dimensions or approved image-provider configuration. */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-contain" />
    </div>
  );
}

/** Missing selected-locale content stays explicit. null retains legacy English URLs. */
export function ProductListing({ catalogue = localCatalogue, locale = "en", routeLocale = null,
  criteria = { query: "", brand: "" } }: {
  catalogue?: CatalogueReader; locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
  criteria?: CatalogueCriteria;
} = {}) {
  const products = discoverCatalogue(catalogue, locale, criteria);
  const active = Boolean(criteria.query || criteria.brand);
  const unknownBrand = criteria.brand && !brandNames.some((brand) => brand === criteria.brand);
  const labels = storefrontLabels[locale];
  const listingHref = storefrontHref("/products", routeLocale);
  const controlStyle = "min-h-11 w-full rounded-xl border border-hanapure-border bg-hanapure-warm-white px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      <h1 className="text-4xl font-light text-hanapure-text sm:text-5xl">{labels.heading}</h1>
      <form key={JSON.stringify([locale, criteria.query, criteria.brand])}
        action={listingHref} method="get" role="search" aria-label={labels.searchProducts}
        className="mt-8 grid gap-4 rounded-2xl border border-hanapure-border bg-hanapure-white p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <label htmlFor="catalogue-search" className="mb-2 block text-sm font-medium">{labels.searchProducts}</label>
          <input id="catalogue-search" name="q" type="search" defaultValue={criteria.query} autoComplete="off"
            placeholder={labels.searchHint} className={`${controlStyle} scroll-mt-28`} />
        </div>
        <div className="min-w-0">
          <label htmlFor="catalogue-brand" className="mb-2 block text-sm font-medium">{labels.filterBrand}</label>
          <select id="catalogue-brand" name="brand" defaultValue={criteria.brand} className={controlStyle}>
            <option value="">{labels.allBrands}</option>
            {unknownBrand && <option value={criteria.brand}>{labels.invalidBrand}</option>}
            {[...brandNames].sort((a, b) => a.localeCompare(b, "en")).map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-xl bg-hanapure-text px-5 py-3 text-hanapure-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.apply}</button>
      </form>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p role="status" className="text-sm text-hanapure-muted">{labels.results}: {products.length}</p>
        {active && <Link href={listingHref} className={linkStyle}>{labels.clear}</Link>}
      </div>
      {products.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-hanapure-border bg-hanapure-white p-6 sm:p-8">
          <h2 className="text-2xl font-light">{active ? labels.noResults : labels.empty}</h2>
          <p className="mt-3 leading-7 text-hanapure-muted">{active ? labels.noResultsDescription : labels.emptyDescription}</p>
          <Link href={storefrontHref("/brands", routeLocale)} className={`${linkStyle} mt-4`}>{labels.exploreBrands}</Link>
        </div>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const content = product.translations[locale];
            return (
              <li key={product.publicId} className="min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
                {content?.images[0] && <ProductImage {...content.images[0]} />}
                <p className="mt-4 text-sm text-hanapure-muted">{product.brand}</p>
                <h2 className="mt-2 break-words text-2xl font-light">
                  <Link href={storefrontHref(`/products/${product.slug}`, routeLocale)} className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                    {content?.name ?? labels.details}
                  </Link>
                </h2>
                <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">
                  {content?.description ?? labels.missing}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

export function ProductDetail({ slug, catalogue = localCatalogue, locale = "en", routeLocale = null }: {
  slug: string; catalogue?: CatalogueReader; locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
}) {
  const product = catalogue.findPublishedBySlug(slug);
  // Absent/draft editorial records are not public pages. No ERP absence is inferred.
  if (!product) notFound();
  const content = product.translations[locale];
  const labels = storefrontLabels[locale];
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      <Link href={storefrontHref("/products", routeLocale)} className={linkStyle}>{labels.back}</Link>
      <article className="mt-6 grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
        {content && content.images.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {content.images.map((image, index) => <ProductImage key={`${image.src}-${index}`} {...image} />)}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm text-hanapure-muted">{product.brand}</p>
          <h1 className="mt-3 break-words text-4xl font-light sm:text-5xl">{content?.name ?? labels.details}</h1>
          <p className="mt-6 whitespace-pre-line break-words leading-8 text-hanapure-muted">
            {content?.description ?? labels.missing}
          </p>
          {content?.usage && (
            <section className="mt-8" aria-labelledby="product-usage">
              <h2 id="product-usage" className="text-xl font-medium">{labels.usage}</h2>
              <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">{content.usage}</p>
            </section>
          )}
          {content?.caution && (
            <section className="mt-8" aria-labelledby="product-caution">
              <h2 id="product-caution" className="text-xl font-medium">{labels.caution}</h2>
              <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">{content.caution}</p>
            </section>
          )}
        </div>
      </article>
    </Container>
  );
}
