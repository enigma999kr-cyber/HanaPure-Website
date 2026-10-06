import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";

// Test-only JSX transpilation using installed TypeScript; no new test framework.
// Use Next's real RSC navigation implementation, including its actual 404 interrupt.
const require = createRequire(import.meta.url);
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Native Node does not provide Next's client-reference bundling. Load real
    // React/Link for their element references; do not execute client hooks here.
    if (specifier === "react") return { url: reactEntry, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: jsxEntry, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation") return nextResolve("next/dist/client/components/navigation.react-server.js", context);
    if (specifier.startsWith("@/")) specifier = pathToFileURL(join(repo, specifier.slice(2))).href;
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      for (const extension of [".ts", ".tsx"]) {
        try { return nextResolve(`${specifier}${extension}`, context); } catch { /* Try next TS extension. */ }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText };
    return nextLoad(url, context);
  },
});
const { ProductListing, ProductDetail } = await import("../components/catalogue/ProductCatalogue.tsx");
const { default: LanguageSwitcher } = await import("../components/layout/LanguageSwitcher.tsx");
// Expand the actual pure server views, preserving host-element attributes/text.
function elements(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node !== "object") return [node];
  if (typeof node.type === "function") return elements(node.type(node.props));
  return [node, ...elements(node.props?.children)];
}
const text = (nodes) => nodes.filter((node) => typeof node === "string").join(" ");
const content = () => ({ name: "Fictional fixture", description: "Only a test fixture.",
  images: [{ src: "/fixtures/image.webp", alt: "Fictional fixture image" }], usage: "Fixture usage.", caution: "Fixture caution." });
const product = (patch = {}) => ({ publicId: "12345678-abcd-1234-abcd-123456789abc", brand: "beplain",
  slug: "fictional-fixture", state: "published", translations: { en: content(), hu: null, ko: null }, ...patch });
const reader = (...records) => createLocalCatalogueReader(records);

test("actual production listing is an editorial empty state, not out-of-stock or operational readiness", () => {
  const nodes = elements(ProductListing());
  assert.match(text(nodes), /No products to browse yet/);
  assert.ok(nodes.some((node) => node.props?.href === "/brands"));
  assert.doesNotMatch(text(nodes), /out of stock|not ready|HUF|Add to cart/i);
});

test("listing links only published records using the stable slug and exact brand/content", () => {
  const published = product();
  const draft = product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "private-draft", state: "draft" });
  const catalogue = reader(published, draft);
  const nodes = elements(ProductListing({ catalogue }));
  assert.deepEqual(nodes.filter((node) => node.props?.href).map((node) => node.props.href), ["/products/fictional-fixture"]);
  assert.match(text(nodes), /beplain Fictional fixture Only a test fixture/);
  assert.equal(nodes.find((node) => node.type === "img").props.alt, published.translations.en.images[0].alt);
  assert.equal(catalogue.listPublished()[0].publicId, published.publicId);
});

test("detail resolves a published slug and renders supplied images, usage and cautions", () => {
  const record = product();
  const nodes = elements(ProductDetail({ slug: record.slug, catalogue: reader(record) }));
  for (const value of [record.brand, record.translations.en.name, record.translations.en.description,
    record.translations.en.usage, record.translations.en.caution]) assert.ok(text(nodes).includes(value));
  assert.ok(nodes.some((node) => node.props?.href === "/products"));
  assert.equal(nodes.find((node) => node.type === "img").props.src, record.translations.en.images[0].src);
  assert.ok(nodes.every((node) => !node.props?.dangerouslySetInnerHTML));
});

