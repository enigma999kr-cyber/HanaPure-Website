import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { ProductListing } from "@/components/catalogue/ProductCatalogue";

export const metadata: Metadata = {
  title: "Products | HanaPure",
  description: "Browse the HanaPure Korean skincare catalogue.",
};

export default function ProductsPage() {
  return (
    <main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />
      <ProductListing />
    </main>
  );
}
