import Header from "@/components/layout/Header";
import Hero from "./Hero";
import WhyHanaPure from "./WhyHanaPure";
import FeaturedBrands from "@/components/brands/FeaturedBrands";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";

export default function HomeContent({ locale = "en", routeLocale = null }: {
  locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
}) {
  return (
    <main lang={locale} className="min-h-screen bg-hanapure-white">
      <Header />
      <Hero locale={locale} routeLocale={routeLocale} />
      <FeaturedBrands locale={locale} routeLocale={routeLocale} />
      <WhyHanaPure locale={locale} />
    </main>
  );
}
