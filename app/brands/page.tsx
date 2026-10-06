import BrandsContent from "@/components/brands/BrandsContent";

import { marketingMetadata } from "@/lib/storefront/seo";

export function generateMetadata() {
  return marketingMetadata("brands", "en", { legacy: true });
}

export default function BrandsPage() {
  return <BrandsContent />;
}
