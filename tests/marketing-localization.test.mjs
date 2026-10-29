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
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { publishedCatalogueFixtures } from "./browser/published-catalogue-fixtures.mjs";

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
const { default: Footer } = await import("../components/layout/Footer.tsx");
const { default: Home } = await import("../app/page.tsx");
const { default: Brands } = await import("../app/brands/page.tsx");
const { default: BrandsContent } = await import("../components/brands/BrandsContent.tsx");
const { default: FeaturedBrands } = await import("../components/brands/FeaturedBrands.tsx");
const { default: LocalizedHome } = await import("../app/[locale]/page.tsx");
const { default: LocalizedBrands } = await import("../app/[locale]/brands/page.tsx");
const { ProductListing } = await import("../components/catalogue/ProductCatalogue.tsx");

// Header pathname hooks belong to Next's browser router; its unchanged behavior
// is covered separately. Render the actual body, including the real BrandDirectory.
function body(element) {
  const shell = element.type(element.props);
  const main = shell.type === "main" ? shell : shell.props.children.find(child => child?.type === "main");
  return { ...main, props: { ...main.props,
    children: main.props.children.filter(child => child?.type !== Header) } };
}
const render = element => renderToStaticMarkup(body(element));

test("public Footer uses only real localized links and distinguishes its landmark without new copy", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const html = renderToStaticMarkup(Footer({ locale, routeLocale }));
    assert.match(html, /<footer lang="[^"]+" aria-label="HanaPure"/);
    assert.match(html, /<nav aria-label="HanaPure"/);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(hrefs, ["/", "/products", "/brands", "/cart"].map(path => storefrontHref(path, routeLocale)));
    assert.doesNotMatch(html, /href="#|Contact|Privacy|Terms|Delivery|Returns/);
    assert.match(html, /min-h-11/);
    assert.match(html, /focus-visible:outline-2/);
  }
});

test("Footer stays outside main and outside global layout/not-found boundaries", () => {
  for (const component of [Home, Brands]) {
    const shell = component();
    const result = shell.type(shell.props);
    assert.equal(result.props.children[0].type, "main");
    assert.equal(result.props.children[1].type, Footer);
  }
  for (const path of ["app/layout.tsx", "app/[locale]/layout.tsx", "app/not-found.tsx", "app/products/[slug]/not-found.tsx", "app/[locale]/products/[slug]/not-found.tsx"]) {
    assert.doesNotMatch(readFileSync(join(repo, path), "utf8"), /import Footer|<Footer/);
  }
});

