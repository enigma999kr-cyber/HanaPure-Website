import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ProductDetail, catalogueHeaderQuery } from "@/components/catalogue/ProductCatalogue";
import { productMetadata } from "@/lib/storefront/seo";
import { readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";
import { readComparisonContext } from "@/lib/comparison/compare-selection";
import { readCartReturn } from "@/lib/cart/cart-review-view";
import { readCatalogueBrowse } from "@/lib/catalog/catalogue-browse";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<CatalogueSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return productMetadata(slug, "en", { legacy: true });
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const criteria = readCatalogueCriteria(query);
  const browse = readCatalogueBrowse(query);
  const comparisonContext = readComparisonContext(query);
  const headerQuery = catalogueHeaderQuery(criteria, browse, query.cartPlan, undefined, `/products/${slug}`, comparisonContext);
  // Resolve existence before rendering the page shell; drafts use the same 404 path.
  const detail = ProductDetail({ slug, criteria, browse, planHint: query.cartPlan, comparisonContext, cartReturn: readCartReturn(query.cartReturn) });
  return (
    <><main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={headerQuery} />
      {detail}
    </main><Footer /></>
  );
}
