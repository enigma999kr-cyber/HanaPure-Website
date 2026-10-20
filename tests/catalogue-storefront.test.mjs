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
const { default: ProductImage } = await import("../components/catalogue/ProductImage.tsx");
const { default: ProductMediaGallery } = await import("../components/catalogue/ProductMediaGallery.tsx");
const { default: AddToCart } = await import("../components/cart/AddToCart.tsx");
const { default: QuickAdd } = await import("../components/cart/QuickAdd.tsx");
const { default: SaveProductButton } = await import("../components/catalogue/SaveProductButton.tsx");
const { default: SavedProductsBar } = await import("../components/catalogue/SavedProductsBar.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { default: SearchSuggestions } = await import("../components/catalogue/SearchSuggestions.tsx");
// Expand the actual pure server views, preserving host-element attributes/text.
function elements(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node !== "object") return [node];
  // Client hooks are exercised in the hydrated browser, not called as server functions.
  // This island also carries the actual server-rendered native input as its child.
  if (node.type === SearchSuggestions) return [node, ...elements(node.props.children)];
  if (node.type === ProductImage || node.type === ProductMediaGallery || node.type === AddToCart || node.type === QuickAdd ||
    node.type === SaveProductButton || node.type === SavedProductsBar || node.type === ProductComparison) return [node];
  if (typeof node.type === "function") return elements(node.type(node.props));
  return [node, ...elements(node.props?.children)];
}
const text = (nodes) => nodes.filter((node) => typeof node === "string").join(" ");
const content = () => ({ name: "Fictional fixture", description: "Only a test fixture.",
  images: [{ src: "/fixtures/image.webp", alt: "Fictional fixture image" }], usage: "Fixture usage.", caution: "Fixture caution." });
const product = (patch = {}) => ({ publicId: "12345678-abcd-1234-abcd-123456789abc", brand: "beplain",
  slug: "fictional-fixture", state: "published", translations: { en: content(), hu: null, ko: null }, ...patch });
const reader = (...records) => createLocalCatalogueReader(records);
const { readCatalogueCriteria, catalogueQueryString } = await import("../lib/catalog/catalogue-discovery.ts");
const { productMetadata } = await import("../lib/storefront/seo.ts");

test("instant suggestions receive full published selected-locale projection while the actual native GET input remains intact", () => {
  const first = product();
  const second = product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "another-fixture", brand: "Anua" });
  const draft = product({ publicId: "32345678-abcd-1234-abcd-123456789abc", slug: "private-draft", state: "draft" });
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const criteria = { query: "prefilled & text", brand: "beplain", sort: "name-desc" };
    const nodes = elements(ProductListing({ catalogue: reader(first, second, draft), locale, routeLocale, criteria }));
    const island = nodes.find(node => node.type === SearchSuggestions);
    assert.equal(nodes.filter(node => node.type === SearchSuggestions).length, 1);
    assert.deepEqual(Object.keys(island.props).sort(), ["children", "initialQuery", "locale", "products", "routeLocale"]);
    assert.equal(island.props.initialQuery, criteria.query);
    assert.equal(island.props.locale, locale);
    assert.equal(island.props.routeLocale, routeLocale);
    assert.deepEqual(island.props.products.map(item => item.publicId), [first.publicId, second.publicId]);
    for (const item of island.props.products) {
      assert.deepEqual(Object.keys(item).sort(), ["brand", "description", "name", "publicId", "slug"]);
      assert.equal(item.name, locale === "en" ? content().name : null);
      assert.equal(item.description, locale === "en" ? content().description : null);
    }
    const forms = nodes.filter(node => node.type === "form");
    assert.equal(forms.length, 1);
    assert.equal(forms[0].props.method, "get");
    assert.equal(forms[0].props.action, routeLocale ? `/${locale}/products` : "/products");
    assert.equal(forms[0].props.role, "search");
    const input = island.props.children;
    assert.equal(input.type, "input");
    assert.equal(input.props.id, "catalogue-search");
    assert.equal(input.props.name, "q");
    assert.equal(input.props.type, "search");
    assert.equal(input.props.defaultValue, criteria.query);
    assert.ok(nodes.some(node => node.type === "label" && node.props.htmlFor === input.props.id));
    assert.equal(nodes.find(node => node.type === "select" && node.props.name === "brand").props.defaultValue, criteria.brand);
    assert.equal(nodes.find(node => node.type === "select" && node.props.name === "sort").props.defaultValue, criteria.sort);
    assert.equal(nodes.filter(node => node.type === "button" && node.props.type === "submit").length, 1);
    const empty = elements(ProductListing({ locale, routeLocale }));
    assert.deepEqual(empty.find(node => node.type === SearchSuggestions).props.products, []);
    assert.equal(empty.filter(node => node.type === "input").length, 1);
  }
});

