import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ProductListing, catalogueHeaderQuery } from "@/components/catalogue/ProductCatalogue";
import { readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";
import { listingMetadata } from "@/lib/storefront/seo";
import { readComparisonContext } from "@/lib/comparison/compare-selection";
import { readCatalogueBrowse } from "@/lib/catalog/catalogue-browse";

export async function generateMetadata({ searchParams }: { searchParams: Promise<CatalogueSearchParams> }): Promise<Metadata> {
  return listingMetadata("en", await searchParams, { legacy: true });
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<CatalogueSearchParams> }) {
  const query = await searchParams;
  const criteria = readCatalogueCriteria(query);
  const browse = readCatalogueBrowse(query);
  const comparisonContext = readComparisonContext(query);
  const headerQuery = catalogueHeaderQuery(criteria, browse, query.cartPlan, undefined, "/products", comparisonContext);
  return (
    <><main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={headerQuery} />
      <ProductListing criteria={criteria} browse={browse} planHint={query.cartPlan} comparisonContext={comparisonContext} />
    </main><Footer /></>
  );
}
