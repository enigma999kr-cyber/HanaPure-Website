import "server-only";

import { notFound } from "next/navigation";
import Link from "next/link";
import Container from "@/components/ui/Container";
import ProductImage from "./ProductImage";
import ProductMediaGallery from "./ProductMediaGallery";
import AddToCart from "@/components/cart/AddToCart";
import QuickAdd from "@/components/cart/QuickAdd";
import SaveProductButton from "./SaveProductButton";
import SavedProductsBar from "./SavedProductsBar";
import ProductComparison from "./ProductComparison";
import SearchSuggestions from "./SearchSuggestions";
import CopySearchLink from "./CopySearchLink";
import RecentlyViewedProducts, { ProductVisitTracker } from "./RecentlyViewedProducts";
import { resolveComparison, type ComparisonProduct } from "@/lib/comparison/compare-selection";
import { cartLabels } from "@/lib/cart/labels";
import { localCatalogue } from "@/lib/catalog/local-catalogue";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { brandNames } from "@/data/brands";
import { catalogueQueryString, discoverCatalogue, publishedCatalogueBrands, type CatalogueCriteria } from "@/lib/catalog/catalogue-discovery";

type CatalogueReader = typeof localCatalogue;
function comparisonProjection(catalogue: CatalogueReader, locale: EditorialLocale): readonly ComparisonProduct[] {
  return catalogue.listPublished().map(product => {
    const content = product.translations[locale];
    return { publicId: product.publicId, slug: product.slug, brand: product.brand,
      name: content?.name ?? null, description: content?.description ?? null,
      usage: content?.usage ?? null, caution: content?.caution ?? null };
  });
}
const linkStyle = "inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text";

