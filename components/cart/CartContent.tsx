import "server-only";
import Container from "@/components/ui/Container";
import { localCatalogue } from "@/lib/catalog/local-catalogue";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { cartLabels } from "@/lib/cart/labels";
import ShoppingCart from "./ShoppingCart";

export default function CartContent({ locale = "en", routeLocale = null }: {
  locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
}) {
  // Only public editorial projection crosses RSC. No reader/operational object crosses.
  const products = localCatalogue.listPublished().map(product => ({
    publicId: product.publicId, slug: product.slug, brand: product.brand,
    names: { en: product.translations.en?.name ?? null, hu: product.translations.hu?.name ?? null, ko: product.translations.ko?.name ?? null },
  }));
  return <Container className="pb-20 pt-32 sm:pt-36">
    <h1 id="main-content" tabIndex={-1} className="text-4xl font-light sm:text-5xl">{cartLabels[locale].cart}</h1>
    <ShoppingCart products={products} locale={locale} routeLocale={routeLocale} />
  </Container>;
}