test("comparison is published-only, independent of filtered results, localized and preselects the detail identity", () => {
  const first = product();
  const second = product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "second-fixture", brand: "Anua",
    translations: { en: { ...content(), usage: null, caution: null }, hu: null, ko: null } });
  const draft = product({ publicId: "32345678-abcd-1234-abcd-123456789abc", slug: "private-draft", state: "draft" });
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const catalogue = reader(first, second, draft);
    const nodes = elements(ProductListing({ catalogue, locale, routeLocale,
      criteria: { query: "", brand: "beplain", sort: "name-desc" } }));
    const board = nodes.find(node => node.type === ProductComparison);
    assert.equal(nodes.filter(node => node.type === ProductComparison).length, 1);
    assert.deepEqual(Object.keys(board.props).sort(), ["locale", "products", "routeLocale"]);
    assert.equal(board.props.locale, locale);
    assert.equal(board.props.routeLocale, routeLocale);
    assert.equal(board.props.products.length, 2);
    assert.deepEqual(board.props.products.map(item => item.publicId), [first.publicId, second.publicId]);
    assert.equal(nodes.filter(node => node.type === QuickAdd).length, 1);
    for (const [index, item] of board.props.products.entries()) {
      assert.deepEqual(Object.keys(item).sort(), ["brand", "caution", "description", "name", "publicId", "slug", "usage"]);
      assert.equal(item.slug, [first, second][index].slug);
      if (locale === "en") {
        assert.equal(item.name, content().name);
        assert.equal(item.description, content().description);
      } else for (const field of ["name", "description", "usage", "caution"]) assert.equal(item[field], null);
    }
    assert.equal(board.props.products[1].usage, null);
    assert.equal(board.props.products[1].caution, null);
    const detail = elements(ProductDetail({ catalogue, slug: second.slug, locale, routeLocale,
      criteria: { query: "original", brand: "Round Lab" } }));
    const detailBoard = detail.find(node => node.type === ProductComparison);
    assert.equal(detailBoard.props.initialPublicId, second.publicId);
    assert.deepEqual(detailBoard.props.products, board.props.products);
    assert.equal(detailBoard.props.routeLocale, routeLocale);
    for (const count of [0, 1]) {
      const small = reader(...[first].slice(0, count), draft);
      assert.equal(elements(ProductListing({ catalogue: small, locale, routeLocale })).some(node => node.type === ProductComparison), false);
      if (count) assert.equal(elements(ProductDetail({ catalogue: small, slug: first.slug, locale, routeLocale })).some(node => node.type === ProductComparison), false);
    }
    for (const slug of [draft.slug, "unknown"]) assert.throws(() => ProductDetail({ catalogue, slug, locale, routeLocale }));
  }
  assert.equal(elements(ProductListing()).some(node => node.type === ProductComparison), false);
});

