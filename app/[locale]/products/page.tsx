import Header from "@/components/layout/Header";
import { ProductListing } from "@/components/catalogue/ProductCatalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { catalogueQueryString, readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";

export default async function LocalizedProducts({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<CatalogueSearchParams>;
}) {
  const locale = requireStorefrontLocale((await params).locale);
  const criteria = readCatalogueCriteria(await searchParams);
  return (
    <main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={catalogueQueryString(criteria)} />
      <ProductListing locale={locale} routeLocale={locale} criteria={criteria} />
    </main>
  );
}
