import Header from "@/components/layout/Header";
import Hero from "./Hero";
import WhyHanaPure from "./WhyHanaPure";
import FeaturedBrands from "@/components/brands/FeaturedBrands";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";

export default function HomeContent({ locale = "en" }: { locale?: EditorialLocale }) {
  return (
    <main lang={locale} className="min-h-screen bg-hanapure-white">
      <Header />
      <Hero locale={locale} />
      <FeaturedBrands locale={locale} />
      <WhyHanaPure locale={locale} />
    </main>
  );
}
