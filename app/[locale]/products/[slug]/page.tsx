import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { ProductDetail } from "@/components/catalogue/ProductCatalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { productMetadata } from "@/lib/storefront/seo";

type Props = { params: Promise<{ locale: string; slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: value, slug } = await params;
  const locale = requireStorefrontLocale(value);
  return productMetadata(slug, locale);
}
export default async function LocalizedProduct({ params }: Props) {
  const { locale: value, slug } = await params;
  const locale = requireStorefrontLocale(value);
  const detail = ProductDetail({ slug, locale, routeLocale: locale });
  return (
    <main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />
      {detail}
    </main>
  );
}
