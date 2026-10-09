import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { ProductDetail } from "@/components/catalogue/ProductCatalogue";
import { productMetadata } from "@/lib/storefront/seo";
import { catalogueQueryString, readCatalogueCriteria, type CatalogueSearchParams } from "@/lib/catalog/catalogue-discovery";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<CatalogueSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return productMetadata(slug, "en", { legacy: true });
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const criteria = readCatalogueCriteria(await searchParams);
  // Resolve existence before rendering the page shell; drafts use the same 404 path.
  const detail = ProductDetail({ slug, criteria });
  return (
    <main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header catalogueQuery={catalogueQueryString(criteria)} />
      {detail}
    </main>
  );
}
