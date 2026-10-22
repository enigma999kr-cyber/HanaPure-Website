import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ProductDetail, catalogueHeaderQuery } from "@/components/catalogue/ProductCatalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { productMetadata } from "@/lib/storefront/seo";
import { readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";
import { readComparisonContext } from "@/lib/comparison/compare-selection";
import { readCartReturn } from "@/lib/cart/cart-review-view";
import { readCatalogueBrowse } from "@/lib/catalog/catalogue-browse";

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
  const browse = readCatalogueBrowse(query);
  const headerQuery = catalogueHeaderQuery(criteria, browse, query.cartPlan, undefined, `/products/${slug}`);
  const detail = ProductDetail({ slug, locale, routeLocale: locale, criteria, browse, planHint: query.cartPlan, comparisonContext: readComparisonContext(query), cartReturn: readCartReturn(query.cartReturn) });
  return (
    <><main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={headerQuery} />
      {detail}
    </main><Footer locale={locale} routeLocale={locale} /></>
  );
}
