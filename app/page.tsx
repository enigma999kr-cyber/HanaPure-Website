import Header from "@/components/layout/Header";
import Hero from "@/components/home/Hero";
import WhyHanaPure from "@/components/home/WhyHanaPure";
import FeaturedBrands from "@/components/brands/FeaturedBrands";
import { marketingMetadata } from "@/lib/storefront/seo";

export function generateMetadata() {
  return marketingMetadata("home", "en", { legacy: true });
}

export default function Home() {
  return (
    <main className="min-h-screen bg-hanapure-white">
      <Header />

      <Hero />

      <FeaturedBrands />

      <WhyHanaPure />
    </main>
  );
}
