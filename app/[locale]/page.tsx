import Home from "@/app/page";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";

export default async function LocalizedHome({ params }: { params: Promise<{ locale: string }> }) {
  requireStorefrontLocale((await params).locale);
  // Existing marketing copy remains English; Header carries its own selected lang.
  return <div lang="en"><Home /></div>;
}
