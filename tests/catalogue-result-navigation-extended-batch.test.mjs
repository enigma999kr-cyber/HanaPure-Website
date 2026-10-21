import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { discoverCatalogue, catalogueQueryString, readCatalogueCriteria } from "../lib/catalog/catalogue-discovery.ts";
import { CATALOGUE_PAGE_SIZE, readCatalogueBrowse, catalogueResultPage, catalogueBrowseQuery, catalogueBrowseHref, catalogueCardId } from "../lib/catalog/catalogue-browse.ts";
import { storefrontLabels, switchLocalePath } from "../lib/storefront/localization.ts";
import { publishedComparison, comparisonHref, comparisonShareLink, COMPARISON_DESTINATION } from "../lib/comparison/compare-selection.ts";

// Existing installed TypeScript / react-server resolver convention; no browser or runner.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return { url: reactEntry, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: jsxEntry, shortCircuit: true };
    if (specifier === "react-dom") return { url: pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "index.js")).href, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation") return nextResolve("next/dist/client/components/navigation.react-server.js", context);
    if (specifier.startsWith("@/")) specifier = pathToFileURL(join(repo, specifier.slice(2))).href;
    try { return nextResolve(specifier, context); } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      for (const extension of [".ts", ".tsx"]) { try { return nextResolve(specifier + extension, context); } catch { /* Next extension. */ } }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText };
    return nextLoad(url, context);
  },
});
const { ProductListing, ProductDetail } = await import("../components/catalogue/ProductCatalogue.tsx");
const { default: PairPicker } = await import("../components/catalogue/CatalogueResultPairPicker.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { default: QuickAdd } = await import("../components/cart/QuickAdd.tsx");
const { default: CopySearchLink } = await import("../components/catalogue/CopySearchLink.tsx");
const identity = number => `${number.toString(16).padStart(8, "0")}-abcd-1234-abcd-123456789abc`;
function record(index, state = "published") {
  const content = (locale, image) => ({ name: `${locale === "hu" ? "Árvíz" : locale === "ko" ? "가상" : "Fixture"} ${index % 3}`,
    description: `Synthetic ${locale} fixture only.`, images: image ? [{ src: `/fixtures/test-${index}.webp`, alt: "Synthetic test image" }] : [], usage: null, caution: null });
  return { publicId: identity(index), slug: `test-${String(index).padStart(3, "0")}`, brand: index % 2 ? "Anua" : "beplain", state,
    translations: { en: content("en", index % 2 === 0), hu: index % 3 ? content("hu", index % 2 === 0) : null,
      ko: index % 4 ? content("ko", index % 5 === 0) : null } };
}
const records = Array.from({ length: 37 }, (_, index) => record(index + 1));
const draft = record(100, "draft");
const catalogue = createLocalCatalogueReader([...records, draft]);
const criteria = { query: "", brand: "" };
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = tree => nodes(tree).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const cards = tree => nodes(tree).filter(node => node.type === "li" && nodes(node).some(child => child.type === QuickAdd));
const links = tree => nodes(tree).filter(node => typeof node.props?.href === "string");
const listing = (params = {}, locale = "en", routeLocale = locale, reader = catalogue) => ProductListing({ catalogue: reader,
  criteria: readCatalogueCriteria(params), browse: readCatalogueBrowse(params), locale, routeLocale });
const parseHref = href => {
  const url = new URL(href, "https://synthetic.invalid");
  return { url, params: Object.fromEntries([...url.searchParams.keys()].map(key => [key, url.searchParams.getAll(key).length > 1 ? url.searchParams.getAll(key) : url.searchParams.get(key)])) };
};
const findLink = (tree, label) => links(tree).find(link => text(link) === label);

test("F1 0/1/12/13/25/37 published results have truthful ranges, 12-card pages and safe clamping", () => {
  assert.equal(CATALOGUE_PAGE_SIZE, 12);
  for (const count of [0, 1, 12, 13, 25, 37]) {
    const reader = createLocalCatalogueReader([...records.slice(0, count), draft]);
    for (const page of [1, 2, 3, 999999]) {
      const browse = readCatalogueBrowse({ page: String(page) });
      const result = catalogueResultPage(discoverCatalogue(reader, "en", criteria), "en", browse);
      assert.equal(result.total, count); assert.equal(result.pages, Math.max(1, Math.ceil(count / 12)));
      assert.equal(result.page, Math.min(page, result.pages));
      assert.equal(result.from, count ? (result.page - 1) * 12 + 1 : 0);
      assert.equal(result.to, Math.min(result.page * 12, count));
      assert.equal(result.items.length, count ? result.to - result.from + 1 : 0);
      const tree = listing({ page: String(page) }, "en", null, reader);
      assert.equal(cards(tree).length, result.items.length);
      assert.ok(text(tree).replace(/\s*:\s*/g, ": ").includes(`${storefrontLabels.en.results}: ${count}`));
      assert.ok(!cards(tree).some(card => card.props.id === catalogueCardId(draft.publicId)));
    }
  }
});

test("F1 strict page and literal flags normalize invalid/repeated/noncanonical/huge presentation parameters", () => {
  for (const page of [undefined, "", "0", "-1", "01", "1.0", "1e2", " 2", "2 ", "1000000", "9".repeat(9000), ["2"], ["2", "3"]]) assert.equal(readCatalogueBrowse({ page }).page, 1);
  assert.equal(readCatalogueBrowse({ page: "2" }).page, 2);
  for (const flag of [undefined, "", "true", "01", "0", ["1"], ["1", "1"], 1]) {
    assert.equal(readCatalogueBrowse({ withLocaleInfo: flag }).withLocaleInfo, false);
    assert.equal(readCatalogueBrowse({ withLocaleImage: flag }).withLocaleImage, false);
  }
  assert.equal(readCatalogueBrowse({ withLocaleInfo: "1", withLocaleImage: "1" }).withLocaleInfo, true);
});

test("F2 selected-locale presence/image filters default inclusive, combine before paging and never borrow English", () => {
  for (const locale of ["en", "hu", "ko"]) for (const withLocaleInfo of [false, true]) for (const withLocaleImage of [false, true]) {
    const browse = { ...readCatalogueBrowse(), withLocaleInfo, withLocaleImage };
    const expected = records.filter(product => (!withLocaleInfo || product.translations[locale] !== null) && (!withLocaleImage || product.translations[locale]?.images.length));
    const result = catalogueResultPage(discoverCatalogue(catalogue, locale, criteria), locale, browse);
    assert.equal(result.total, expected.length); assert.deepEqual(result.all.map(product => product.publicId), expected.map(product => product.publicId));
    assert.ok(result.items.length <= 12);
    const tree = listing({ ...(withLocaleInfo ? { withLocaleInfo: "1" } : {}), ...(withLocaleImage ? { withLocaleImage: "1" } : {}) }, locale);
    const controls = nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox" && node.props.name);
    assert.deepEqual(controls.map(node => [node.props.name, node.props.value, node.props.defaultChecked]), [["withLocaleInfo", "1", withLocaleInfo], ["withLocaleImage", "1", withLocaleImage]]);
    assert.ok(!nodes(tree).some(node => node.type === "input" && ["page", "pickFirst"].includes(node.props.name)));
    assert.equal(nodes(tree).find(node => node.type === "form").props.method, "get");
  }
});

test("F1/F2 existing Unicode discovery and stable name-sort ties remain authoritative; duplicate aliases cannot fill pages", () => {
  const selected = readCatalogueCriteria({ q: "  ÁRVÍZ  ", sort: "name-desc" });
  const sorted = discoverCatalogue(catalogue, "hu", selected);
  const view = catalogueResultPage(sorted, "hu", readCatalogueBrowse({ page: "2" }));
  assert.deepEqual(view.all, sorted); assert.ok(view.all.every(product => product.translations.hu));
  for (let index = 1; index < sorted.length; index++) if (sorted[index - 1].translations.hu.name === sorted[index].translations.hu.name) assert.ok(sorted[index - 1].slug < sorted[index].slug);
  const duplicate = { ...records[0], publicId: records[0].publicId.toUpperCase() };
  assert.equal(catalogueResultPage([...records, duplicate], "en", readCatalogueBrowse()).total, records.length);
});

test("F1/F2 EN/HU/KO and legacy native pagination carries only applied criteria/refinements and bounded first hint", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", root = routeLocale ? `/${locale}/products` : "/products";
    const params = { q: "Anua", sort: "name-desc", withLocaleInfo: "1", page: "2", pickFirst: records[0].publicId };
    const tree = listing(params, locale, routeLocale), label = storefrontLabels[locale];
    const prev = findLink(tree, label.previousPage);
    // KO/HU may have <=12 matching items: clamped first page legitimately has no previous link.
    for (const link of links(tree).filter(node => node.props.rel === "prev" || node.props.rel === "next")) {
      assert.ok(link.props.href.startsWith(root)); assert.ok(link.props.href.length <= 8192);
      assert.equal(link.props.onClick, undefined);
      const parsed = parseHref(link.props.href);
      assert.equal(parsed.params.q, "Anua"); assert.equal(parsed.params.sort, "name-desc"); assert.equal(parsed.params.withLocaleInfo, "1");
      assert.equal(parsed.params.pickFirst, records[0].publicId);
    }
    if (locale === "en") assert.ok(prev);
  }
  assert.equal(catalogueBrowseQuery("?q=" + "x".repeat(8192), readCatalogueBrowse()), null);
  assert.equal(catalogueBrowseHref("//evil.invalid/products", "", readCatalogueBrowse()), null);
  assert.equal(catalogueBrowseHref("/products", "?q=" + "x".repeat(8180), readCatalogueBrowse()).length, 8192);
  assert.equal(catalogueBrowseHref("/products", "?q=" + "x".repeat(8181), readCatalogueBrowse()), null);
});

