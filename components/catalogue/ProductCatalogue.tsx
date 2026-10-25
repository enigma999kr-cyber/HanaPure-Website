import "server-only";

import { notFound } from "next/navigation";
import Link from "next/link";
import type { ComponentProps } from "react";
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
import CatalogueResultPairPicker, { CatalogueResultPairCheckbox } from "./CatalogueResultPairPicker";
import RecentlyViewedProducts, { ProductVisitTracker } from "./RecentlyViewedProducts";
import { COMPARISON_DESTINATION, comparisonHref, publishedComparison, resolveComparison, type ComparisonContext, type ComparisonProduct } from "@/lib/comparison/compare-selection";
import { comparisonLabels } from "@/lib/comparison/labels";
import { cartLabels } from "@/lib/cart/labels";
import { localCatalogue } from "@/lib/catalog/local-catalogue";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { brandNames } from "@/data/brands";
import { catalogueQueryString, discoverCatalogue, publishedCatalogueBrands, type CatalogueCriteria } from "@/lib/catalog/catalogue-discovery";
import { catalogueBrowseHref, catalogueBrowseQuery, catalogueCardId, catalogueResultPage, readCatalogueBrowse, CATALOGUE_PAGE_SIZE, type CatalogueBrowse } from "@/lib/catalog/catalogue-browse";
import CatalogueShoppingPlan, { ShoppingPlanCardActions, ShoppingPlanSearchGuard, type PlanProduct } from "./CatalogueShoppingPlan";
import { readShoppingPlan, carryShoppingPlan, shoppingPlanHref } from "@/lib/catalog/catalogue-shopping-plan";

type CatalogueReader = typeof localCatalogue;
function comparisonProjection(catalogue: CatalogueReader, locale: EditorialLocale): readonly ComparisonProduct[] {
  return catalogue.listPublished().map(product => {
    const content = product.translations[locale];
    return { publicId: product.publicId, slug: product.slug, brand: product.brand,
      name: content?.name ?? null, description: content?.description ?? null,
      usage: content?.usage ?? null, caution: content?.caution ?? null, image: content?.images[0] ?? null };
  });
}
const linkStyle = "inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text";
function BrowseLink({ href, refusal, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string | null; refusal: string }) {
  return href === null ? <span role="status" className="break-words text-sm">{refusal}</span> : <Link href={href} {...props} />;
}
/** The shell forwards only validated public Plan and complete comparison hints. */
export function catalogueHeaderQuery(criteria: CatalogueCriteria, browse: CatalogueBrowse, planHint: unknown, catalogue: CatalogueReader = localCatalogue, path = "/products", comparisonContext: ComparisonContext = {}) {
  const query = catalogueBrowseQuery(catalogueQueryString(criteria), { ...browse, pickFirst: undefined });
  if (query === null) return null;
  const plan = readShoppingPlan(planHint, catalogue.listPublished());
  const href = shoppingPlanHref(path, query, plan.lines);
  if (href === null) return null;
  // Do not turn a partial/invalid selection into the comparison UI's fallback pair.
  const pair = comparisonContext.first && comparisonContext.second
    ? publishedComparison(catalogue.listPublished(), comparisonContext) : null;
  const params = new URLSearchParams(href.slice(path.length));
  if (pair) {
    params.set("compareFirst", pair[0].publicId.toLowerCase());
    params.set("compareSecond", pair[1].publicId.toLowerCase());
  }
  const suffix = params.size ? `?${params}` : "";
  // Reserve the longest locale prefix for all language-switch destinations.
  return path.length + suffix.length + 4 > 8192 ? null : suffix;
}
function planProjection(comparison: readonly ComparisonProduct[], ids: readonly string[]): readonly PlanProduct[] {
  return comparison.filter(product => ids.includes(product.publicId.toLowerCase())).map(product => ({
    publicId: product.publicId.toLowerCase(), slug: product.slug, brand: product.brand, name: product.name }));
}