test("Saved controls use only published identity and the full minimal locale projection, independent of search/sort", () => {
  const published = product();
  const second = product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "other-fixture", brand: "Anua" });
  const draft = product({ publicId: "32345678-abcd-1234-abcd-123456789abc", slug: "draft-fixture", state: "draft" });
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const catalogue = reader(published, second, draft);
    const nodes = elements(ProductListing({ catalogue, locale, routeLocale,
      criteria: { query: "", brand: "beplain", sort: "name-desc" } }));
    const bar = nodes.find(node => node.type === SavedProductsBar);
    assert.equal(nodes.filter(node => node.type === SavedProductsBar).length, 1);
    assert.deepEqual(Object.keys(bar.props).sort(), ["locale", "products", "routeLocale"]);
    assert.equal(bar.props.routeLocale, routeLocale);
    assert.equal(bar.props.locale, locale);
    assert.deepEqual(bar.props.products.map(item => item.publicId), [published.publicId, second.publicId]);
    for (const item of bar.props.products) {
      assert.deepEqual(Object.keys(item).sort(), ["name", "publicId", "slug"]);
      assert.ok(locale === "en" ? item.name === "Fictional fixture" : item.name.includes(item.slug));
      if (locale !== "en") assert.ok(!item.name.includes("Fictional fixture"));
    }
    const buttons = nodes.filter(node => node.type === SaveProductButton);
    assert.equal(buttons.length, 1);
    assert.deepEqual(Object.keys(buttons[0].props).sort(), ["locale", "name", "publicId"]);
    assert.equal(buttons[0].props.publicId, published.publicId);
    const detail = elements(ProductDetail({ catalogue, slug: second.slug, locale, routeLocale }));
    assert.equal(detail.filter(node => node.type === SaveProductButton).length, 1);
    assert.equal(detail.find(node => node.type === SaveProductButton).props.publicId, second.publicId);
    assert.throws(() => ProductDetail({ catalogue, slug: draft.slug, locale, routeLocale }));
    assert.throws(() => ProductDetail({ catalogue, slug: "unknown", locale, routeLocale }));
  }
  const empty = elements(ProductListing());
  assert.equal(empty.filter(node => node.type === SaveProductButton).length, 0);
  assert.deepEqual(empty.find(node => node.type === SavedProductsBar).props.products, []);
});

test("Quick Add receives published editorial identity only and respects missing-locale content", () => {
  const published = product();
  const draft = product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "test-only-draft", state: "draft" });
  for (const locale of ["en", "hu", "ko"]) {
    const nodes = elements(ProductListing({ catalogue: reader(published, draft), locale, routeLocale: locale }));
    const controls = nodes.filter(node => node.type === QuickAdd);
    assert.equal(controls.length, 1);
    assert.deepEqual(Object.keys(controls[0].props).sort(), ["locale", "name", "publicId"]);
    assert.equal(controls[0].props.publicId, published.publicId);
    assert.equal(controls[0].props.locale, locale);
    assert.ok(locale === "en" ? controls[0].props.name === "Fictional fixture" : controls[0].props.name.includes(published.slug));
    assert.equal(nodes.find(node => node.type === "li").props.children.some(child => child?.type === QuickAdd), true);
  }
  assert.equal(elements(ProductListing()).filter(node => node.type === QuickAdd).length, 0);
});

