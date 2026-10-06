import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { ProductDetail } from "@/components/catalogue/ProductCatalogue";
import { localCatalogue } from "@/lib/catalog/local-catalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { storefrontLabels } from "@/lib/storefront/localization";

type Props = { params: Promise<{ locale: string; slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: value, slug } = await params;
  const locale = requireStorefrontLocale(value);
  const content = localCatalogue.findPublishedBySlug(slug)?.translations[locale];
  return { title: `${content?.name ?? storefrontLabels[locale].details} | HanaPure`,
    description: content?.description ?? storefrontLabels[locale].missing };
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
