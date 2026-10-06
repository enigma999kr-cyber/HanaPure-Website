import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { publicSiteOrigin } from "../lib/storefront/site-origin.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/navigation") return nextResolve("next/dist/client/components/navigation.react-server.js", context);
  return nextResolve(specifier, context);
} });
const { rootMetadata, listingMetadata, productMetadata, marketingMetadata, storefrontSitemap, storefrontRobots } = await import("../lib/storefront/seo.ts");
// A fictional origin used only to exercise absolute metadata. Never configures a real deployment.
const origin = publicSiteOrigin("https://example.test/");
const content = locale => ({ name: `${locale} fictional fixture`, description: `${locale} test description`,
  images: [{ src: "/fixtures/image.webp", alt: `${locale} fixture image` }], usage: null, caution: null });
const product = (number, patch = {}) => ({ publicId: `${number}2345678-abcd-1234-abcd-123456789abc`,
  slug: `fictional-${number}`, brand: "beplain", state: "published",
  translations: { en: content("en"), hu: content("hu"), ko: content("ko") }, ...patch });
const catalogue = createLocalCatalogueReader([product(1), product(2, { state: "draft" }),
  product(3, { translations: { en: null, hu: content("hu"), ko: null } })]);

test("public origin seam normalizes a supplied HTTPS origin and rejects paths, credentials and non-HTTPS URLs", () => {
  assert.equal(publicSiteOrigin(""), null);
  assert.equal(origin, "https://example.test");
  for (const value of ["http://example.test", "//example.test", "https://user:secret@example.test",
    "https://example.test/path", "https://example.test/..", "https://example.test?q=x", "https://example.test/#", " https://example.test"]) {
    assert.throws(() => publicSiteOrigin(value), /Invalid HANAPURE_PUBLIC_SITE_ORIGIN/);
  }
});

test("absent origin keeps metadata noindex, sitemap empty and robots disallow-all without fabricated URLs", () => {
  assert.equal(rootMetadata(null).title, "HanaPure");
  assert.equal(rootMetadata(null).robots.index, false);
  for (const locale of ["en", "hu", "ko"]) {
    const metadata = listingMetadata(locale, {}, { origin: null });
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.alternates, null);
    assert.equal(metadata.openGraph.url, undefined);
    assert.deepEqual(productMetadata("fictional-1", locale, { origin: null, catalogue }).openGraph.images, []);
  }
  assert.deepEqual(storefrontSitemap(catalogue, null), []);
  assert.deepEqual(storefrontRobots(null), { rules: { userAgent: "*", disallow: "/" } });
});

test("EN/HU/KO listing metadata reuses localized labels, canonicalizes clean locale URLs and declares reciprocal alternates", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const metadata = listingMetadata(locale, {}, { origin });
    assert.equal(metadata.title, `${storefrontLabels[locale].shop} | HanaPure`);
    assert.equal(metadata.description, storefrontLabels[locale].heading);
    assert.equal(metadata.robots.index, true);
    assert.equal(metadata.alternates.canonical, `${origin}/${locale}/products`);
    assert.deepEqual(metadata.alternates.languages, { en: `${origin}/en/products`, hu: `${origin}/hu/products`, ko: `${origin}/ko/products` });
    assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
    assert.equal(metadata.twitter.title, metadata.title);
  }
});

test("legacy English and query variants stay functional but cannot become duplicate indexable listings", () => {
  for (const params of [{ q: "cleanser" }, { brand: "Anua" }, { q: "", brand: "" }, { utm_source: "fixture" }]) {
    const metadata = listingMetadata("hu", params, { origin });
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.robots.follow, true);
    assert.equal(metadata.alternates.canonical, `${origin}/hu/products`);
  }
  assert.equal(listingMetadata("en", {}, { origin, legacy: true }).robots.index, false);
  assert.equal(listingMetadata("en", {}, { origin, legacy: true }).alternates.canonical, `${origin}/en/products`);
});

