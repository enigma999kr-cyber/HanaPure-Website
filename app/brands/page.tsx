import BrandDirectory from "@/components/brands/BrandDirectory";
import Header from "@/components/layout/Header";

import { marketingMetadata } from "@/lib/storefront/seo";

export function generateMetadata() {
  return marketingMetadata("brands", "en", { legacy: true });
}

export default function BrandsPage() {
  return (
    <main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />

      <div className="bg-gradient-to-b from-hanapure-ivory to-hanapure-warm-white px-5 pb-12 pt-36 sm:px-6 sm:pb-16 sm:pt-40">
        <div className="mx-auto max-w-7xl">
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-hanapure-muted sm:text-sm">
            HanaPure directory
          </p>
          <h1 className="max-w-3xl text-5xl font-light leading-tight sm:text-6xl">
            Explore our brands.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-hanapure-muted sm:text-lg">
            A considered selection of Korean skincare names, gathered in one
            place for easy discovery.
          </p>
        </div>
      </div>

      <BrandDirectory />
    </main>
  );
}