test("F2 changed search/brand/sort/chip/refinement reset page and pending selection; locale switch drops only pending hint", () => {
  const tree = listing({ page: "2", pickFirst: records[0].publicId, q: "Anua", sort: "name-asc", withLocaleInfo: "1" });
  const labels = storefrontLabels.en;
  const changing = links(tree).filter(link => link.props["aria-label"]?.startsWith(labels.removeFilter) || (link.props.href.includes("brand=") && !link.props.rel));
  assert.ok(changing.length > 0);
  for (const link of changing) { const { params } = parseHref(link.props.href); assert.equal(params.page, undefined); assert.equal(params.pickFirst, undefined); }
  const form = nodes(tree).find(node => node.type === "form");
  assert.ok(!nodes(form).some(node => node.props?.name === "page" || node.props?.name === "pickFirst"));
  const switched = switchLocalePath(`/en/products?q=%EA%B0%80%EC%83%81&sort=name-asc&page=2&withLocaleInfo=1&pickFirst=${records[0].publicId}#catalogue-search`, "hu");
  const parsed = parseHref(switched);
  assert.equal(parsed.params.pickFirst, undefined); assert.equal(parsed.params.q, "가상"); assert.equal(parsed.params.withLocaleInfo, "1"); assert.equal(parsed.url.hash, "#catalogue-search");
});

