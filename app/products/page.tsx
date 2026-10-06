import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { ProductListing } from "@/components/catalogue/ProductCatalogue";
import { catalogueQueryString, readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";
import { listingMetadata } from "@/lib/storefront/seo";

export async function generateMetadata({ searchParams }: { searchParams: Promise<CatalogueSearchParams> }): Promise<Metadata> {
  return listingMetadata("en", await searchParams, { legacy: true });
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<CatalogueSearchParams> }) {
  const criteria = readCatalogueCriteria(await searchParams);
  return (
    <main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={catalogueQueryString(criteria)} />
      <ProductListing criteria={criteria} />
    </main>
  );
}
