import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { ProductDetail } from "@/components/catalogue/ProductCatalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { productMetadata } from "@/lib/storefront/seo";
import { catalogueQueryString, readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<CatalogueSearchParams> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: value, slug } = await params;
  const locale = requireStorefrontLocale(value);
  return productMetadata(slug, locale);
}
export default async function LocalizedProduct({ params, searchParams }: Props) {
  const { locale: value, slug } = await params;
  const locale = requireStorefrontLocale(value);
  const criteria = readCatalogueCriteria(await searchParams);
  const detail = ProductDetail({ slug, locale, routeLocale: locale, criteria });
  return (
    <main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={catalogueQueryString(criteria)} />
      {detail}
    </main>
  );
}