test("F1/F2 canonical presentation serialization round-trips Unicode criteria, both flags, page and only one public hint", () => {
  const original = readCatalogueCriteria({ q: "  Árvíz 한국 & ?/#  ", brand: "Anua", sort: "name-desc" });
  const browse = readCatalogueBrowse({ page: "3", withLocaleInfo: "1", withLocaleImage: "1", pickFirst: records[0].publicId });
  const query = catalogueBrowseQuery(catalogueQueryString(original), browse);
  const parsed = parseHref("/hu/products" + query);
  assert.deepEqual(readCatalogueCriteria(parsed.params), original);
  assert.deepEqual(readCatalogueBrowse(parsed.params), browse);
  assert.deepEqual([...parsed.url.searchParams.keys()], ["q", "brand", "sort", "withLocaleInfo", "withLocaleImage", "page", "pickFirst"]);
  assert.ok(query.length <= 8192);
  const reset = catalogueBrowseQuery(catalogueQueryString(original), { ...browse, page: 1, pickFirst: undefined });
  assert.equal(new URLSearchParams(reset).has("page"), false); assert.equal(new URLSearchParams(reset).has("pickFirst"), false);
});

test("F3 explicit first/second cross-page links retain click order and strict CLOSED comparison/share contract", () => {
  for (const locale of ["en", "hu", "ko"]) {
    let tree = listing({}, locale), labels = storefrontLabels[locale];
    const first = links(cards(tree)[0]).find(link => text(link) === labels.chooseFirstResult);
    assert.ok(first); assert.equal(first.props.onClick, undefined);
    const firstParams = parseHref(first.props.href).params;
    tree = listing({ ...firstParams, page: "2" }, locale);
    assert.ok(text(tree).includes(labels.firstResultSelected));
    const cancel = findLink(tree, labels.cancelFirstResult); assert.equal(parseHref(cancel.props.href).params.pickFirst, undefined);
    const second = links(cards(tree)[0]).find(link => text(link) === labels.chooseSecondResult);
    assert.ok(second);
    const parsed = parseHref(second.props.href);
    assert.equal(parsed.params.compareFirst, records[0].publicId);
    assert.equal(parsed.params.compareSecond, records[12].publicId);
    assert.equal(parsed.params.page, undefined); assert.equal(parsed.params.pickFirst, undefined); assert.equal(parsed.params.withLocaleInfo, undefined);
    assert.equal(parsed.url.hash, `#${COMPARISON_DESTINATION}`);
    const comparison = nodes(tree).find(node => node.type === ProductComparison);
    assert.equal(comparison.props.products.length, records.length);
    assert.ok(comparisonShareLink(second.props.href, "https://synthetic.invalid", comparison.props.products));
    const expected = publishedComparison(comparison.props.products, { first: records[0].publicId, second: records[12].publicId });
    assert.equal(second.props.href, comparisonHref(`/${locale}/products`, expected) + `#${COMPARISON_DESTINATION}`);
  }
});

