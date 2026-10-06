import "server-only";

import { notFound } from "next/navigation";
import Link from "next/link";
import Container from "@/components/ui/Container";
import { localCatalogue } from "@/lib/catalog/local-catalogue";

type CatalogueReader = typeof localCatalogue;
const linkStyle = "inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text";

/** Native images use editorial URLs directly; no optimizer/provider allowlist is invented. */
function ProductImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="aspect-square overflow-hidden rounded-2xl bg-hanapure-ivory">
      {/* eslint-disable-next-line @next/next/no-img-element -- Editorial v1 has no dimensions or approved image-provider configuration. */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-contain" />
    </div>
  );
}

/** Current storefront is English. Missing EN is explicit, never a locale fallback. */
export function ProductListing({ catalogue = localCatalogue }: { catalogue?: CatalogueReader } = {}) {
  const products = catalogue.listPublished();
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      <h1 className="text-4xl font-light text-hanapure-text sm:text-5xl">Shop Korean skincare</h1>
      {products.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-hanapure-border bg-hanapure-white p-6 sm:p-8">
          <h2 className="text-2xl font-light">No products to browse yet</h2>
          <p className="mt-3 leading-7 text-hanapure-muted">Explore our brands while our catalogue is being prepared.</p>
          <Link href="/brands" className={`${linkStyle} mt-4`}>Explore brands</Link>
        </div>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const content = product.translations.en;
            return (
              <li key={product.publicId} className="min-w-0 rounded-2xl border border-hanapure-border bg-hanapure-white p-5">
                {content?.images[0] && <ProductImage {...content.images[0]} />}
                <p className="mt-4 text-sm text-hanapure-muted">{product.brand}</p>
                <h2 className="mt-2 break-words text-2xl font-light">
                  <Link href={`/products/${product.slug}`} className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                    {content?.name ?? "Product details"}
                  </Link>
                </h2>
                <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">
                  {content?.description ?? "English product content is not available yet."}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

export function ProductDetail({ slug, catalogue = localCatalogue }: { slug: string; catalogue?: CatalogueReader }) {
  const product = catalogue.findPublishedBySlug(slug);
  // Absent/draft editorial records are not public pages. No ERP absence is inferred.
  if (!product) notFound();
  const content = product.translations.en;
  return (
    <Container className="pb-20 pt-32 sm:pt-36">
      <Link href="/products" className={linkStyle}>Back to products</Link>
      <article className="mt-6 grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
        {content && content.images.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {content.images.map((image, index) => <ProductImage key={`${image.src}-${index}`} {...image} />)}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm text-hanapure-muted">{product.brand}</p>
          <h1 className="mt-3 break-words text-4xl font-light sm:text-5xl">{content?.name ?? "Product details"}</h1>
          <p className="mt-6 whitespace-pre-line break-words leading-8 text-hanapure-muted">
            {content?.description ?? "English product content is not available yet."}
          </p>
          {content?.usage && (
            <section className="mt-8" aria-labelledby="product-usage">
              <h2 id="product-usage" className="text-xl font-medium">How to use</h2>
              <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">{content.usage}</p>
            </section>
          )}
          {content?.caution && (
            <section className="mt-8" aria-labelledby="product-caution">
              <h2 id="product-caution" className="text-xl font-medium">Cautions</h2>
              <p className="mt-3 whitespace-pre-line break-words leading-7 text-hanapure-muted">{content.caution}</p>
            </section>
          )}
        </div>
      </article>
    </Container>
  );
}