test("published detail metadata uses selected locale copy/image alt and the unchanged slug/public identity", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const metadata = productMetadata("fictional-1", locale, { origin, catalogue });
    assert.equal(metadata.title, `${locale} fictional fixture | HanaPure`);
    assert.equal(metadata.description, `${locale} test description`);
    assert.equal(metadata.robots.index, true);
    assert.equal(metadata.alternates.canonical, `${origin}/${locale}/products/fictional-1`);
    assert.deepEqual(metadata.openGraph.images, [{ url: `${origin}/fixtures/image.webp`, alt: `${locale} fixture image` }]);
    assert.deepEqual(metadata.twitter.images, metadata.openGraph.images);
    assert.equal(metadata.alternates.languages.hu, `${origin}/hu/products/fictional-1`);
    assert.equal(metadata.openGraph.type, "website");
    assert.ok(!JSON.stringify(metadata).includes("basePriceHuf"));
  }
  assert.equal(catalogue.findPublishedBySlug("fictional-1").publicId, product(1).publicId);
  assert.equal(productMetadata("fictional-1", "en", { origin, catalogue, legacy: true }).robots.index, false);
});

test("missing translations stay explicit/noindex and are excluded from hreflang without another locale's copy/image", () => {
  for (const locale of ["en", "ko"]) {
    const metadata = productMetadata("fictional-3", locale, { origin, catalogue });
    assert.equal(metadata.description, storefrontLabels[locale].missing);
    assert.equal(metadata.robots.index, false);
    assert.deepEqual(metadata.alternates.languages, { hu: `${origin}/hu/products/fictional-3` });
    assert.deepEqual(metadata.openGraph.images, []);
    assert.ok(!JSON.stringify(metadata).includes("hu test description"));
  }
});

test("draft and unknown detail metadata invoke Next's real notFound interrupt", () => {
  for (const slug of ["fictional-2", "unknown", "../draft"]) for (const locale of ["en", "hu", "ko"]) {
    assert.throws(() => productMetadata(slug, locale, { origin, catalogue }), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

test("sitemap contains only canonical public routes and actually supplied published translations", () => {
  const sitemap = storefrontSitemap(catalogue, origin);
  assert.deepEqual(sitemap.map(entry => entry.url), [`${origin}/en`, `${origin}/en/brands`,
    `${origin}/en/products`, `${origin}/hu/products`, `${origin}/ko/products`,
    `${origin}/en/products/fictional-1`, `${origin}/hu/products/fictional-1`, `${origin}/ko/products/fictional-1`,
    `${origin}/hu/products/fictional-3`]);
  assert.equal(new Set(sitemap.map(entry => entry.url)).size, sitemap.length);
  assert.ok(!JSON.stringify(sitemap).includes("fictional-2"));
  assert.ok(!sitemap.some(entry => "priority" in entry || "changeFrequency" in entry || "lastModified" in entry));
  assert.deepEqual(sitemap.at(-1).alternates.languages, { hu: `${origin}/hu/products/fictional-3` });
});

test("English-only home/brand bodies advertise only EN, without invented HU/KO descriptions", () => {
  for (const kind of ["home", "brands"]) for (const locale of ["en", "hu", "ko"]) {
    const metadata = marketingMetadata(kind, locale, { origin });
    assert.equal(metadata.robots.index, locale === "en");
    assert.equal(metadata.alternates.canonical, `${origin}/en${kind === "brands" ? "/brands" : ""}`);
    assert.deepEqual(Object.keys(metadata.alternates.languages), ["en"]);
    if (locale !== "en") assert.equal(metadata.description, null);
    assert.equal(marketingMetadata(kind, "en", { origin, legacy: true }).robots.index, false);
  }
});

test("robots is deterministic, limits crawling to storefront/assets and allows reading query noindex directives", () => {
  const robots = storefrontRobots(origin);
  assert.deepEqual(robots, storefrontRobots(origin));
  assert.equal(robots.rules.disallow, "/");
  assert.equal(robots.sitemap, `${origin}/sitemap.xml`);
  for (const locale of ["en", "hu", "ko"]) {
    assert.ok(robots.rules.allow.includes(`/${locale}/products?`));
    assert.ok(robots.rules.allow.includes(`/${locale}/products/`));
  }
  assert.ok(!robots.rules.allow.some(path => /admin|api|internal|tests|lib/.test(path)));
});