test("F3 malformed/private/filtered/duplicate first hints rejected; zero/one cannot invent an explicit pair", () => {
  for (const pickFirst of ["bad", records[0].publicId.toUpperCase(), [records[0].publicId], [records[0].publicId, records[1].publicId], draft.publicId, identity(999)]) {
    const tree = listing({ pickFirst }); assert.ok(!text(tree).includes(storefrontLabels.en.firstResultSelected));
    assert.ok(!findLink(tree, storefrontLabels.en.chooseSecondResult));
  }
  const tree = listing({ pickFirst: records[0].publicId, brand: "beplain" });
  assert.ok(!text(tree).includes(storefrontLabels.en.firstResultSelected));
  assert.ok(!text(listing({ pickFirst: records[2].publicId, withLocaleInfo: "1" }, "hu")).includes(storefrontLabels.hu.firstResultSelected));
  assert.ok(!text(listing({ pickFirst: records[0].publicId, withLocaleImage: "1" })).includes(storefrontLabels.en.firstResultSelected));
  for (const count of [0, 1]) {
    const tree = listing({ pickFirst: records[0].publicId }, "en", null, createLocalCatalogueReader(records.slice(0, count)));
    assert.ok(!findLink(tree, storefrontLabels.en.chooseFirstResult)); assert.ok(!findLink(tree, storefrontLabels.en.chooseSecondResult));
  }
  const valid = listing({ pickFirst: records[0].publicId });
  assert.ok(!findLink(cards(valid)[0], storefrontLabels.en.chooseSecondResult));
});

test("F1/F3 current-page checkbox island stays page-local while full public comparison projection remains available", () => {
  const tree = listing({ page: "3" });
  const picker = nodes(tree).find(node => node.type === PairPicker), compare = nodes(tree).find(node => node.type === ProductComparison);
  assert.equal(picker.props.products.length, 12); assert.equal(compare.props.products.length, 37);
  assert.deepEqual(picker.props.products.map(product => product.publicId), records.slice(24, 36).map(product => product.publicId));
  assert.ok(picker.props.products.every(product => Object.keys(product).sort().join(",") === "name,publicId"));
});

test("F4 listing -> detail -> Back restores exact locale/page/card; adjacent page crossover derives next Back page", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", root = routeLocale ? `/${locale}/products` : "/products";
    const tree = listing({ page: "2" }, locale, routeLocale), card = cards(tree)[0];
    assert.equal(card.props.id, catalogueCardId(records[12].publicId)); assert.equal(card.props.tabIndex, -1); assert.match(card.props.className, /scroll-mt-24.*focus-visible:outline/);
    const target = links(card).find(link => link.props.href.startsWith(`${root}/${records[12].slug}`));
    const parsed = parseHref(target.props.href);
    const detail = ProductDetail({ slug: records[12].slug, catalogue, locale, routeLocale, criteria: readCatalogueCriteria(parsed.params), browse: readCatalogueBrowse(parsed.params) });
    const back = findLink(detail, storefrontLabels[locale].back);
    assert.equal(back.props.href, `${root}?page=2#${card.props.id}`);
    const previous = links(detail).find(link => link.props["aria-label"]?.startsWith(storefrontLabels[locale].previousMatch + ":"));
    assert.equal(previous.props.href, `${root}/${records[11].slug}?page=1`);
    const prevDetail = ProductDetail({ slug: records[11].slug, catalogue, locale, routeLocale, browse: readCatalogueBrowse(parseHref(previous.props.href).params) });
    assert.equal(findLink(prevDetail, storefrontLabels[locale].back).props.href, `${root}?page=1#${catalogueCardId(records[11].publicId)}`);
  }
});

