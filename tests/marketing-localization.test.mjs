import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { marketingCopy } from "../lib/storefront/marketing-copy.ts";
import { brandNames } from "../data/brands.ts";
import { readCatalogueCriteria } from "../lib/catalog/catalogue-discovery.ts";
import { storefrontHref, switchLocalePath, storefrontLabels } from "../lib/storefront/localization.ts";

// Same installed TypeScript/React loader convention as catalogue-storefront tests.
const require = createRequire(import.meta.url);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot = dirname(require.resolve("react/package.json"));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return { url: pathToFileURL(join(reactRoot, "index.js")).href, shortCircuit: true };
    if (specifier === "react-dom") return { url: pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "index.js")).href, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: pathToFileURL(join(reactRoot, "jsx-runtime.js")).href, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
    if (specifier.startsWith("@/")) specifier = pathToFileURL(join(repo, specifier.slice(2))).href;
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      for (const extension of [".ts", ".tsx"]) {
        try { return nextResolve(`${specifier}${extension}`, context); } catch { /* Next extension. */ }
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
const { renderToStaticMarkup } = await import(pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "server.node.js")).href);
const { default: Header } = await import("../components/layout/Header.tsx");
const { default: Home } = await import("../app/page.tsx");
const { default: Brands } = await import("../app/brands/page.tsx");
const { default: LocalizedHome } = await import("../app/[locale]/page.tsx");
const { default: LocalizedBrands } = await import("../app/[locale]/brands/page.tsx");
const { ProductListing } = await import("../components/catalogue/ProductCatalogue.tsx");

// Header pathname hooks belong to Next's browser router; its unchanged behavior
// is covered separately. Render the actual body, including the real BrandDirectory.
function body(element) {
  const main = element.type(element.props);
  return { ...main, props: { ...main.props,
    children: main.props.children.filter(child => child?.type !== Header) } };
}
const render = element => renderToStaticMarkup(body(element));

test("actual EN/HU/KO Home and Brands routes render their selected body and directory labels", async () => {
  for (const locale of ["en", "hu", "ko"]) {
    const props = { params: Promise.resolve({ locale }) };
    const home = render(await LocalizedHome(props));
    const brands = render(await LocalizedBrands(props));
    const copy = marketingCopy[locale];
    assert.ok(home.includes(`lang="${locale}"`));
    assert.ok(brands.includes(`lang="${locale}"`));
    for (const value of [copy.hero.heading, copy.hero.description, copy.hero.shop, copy.hero.routine,
      ...copy.hero.trust, copy.featured.eyebrow, copy.featured.heading, copy.featured.headingEnd,
      copy.featured.description, copy.featured.discover, ...[copy.featured.roundLab, copy.featured.anua, copy.featured.skin1004].flatMap(item => [item.tagline, item.description]),
      copy.why.heading, copy.why.description, ...copy.why.points.flatMap(item => [item.title, item.description])]) {
      assert.ok(home.includes(value), `${locale} missing body string: ${value}`);
    }
    for (const value of [copy.brands.heading, copy.brands.description, copy.directory.browse,
      copy.directory.searchLabel, copy.directory.searchPlaceholder, copy.directory.filterLabel,
      copy.directory.alphabet, copy.directory.all, copy.directory.resultMany.replace("{count}", "16")]) {
      assert.ok(brands.includes(value), `${locale} missing directory string: ${value}`);
    }
    for (const brand of brandNames) assert.ok(brands.includes(`>${brand}</a>`), brand);
    assert.equal((brands.match(/aria-pressed=/g) ?? []).length, 27);
    assert.ok(!home.includes('href="#"'));
    assert.equal((home.match(/<button/g) ?? []).length, 1); // Routine remains unresolved.
    if (locale !== "en") {
      assert.ok(!home.includes(marketingCopy.en.hero.heading));
      assert.ok(!brands.includes(marketingCopy.en.directory.searchLabel));
    }
  }
});

