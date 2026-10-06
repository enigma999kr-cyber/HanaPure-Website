import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { ProductDetail } from "@/components/catalogue/ProductCatalogue";
import { productMetadata } from "@/lib/storefront/seo";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return productMetadata(slug, "en", { legacy: true });
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  // Resolve existence before rendering the page shell; drafts use the same 404 path.
  const detail = ProductDetail({ slug });
  return (
    <main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />
      {detail}
    </main>
  );
}