test("same-brand detail discovery limits only other published identities and preserves original Back criteria", () => {
  for (const count of [0, 1, 2, 3, 4, 5]) for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const current = product({ brand: "Dr. Althea" });
    const others = Array.from({ length: count }, (_, index) => product({
      publicId: `${String(index + 2).padStart(8, "0")}-abcd-1234-abcd-123456789abc`, slug: `same-brand-${index}`, brand: current.brand,
    }));
    const unrelated = product({ publicId: "82345678-abcd-1234-abcd-123456789abc", slug: "different-brand", brand: "Anua" });
    const draft = product({ publicId: "92345678-abcd-1234-abcd-123456789abc", slug: "private-same-brand", brand: current.brand, state: "draft" });
    const catalogue = reader(current, ...others, unrelated, draft);
    const root = routeLocale ? `/${locale}/products` : "/products";
    const criteria = { query: "Original & query", brand: "Round Lab" };
    const nodes = elements(ProductDetail({ catalogue, slug: current.slug, locale, routeLocale, criteria }));
    assert.ok(nodes.some(node => node.props?.href === root + catalogueQueryString(criteria)));
    assert.ok(nodes.some(node => node.props?.href === `${root}?brand=Dr.+Althea`));
    const section = nodes.find(node => node.type === "section" && node.props["aria-labelledby"] === "same-brand-heading");
    assert.equal(Boolean(section), count > 0);
    if (section) {
      const links = elements(section).filter(node => node.props?.href);
      assert.deepEqual(links.map(node => node.props.href), others.slice(0, 3).map(item => `${root}/${item.slug}?brand=Dr.+Althea`));
      for (const link of links) assert.match(link.props.className, /focus-visible:outline-2/);
      if (locale !== "en") {
        assert.doesNotMatch(text(elements(section)), /Fictional fixture/);
        assert.equal(new Set(links.map(node => node.props["aria-label"])).size, Math.min(count, 3));
      }
    }
    assert.equal(catalogue.listPublished().length, count + 2);
    assert.throws(() => ProductDetail({ catalogue, slug: draft.slug }), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

test("related detail Back restores brand context without changing canonical SEO", () => {
  const current = product();
  const other = product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "same-brand-other" });
  const catalogue = reader(current, other);
  const params = readCatalogueCriteria({ brand: "beplain" });
  const nodes = elements(ProductDetail({ catalogue, slug: other.slug, criteria: params }));
  assert.ok(nodes.some(node => node.props?.href === "/products?brand=beplain"));
  const metadata = productMetadata(other.slug, "en", { catalogue, origin: "https://hanapure.test" });
  assert.equal(metadata.alternates.canonical, "/en/products/same-brand-other".replace(/^/, "https://hanapure.test"));
});

test("detail gallery receives exact ordered editorial media only for multiple images; zero/one stays unchanged", () => {
  for (const count of [0, 1, 2, 3]) {
    const record = product();
    record.translations.en.images = Array.from({ length: count }, (_, i) => ({ src: `/test-only-${i}.svg`, alt: `Editorial ${i}` }));
    const catalogue = reader(record);
    const nodes = elements(ProductDetail({ catalogue, slug: record.slug }));
    assert.equal(nodes.filter(node => node.type === ProductMediaGallery).length, count > 1 ? 1 : 0);
    assert.equal(nodes.filter(node => node.type === ProductImage).length, count === 1 ? 1 : 0);
    if (count > 1) {
      const images = nodes.find(node => node.type === ProductMediaGallery).props.images;
      assert.deepEqual(images, record.translations.en.images);
      assert.deepEqual(Object.keys(nodes.find(node => node.type === ProductMediaGallery).props), ["images"]);
    }
  }
  const images = [{ src: "/test-only.svg", alt: "Editorial" }, { src: "/test-only-2.svg", alt: "Editorial 2" }];
  assert.notEqual(ProductMediaGallery({ images }).key, ProductMediaGallery({ images: [...images].reverse() }).key);
});

test("image sources get distinct state identities without altering editorial publication or links", () => {
  const first = ProductImage({ src: "/missing-test-only.png", alt: "Editorial meaning" });
  const second = ProductImage({ src: "/replacement-test-only.png", alt: "Editorial meaning" });
  assert.notEqual(first.key, second.key);
  assert.equal(first.props.alt, second.props.alt);
  const record = product();
  record.translations.en.images[0].src = "/missing-test-only.png";
  const catalogue = reader(record);
  const nodes = elements(ProductListing({ catalogue, criteria: { query: "fixture", brand: "beplain" } }));
  assert.equal(nodes.filter(node => node.type === ProductImage).length, 1);
  assert.ok(nodes.some(node => node.props?.href === "/products/fictional-fixture?q=fixture&brand=beplain"));
  assert.equal(catalogue.listPublished().length, 1);
  assert.equal(catalogue.listPublished()[0].publicId, record.publicId);
  const detail = elements(ProductDetail({ catalogue, slug: record.slug }));
  assert.ok(detail.find(node => node.type === ProductImage).key.startsWith(`${record.publicId}-`));
});

test("published listing/detail/Back round-trip preserves only parsed criteria in every locale and legacy URLs", () => {
  const record = product();
  record.translations.hu = content();
  record.translations.ko = content();
  const catalogue = reader(record);
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const root = routeLocale ? `/${routeLocale}/products` : "/products";
    for (const params of [
      {}, { q: "fixture" }, { brand: "beplain" }, { q: "fixture", brand: "beplain" },
      { q: "fixture", brand: "beplain", sort: "name-asc" }, { sort: "name-desc" },
      { q: "fixture", sort: ["name-asc", "name-desc"] },
      { q: ["  beplain  ", "ignored"], brand: ["beplain", "Anua"], returnUrl: "https://invalid.example" },
      { q: ["", "ignored"], brand: [] },
    ]) {
      const criteria = readCatalogueCriteria(params);
      const suffix = catalogueQueryString(criteria);
      const listing = elements(ProductListing({ catalogue, locale, routeLocale, criteria }));
      const href = listing.find(node => node.props?.href?.startsWith(`${root}/${record.slug}`)).props.href;
      assert.equal(href, `${root}/${record.slug}${suffix}`);
      const parsed = readCatalogueCriteria(Object.fromEntries(new URL(href, "https://test.invalid").searchParams));
      const detail = elements(ProductDetail({ slug: record.slug, catalogue, locale, routeLocale, criteria: parsed }));
      assert.ok(detail.some(node => node.props?.href === `${root}${suffix}`));
      const languages = elements(LanguageSwitcher({ locale, pathname: href })).filter(node => node.props?.href);
      assert.deepEqual(languages.map(node => node.props.href), ["en", "hu", "ko"].map(next => `/${next}/products/${record.slug}${suffix}`));
    }
    for (const query of ["테스트 & lemosó + / ? #", "https://invalid.example/?returnUrl=/", "%2F"]) {
      const criteria = readCatalogueCriteria({ q: query, brand: "unknown & brand", returnUrl: "//invalid.example" });
      const suffix = catalogueQueryString(criteria);
      const detail = elements(ProductDetail({ slug: record.slug, catalogue, locale, routeLocale, criteria }));
      assert.ok(detail.some(node => node.props?.href === `${root}${suffix}`));
      assert.deepEqual(readCatalogueCriteria(Object.fromEntries(new URLSearchParams(suffix))), criteria);
      const metadata = productMetadata(record.slug, locale, { catalogue, origin: "https://hanapure.test", legacy: routeLocale === null });
      assert.ok(!JSON.stringify(metadata.alternates).includes("?"));
      assert.equal(metadata.alternates.canonical, `https://hanapure.test/${locale}/products/${record.slug}`);
    }
    const direct = elements(ProductDetail({ slug: record.slug, catalogue, locale, routeLocale }));
    assert.ok(direct.some(node => node.props?.href === root));
    for (const slug of ["missing", "private-draft"]) {
      const unpublished = reader(record, product({ publicId: "22345678-abcd-1234-abcd-123456789abc", slug: "private-draft", state: "draft" }));
      assert.throws(() => ProductDetail({ slug, catalogue: unpublished, locale, routeLocale,
        criteria: { query: "fixture", brand: "beplain" } }), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
    }
  }
});

test("localized native sort control preserves normalized criteria and reset keeps sort-only empty state honest", () => {
  const { storefrontLabels } = require("../lib/storefront/localization.ts");
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const nodes = elements(ProductListing({ locale, routeLocale, criteria: { query: "", brand: "", sort: "name-desc" } }));
    const sort = nodes.find(node => node.props?.id === "catalogue-sort");
    assert.equal(sort.type, "select"); assert.equal(sort.props.name, "sort");
    assert.equal(sort.props.defaultValue, "name-desc");
    assert.deepEqual(elements(sort.props.children).filter(node => node.type === "option").map(node => node.props.value), ["", "name-asc", "name-desc"]);
    assert.ok(nodes.some(node => node.type === "label" && node.props.htmlFor === "catalogue-sort"));
    assert.ok(text(nodes).includes(storefrontLabels[locale].empty));
    assert.ok(!text(nodes).includes(storefrontLabels[locale].noResults));
    assert.ok(nodes.some(node => node.props?.href === (routeLocale ? `/${locale}/products` : "/products")));
  }
});