/** Missing selected-locale content stays explicit. null retains legacy English URLs. */
export function ProductListing({ catalogue = localCatalogue, locale = "en", routeLocale = null,
  criteria = { query: "", brand: "" } }: {
  catalogue?: CatalogueReader; locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
  criteria?: CatalogueCriteria;
} = {}) {
  const products = discoverCatalogue(catalogue, locale, criteria);
  const suggestions = catalogue.listPublished().map(product => ({
    publicId: product.publicId, slug: product.slug, brand: product.brand,
    name: product.translations[locale]?.name ?? null,
    description: product.translations[locale]?.description ?? null,
  }));
  const comparison = comparisonProjection(catalogue, locale);
  const active = Boolean(criteria.query || criteria.brand);
  const unknownBrand = criteria.brand && !brandNames.some((brand) => brand === criteria.brand);
  const publishedBrands = publishedCatalogueBrands(catalogue);
  const labels = storefrontLabels[locale];
  const quickProducts = catalogue.listPublished().map(product => ({
    publicId: product.publicId, slug: product.slug,
    name: product.translations[locale]?.name ?? `${labels.details}: ${product.brand} (${product.slug})`,
  }));
  const savedProducts = comparison.map(product => ({
    publicId: product.publicId, slug: product.slug, brand: product.brand,
    name: product.name ?? `${labels.details}: ${product.brand} (${product.slug})`,
  }));
  const listingHref = storefrontHref("/products", routeLocale);
  const appliedCriteria = [
    ...(criteria.query ? [{ key: "q", label: `${labels.searchProducts}: ${criteria.query}`,
      href: listingHref + catalogueQueryString({ ...criteria, query: "" }) }] : []),
    ...(criteria.brand ? [{ key: "brand", label: `${labels.filterBrand}: ${publishedBrands.some(brand => brand === criteria.brand) ? criteria.brand : labels.invalidBrand}`,
      href: listingHref + catalogueQueryString({ ...criteria, brand: "" }) }] : []),
    ...(criteria.sort === "name-asc" || criteria.sort === "name-desc" ? [{ key: "sort",
      label: `${labels.sortBy}: ${criteria.sort === "name-asc" ? labels.nameAscending : labels.nameDescending}`,
      href: listingHref + catalogueQueryString({ query: criteria.query, brand: criteria.brand }) }] : []),
  ];
  const criterionLinkStyle = `${linkStyle} min-w-0 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3`;
  const controlStyle = "min-h-11 w-full rounded-xl border border-hanapure-border bg-hanapure-warm-white px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      <h1 id="main-content" tabIndex={-1} className="text-4xl font-light text-hanapure-text sm:text-5xl">{labels.heading}</h1>
      <SavedProductsBar locale={locale} routeLocale={routeLocale} products={savedProducts} comparisonProducts={comparison} />
      <RecentlyViewedProducts locale={locale} routeLocale={routeLocale} products={quickProducts} comparisonProducts={comparison} />
      <form key={JSON.stringify([locale, criteria.query, criteria.brand, criteria.sort])}
        action={listingHref} method="get" autoComplete="off" role="search" aria-label={labels.searchProducts}
        className="mt-8 grid gap-4 rounded-2xl border border-hanapure-border bg-hanapure-white p-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <label htmlFor="catalogue-search" className="mb-2 block text-sm font-medium">{labels.searchProducts}</label>
          <SearchSuggestions products={suggestions} initialQuery={criteria.query} locale={locale} routeLocale={routeLocale}
            appliedCriteria={{ brand: criteria.brand, ...(criteria.sort ? { sort: criteria.sort } : {}) }}>
            <input id="catalogue-search" name="q" type="search" defaultValue={criteria.query} autoComplete="off"
              placeholder={labels.searchHint} className={`${controlStyle} scroll-mt-24`} />
          </SearchSuggestions>
        </div>
        <div className="min-w-0">
          <label htmlFor="catalogue-brand" className="mb-2 block text-sm font-medium">{labels.filterBrand}</label>
          <select id="catalogue-brand" name="brand" defaultValue={criteria.brand} className={controlStyle}>
            <option value="">{labels.allBrands}</option>
            {criteria.brand && !publishedBrands.some(brand => brand === criteria.brand) &&
              <option value={criteria.brand}>{unknownBrand ? labels.invalidBrand : criteria.brand}</option>}
            {publishedBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="catalogue-sort" className="mb-2 block text-sm font-medium">{labels.sortBy}</label>
          <select id="catalogue-sort" name="sort" defaultValue={criteria.sort ?? ""} className={controlStyle}>
            <option value="">{labels.defaultOrder}</option>
            <option value="name-asc">{labels.nameAscending}</option>
            <option value="name-desc">{labels.nameDescending}</option>
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-xl bg-hanapure-text px-5 py-3 text-hanapure-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.apply}</button>
      </form>
      {publishedBrands.length > 0 && <nav aria-labelledby="catalogue-brand-shortcuts" className="mt-6 min-w-0">
        <h2 id="catalogue-brand-shortcuts" className="break-words text-sm font-medium">{labels.quickBrands}</h2>
        <ul className="mt-3 flex min-w-0 flex-wrap gap-3">
          {publishedBrands.map(brand => <li key={brand} className="min-w-0 max-w-full">
            <Link href={listingHref + catalogueQueryString({ ...criteria, brand: criteria.brand === brand ? "" : brand })}
              aria-current={criteria.brand === brand ? "true" : undefined}
              aria-label={criteria.brand === brand ? `${labels.removeFilter}: ${labels.filterBrand}: ${brand}` : undefined}
              className={`${criterionLinkStyle} ${criteria.brand === brand ? "bg-hanapure-beige" : "bg-hanapure-white"}`}>{brand}</Link>
          </li>)}
        </ul>
      </nav>}
      {appliedCriteria.length > 0 && <section aria-labelledby="catalogue-active-filters" className="mt-6 min-w-0">
        <h2 id="catalogue-active-filters" className="break-words text-sm font-medium">{labels.activeFilters}</h2>
        <ul className="mt-3 flex min-w-0 flex-wrap gap-3">
          {appliedCriteria.map(criterion => <li key={criterion.key} className="min-w-0 max-w-full">
            <Link href={criterion.href} aria-label={`${labels.removeFilter}: ${criterion.label}`}
              className={`${criterionLinkStyle} gap-2 bg-hanapure-warm-white`}>
              <span className="min-w-0 break-words">{criterion.label}</span><span aria-hidden="true">×</span>
            </Link>
          </li>)}
        </ul>
      </section>}
      {appliedCriteria.length > 0 && <CopySearchLink key={`${locale}-${catalogueQueryString(criteria)}`} locale={locale}
        relativeHref={listingHref + catalogueQueryString(criteria)} />}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p role="status" className="text-sm text-hanapure-muted">{labels.results}: {products.length}</p>
        {(active || criteria.sort) && <Link href={listingHref} className={linkStyle}>{labels.clear}</Link>}
      </div>
      {products.length > 0 && <p className="mt-4 text-sm leading-6 text-hanapure-muted">{cartLabels[locale].notice}</p>}
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
            const detailHref = `${storefrontHref(`/products/${product.slug}`, routeLocale)}${catalogueQueryString(criteria)}`;
            return (
              <li key={product.publicId} className="min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
                {content?.images[0] && <Link href={detailHref} aria-label={`${labels.details}: ${content.name}`}
                  className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                  <ProductImage {...content.images[0]} />
                </Link>}
                <p className="mt-4 text-sm text-hanapure-muted">{product.brand}</p>
                <h2 className="mt-2 break-words text-2xl font-light">
                  <Link href={detailHref}
                    aria-label={content ? undefined : `${labels.details}: ${product.brand} (${product.slug})`}
                    className="block min-h-11 py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                    {content?.name ?? labels.details}
                  </Link>
                </h2>
                <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">
                  {content?.description ?? labels.missing}
                </p>
                <QuickAdd publicId={product.publicId} locale={locale}
                  name={content?.name ?? `${labels.details}: ${product.brand} (${product.slug})`} />
                <SaveProductButton publicId={product.publicId} locale={locale}
                  name={content?.name ?? `${labels.details}: ${product.brand} (${product.slug})`} />
              </li>
            );
          })}
        </ul>
      )}
      {comparison.length >= 2 && <ProductComparison key={locale} products={comparison} locale={locale} routeLocale={routeLocale} />}
    </Container>
  );
}