test("legacy routes retain the same English body as EN routes and source claims", async () => {
  const withoutLinkDestinations = html => html.replace(/href="[^"]*"/g, 'href=""');
  assert.equal(withoutLinkDestinations(render(Home())), withoutLinkDestinations(render(await LocalizedHome({ params: Promise.resolve({ locale: "en" }) }))));
  assert.equal(withoutLinkDestinations(render(Brands())), withoutLinkDestinations(render(await LocalizedBrands({ params: Promise.resolve({ locale: "en" }) }))));
  assert.ok(render(Home()).includes("Feel confident in your skin."));
  assert.ok(render(Brands()).includes("16 brands found"));
  for (const route of [LocalizedHome, LocalizedBrands]) {
    await assert.rejects(route({ params: Promise.resolve({ locale: "fr" }) }), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

test("Home shop and featured brand links reach the existing listing with exact locale and brand criteria", async () => {
  for (const locale of [null, "en", "hu", "ko"]) {
    const home = render(locale === null ? Home() : await LocalizedHome({ params: Promise.resolve({ locale }) }));
    const links = [...home.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)];
    assert.equal(links.length, 4);
    assert.equal(links[0][1], storefrontHref("/products", locale));
    assert.ok(links[0][2].includes(marketingCopy[locale ?? "en"].hero.shop));
    for (const [index, brand] of ["Round Lab", "Anua", "SKIN1004"].entries()) {
      const url = new URL(links[index + 1][1], "http://localhost");
      assert.equal(url.pathname, storefrontHref("/products", locale));
      const criteria = readCatalogueCriteria(Object.fromEntries(url.searchParams));
      assert.deepEqual(criteria, { query: "", brand });
      assert.ok(brandNames.includes(criteria.brand));
      const listing = renderToStaticMarkup(ProductListing({ locale: locale ?? "en", routeLocale: locale, criteria }));
      assert.ok(listing.includes(`<option value="${brand}" selected="">${brand}</option>`));
      assert.ok(listing.includes(storefrontLabels[locale ?? "en"].noResults));
      assert.ok(listing.includes(`action="${storefrontHref("/products", locale)}"`));
      for (const destination of ["en", "hu", "ko"]) {
        const switched = new URL(switchLocalePath(url.pathname + url.search, destination), "http://localhost");
        assert.equal(switched.pathname, `/${destination}/products`);
        assert.equal(switched.searchParams.get("brand"), brand);
      }
    }
    assert.ok(home.includes(`<button`));
    assert.ok(home.includes(marketingCopy[locale ?? "en"].hero.routine));
    assert.ok(!home.includes('<a href="#"'));
  }
});

test("all 16 directory links retain exact brand identity, legacy/locale routing, and existing catalogue behavior", async () => {
  for (const locale of [null, "en", "hu", "ko"]) {
    const html = render(locale === null ? Brands() : await LocalizedBrands({ params: Promise.resolve({ locale }) }));
    const links = [...html.matchAll(/<a\b([^>]*?)href="([^"]*)"([^>]*)>(.*?)<\/a>/gs)];
    assert.equal(links.length, 16);
    assert.deepEqual(links.map(link => link[4]).sort(), [...brandNames].sort());
    for (const [, before, href, after, brand] of links) {
      const url = new URL(href, "http://localhost");
      assert.equal(url.pathname, storefrontHref("/products", locale));
      assert.deepEqual([...url.searchParams.keys()], ["brand"]);
      assert.deepEqual(readCatalogueCriteria(Object.fromEntries(url.searchParams)), { query: "", brand });
      assert.match(before + after, /min-h-11/);
      assert.match(before + after, /focus-visible:outline-2/);
      assert.doesNotMatch(before + after, /role=|tabindex=|aria-label=/);
      const listing = renderToStaticMarkup(ProductListing({ locale: locale ?? "en", routeLocale: locale,
        criteria: { query: "", brand } }));
      assert.ok(listing.includes(`<option value="${brand}" selected="">${brand}</option>`));
      assert.ok(listing.includes(storefrontLabels[locale ?? "en"].noResults));
      assert.ok(listing.includes(`href="${storefrontHref("/products", locale)}"`));
      assert.ok(!listing.includes("out of stock"));
      for (const target of ["en", "hu", "ko"]) {
        const switched = new URL(switchLocalePath(url.pathname + url.search, target), "http://localhost");
        assert.equal(switched.pathname, `/${target}/products`);
        assert.equal(switched.searchParams.get("brand"), brand);
      }
    }
  }
});

test("Directory receives serializable destinations without importing the server-only discovery layer", () => {
  const source = readFileSync(join(repo, "components/brands/BrandDirectory.tsx"), "utf8");
  assert.ok(source.startsWith('"use client";'));
  assert.doesNotMatch(source, /from ["'][^"']*(?:catalogue-discovery|local-catalogue|product-operational)/);
  assert.match(source, /href=\{catalogueLinks\[brand\]\}/);
  // Existing search/A-Z continues to render links from the same filtered brand names.
  assert.match(source, /matchingBrands[\s\S]*?\.filter\(\(brand\) => brand\[0\]\.toUpperCase\(\) === letter\)[\s\S]*?\.map\(\(brand\)/);
});

test("marketing locales expose the same complete string structure, including zero-results and count patterns", () => {
  function leaves(value, prefix = "") {
    return typeof value === "string" ? [[prefix, value]] : Object.entries(value).flatMap(([key, child]) => leaves(child, `${prefix}.${key}`));
  }
  const keys = leaves(marketingCopy.en).map(([key]) => key);
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(leaves(marketingCopy[locale]).map(([key]) => key), keys);
    for (const [, text] of leaves(marketingCopy[locale])) assert.ok(text.trim());
    for (const count of [0, 1, 16]) {
      const labels = marketingCopy[locale].directory;
      assert.ok((count === 1 ? labels.resultOne : labels.resultMany).replace("{count}", String(count)).includes(String(count)));
    }
  }
});