/** Missing selected-locale content stays explicit. null retains legacy English URLs. */
export function ProductListing({ catalogue = localCatalogue, locale = "en", routeLocale = null,
  criteria = { query: "", brand: "" }, comparisonContext = {}, browse = readCatalogueBrowse(), planHint }: {
  catalogue?: CatalogueReader; locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
  criteria?: CatalogueCriteria;
  comparisonContext?: ComparisonContext;
  browse?: CatalogueBrowse;
  planHint?: unknown;
} = {}) {
  const plan = readShoppingPlan(planHint, catalogue.listPublished());
  const withPlan = (href: string | null) => carryShoppingPlan(href, plan);
  const resultPage = catalogueResultPage(discoverCatalogue(catalogue, locale, criteria), locale, browse);
  const products = resultPage.items;
  const firstProduct = resultPage.total >= 2 ? resultPage.all.find(product => product.publicId.toLowerCase() === browse.pickFirst) : undefined;
  const view = { ...browse, page: resultPage.page, pickFirst: firstProduct?.publicId.toLowerCase() };
  const resetView = { ...view, page: 1, pageSpecified: false, pickFirst: undefined };
  const positioned = resultPage.pages > 1 || view.pageSpecified || view.withLocaleInfo || view.withLocaleImage;
  const suggestions = catalogue.listPublished().map(product => ({
    publicId: product.publicId, slug: product.slug, brand: product.brand,
    name: product.translations[locale]?.name ?? null,
    description: product.translations[locale]?.description ?? null,
  }));
  const comparison = comparisonProjection(catalogue, locale);
  const active = Boolean(criteria.query || criteria.brand || view.withLocaleInfo || view.withLocaleImage);
  const unknownBrand = criteria.brand && !brandNames.some((brand) => brand === criteria.brand);
  const publishedBrands = publishedCatalogueBrands(catalogue);
  const labels = storefrontLabels[locale];
  const quickProducts = catalogue.listPublished().map(product => ({
    publicId: product.publicId, slug: product.slug,
    name: product.translations[locale]?.name ?? `${labels.details}: ${product.brand} (${product.slug})`,
    image: product.translations[locale]?.images[0] ?? null,
  }));
  const savedProducts = comparison.map(product => ({
    publicId: product.publicId, slug: product.slug, brand: product.brand,
    name: product.name ?? `${labels.details}: ${product.brand} (${product.slug})`,
    image: product.image ?? null,
  }));
  const listingHref = storefrontHref("/products", routeLocale);
  const query = catalogueQueryString(criteria);
  const changedViewHref = (next: CatalogueCriteria, nextView = resetView) => withPlan(catalogueBrowseHref(listingHref, catalogueQueryString(next), nextView));
  const pageHref = (page: number) => withPlan(catalogueBrowseHref(listingHref, query, { ...view, page }));
  const planQuery = catalogueBrowseQuery(query, view) ?? query;
  const planContext = { plan, path: listingHref, query: planQuery, publishedIds: catalogue.listPublished().map(product => product.publicId.toLowerCase()) };
  const planProducts = planProjection(comparison, [...products.map(product => product.publicId.toLowerCase()), ...plan.lines.map(line => line.publicId)]);
  const comparisonPair = publishedComparison(comparison, comparisonContext);
  const appliedCriteria = [
    ...(criteria.query ? [{ key: "q", label: `${labels.searchProducts}: ${criteria.query}`,
      href: changedViewHref({ ...criteria, query: "" }) }] : []),
    ...(criteria.brand ? [{ key: "brand", label: `${labels.filterBrand}: ${publishedBrands.some(brand => brand === criteria.brand) ? criteria.brand : labels.invalidBrand}`,
      href: changedViewHref({ ...criteria, brand: "" }) }] : []),
    ...(criteria.sort === "name-asc" || criteria.sort === "name-desc" ? [{ key: "sort",
      label: `${labels.sortBy}: ${criteria.sort === "name-asc" ? labels.nameAscending : labels.nameDescending}`,
      href: changedViewHref({ query: criteria.query, brand: criteria.brand }) }] : []),
    ...(view.withLocaleInfo ? [{ key: "withLocaleInfo", label: labels.withLocaleInfo,
      href: changedViewHref(criteria, { ...resetView, withLocaleInfo: false }) }] : []),
    ...(view.withLocaleImage ? [{ key: "withLocaleImage", label: labels.withLocaleImage,
      href: changedViewHref(criteria, { ...resetView, withLocaleImage: false }) }] : []),
  ];
  const criterionLinkStyle = `${linkStyle} min-w-0 max-w-full break-words rounded-xl border border-hanapure-border px-4 py-3`;
  const controlStyle = "min-h-11 w-full min-w-0 max-w-full break-words rounded-xl border border-hanapure-border bg-hanapure-warm-white px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text";
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      <h1 id="main-content" tabIndex={-1} className={`${locale === "ko" ? "text-3xl min-[375px]:text-4xl" : "text-4xl"} font-light text-hanapure-text sm:text-5xl`}>{labels.heading}</h1>
      <ShoppingPlanSearchGuard path={listingHref} locale={locale}>
      <form key={JSON.stringify([locale, criteria.query, criteria.brand, criteria.sort, view.withLocaleInfo, view.withLocaleImage])}
        action={listingHref} method="get" autoComplete="off" role="search" aria-label={labels.searchProducts}
        className="mt-8 grid gap-4 rounded-2xl border border-hanapure-border bg-hanapure-white p-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        {plan.status === "ready" && <input type="hidden" name="cartPlan" value={new URLSearchParams(withPlan(listingHref)?.split("?")[1]).get("cartPlan") ?? ""} />}
        <div className="min-w-0">
          <label htmlFor="catalogue-search" className="mb-2 block text-sm font-medium">{labels.searchProducts}</label>
          <SearchSuggestions products={suggestions} initialQuery={criteria.query} locale={locale} routeLocale={routeLocale}
            {...(plan.status === "ready" ? { plan } : {})}
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
        <fieldset className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-full">
          <legend className="mb-2 text-sm font-medium">{labels.informationFilters}</legend>
          <label className="flex min-h-11 items-center gap-3 break-words"><input type="checkbox" name="withLocaleInfo" value="1" defaultChecked={view.withLocaleInfo}
            className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2" />{labels.withLocaleInfo}</label>
          <label className="flex min-h-11 items-center gap-3 break-words"><input type="checkbox" name="withLocaleImage" value="1" defaultChecked={view.withLocaleImage}
            className="h-5 w-5 shrink-0 accent-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2" />{labels.withLocaleImage}</label>
        </fieldset>
        <button type="submit" className="min-h-11 rounded-xl bg-hanapure-text px-5 py-3 text-hanapure-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{labels.apply}</button>
      </form>
      </ShoppingPlanSearchGuard>
      <SavedProductsBar locale={locale} routeLocale={routeLocale} products={savedProducts} comparisonProducts={comparison} planContext={planContext} />
      <RecentlyViewedProducts locale={locale} routeLocale={routeLocale} products={quickProducts} comparisonProducts={comparison} planContext={planContext} />
      {publishedBrands.length > 0 && <nav aria-labelledby="catalogue-brand-shortcuts" className="mt-6 min-w-0">
        <h2 id="catalogue-brand-shortcuts" className="break-words text-sm font-medium">{labels.quickBrands}</h2>
        <ul className="mt-3 flex min-w-0 flex-wrap gap-3">
          {publishedBrands.map(brand => <li key={brand} className="min-w-0 max-w-full">
            <BrowseLink refusal={labels.planLimit} href={changedViewHref({ ...criteria, brand: criteria.brand === brand ? "" : brand })}
              aria-current={criteria.brand === brand ? "true" : undefined}
              aria-label={criteria.brand === brand ? `${labels.removeFilter}: ${labels.filterBrand}: ${brand}` : undefined}
              className={`${criterionLinkStyle} ${criteria.brand === brand ? "bg-hanapure-beige" : "bg-hanapure-white"}`}>{brand}</BrowseLink>
          </li>)}
        </ul>
      </nav>}
      {appliedCriteria.length > 0 && <section aria-labelledby="catalogue-active-filters" className="mt-6 min-w-0">
        <h2 id="catalogue-active-filters" className="break-words text-sm font-medium">{labels.activeFilters}</h2>
        <ul className="mt-3 flex min-w-0 flex-wrap gap-3">
          {appliedCriteria.map(criterion => <li key={criterion.key} className="min-w-0 max-w-full">
            <BrowseLink refusal={labels.planLimit} href={criterion.href} aria-label={`${labels.removeFilter}: ${criterion.label}`}
              className={`${criterionLinkStyle} gap-2 bg-hanapure-warm-white`}>
              <span className="min-w-0 break-words">{criterion.label}</span><span aria-hidden="true">×</span>
            </BrowseLink>
          </li>)}
        </ul>
      </section>}
      {appliedCriteria.length > 0 && plan.status !== "ready" && !view.withLocaleInfo && !view.withLocaleImage && <CopySearchLink key={`${locale}-${catalogueQueryString(criteria)}`} locale={locale}
        relativeHref={listingHref + catalogueQueryString(criteria)} />}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p role="status" className="text-sm text-hanapure-muted">{labels.results}: {resultPage.total}</p>
        <p className="break-words text-sm">{labels.visibleResults}: {resultPage.from}–{resultPage.to} / {resultPage.total}</p>
        {resultPage.total > 0 && <p className="break-words text-sm">{labels.resultPage}: {resultPage.page} / {resultPage.pages}</p>}
        {(active || criteria.sort) && <BrowseLink refusal={labels.planLimit} href={withPlan(listingHref)} className={linkStyle}>{labels.clear}</BrowseLink>}
      </div>
      {resultPage.pages > 1 && <nav aria-label={labels.resultPages} className="mt-5 flex min-w-0 flex-wrap gap-4">
        {resultPage.page > 1 && <BrowseLink refusal={labels.planLimit} rel="prev" href={pageHref(resultPage.page - 1)} className={`${linkStyle} max-w-full break-words`}>{labels.previousPage}</BrowseLink>}
        {resultPage.page < resultPage.pages && <BrowseLink refusal={labels.planLimit} rel="next" href={pageHref(resultPage.page + 1)} className={`${linkStyle} max-w-full break-words`}>{labels.nextPage}</BrowseLink>}
      </nav>}
      {firstProduct && <section aria-label={labels.crossPageComparison} className="mt-5 min-w-0 rounded-xl border border-hanapure-border p-4">
        <p role="status" className="break-words">{labels.firstResultSelected}: {firstProduct.translations[locale]?.name ?? labels.details}</p>
        <BrowseLink refusal={labels.planLimit} href={withPlan(catalogueBrowseHref(listingHref, query, { ...view, pickFirst: undefined }))} className={`${linkStyle} max-w-full break-words`}>{labels.cancelFirstResult}</BrowseLink>
      </section>}
      {products.length > 0 && <p className="mt-4 text-sm leading-6 text-hanapure-muted">{cartLabels[locale].notice}</p>}
      <CatalogueShoppingPlan key={JSON.stringify([locale, routeLocale, plan, view, criteria])} plan={plan} products={planProducts}
        publishedIds={catalogue.listPublished().map(product => product.publicId.toLowerCase())} visibleIds={products.map(product => product.publicId.toLowerCase())}
        locale={locale} routeLocale={routeLocale} path={listingHref} query={planQuery}>
      {products.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-hanapure-border bg-hanapure-white p-6 sm:p-8">
          <h2 className="text-2xl font-light">{active ? labels.noResults : labels.empty}</h2>
          <p className="mt-3 leading-7 text-hanapure-muted">{active ? labels.noResultsDescription : labels.emptyDescription}</p>
          <Link href={storefrontHref("/brands", routeLocale)} className={`${linkStyle} mt-4`}>{labels.exploreBrands}</Link>
        </div>
      ) : (
        <CatalogueResultPairPicker key={JSON.stringify([locale, routeLocale, criteria, products.map(product => product.publicId)])}
          products={products.map(product => ({ publicId: product.publicId,
            name: product.translations[locale]?.name ?? `${labels.details}: ${product.brand} (${product.slug})` }))}
          locale={locale} routeLocale={routeLocale} catalogueQuery={catalogueQueryString(criteria)}>
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const content = product.translations[locale];
            const detailHref = withPlan(catalogueBrowseHref(storefrontHref(`/products/${product.slug}`, routeLocale), query,
              { ...view, pickFirst: undefined }, { forcePage: positioned }));
            const explicitPair = firstProduct && firstProduct.publicId.toLowerCase() !== product.publicId.toLowerCase()
              ? publishedComparison(comparison, { first: firstProduct.publicId, second: product.publicId }) : null;
            const secondHref = explicitPair && comparisonHref(listingHref, explicitPair, query);
            const firstHref = !firstProduct && resultPage.total >= 2 ? withPlan(catalogueBrowseHref(listingHref, query, { ...view, pickFirst: product.publicId.toLowerCase() })) : null;
            return (
              <li key={product.publicId} id={catalogueCardId(product.publicId) ?? undefined} tabIndex={-1}
                className="min-w-0 scroll-mt-24 rounded-2xl border border-hanapure-border bg-hanapure-white p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                <CatalogueResultPairCheckbox publicId={product.publicId} />
                <ShoppingPlanCardActions publicId={product.publicId.toLowerCase()} />
                {!firstProduct && resultPage.total >= 2 && <BrowseLink refusal={labels.planLimit} href={firstHref} className={`${linkStyle} mb-3 max-w-full break-words`} aria-label={`${labels.chooseFirstResult}: ${content?.name ?? labels.details}`}>{labels.chooseFirstResult}</BrowseLink>}
                {secondHref && <Link href={`${secondHref}#${COMPARISON_DESTINATION}`} className={`${linkStyle} mb-3 max-w-full break-words`}
                  aria-label={`${labels.chooseSecondResult}: ${content?.name ?? labels.details}`}>{labels.chooseSecondResult}</Link>}
                {content?.images[0] && <BrowseLink refusal={labels.planLimit} href={detailHref} aria-label={`${labels.details}: ${content.name}`}
                  className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                  <ProductImage {...content.images[0]} />
                </BrowseLink>}
                <p className="mt-4 text-sm text-hanapure-muted">{product.brand}</p>
                <h2 className="mt-2 break-words text-2xl font-light">
                  <BrowseLink refusal={labels.planLimit} href={detailHref}
                    aria-label={content ? undefined : `${labels.details}: ${product.brand} (${product.slug})`}
                    className="block min-h-11 py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                    {content?.name ?? labels.details}
                  </BrowseLink>
                </h2>
                <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">
                  {content?.description ?? labels.missing}
                </p>
                {(content?.usage || content?.caution) && <details className="mt-4 min-w-0 rounded-xl border border-hanapure-border p-3">
                  <summary className="min-h-11 cursor-pointer break-words py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
                    {[content.usage ? labels.usage : null, content.caution ? labels.caution : null].filter(Boolean).join(" / ")}
                  </summary>
                  {content.usage && <div className="mt-3"><h3 className="text-sm font-medium">{labels.usage}</h3><p className="mt-2 whitespace-pre-line break-words leading-7">{content.usage}</p></div>}
                  {content.caution && <div className="mt-3"><h3 className="text-sm font-medium">{labels.caution}</h3><p className="mt-2 whitespace-pre-line break-words leading-7">{content.caution}</p></div>}
                </details>}
                <QuickAdd publicId={product.publicId} locale={locale}
                  name={content?.name ?? `${labels.details}: ${product.brand} (${product.slug})`} />
                <SaveProductButton publicId={product.publicId} locale={locale}
                  name={content?.name ?? `${labels.details}: ${product.brand} (${product.slug})`} />
                {(() => {
                  const pair = resolveComparison(comparison, product.publicId);
                  const href = pair && comparisonHref(listingHref, pair, catalogueQueryString(criteria));
                  return href ? <Link href={`${href}#${COMPARISON_DESTINATION}`} className={`${linkStyle} mt-4 max-w-full break-words`}
                    aria-label={`${comparisonLabels[locale].compare}: ${content?.name ?? `${product.brand} (${product.slug})`}`}>{comparisonLabels[locale].compare}</Link> : null;
                })()}
              </li>
            );
          })}
        </ul>
        </CatalogueResultPairPicker>
      )}
      </CatalogueShoppingPlan>
      {comparison.length >= 2 && <ProductComparison key={`${locale}-${comparisonPair?.map(product => product.publicId).join("-") ?? "default"}-${catalogueQueryString(criteria)}`}
        products={comparison} locale={locale} routeLocale={routeLocale} initialPublicId={comparisonPair?.[0].publicId}
        initialSecondPublicId={comparisonPair?.[1].publicId} catalogueQuery={catalogueQueryString(criteria)} destinationId={COMPARISON_DESTINATION} planContext={planContext} />}
    </Container>
  );
}