test("draft and unknown detail slugs take Next's real notFound path", () => {
  const catalogue = reader(product({ state: "draft" }));
  for (const slug of ["fictional-fixture", "missing", "../private"]) {
    assert.throws(() => ProductDetail({ slug, catalogue }), (error) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

test("missing English remains visible as unavailable content, not another language or product absence", () => {
  const record = product({ translations: { en: null, hu: { ...content(), name: "HU fixture" }, ko: null } });
  const catalogue = reader(record);
  for (const view of [ProductListing({ catalogue }), ProductDetail({ slug: record.slug, catalogue })]) {
    const nodes = elements(view);
    assert.match(text(nodes), /English product content is not available yet/);
    assert.doesNotMatch(text(nodes), /HU fixture/);
  }
  assert.equal(catalogue.listPublished()[0].translations.en, null);
});

test("text-only published content works without invented images, usage/caution or commerce values", () => {
  const record = product(); record.translations.en.images = [];
  record.translations.en.usage = null; record.translations.en.caution = null;
  const nodes = elements(ProductDetail({ slug: record.slug, catalogue: reader(record) }));
  assert.equal(nodes.filter((node) => node.type === "img").length, 0);
  assert.doesNotMatch(text(nodes), /How to use|Cautions|HUF|stock|available for sale/i);
});

test("invalid publication data cannot enter storefront through the existing catalogue reader", () => {
  const invalid = product(); invalid.translations.en.name = "";
  assert.throws(() => reader(invalid), /incomplete_published_content/);
  assert.throws(() => reader(product({ basePriceHuf: 100 })), /invalid_record/);
});

test("route wiring uses the authoritative reader and promised slug; Header Shop reaches the real listing", () => {
  const source = (path) => readFileSync(join(repo, path), "utf8");
  assert.match(source("app/products/page.tsx"), /<ProductListing criteria=\{criteria\}\s*\/>/);
  const detail = source("app/products/[slug]/page.tsx");
  assert.match(detail, /await params/);
  assert.match(detail, /ProductDetail\(\{ slug \}\)/);
  assert.match(detail, /productMetadata\(slug, "en", \{ legacy: true \}\)/);
  const header = source("components/layout/Header.tsx");
  assert.equal((header.match(/storefrontHref\("\/products", routeLocale\)/g) ?? []).length, 3);
  assert.match(header, /storefrontHref\("\/products", routeLocale\)[\s\S]*?onClick=\{closeMenuForNavigation\}/);
});

test("EN/HU/KO catalogue views select only the requested editorial content and keep identity/slug", () => {
  const record = product();
  for (const locale of ["en", "hu", "ko"]) record.translations[locale] = {
    ...content(), name: `${locale} fixture`, description: `${locale} description`,
    images: [{ src: `/fixtures/${locale}.webp`, alt: `${locale} image` }],
    usage: `${locale} usage`, caution: `${locale} caution`,
  };
  const catalogue = reader(record);
  for (const locale of ["en", "hu", "ko"]) {
    for (const view of [ProductListing({ catalogue, locale, routeLocale: locale }),
      ProductDetail({ catalogue, slug: record.slug, locale, routeLocale: locale })]) {
      const nodes = elements(view);
      assert.ok(text(nodes).includes(`${locale} fixture`));
      assert.equal(nodes.find((node) => node.type === "img").props.alt, `${locale} image`);
      assert.ok(nodes.some((node) => node.props?.href === `/${locale}/products/${record.slug}` || node.props?.href === `/${locale}/products`));
      for (const other of ["en", "hu", "ko"].filter((value) => value !== locale)) assert.ok(!text(nodes).includes(`${other} fixture`));
    }
  }
  assert.equal(catalogue.listPublished()[0].publicId, record.publicId);
});

test("missing HU/KO never fall back to EN; drafts remain inaccessible in every locale", () => {
  const { storefrontLabels } = require("../lib/storefront/localization.ts");
  const record = product();
  for (const locale of ["hu", "ko"]) {
    const catalogue = reader(record);
    for (const view of [ProductListing({ catalogue, locale, routeLocale: locale }),
      ProductDetail({ slug: record.slug, catalogue, locale, routeLocale: locale })]) {
      const nodes = elements(view);
      assert.ok(text(nodes).includes(storefrontLabels[locale].missing));
      assert.ok(!text(nodes).includes(record.translations.en.name));
      assert.equal(nodes.filter((node) => node.type === "img").length, 0);
    }
  }
  for (const locale of ["en", "hu", "ko"]) {
    const catalogue = reader(product({ state: "draft" }));
    assert.throws(() => ProductDetail({ slug: record.slug, catalogue, locale }),
      (error) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

test("language links preserve the product destination, expose current locale, and close mobile navigation", () => {
  let closed = 0;
  const nodes = elements(LanguageSwitcher({ locale: "hu", pathname: "/hu/products/fictional-fixture", onNavigate: () => closed++ }));
  const links = nodes.filter((node) => node.props?.href);
  assert.deepEqual(links.map((node) => node.props.href), ["/en/products/fictional-fixture", "/hu/products/fictional-fixture", "/ko/products/fictional-fixture"]);
  assert.equal(links.filter((node) => node.props["aria-current"] === "true").length, 1);
  assert.equal(links[1].props.lang, "hu");
  for (const link of links) link.props.onClick();
  assert.equal(closed, 3);
});

test("localized GET search/filter controls reflect state and render only combined matches with stable slug links", () => {
  const first = product();
  first.translations.hu = { ...content(), name: "Teszt lemosó" };
  const other = { ...first, publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "other-fixture", brand: "Anua" };
  const criteria = { query: "lemosó", brand: "beplain" };
  const nodes = elements(ProductListing({ catalogue: reader(first, other), locale: "hu", routeLocale: "hu", criteria }));
  const form = nodes.find(node => node.type === "form");
  assert.equal(form.props.method, "get");
  assert.equal(form.props.action, "/hu/products");
  assert.equal(form.props.role, "search");
  assert.equal(nodes.find(node => node.type === "input").props.defaultValue, "lemosó");
  assert.equal(nodes.find(node => node.type === "select").props.defaultValue, "beplain");
  assert.ok(nodes.some(node => node.type === "button" && node.props.type === "submit"));
  assert.equal(nodes.filter(node => node.type === "li").length, 1);
  assert.ok(nodes.some(node => node.props?.href === "/hu/products/fictional-fixture"));
  assert.ok(!nodes.some(node => node.props?.href === "/hu/products/other-fixture"));
  assert.ok(nodes.some(node => node.props?.href === "/hu/products"));
  assert.ok(text(nodes).includes("Keresés és szűrők törlése"));
});

test("zero search results differ from empty catalogue; reset restores publication and missing-translation display", () => {
  const catalogue = reader(product(), product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "private", state: "draft" }));
  const criteria = { query: "no-match", brand: "beplain" };
  const nodes = elements(ProductListing({ catalogue, locale: "ko", routeLocale: "ko", criteria }));
  assert.ok(text(nodes).includes("조건에 맞는 상품이 없습니다"));
  assert.equal(nodes.filter(node => node.type === "li").length, 0);
  assert.ok(nodes.some(node => node.props?.href === "/ko/products"));
  const reset = elements(ProductListing({ catalogue, locale: "ko", routeLocale: "ko" }));
  assert.equal(reset.filter(node => node.type === "li").length, 1);
  assert.ok(text(reset).includes("이 상품의 한국어 콘텐츠가 아직 없습니다"));
  assert.ok(!text(reset).includes("Fictional fixture"));
  const invalid = elements(ProductListing({ catalogue, criteria: { query: "", brand: "unknown" } }));
  assert.ok(text(invalid).includes("Unknown brand selection"));
  assert.equal(invalid.filter(node => node.type === "li").length, 0);
});

test("language switching retains active catalogue search/brand query for the destination locale", () => {
  const nodes = elements(LanguageSwitcher({ locale: "en", pathname: "/en/products?q=cleanser&brand=Round+Lab" }));
  assert.deepEqual(nodes.filter(node => node.props?.href).map(node => node.props.href), [
    "/en/products?q=cleanser&brand=Round+Lab", "/hu/products?q=cleanser&brand=Round+Lab", "/ko/products?q=cleanser&brand=Round+Lab",
  ]);
});

test("catalogue keyboard entry has a unique skip target and native labelled controls in logical order", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const nodes = elements(ProductListing({ locale, routeLocale: locale,
      criteria: { query: "no-match", brand: "beplain" } }));
    const target = nodes.filter(node => node.props?.id === "main-content");
    assert.equal(target.length, 1);
    assert.equal(target[0].type, "h1");
    assert.equal(target[0].props.tabIndex, -1);
    const controls = nodes.filter(node => ["input", "select", "button"].includes(node.type));
    assert.deepEqual(controls.map(node => node.type), ["input", "select", "button"]);
    for (const control of controls.filter(node => node.type !== "button")) {
      assert.ok(nodes.some(node => node.type === "label" && node.props.htmlFor === control.props.id));
      assert.equal(control.props.tabIndex, undefined);
    }
    assert.equal(controls[2].props.type, "submit");
    assert.equal(nodes.find(node => node.type === "form").props.method, "get");
    assert.ok(nodes.some(node => node.props?.href === `/${locale}/products`));
    assert.ok(nodes.some(node => node.props?.href === `/${locale}/brands`));
    assert.ok(!nodes.some(node => node.props?.tabIndex > 0));
  }
});

test("missing translations retain distinct product link names and published-only navigation", () => {
  const first = product();
  const second = product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "other-fixture" });
  const draft = product({ publicId: "32345678-abcd-1234-abcd-123456789abc", slug: "draft-fixture", state: "draft" });
  for (const locale of ["hu", "ko"]) {
    const nodes = elements(ProductListing({ catalogue: reader(first, second, draft), locale, routeLocale: locale }));
    const links = nodes.filter(node => node.props?.href?.includes("/products/"));
    assert.equal(links.length, 2);
    assert.equal(new Set(links.map(link => link.props["aria-label"])).size, 2);
    for (const [index, record] of [first, second].entries()) {
      assert.ok(links[index].props["aria-label"].includes(record.brand));
      assert.ok(links[index].props["aria-label"].includes(record.slug));
      assert.match(links[index].props.className, /min-h-11/);
    }
    assert.ok(!text(nodes).includes("Fictional fixture"));
    const detail = elements(ProductDetail({ catalogue: reader(first), locale, routeLocale: locale, slug: first.slug }));
    assert.equal(detail.find(node => node.props?.id === "main-content").props.tabIndex, -1);
    assert.ok(detail.some(node => node.props?.href === `/${locale}/products`));
  }
});

test("locale controls retain native named links with usable touch targets and no synthetic tab order", () => {
  const nodes = elements(LanguageSwitcher({ locale: "ko", pathname: "/ko/products?q=fixture&brand=beplain" }));
  const links = nodes.filter(node => node.props?.href);
  assert.deepEqual(links.map(node => node.props["aria-label"]), ["English", "Magyar", "한국어"]);
  for (const link of links) {
    assert.match(link.props.className, /min-h-11 min-w-11/);
    assert.equal(link.props.tabIndex, undefined);
    assert.ok(link.props.href.endsWith("?q=fixture&brand=beplain"));
    assert.equal(link.props.role, undefined);
  }
});

test("Header disclosure keeps explicit focus recovery, cleanup, bounded scrolling and a skip destination on each shell", () => {
  const source = path => readFileSync(join(repo, path), "utf8");
  const header = source("components/layout/Header.tsx");
  assert.match(header, /href="#main-content"/);
  assert.match(header, /<a href=\{`\$\{storefrontHref\("\/products", routeLocale\)\}\$\{catalogueQuery\}#catalogue-search`\}/);
  assert.match(header, /aria-expanded=\{isMenuOpen\}/);
  assert.match(header, /aria-controls="mobile-navigation"/);
  assert.match(header, /hidden=\{!isMenuOpen\}/);
  assert.match(header, /max-h-\[calc\(100dvh-5rem\)\] overflow-y-auto/);
  assert.match(header, /event\.key === "Escape"[\s\S]*?menuButtonRef\.current\?\.focus\(\)/);
  assert.match(header, /desktopShopRef\.current\?\.focus\(\)/);
  assert.match(header, /event\.currentTarget\.contains\(event\.relatedTarget\)/);
  for (const event of ["keydown", "pointerdown"]) {
    assert.ok(header.includes(`document.addEventListener("${event}"`));
    assert.ok(header.includes(`document.removeEventListener("${event}"`));
  }
  assert.match(header, /desktopQuery\.removeEventListener\("change"/);
  assert.doesNotMatch(header, /href="#"/);
  assert.match(header, /<button type="button" disabled>/);
  for (const path of ["components/home/Hero.tsx", "app/brands/page.tsx", "app/products/[slug]/not-found.tsx"]) {
    assert.match(source(path), /<h1 id="main-content" tabIndex=\{-1\}/);
  }
  const css = source("app/globals.css");
  assert.match(css, /scroll-padding-top: 6rem/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(source("app/layout.tsx"), /data-scroll-behavior="smooth"/);
});