test("actual EN/HU/KO Home and Brands routes render their selected body and directory labels", async () => {
  for (const locale of ["en", "hu", "ko"]) {
    const props = { params: Promise.resolve({ locale }) };
    const home = render(await LocalizedHome(props));
    const brands = render(await LocalizedBrands(props));
    const copy = marketingCopy[locale];
    assert.ok(home.includes(`lang="${locale}"`));
    assert.ok(brands.includes(`lang="${locale}"`));
    for (const value of [copy.hero.heading, copy.hero.description, copy.hero.shop,
      ...copy.hero.trust, copy.featured.eyebrow, copy.featured.heading, copy.featured.headingEnd,
      copy.featured.description, ...[copy.featured.roundLab, copy.featured.anua, copy.featured.skin1004].flatMap(item => [item.tagline, item.description]),
      copy.why.heading, copy.why.description, ...copy.why.points.flatMap(item => [item.title, item.description])]) {
      assert.ok(home.includes(value), `${locale} missing body string: ${value}`);
    }
    for (const value of [copy.brands.heading, copy.brands.description, copy.directory.browse,
      copy.directory.searchLabel, copy.directory.searchPlaceholder, copy.directory.filterLabel,
      copy.directory.alphabet, copy.directory.all, copy.directory.resultMany.replace("{count}", "16"),
      copy.directory.information, copy.directory.unpublished]) {
      assert.ok(brands.includes(value), `${locale} missing directory string: ${value}`);
    }
    for (const brand of brandNames) assert.ok(!brands.includes(`>${brand}</a>`), brand);
    assert.equal((brands.match(/aria-pressed=/g) ?? []).length, 27);
    assert.ok(!home.includes('href="#"'));
    assert.equal((home.match(/<button/g) ?? []).length, 0);
    assert.ok(!home.includes(copy.hero.routine));
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

test("Home keeps editorial cards but Discover links require published products, retaining locale and brand criteria", async () => {
  const content = publishedCatalogueFixtures[0].translations;
  const catalogue = createLocalCatalogueReader([publishedCatalogueFixtures[0],
    { ...publishedCatalogueFixtures[1], brand: "Anua" },
    { publicId: "52345678-abcd-1234-abcd-123456789abc", brand: "SKIN1004", slug: "test-only-featured", state: "published", translations: { en: content.en, hu: null, ko: null } }]);
  for (const locale of [null, "en", "hu", "ko"]) {
    const home = render(locale === null ? Home() : await LocalizedHome({ params: Promise.resolve({ locale }) }));
    const links = [...home.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)];
    assert.equal(links.length, 1);
    assert.equal(links[0][1], storefrontHref("/products", locale));
    assert.ok(links[0][2].includes(marketingCopy[locale ?? "en"].hero.shop));
    const featured = renderToStaticMarkup(FeaturedBrands({ catalogue, locale: locale ?? "en", routeLocale: locale }));
    const featuredLinks = [...featured.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)];
    assert.equal(featuredLinks.length, 2); // Draft-only Anua has no action.
    assert.equal((featured.match(/<article/g) ?? []).length, 3);
    for (const [index, brand] of ["Round Lab", "SKIN1004"].entries()) {
      const url = new URL(featuredLinks[index][1], "http://localhost");
      assert.equal(url.pathname, storefrontHref("/products", locale));
      const criteria = readCatalogueCriteria(Object.fromEntries(url.searchParams));
      assert.deepEqual(criteria, { query: "", brand });
      assert.ok(brandNames.includes(criteria.brand));
      const listing = renderToStaticMarkup(ProductListing({ catalogue, locale: locale ?? "en", routeLocale: locale, criteria }));
      assert.ok(listing.includes(`<option value="${brand}" selected="">${brand}</option>`));
      assert.ok(!listing.includes(storefrontLabels[locale ?? "en"].noResults));
      assert.ok(listing.includes(`action="${storefrontHref("/products", locale)}"`));
      for (const destination of ["en", "hu", "ko"]) {
        const switched = new URL(switchLocalePath(url.pathname + url.search, destination), "http://localhost");
        assert.equal(switched.pathname, `/${destination}/products`);
        assert.equal(switched.searchParams.get("brand"), brand);
      }
    }
    assert.ok(!home.includes(`<button`));
    assert.ok(!home.includes(marketingCopy[locale ?? "en"].hero.routine));
    assert.ok(!home.includes('<a href="#"'));
  }
});

test("Header removes unimplemented English menus without changing existing navigation authority", () => {
  const source = readFileSync(join(repo, "components/layout/Header.tsx"), "utf8");
  for (const label of ["Skin Concerns", "Best Sellers", "New Arrivals", "Why HanaPure"]) {
    assert.ok(!source.includes(label));
  }
});

test("all 16 directory links retain exact brand identity, legacy/locale routing, and existing catalogue behavior", async () => {
  const catalogue = createLocalCatalogueReader(brandNames.map((brand, index) => ({
    publicId: `${String(index + 1).padStart(8, "0")}-abcd-1234-abcd-123456789abc`,
    brand, slug: `test-only-${index}`, state: "published",
    translations: { en: { name: "TEST ONLY", description: "Fictional fixture", images: [], usage: null, caution: null }, hu: null, ko: null },
  })));
  for (const locale of [null, "en", "hu", "ko"]) {
    const html = render({ type: BrandsContent, props: { catalogue, locale: locale ?? "en", routeLocale: locale } });
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
  assert.match(source, /brand\.productsHref !== null \? <Link href=\{brand\.productsHref\}/);
  // Existing search/A-Z filters informational rows and genuine links together.
  assert.match(source, /matchingBrands[\s\S]*?\.filter\(\(brand\) => brand\.name\[0\]\.toUpperCase\(\) === letter\)[\s\S]*?\.map\(\(brand\)/);
});

test("directory links and catalogue options derive only published brands while names remain informational", () => {
  const catalogue = createLocalCatalogueReader([...publishedCatalogueFixtures,
    { ...publishedCatalogueFixtures[1], publicId: "42345678-abcd-1234-abcd-123456789abc", brand: "Anua", slug: "test-only-draft-brand" }]);
  for (const locale of ["en", "hu", "ko"]) {
    const html = render({ type: BrandsContent, props: { catalogue, locale, routeLocale: locale } });
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)];
    assert.deepEqual(links.map(link => link[2]), ["beplain", "Round Lab"]);
    assert.ok(!html.includes('>Anua</a>'));
    assert.ok(html.includes(marketingCopy[locale].directory.resultMany.replace("{count}", "16")));
    assert.equal((html.match(/<li\b/g) ?? []).length, 16);
    assert.equal(html.split(marketingCopy[locale].directory.unpublished).length - 1, 14);
    const listing = renderToStaticMarkup(ProductListing({ catalogue, locale, routeLocale: locale }));
    const brandOptions = listing.match(/<select\b[^>]*id="catalogue-brand"[^>]*>([\s\S]*?)<\/select>/)?.[1];
    assert.ok(brandOptions);
    assert.deepEqual([...brandOptions.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]), ["", "beplain", "Round Lab"]);
    const historical = renderToStaticMarkup(ProductListing({ catalogue, locale, routeLocale: locale,
      criteria: { query: "TEST ONLY", brand: "Anua" } }));
    assert.ok(historical.includes('<option value="Anua" selected="">Anua</option>'));
    assert.ok(historical.includes(storefrontLabels[locale].noResults));
    assert.ok(historical.includes('value="TEST ONLY"'));
  }
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

test("WEB31 empty public directory lists exactly 16 configured identities without product actions in all routes", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", labels = marketingCopy[locale].directory;
    const html = render(routeLocale === null ? Brands() : await LocalizedBrands({ params: Promise.resolve({ locale }) }));
    const rows = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map(match => match[1]);
    assert.equal(rows.length, 16);
    const names = rows.map(row => row.match(/<span>(.*?)<\/span>/s)?.[1]);
    assert.deepEqual(names, [...brandNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en")));
    assert.equal(new Set(names.map(name => name.toLowerCase())).size, 16);
    for (const row of rows) {
      assert.ok(row.includes(labels.unpublished));
      assert.doesNotMatch(row, /<(?:a|button)\b|href=|tabindex=|role=|cursor-pointer|hover:/);
    }
    assert.doesNotMatch(html, /<a\b/);
    assert.ok(html.includes(labels.information));
    assert.match(html, /aria-live="polite"[^>]*>16|aria-live="polite"[^>]*>브랜드 16/);
    if (locale !== "en") assert.ok(!html.includes(marketingCopy.en.directory.unpublished));
  }
});

test("WEB31 an unconfigured published reader value cannot create an authoritative directory row or link", () => {
  const unknown = { ...publishedCatalogueFixtures[0], brand: '<unknown-brand>' };
  assert.throws(() => createLocalCatalogueReader([unknown]), /invalid_brand/);
  const base = createLocalCatalogueReader([publishedCatalogueFixtures[0]]);
  // Adversarial reader injection is test-only; the real validated reader rejects it.
  const catalogue = { ...base, listPublished: () => [...base.listPublished(), unknown] };
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const html = render({ type: BrandsContent, props: { catalogue, locale: routeLocale ?? "en", routeLocale } });
    assert.doesNotMatch(html, /unknown-brand/);
    assert.equal((html.match(/<li\b/g) ?? []).length, 16);
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)];
    assert.deepEqual(links.map(link => link[2]), ["Round Lab"]);
    assert.equal(links[0][1], storefrontHref("/products", routeLocale) + "?brand=Round+Lab");
  }
});

