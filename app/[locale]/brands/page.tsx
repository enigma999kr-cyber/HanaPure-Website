import BrandsPage from "@/app/brands/page";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";

export default async function LocalizedBrands({ params }: { params: Promise<{ locale: string }> }) {
  requireStorefrontLocale((await params).locale);
  return <div lang="en"><BrandsPage /></div>;
}
