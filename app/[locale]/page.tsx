import HomeContent from "@/components/home/HomeContent";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { marketingMetadata } from "@/lib/storefront/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return marketingMetadata("home", requireStorefrontLocale((await params).locale));
}

export default async function LocalizedHome({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireStorefrontLocale((await params).locale);
  return <HomeContent locale={locale} />;
}