test("detail route shells pass normalized criteria to Back and locale navigation without changing metadata", () => {
  for (const path of ["app/products/[slug]/page.tsx", "app/[locale]/products/[slug]/page.tsx"]) {
    const source = readFileSync(join(repo, path), "utf8");
    assert.match(source, /readCatalogueCriteria\(await searchParams\)/);
    assert.match(source, /<Header catalogueQuery=\{catalogueQueryString\(criteria\)\}/);
    const metadata = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default"));
    assert.doesNotMatch(metadata, /searchParams|criteria|catalogueQuery/);
  }
});

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
  assert.deepEqual(nodes.filter((node) => node.props?.href).map((node) => node.props.href), ["/products/fictional-fixture", "/products/fictional-fixture"]);
  assert.match(text(nodes), /beplain Fictional fixture Only a test fixture/);
  assert.equal(nodes.find((node) => node.type === ProductImage).props.alt, published.translations.en.images[0].alt);
  assert.equal(catalogue.listPublished()[0].publicId, published.publicId);
});

test("detail resolves a published slug and renders supplied images, usage and cautions", () => {
  const record = product();
  const nodes = elements(ProductDetail({ slug: record.slug, catalogue: reader(record) }));
  for (const value of [record.brand, record.translations.en.name, record.translations.en.description,
    record.translations.en.usage, record.translations.en.caution]) assert.ok(text(nodes).includes(value));
  assert.ok(nodes.some((node) => node.props?.href === "/products"));
  assert.equal(nodes.find((node) => node.type === ProductImage).props.src, record.translations.en.images[0].src);
  assert.ok(nodes.every((node) => !node.props?.dangerouslySetInnerHTML));
});

