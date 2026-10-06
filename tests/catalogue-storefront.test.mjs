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
  assert.match(source("app/products/page.tsx"), /<ProductListing\s*\/>/);
  const detail = source("app/products/[slug]/page.tsx");
  assert.match(detail, /await params/);
  assert.match(detail, /ProductDetail\(\{ slug \}\)/);
  assert.match(detail, /localCatalogue\.findPublishedBySlug\(slug\)/);
  const header = source("components/layout/Header.tsx");
  assert.equal((header.match(/href="\/products"/g) ?? []).length, 2);
  assert.match(header, /href="\/products"[\s\S]*?onClick=\{\(\) => setIsMenuOpen\(false\)\}/);
});
