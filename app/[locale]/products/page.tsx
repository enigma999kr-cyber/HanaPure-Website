import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ProductListing } from "@/components/catalogue/ProductCatalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { catalogueQueryString, readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";
import { listingMetadata } from "@/lib/storefront/seo";
import { readComparisonContext } from "@/lib/comparison/compare-selection";
import { readCatalogueBrowse, catalogueBrowseQuery } from "@/lib/catalog/catalogue-browse";

export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<CatalogueSearchParams>;
}) {
  return listingMetadata(requireStorefrontLocale((await params).locale), await searchParams);
}

export default async function LocalizedProducts({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<CatalogueSearchParams>;
}) {
  const locale = requireStorefrontLocale((await params).locale);
  const query = await searchParams;
  const criteria = readCatalogueCriteria(query);
  const browse = readCatalogueBrowse(query);
  return (
    <><main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={catalogueBrowseQuery(catalogueQueryString(criteria), { ...browse, pickFirst: undefined }) ?? ""} />
      <ProductListing locale={locale} routeLocale={locale} criteria={criteria} browse={browse} comparisonContext={readComparisonContext(query)} />
    </main><Footer locale={locale} routeLocale={locale} /></>
  );
}
