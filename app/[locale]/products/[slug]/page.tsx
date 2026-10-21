import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ProductDetail } from "@/components/catalogue/ProductCatalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { productMetadata } from "@/lib/storefront/seo";
import { catalogueQueryString, readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";
import { readComparisonContext } from "@/lib/comparison/compare-selection";

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<CatalogueSearchParams> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: value, slug } = await params;
  const locale = requireStorefrontLocale(value);
  return productMetadata(slug, locale);
}
export default async function LocalizedProduct({ params, searchParams }: Props) {
  const { locale: value, slug } = await params;
  const locale = requireStorefrontLocale(value);
  const query = await searchParams;
  const criteria = readCatalogueCriteria(query);
  const detail = ProductDetail({ slug, locale, routeLocale: locale, criteria, comparisonContext: readComparisonContext(query) });
  return (
    <><main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={catalogueQueryString(criteria)} />
      {detail}
    </main><Footer locale={locale} routeLocale={locale} /></>
  );
}