test("image and title share exact detail criteria without exposing missing media or unpublished records", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const record = product(); record.translations[locale] = content();
    const criteria = { query: "fixture", brand: "beplain" };
    const nodes = elements(ProductListing({ catalogue: reader(record), locale, routeLocale, criteria }));
    const links = nodes.filter(node => node.props?.href?.includes("/products/"));
    assert.equal(links.length, 2);
    assert.equal(links[0].props.href, links[1].props.href);
    assert.match(links[0].props["aria-label"], /Fictional fixture/);
    assert.match(links[0].props.className, /focus-visible:outline-2/);
    record.translations[locale].images = [];
    assert.equal(elements(ProductListing({ catalogue: reader(record), locale, routeLocale, criteria })).filter(node => node.props?.href?.includes("/products/")).length, 1);
  }
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
  assert.equal(nodes.filter((node) => node.type === ProductImage).length, 0);
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
  assert.match(detail, /ProductDetail\(\{ slug, criteria \}\)/);
  assert.match(detail, /productMetadata\(slug, "en", \{ legacy: true \}\)/);
  const header = source("components/layout/Header.tsx");
  assert.equal((header.match(/storefrontHref\("\/products", routeLocale\)/g) ?? []).length, 4);
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
      assert.equal(nodes.find((node) => node.type === ProductImage).props.alt, `${locale} image`);
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
      assert.equal(nodes.filter((node) => node.type === ProductImage).length, 0);
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
  assert.ok(nodes.some(node => node.props?.href === "/hu/products/fictional-fixture?q=lemos%C3%B3&brand=beplain"));
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
    assert.deepEqual(controls.map(node => node.type), ["input", "select", "select", "button"]);
    for (const control of controls.filter(node => node.type !== "button")) {
      assert.ok(nodes.some(node => node.type === "label" && node.props.htmlFor === control.props.id));
      assert.equal(control.props.tabIndex, undefined);
    }
    assert.equal(controls[3].props.type, "submit");
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
  assert.match(header, /storefrontHref\("\/cart", routeLocale\)/);
  for (const path of ["components/home/Hero.tsx", "components/brands/BrandsContent.tsx", "app/products/[slug]/not-found.tsx"]) {
    assert.match(source(path), /<h1 id="main-content" tabIndex=\{-1\}/);
  }
  const css = source("app/globals.css");
  assert.match(css, /scroll-padding-top: 6rem/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(source("app/layout.tsx"), /data-scroll-behavior="smooth"/);
});

test("cart entry receives only published ERP identity and locale, never operational facts or a server reader", () => {
  const record = product();
  for (const locale of ["en", "hu", "ko"]) {
    const nodes = elements(ProductDetail({ catalogue: reader(record), slug: record.slug, locale, routeLocale: locale }));
    const control = nodes.find(node => node.type === AddToCart);
    assert.deepEqual(control.props, { publicId: record.publicId, locale, routeLocale: locale });
    assert.ok(!elements(ProductListing({ catalogue: reader(record) })).some(node => node.type === AddToCart));
  }
  assert.throws(() => ProductDetail({ catalogue: reader(product({ state: "draft" })), slug: record.slug }));
});