export function ProductDetail({ slug, catalogue = localCatalogue, locale = "en", routeLocale = null,
  criteria = { query: "", brand: "" }, comparisonContext = {}, cartReturn = false, browse = readCatalogueBrowse(), planHint }: {
  slug: string; catalogue?: CatalogueReader; locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
  criteria?: CatalogueCriteria;
  comparisonContext?: ComparisonContext;
  cartReturn?: boolean;
  browse?: CatalogueBrowse;
  planHint?: unknown;
}) {
  const product = catalogue.findPublishedBySlug(slug);
  // Absent/draft editorial records are not public pages. No ERP absence is inferred.
  if (!product) notFound();
  const content = product.translations[locale];
  const labels = storefrontLabels[locale];
  const plan = readShoppingPlan(planHint, catalogue.listPublished());
  const brandQuery = catalogueQueryString({ query: "", brand: product.brand });
  const related = catalogue.listPublished().filter(item => item.brand === product.brand && item.publicId !== product.publicId).slice(0, 3);
  const comparison = comparisonProjection(catalogue, locale);
  const hasComparison = resolveComparison(comparison, product.publicId) !== null;
  const returnPair = comparisonContext.second ? publishedComparison(comparison, comparisonContext) : null;
  const returnHref = returnPair && returnPair.some(item => item.publicId.toLowerCase() === product.publicId.toLowerCase())
    ? comparisonHref(storefrontHref("/products", routeLocale), returnPair, catalogueQueryString(criteria)) : null;
  const browseQuery = catalogueQueryString(criteria);
  const resultPage = catalogueResultPage(browseQuery.length <= 8192 ? discoverCatalogue(catalogue, locale, criteria) : [], locale, browse);
  const matching = resultPage.all;
  const position = matching.findIndex(item => item.publicId.toLowerCase() === product.publicId.toLowerCase());
  const positioned = browse.pageSpecified || browse.withLocaleInfo || browse.withLocaleImage;
  const cleanView = { ...browse, page: 1, pickFirst: undefined };
  const backHref = catalogueBrowseHref(storefrontHref("/products", routeLocale), browseQuery,
    { ...cleanView, page: position >= 0 && positioned ? Math.floor(position / CATALOGUE_PAGE_SIZE) + 1 : 1 },
    position >= 0 && positioned ? { forcePage: true, card: product.publicId } : {}) ?? storefrontHref("/products", routeLocale);
  const adjacent = position < 0 ? [] : [
    { item: matching[position - 1], label: labels.previousMatch },
    { item: matching[position + 1], label: labels.nextMatch },
  ].flatMap(({ item, label }) => {
    if (!item || item.publicId.toLowerCase() === product.publicId.toLowerCase()) return [];
    const itemIndex = matching.indexOf(item);
    const href = catalogueBrowseHref(storefrontHref(`/products/${item.slug}`, routeLocale), browseQuery,
      { ...cleanView, page: positioned || resultPage.pages > 1 ? Math.floor(itemIndex / CATALOGUE_PAGE_SIZE) + 1 : 1 },
      { forcePage: positioned || resultPage.pages > 1 });
    return href ? [{ href, label, name: item.translations[locale]?.name ?? `${labels.details}: ${item.brand} (${item.slug})` }] : [];
  });
  const detailTargetStyle = "scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text";
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      {planHint === undefined && <ProductVisitTracker key={product.publicId} publicId={product.publicId} />}
      <div className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3">
        <BrowseLink refusal={labels.planLimit} href={carryShoppingPlan(backHref, plan)} className={`${linkStyle} min-w-0 max-w-full break-words`}>{labels.back}</BrowseLink>
        {cartReturn === true && <Link href={storefrontHref("/cart", routeLocale)} className={`${linkStyle} min-w-0 max-w-full break-words`}>{cartLabels[locale].backToCart}</Link>}
        {returnHref && <Link href={`${returnHref}#${COMPARISON_DESTINATION}`} className={`${linkStyle} min-w-0 max-w-full break-words`}>{comparisonLabels[locale].backToComparison}</Link>}
      </div>
      {adjacent.length > 0 && <nav aria-label={labels.matchingNavigation} className="mt-5 flex min-w-0 flex-wrap gap-4">
        {adjacent.map(link => <Link key={link.href} href={link.href} aria-label={`${link.label}: ${link.name}`}
          className={`${linkStyle} min-w-0 max-w-full break-words`}>{link.label}: {link.name}</Link>)}
      </nav>}
      <article className="mt-6 grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
        {content && content.images.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <ProductMediaGallery key={`${product.publicId}-${locale}`} images={content.images} locale={locale} />
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
      {planHint !== undefined && <CatalogueShoppingPlan key={JSON.stringify([product.publicId, locale, plan, criteria, browse])} plan={plan}
        products={planProjection(comparison, [product.publicId.toLowerCase(), ...plan.lines.map(line => line.publicId)])}
        publishedIds={catalogue.listPublished().map(item => item.publicId.toLowerCase())} visibleIds={[product.publicId.toLowerCase()]}
        locale={locale} routeLocale={routeLocale} path={storefrontHref(`/products/${product.slug}`, routeLocale)}
        query={catalogueBrowseQuery(browseQuery, cleanView, positioned) ?? browseQuery}>
        <ShoppingPlanCardActions publicId={product.publicId.toLowerCase()} />
      </CatalogueShoppingPlan>}
      {related.length > 0 && <section className="mt-12" aria-labelledby="same-brand-heading">
        <h2 id="same-brand-heading" className="text-2xl font-light">{product.brand}</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {related.map(item => {
            const translated = item.translations[locale];
            const name = translated?.name ?? `${labels.details}: ${item.brand} (${item.slug})`;
            const pair = publishedComparison(comparison, { first: product.publicId, second: item.publicId });
            const compareHref = pair && comparisonHref(storefrontHref("/products", routeLocale), pair, browseQuery);
            return <li key={item.publicId} className="min-w-0">
              <Link href={`${storefrontHref(`/products/${item.slug}`, routeLocale)}${brandQuery}`}
                aria-label={translated ? undefined : `${labels.details}: ${item.brand} (${item.slug})`}
                className="block min-h-11 break-words rounded-xl border border-hanapure-border bg-hanapure-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">
                {translated?.name ?? labels.details}
              </Link>
              {!translated && <p className="mt-2 text-sm text-hanapure-muted">{labels.missing}</p>}
              {compareHref && <Link href={`${compareHref}#${COMPARISON_DESTINATION}`} aria-label={`${labels.compareRelated}: ${name}`}
                className={`${linkStyle} mt-3 max-w-full break-words`}>{labels.compareRelated}</Link>}
              <QuickAdd publicId={item.publicId} locale={locale} name={name} />
              <SaveProductButton publicId={item.publicId} locale={locale} name={name} />
            </li>;
          })}
        </ul>
      </section>}
      {hasComparison && <ProductComparison key={`${product.publicId}-${locale}`} products={comparison}
        locale={locale} routeLocale={routeLocale} initialPublicId={product.publicId} catalogueQuery={catalogueQueryString(criteria)} destinationId="product-comparison"
        planContext={{ plan, path: storefrontHref("/products", routeLocale), query: catalogueBrowseQuery(browseQuery, cleanView, positioned) ?? browseQuery,
          publishedIds: catalogue.listPublished().map(item => item.publicId.toLowerCase()) }} />}
    </Container>
  );
}