test("F4 refined ordered neighbours use actual result position, separate Cart/comparison returns, no stale/private anchor", () => {
  const params = { q: "Anua", sort: "name-desc", withLocaleImage: "1", page: "999999" };
  // Odd Anua fixtures have no English image: current product is intentionally filtered out.
  const detail = ProductDetail({ slug: records[0].slug, catalogue, criteria: readCatalogueCriteria(params), browse: readCatalogueBrowse(params), cartReturn: true,
    comparisonContext: { first: records[0].publicId, second: records[1].publicId } });
  assert.ok(!findLink(detail, storefrontLabels.en.back).props.href.includes("#"));
  assert.ok(!nodes(detail).some(node => node.type === "nav" && node.props["aria-label"] === storefrontLabels.en.matchingNavigation));
  assert.ok(links(detail).some(link => link.props.href === "/cart"));
  const comparisonBack = links(detail).find(link => link.props.href.includes("compareFirst="));
  assert.ok(comparisonBack); assert.ok(!comparisonBack.props.href.includes("withLocaleImage"));
  const refined = { sort: "name-asc", withLocaleInfo: "1", withLocaleImage: "1", page: "2" };
  const ordered = catalogueResultPage(discoverCatalogue(catalogue, "hu", readCatalogueCriteria(refined)), "hu", readCatalogueBrowse(refined)).all;
  const product = ordered[1];
  const shown = ProductDetail({ slug: product.slug, catalogue, locale: "hu", routeLocale: "hu", criteria: readCatalogueCriteria(refined), browse: readCatalogueBrowse(refined), cartReturn: true,
    comparisonContext: { first: product.publicId, second: ordered[0].publicId } });
  const back = findLink(shown, storefrontLabels.hu.back);
  assert.equal(parseHref(back.props.href).params.page, "1"); assert.equal(parseHref(back.props.href).url.hash, `#${catalogueCardId(product.publicId)}`);
  for (const adjacent of links(shown).filter(link => link.props["aria-label"]?.startsWith(storefrontLabels.hu.previousMatch + ":") || link.props["aria-label"]?.startsWith(storefrontLabels.hu.nextMatch + ":"))) {
    const parsed = parseHref(adjacent.props.href);
    assert.equal(parsed.params.withLocaleInfo, "1"); assert.equal(parsed.params.withLocaleImage, "1");
    assert.equal(parsed.params.cartReturn, undefined); assert.equal(parsed.params.compareFirst, undefined); assert.equal(parsed.params.pickFirst, undefined);
  }
  const direct = ProductDetail({ slug: records[0].slug, catalogue });
  assert.equal(findLink(direct, storefrontLabels.en.back).props.href, "/products");
  for (const slug of [draft.slug, "unknown"]) assert.throws(() => ProductDetail({ slug, catalogue }), /NEXT_HTTP_ERROR_FALLBACK;404/);
});

test("Boundaries: unchanged SEO route authorities, no new stores/operational fields, full public projection and locale keys", () => {
  for (const path of ["app/products/page.tsx", "app/products/[slug]/page.tsx", "app/[locale]/products/page.tsx", "app/[locale]/products/[slug]/page.tsx"]) {
    const source = readFileSync(join(repo, path), "utf8");
    assert.match(source, /readCatalogueBrowse\(query\)/); assert.match(source, /browse[=:,]/);
    const metadata = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default"));
    assert.doesNotMatch(metadata, /readCatalogueBrowse|catalogueBrowseQuery|pickFirst|withLocaleInfo/);
    assert.match(metadata, /listingMetadata|productMetadata/);
  }
  const utility = readFileSync(join(repo, "lib/catalog/catalogue-browse.ts"), "utf8");
  assert.doesNotMatch(utility, /localStorage|sessionStorage|fetch\(|window|basePrice|sellableStock|operationalReady/);
  assert.match(readFileSync(join(repo, "data/catalogue.ts"), "utf8"), /Object.freeze\(\[\]\)/);
  assert.deepEqual(Object.keys(storefrontLabels.en).sort(), Object.keys(storefrontLabels.hu).sort());
  assert.deepEqual(Object.keys(storefrontLabels.en).sort(), Object.keys(storefrontLabels.ko).sort());
  assert.equal(catalogueBrowseQuery("?q=Anua&sort=name-asc", readCatalogueBrowse()), "?q=Anua&sort=name-asc");
  assert.ok(!nodes(listing({ withLocaleInfo: "1" })).some(node => node.type === CopySearchLink), "do not misrepresent a refined view through the CLOSED q/brand/sort-only clipboard protocol");
});
