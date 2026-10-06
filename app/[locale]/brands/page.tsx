import BrandsContent from "@/components/brands/BrandsContent";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { marketingMetadata } from "@/lib/storefront/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return marketingMetadata("brands", requireStorefrontLocale((await params).locale));
}

export default async function LocalizedBrands({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireStorefrontLocale((await params).locale);
  return <BrandsContent locale={locale} />;
}