export function ProductDetail({ slug, catalogue = localCatalogue, locale = "en", routeLocale = null,
  criteria = { query: "", brand: "" } }: {
  slug: string; catalogue?: CatalogueReader; locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
  criteria?: CatalogueCriteria;
}) {
  const product = catalogue.findPublishedBySlug(slug);
  // Absent/draft editorial records are not public pages. No ERP absence is inferred.
  if (!product) notFound();
  const content = product.translations[locale];
  const labels = storefrontLabels[locale];
  const brandQuery = catalogueQueryString({ query: "", brand: product.brand });
  const related = catalogue.listPublished().filter(item => item.brand === product.brand && item.publicId !== product.publicId).slice(0, 3);
  const comparison = comparisonProjection(catalogue, locale);
  const hasComparison = resolveComparison(comparison, product.publicId) !== null;
  const detailTargetStyle = "scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text";
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      <ProductVisitTracker key={product.publicId} publicId={product.publicId} />
      <Link href={`${storefrontHref("/products", routeLocale)}${catalogueQueryString(criteria)}`} className={linkStyle}>{labels.back}</Link>
      <article className="mt-6 grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
        {content && content.images.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {content.images.length > 1 ? <ProductMediaGallery key={`${product.publicId}-${locale}`} images={content.images} />
              : content.images.map((image, index) => <ProductImage key={`${product.publicId}-${image.src}-${index}`} {...image} />)}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm text-hanapure-muted"><Link href={`${storefrontHref("/products", routeLocale)}${brandQuery}`} className={linkStyle}>{product.brand}</Link></p>
          <h1 id="main-content" tabIndex={-1} className="mt-3 break-words text-4xl font-light sm:text-5xl">{content?.name ?? labels.details}</h1>
          <nav aria-label={labels.detailNavigation} className="mt-5 flex min-w-0 flex-wrap gap-3">
            {content?.description && <a href="#product-description" className={`${linkStyle} max-w-full break-words`}>{labels.description}</a>}
            {content?.usage && <a href="#product-usage" className={`${linkStyle} max-w-full break-words`}>{labels.usage}</a>}
            {content?.caution && <a href="#product-caution" className={`${linkStyle} max-w-full break-words`}>{labels.caution}</a>}
            <a href="#product-selection" className={`${linkStyle} max-w-full break-words`}>{labels.detailSelection}</a>
            {hasComparison && <a href="#product-comparison" className={`${linkStyle} max-w-full break-words`}>{labels.compareAnother}</a>}
          </nav>
          <p id={content?.description ? "product-description" : undefined} tabIndex={content?.description ? -1 : undefined}
            className={`mt-6 whitespace-pre-line break-words leading-8 text-hanapure-muted ${detailTargetStyle}`}>
            {content?.description ?? labels.missing}
          </p>
          {content?.usage && (
            <section className="mt-8" aria-labelledby="product-usage">
              <h2 id="product-usage" tabIndex={-1} className={`text-xl font-medium ${detailTargetStyle}`}>{labels.usage}</h2>
              <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">{content.usage}</p>
            </section>
          )}
          {content?.caution && (
            <section className="mt-8" aria-labelledby="product-caution">
              <h2 id="product-caution" tabIndex={-1} className={`text-xl font-medium ${detailTargetStyle}`}>{labels.caution}</h2>
              <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">{content.caution}</p>
            </section>
          )}
          <section id="product-selection" tabIndex={-1} aria-label={labels.detailSelection} className={detailTargetStyle}>
            <AddToCart key={product.publicId} publicId={product.publicId} locale={locale} routeLocale={routeLocale} />
          </section>
          <SaveProductButton publicId={product.publicId} locale={locale}
            name={content?.name ?? `${labels.details}: ${product.brand} (${product.slug})`} />
        </div>
      </article>
      {related.length > 0 && <section className="mt-12" aria-labelledby="same-brand-heading">
        <h2 id="same-brand-heading" className="text-2xl font-light">{product.brand}</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {related.map(item => {
            const translated = item.translations[locale];
            return <li key={item.publicId} className="min-w-0">
              <Link href={`${storefrontHref(`/products/${item.slug}`, routeLocale)}${brandQuery}`}
                aria-label={translated ? undefined : `${labels.details}: ${item.brand} (${item.slug})`}
                className="block min-h-11 break-words rounded-xl border border-hanapure-border bg-hanapure-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
                {translated?.name ?? labels.details}
              </Link>
              {!translated && <p className="mt-2 text-sm text-hanapure-muted">{labels.missing}</p>}
            </li>;
          })}
        </ul>
      </section>}
      {hasComparison && <ProductComparison key={`${product.publicId}-${locale}`} products={comparison}
        locale={locale} routeLocale={routeLocale} initialPublicId={product.publicId} destinationId="product-comparison" />}
    </Container>
  );
}
