import "server-only";

import type { Metadata, MetadataRoute } from "next";
import { notFound } from "next/navigation";
import { localCatalogue } from "../catalog/local-catalogue";
import type { EditorialLocale, EditorialImage } from "../catalog/editorial-catalogue";
import type { CatalogueSearchParams } from "../catalog/catalogue-discovery";
import { storefrontHref, storefrontLabels, storefrontLocales } from "./localization";
import { publicSiteOrigin } from "./site-origin";

type Reader = typeof localCatalogue;
type Options = { origin?: string | null; legacy?: boolean };
function languages(path: string, locales: readonly EditorialLocale[], origin: string) {
  return Object.fromEntries(locales.map((locale) => [locale, new URL(storefrontHref(path, locale), origin).href]));
}

function pageMetadata({ title, description, locale, path, translatedLocales, indexable,
  canonicalLocale = locale, images = [], origin }: {
  title: string; description: string | null; locale: EditorialLocale; path: string;
  translatedLocales: readonly EditorialLocale[]; indexable: boolean; canonicalLocale?: EditorialLocale;
  images?: readonly EditorialImage[]; origin: string | null;
}): Metadata {
  const canonical = origin ? new URL(storefrontHref(path, canonicalLocale), origin).href : undefined;
  const shareImages = origin ? images.map((image) => ({ url: new URL(image.src, origin).href, alt: image.alt })) : [];
  return {
    title, description,
    alternates: origin ? { canonical, languages: languages(path, translatedLocales, origin) } : null,
    robots: { index: Boolean(origin) && indexable, follow: true },
    openGraph: { title, ...(description ? { description } : {}), siteName: "HanaPure",
      type: "website", locale, ...(canonical ? { url: canonical } : {}), images: shareImages },
    twitter: { card: shareImages.length ? "summary_large_image" : "summary", title,
      ...(description ? { description } : {}), images: shareImages },
  };
}

/** Deny indexing by default so unknown/error/future private surfaces cannot inherit index=true. */
export function rootMetadata(origin = publicSiteOrigin()): Metadata {
  return { title: "HanaPure", applicationName: "HanaPure", description: null,
    metadataBase: origin ? new URL(origin) : null, robots: { index: false, follow: true } };
}

/** These bodies remain English in the current code; do not advertise HU/KO translations. */
export function marketingMetadata(kind: "home" | "brands", locale: EditorialLocale,
  { origin = publicSiteOrigin(), legacy = false }: Options = {}): Metadata {
  const labels = storefrontLabels[locale];
  return pageMetadata({ title: kind === "home" ? "HanaPure" : `${labels.brands} | HanaPure`,
    // Existing Hero strapline and Brands page description, with no invented translations.
    description: locale === "en" ? (kind === "home" ? "Trusted Korean Skincare" :
      "Explore Korean skincare brands in the HanaPure directory.") : null,
    locale, path: kind === "home" ? "/" : "/brands", translatedLocales: ["en"],
    canonicalLocale: "en", indexable: locale === "en" && !legacy, origin });
}

export function listingMetadata(locale: EditorialLocale, params: CatalogueSearchParams = {},
  { origin = publicSiteOrigin(), legacy = false }: Options = {}): Metadata {
  const labels = storefrontLabels[locale];
  return pageMetadata({ title: `${labels.shop} | HanaPure`, description: labels.heading,
    locale, path: "/products", translatedLocales: storefrontLocales,
    // Every query variant canonicalizes to the unfiltered locale listing and remains crawlable/noindex.
    indexable: !legacy && Object.keys(params).length === 0, origin });
}

export function productMetadata(slug: string, locale: EditorialLocale,
  { catalogue = localCatalogue, origin = publicSiteOrigin(), legacy = false }: Options & { catalogue?: Reader } = {}): Metadata {
  const product = catalogue.findPublishedBySlug(slug);
  if (!product) notFound();
  const content = product.translations[locale];
  return pageMetadata({ title: `${content?.name ?? storefrontLabels[locale].details} | HanaPure`,
    description: content?.description ?? storefrontLabels[locale].missing,
    locale, path: `/products/${product.slug}`,
    translatedLocales: storefrontLocales.filter((candidate) => product.translations[candidate] !== null),
    indexable: Boolean(content) && !legacy, images: content?.images ?? [], origin });
}

export function storefrontSitemap(catalogue: Reader = localCatalogue,
  origin = publicSiteOrigin()): MetadataRoute.Sitemap {
  if (!origin) return [];
  const entries: MetadataRoute.Sitemap = [
    ...["/", "/brands"].map((path) => ({ url: languages(path, ["en"], origin).en })),
    ...storefrontLocales.map((locale) => ({ url: languages("/products", [locale], origin)[locale],
      alternates: { languages: languages("/products", storefrontLocales, origin) } })),
  ];
  for (const product of catalogue.listPublished()) {
    const locales = storefrontLocales.filter((locale) => product.translations[locale] !== null);
    const alternates = { languages: languages(`/products/${product.slug}`, locales, origin) };
    for (const locale of locales) entries.push({ url: alternates.languages[locale], alternates });
  }
  return entries;
}

export function storefrontRobots(origin = publicSiteOrigin()): MetadataRoute.Robots {
  if (!origin) return { rules: { userAgent: "*", disallow: "/" } };
  // Allow only existing storefront paths and current framework assets, not future admin/API routes.
  const allow = ["/$", "/brands$", "/products$", "/products?", "/products/", "/_next/static/", "/favicon.ico", "/sitemap.xml$"];
  for (const locale of storefrontLocales) allow.push(`/${locale}$`, `/${locale}/brands$`,
    `/${locale}/products$`, `/${locale}/products?`, `/${locale}/products/`);
  return { rules: { userAgent: "*", allow, disallow: "/" }, sitemap: new URL("/sitemap.xml", origin).href };
}
