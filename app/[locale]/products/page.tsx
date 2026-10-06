import Header from "@/components/layout/Header";
import { ProductListing } from "@/components/catalogue/ProductCatalogue";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";

export default async function LocalizedProducts({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireStorefrontLocale((await params).locale);
  return (
    <main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />
      <ProductListing locale={locale} routeLocale={locale} />
    </main>
  );
}
