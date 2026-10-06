import Home from "@/app/page";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import { marketingMetadata } from "@/lib/storefront/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return marketingMetadata("home", requireStorefrontLocale((await params).locale));
}

export default async function LocalizedHome({ params }: { params: Promise<{ locale: string }> }) {
  requireStorefrontLocale((await params).locale);
  // Existing marketing copy remains English; Header carries its own selected lang.
  return <div lang="en"><Home /></div>;
}