test("WEB31 actual directory handlers preserve safe search letter reset counts and native keyboard affordances", async () => {
  // Instrument only useState in an in-memory transpilation of the actual source.
  // This exercises real handlers/filtering, not browser hydration or Tab/focus.
  const stateURL = "data:text/javascript," + encodeURIComponent(`
    let values=[], cursor=0;
    export function reset(){values=[];cursor=0;}
    export function begin(){cursor=0;}
    export function useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;
      return [values[i], value=>{values[i]=value;}];}
  `);
  const state = await import(stateURL);
  const source = readFileSync(join(repo, "components/brands/BrandDirectory.tsx"), "utf8");
  assert.ok(source.includes('import { useState } from "react";'));
  const compiled = ts.transpileModule(source.replace('import { useState } from "react";', `import { useState } from ${JSON.stringify(stateURL)};`), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace('from "next/link"', `from ${JSON.stringify(pathToFileURL(require.resolve("next/link.js")).href)}`);
  const { default: Directory } = await import("data:text/javascript," + encodeURIComponent(compiled));
  const nodes = node => node == null || typeof node !== "object" ? [node] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const label = node => nodes(node.props.children).filter(value => typeof value === "string").join("");
  for (const locale of ["en", "hu", "ko"]) {
    state.reset();
    const props = { labels: marketingCopy[locale].directory,
      brands: brandNames.map(name => ({ name, productsHref: null })) };
    const view = () => { state.begin(); return nodes(Directory(props)); };
    const count = tree => label(tree.find(node => node?.props?.["aria-live"] === "polite"));
    const rows = tree => tree.filter(node => node?.type === "li");
    const button = (tree, text) => tree.find(node => node?.type === "button" && label(node) === text);
    let tree = view();
    assert.equal(rows(tree).length, 16);
    for (const node of tree.filter(node => node?.type === "button")) {
      assert.equal(node.props.type, "button");
      assert.equal(node.props.tabIndex, undefined);
      assert.equal(node.props.onKeyDown, undefined); // Native Enter/Space activation retained.
      assert.match(node.props.className, /focus-visible:/);
    }
    assert.equal(button(tree, "Z").props.disabled, true);
    assert.equal(button(tree, "R").props.disabled, false);
    tree.find(node => node?.type === "input").props.onChange({ target: { value: "  rOuNd  " } });
    tree = view(); assert.equal(rows(tree).length, 1);
    assert.equal(count(tree), props.labels.resultOne.replace("{count}", "1"));
    button(tree, "A").props.onClick(); tree = view();
    assert.equal(rows(tree).length, 0);
    assert.equal(count(tree), props.labels.resultMany.replace("{count}", "0"));
    assert.ok(tree.some(node => node === props.labels.empty));
    assert.equal(button(tree, "A").props["aria-pressed"], true);
    tree.find(node => node?.type === "input").props.onChange({ target: { value: "" } });
    tree = view(); assert.equal(rows(tree).length, 3); // Abib, Anua, AXIS-Y.
    button(tree, props.labels.all).props.onClick(); tree = view();
    assert.equal(rows(tree).length, 16);
    assert.equal(button(tree, props.labels.all).props["aria-pressed"], true);
    tree.find(node => node?.type === "input").props.onChange({ target: { value: "<script>alert(1)</script>" } });
    tree = view(); assert.equal(rows(tree).length, 0);
    assert.equal(count(tree), props.labels.resultMany.replace("{count}", "0"));
    // Duplicate input cannot duplicate a name; sorting does not mutate caller data.
    state.reset(); props.brands = [...props.brands].reverse(); props.brands.push(props.brands[0]);
    const before = [...props.brands]; tree = view();
    assert.equal(rows(tree).length, 16); assert.deepEqual(props.brands, before);
  }
});
