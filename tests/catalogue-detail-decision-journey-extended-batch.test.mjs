import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { discoverCatalogue, catalogueQueryString, readCatalogueCriteria } from "../lib/catalog/catalogue-discovery.ts";
import { readComparisonContext, COMPARISON_DESTINATION } from "../lib/comparison/compare-selection.ts";
import { storefrontLabels, storefrontHref } from "../lib/storefront/localization.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { favoriteLabels } from "../lib/favorites/labels.ts";
import { comparisonLabels } from "../lib/comparison/labels.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites, MAX_FAVORITES } from "../lib/favorites/favorite-state.ts";
import { RECENT_STORAGE_KEY, serializeRecent } from "../lib/recently-viewed/recent-state.ts";

// Reuse the installed TypeScript/Node JSX fixture pattern, with a tiny context bridge.
// This is not a browser, a new runner, or actual native disclosure/focus evidence.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot = dirname(require.resolve("react/package.json"));
const reactEntry = pathToFileURL(join(reactRoot, "index.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export {createContext} from '${reactEntry}';
export const driver={instances:new Map(),active:[],index:0,contexts:new Map(),subscriptions:new Map(),serial:0};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}
export function useContext(context){return driver.contexts.get(context)??null;}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/(catalogue\/(CatalogueResultPairPicker|SaveProductButton)|cart\/QuickAdd)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
    if (specifier === "react") return { url: reactEntry, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: pathToFileURL(join(reactRoot, "jsx-runtime.js")).href, shortCircuit: true };
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
const { driver } = await import(hooksUrl);
const { ProductListing, ProductDetail } = await import("../components/catalogue/ProductCatalogue.tsx");
const { default: CatalogueResultPairPicker, CatalogueResultPairCheckbox } = await import("../components/catalogue/CatalogueResultPairPicker.tsx");
const { default: QuickAdd } = await import("../components/cart/QuickAdd.tsx");
const { default: SaveProductButton } = await import("../components/catalogue/SaveProductButton.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { default: ProductMediaGallery } = await import("../components/catalogue/ProductMediaGallery.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts"), favorites = await import("../lib/favorites/browser-favorites.ts");
const ids = Array.from({ length: 7 }, (_, index) => `${index + 1}2345678-abcd-1234-abcd-123456789abc`);
const content = (locale, name, description = "match group") => ({ name: `${locale} ${name}`, description,
  images: [{ src: `/synthetic/${locale}-${name}.webp`, alt: `${locale} ${name} editorial image` }],
  usage: `${locale} synthetic usage.`, caution: `${locale} synthetic caution.\n${"Full warning text. ".repeat(500)}` });
const record = (index, name, patch = {}) => ({ publicId: ids[index], slug: name.toLowerCase(), brand: "Anua", state: "published",
  translations: { en: content("en", name), hu: content("hu", name), ko: content("ko", name) }, ...patch });
const records = [record(0, "Alpha"), record(1, "Beta"), record(2, "Gamma", { translations: { en: content("en", "Gamma", "other"), hu: null, ko: null } }),
  record(3, "Delta"), record(4, "Epsilon"), record(5, "Zeta", { brand: "beplain" }), record(6, "Private", { state: "draft" })];
const catalogue = createLocalCatalogueReader(records);
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  driver.active = driver.instances.get(key); driver.index = 0; return component(props);
}
function picker(props, key = "picker") {
  const tree = render(CatalogueResultPairPicker, props, key);
  driver.contexts.clear();
  if (tree.props.value) driver.contexts.set(tree.type._context ?? tree.type, tree.props.value);
  return tree;
}
function checkbox(publicId) {
  const tree = render(CatalogueResultPairCheckbox, { publicId });
  return tree && nodes(tree).find(node => node.type === "input");
}
const pick = (publicId, checked = true) => checkbox(publicId).props.onChange({ target: { checked } });
const pickerElement = (criteria = { query: "", brand: "" }, locale = "en", routeLocale = locale, reader = catalogue) =>
  nodes(ProductListing({ catalogue: reader, locale, routeLocale, criteria })).find(node => node.type === CatalogueResultPairPicker);
async function stores(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart([{ publicId: ids[0], quantity: 2 }])], [FAVORITES_STORAGE_KEY, serializeFavorites([])], [RECENT_STORAGE_KEY, serializeRecent([])]]);
  const writes = [], navigation = [], events = new Set(), control = { readDenied: null, writeDenied: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { assign: href => navigation.push(href) }, localStorage: {
      getItem(key) { if (control.readDenied === key) throw new Error("synthetic read denial"); return values.get(key) ?? null; },
      setItem(key, value) { if (control.writeDenied === key) throw new Error("synthetic write denial"); writes.push(key); values.set(key, value); },
    }, addEventListener(type, callback) { if (type === "storage") events.add(callback); }, removeEventListener(type, callback) { if (type === "storage") events.delete(callback); },
  } });
  driver.instances.clear(); driver.contexts.clear(); browserCart.useBrowserCart(); favorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key })); notify(null);
  try { await run({ values, writes, control, notify, navigation }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.instances.clear(); driver.contexts.clear();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

test("F1 only filtered published IDs/names enter the island; original single-entry Compare stays separate", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const criteria = { query: "match", brand: "Anua", sort: "name-desc" }, element = pickerElement(criteria, locale);
    const expected = discoverCatalogue(catalogue, locale, criteria);
    assert.deepEqual(element.props.products.map(product => product.publicId), expected.map(product => product.publicId));
    assert.ok(element.props.products.every(product => Object.keys(product).sort().join(",") === "name,publicId"));
    const listing = ProductListing({ catalogue, locale, routeLocale: locale, criteria });
    const oldLinks = nodes(listing).filter(node => node.props?.["aria-label"]?.startsWith(comparisonLabels[locale].compare + ":"));
    assert.equal(oldLinks.length, expected.length); assert.ok(!JSON.stringify(element.props.products).includes(ids[6]));
    const cards = nodes(element.props.children).filter(node => node.type === "li");
    for (const card of cards) {
      assert.equal(nodes(card).filter(node => node.type === CatalogueResultPairCheckbox).length, 1);
      assert.equal(nodes(card).filter(node => node.type === QuickAdd).length, 1); assert.equal(nodes(card).filter(node => node.type === SaveProductButton).length, 1);
    }
    assert.equal(pickerElement({ query: "no-match", brand: "" }, locale), undefined);
  }
});

test("F1 exact click-ordered pair, max-two guard, explicit navigation/context and zero writes in legacy/EN/HU/KO", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ values, writes, navigation }) => {
    const locale = routeLocale ?? "en", labels = storefrontLabels[locale], criteria = { query: "match", brand: "Anua", sort: "name-desc" };
    const element = pickerElement(criteria, locale, routeLocale), props = element.props, before = new Map(values);
    let tree = picker(props); assert.equal(button(tree, labels.compareSelectedResults).props.disabled, true);
    button(tree, labels.compareSelectedResults).props.onClick(); assert.deepEqual(navigation, []);
    pick(ids[3]); tree = picker(props); assert.equal(button(tree, labels.compareSelectedResults).props.disabled, true);
    pick(ids[0]); tree = picker(props); assert.equal(button(tree, labels.compareSelectedResults).props.disabled, false);
    const third = checkbox(ids[1]); assert.equal(third.props.disabled, true); third.props.onChange({ target: { checked: true } }); tree = picker(props);
    assert.deepEqual(tree.props.value.ids, [ids[3], ids[0]]); pick(ids[3]); tree = picker(props); assert.deepEqual(tree.props.value.ids, [ids[3], ids[0]]);
    assert.equal(checkbox(ids[6]), null);
    button(tree, labels.compareSelectedResults).props.onClick(); assert.equal(navigation.length, 1);
    const url = new URL(navigation[0], "https://synthetic.invalid");
    assert.equal(url.pathname, storefrontHref("/products", routeLocale)); assert.equal(url.hash, `#${COMPARISON_DESTINATION}`);
    assert.deepEqual(readComparisonContext(Object.fromEntries(url.searchParams)), { first: ids[3], second: ids[0] });
    assert.deepEqual(readCatalogueCriteria(Object.fromEntries(url.searchParams)), criteria);
    const restored = nodes(ProductListing({ catalogue, locale, routeLocale, criteria, comparisonContext: readComparisonContext(Object.fromEntries(url.searchParams)) })).find(node => node.type === ProductComparison);
    assert.equal(restored.props.initialPublicId, ids[3]); assert.equal(restored.props.initialSecondPublicId, ids[0]);
    pick(ids[3], false); tree = picker(props); assert.equal(button(tree, labels.compareSelectedResults).props.disabled, true);
    assert.deepEqual(writes, []); assert.deepEqual(values, before);
  });
});

test("F1 zero/one/alias-only, changed results/search/sort/locale and stale IDs cannot manufacture a pair", async () => stores(async ({ writes, navigation }) => {
  const base = pickerElement().props;
  for (const products of [[], [base.products[0]], [base.products[0], { ...base.products[0], publicId: ids[0].toUpperCase() }]]) {
    const tree = picker({ ...base, products }, "small"); assert.ok(!button(tree, storefrontLabels.en.compareSelectedResults)); assert.equal(checkbox(ids[0]), null);
  }
  for (const patch of [{ products: base.products.slice(1) }, { catalogueQuery: "?q=changed" }, { catalogueQuery: "?sort=name-desc" }, { locale: "ko", routeLocale: "ko" }]) {
    driver.instances.clear(); picker(base); pick(ids[0]); picker(base); pick(ids[1]);
    const changed = { ...base, ...patch }, tree = picker(changed);
    assert.deepEqual(tree.props.value.ids, []); assert.equal(button(tree, storefrontLabels[changed.locale].compareSelectedResults).props.disabled, true);
    button(tree, storefrontLabels[changed.locale].compareSelectedResults).props.onClick();
  }
  driver.instances.clear();
  const aliased = { ...base, products: [{ ...base.products[0], publicId: ids[0].toUpperCase() }, ...base.products] };
  picker(aliased); pick(ids[0]); picker(aliased); pick(ids[1]); const tree = picker(aliased);
  assert.deepEqual(tree.props.value.ids, [ids[0], ids[1]]);
  const onlyTwo = { ...base, products: base.products.slice(0, 2) }; driver.instances.clear(); picker(onlyTwo); pick(ids[0]); picker(onlyTwo); pick(ids[1]);
  assert.equal(button(picker(onlyTwo), storefrontLabels.en.compareSelectedResults).props.disabled, false);
  assert.deepEqual(writes, []); assert.deepEqual(navigation, []);
}));

test("F2 native disclosures contain exact complete locale usage/caution, never index warnings or invent missing text", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const element = pickerElement({ query: "", brand: "" }, locale);
    const cards = nodes(element.props.children).filter(node => node.type === "li");
    for (const [index, product] of catalogue.listPublished().entries()) {
      const card = cards[index], supplied = product.translations[locale], details = nodes(card).find(node => node.type === "details");
      assert.equal(Boolean(details), Boolean(supplied?.usage || supplied?.caution));
      if (details) {
        const summary = nodes(details).find(node => node.type === "summary"); assert.ok(summary); assert.equal(summary.props.onClick, undefined);
        const paragraphs = nodes(details).filter(node => node.type === "p");
        assert.deepEqual(paragraphs.map(node => node.props.children), [supplied.usage, supplied.caution]);
        assert.ok(paragraphs[1].props.children.length > 8000); assert.match(paragraphs[1].props.className, /whitespace-pre-line break-words/);
        assert.doesNotMatch(paragraphs[1].props.className, /truncate|line-clamp|hidden|max-h/);
        assert.ok(!nodes(details).some(node => ["button", "input", "form"].includes(node.type) || node.props?.href));
      }
    }
    assert.equal(discoverCatalogue(catalogue, locale, { query: "Full warning text", brand: "" }).length, 0);
  }
  const minimal = { ...records[0], translations: { en: { ...records[0].translations.en, usage: null, caution: null }, hu: null, ko: null } };
  const listing = ProductListing({ catalogue: createLocalCatalogueReader([minimal]) }); assert.ok(!nodes(listing).some(node => node.type === "details"));
});

test("F3 adjacency obeys existing default/filtered/locale sort order at every position and carries only criteria", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", labels = storefrontLabels[locale];
    for (const criteria of [{ query: "", brand: "" }, { query: "match", brand: "Anua", sort: "name-desc" }, { query: "", brand: "Anua", sort: "name-asc" }]) {
      const matching = discoverCatalogue(catalogue, locale, criteria);
      for (const [index, product] of matching.entries()) {
        const detail = ProductDetail({ catalogue, slug: product.slug, locale, routeLocale, criteria, cartReturn: true, comparisonContext: { first: ids[0], second: ids[1] } });
        const nav = nodes(detail).find(node => node.type === "nav" && node.props["aria-label"] === labels.matchingNavigation);
        const expected = [matching[index - 1], matching[index + 1]].filter(Boolean);
        assert.equal(Boolean(nav), expected.length > 0);
        if (!nav) continue;
        const links = nodes(nav).filter(node => node.props?.href);
        assert.deepEqual(links.map(node => node.props.href), expected.map(item => storefrontHref(`/products/${item.slug}`, routeLocale) + catalogueQueryString(criteria)));
        for (const link of links) {
          const url = new URL(link.props.href, "https://synthetic.invalid");
          assert.deepEqual(readCatalogueCriteria(Object.fromEntries(url.searchParams)), criteria);
          for (const key of ["cartReturn", "compareFirst", "compareSecond", "returnUrl"]) assert.equal(url.searchParams.has(key), false);
          assert.ok(link.props["aria-label"]); assert.match(link.props.className, /break-words/);
        }
      }
    }
  }
});

test("F3 excluded-current, single/zero match and oversized URLs omit adjacency without changing Back/publication", () => {
  for (const criteria of [{ query: "no-match", brand: "" }, { query: "", brand: "beplain" }, { query: "x".repeat(9000), brand: "" }]) {
    const detail = ProductDetail({ catalogue, slug: "alpha", criteria });
    assert.ok(!nodes(detail).some(node => node.type === "nav" && node.props["aria-label"] === storefrontLabels.en.matchingNavigation));
    assert.ok(nodes(detail).some(node => node.props?.children === storefrontLabels.en.back));
  }
  const single = ProductDetail({ catalogue: createLocalCatalogueReader([records[0]]), slug: "alpha" });
  assert.ok(!nodes(single).some(node => node.type === "nav" && node.props["aria-label"] === storefrontLabels.en.matchingNavigation));
  for (const slug of ["private", "unknown"]) assert.throws(() => ProductDetail({ catalogue, slug }));
});

test("F4/F5 bounded same-brand cards retain original detail href plus exact current→related compare and reused controls", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", labels = storefrontLabels[locale], criteria = { query: "match", brand: "Anua", sort: "name-desc" };
    const detail = ProductDetail({ catalogue, slug: "alpha", locale, routeLocale, criteria });
    const section = nodes(detail).find(node => node.props?.["aria-labelledby"] === "same-brand-heading");
    const cards = nodes(section).filter(node => node.type === "li"); assert.equal(cards.length, 3);
    for (const [index, card] of cards.entries()) {
      const related = records[index + 1], links = nodes(card).filter(node => node.props?.href);
      assert.equal(links[0].props.href, storefrontHref(`/products/${related.slug}`, routeLocale) + "?brand=Anua");
      const compare = links.find(node => node.props.children === labels.compareRelated), url = new URL(compare.props.href, "https://synthetic.invalid");
      assert.equal(url.pathname, storefrontHref("/products", routeLocale)); assert.equal(url.hash, `#${COMPARISON_DESTINATION}`);
      assert.deepEqual(readComparisonContext(Object.fromEntries(url.searchParams)), { first: ids[0], second: related.publicId });
      assert.deepEqual(readCatalogueCriteria(Object.fromEntries(url.searchParams)), criteria);
      for (const component of [QuickAdd, SaveProductButton]) {
        const element = nodes(card).find(node => node.type === component); assert.ok(element);
        assert.equal(element.props.publicId, related.publicId); assert.equal(element.props.locale, locale);
        assert.equal(element.props.name, related.translations[locale]?.name ?? `${labels.details}: ${related.brand} (${related.slug})`);
      }
      assert.ok(links.every(link => !nodes(link.props.children).some(node => node.type === QuickAdd || node.type === SaveProductButton || ["button", "input", "form"].includes(node.type))));
    }
    assert.ok(!nodes(section).some(node => node.props?.publicId === ids[6] || node.props?.href?.includes("/private")));
    assert.ok(nodes(detail).some(node => node.type === ProductMediaGallery));
  }
  for (const reader of [createLocalCatalogueReader([records[0]]), createLocalCatalogueReader([records[0], records[5]])]) {
    assert.ok(!nodes(ProductDetail({ catalogue: reader, slug: "alpha" })).some(node => node.props?.["aria-labelledby"] === "same-brand-heading"));
  }
});

test("F5 related QuickAdd changes only its local draft until explicit submit and uses original failure feedback", async () => {
  for (const fail of [false, true]) await stores(async ({ writes, values, control }) => {
    const detail = ProductDetail({ catalogue, slug: "alpha" }), section = nodes(detail).find(node => node.props?.["aria-labelledby"] === "same-brand-heading");
    const element = nodes(section).find(node => node.type === QuickAdd); assert.equal(element.props.publicId, ids[1]);
    let tree = render(QuickAdd, element.props);
    nodes(tree).find(node => node.type === "input" && node.props.type === "number").props.onChange({ target: { value: "3" } });
    tree = render(QuickAdd, element.props); assert.deepEqual(writes, []);
    const before = values.get(CART_STORAGE_KEY); if (fail) control.writeDenied = CART_STORAGE_KEY;
    nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); tree = render(QuickAdd, element.props);
    if (fail) { assert.equal(values.get(CART_STORAGE_KEY), before); assert.ok(text(tree).includes(cartLabels.en.storage)); assert.ok(!text(tree).includes(cartLabels.en.added)); }
    else { assert.deepEqual(writes, [CART_STORAGE_KEY]); assert.equal(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines.find(line => line.publicId === ids[1]).quantity, 3); }
  });
});

test("F5 real related Save control preserves cap/corrupt/read-denied/write-denied/cross-tab behavior", async () => {
  for (const mode of ["normal", "full", "corrupt", "read", "write"]) await stores(async ({ values, writes, notify, control }) => {
    const detail = ProductDetail({ catalogue, slug: "alpha" }), section = nodes(detail).find(node => node.props?.["aria-labelledby"] === "same-brand-heading");
    const element = nodes(section).find(node => node.type === SaveProductButton);
    if (mode === "full") values.set(FAVORITES_STORAGE_KEY, serializeFavorites(Array.from({ length: MAX_FAVORITES }, (_, index) => `${String(index).padStart(8, "0")}-1111-2222-3333-444444444444`)));
    if (mode === "corrupt") values.set(FAVORITES_STORAGE_KEY, "{");
    if (mode === "read") control.readDenied = FAVORITES_STORAGE_KEY;
    notify(FAVORITES_STORAGE_KEY);
    let tree = render(SaveProductButton, element.props), trigger = nodes(tree).find(node => node.type === "button");
    if (["full", "corrupt", "read"].includes(mode)) { assert.equal(trigger.props.disabled, true); assert.deepEqual(writes, []); return; }
    if (mode === "write") control.writeDenied = FAVORITES_STORAGE_KEY;
    trigger.props.onClick(); tree = render(SaveProductButton, element.props);
    if (mode === "write") { assert.ok(text(tree).includes(favoriteLabels.en.storage)); assert.deepEqual(writes, []); return; }
    assert.equal(nodes(tree).find(node => node.type === "button").props["aria-pressed"], true);
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites([])); notify(FAVORITES_STORAGE_KEY); tree = render(SaveProductButton, element.props);
    assert.equal(nodes(tree).find(node => node.type === "button").props["aria-pressed"], false);
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY]);
  });
});

test("boundaries retain native labels/disclosure, server-only catalogue and CLOSED SEO/return authorities", () => {
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(storefrontLabels[locale]), Object.keys(storefrontLabels.en));
    for (const key of ["selectResultComparison", "compareSelectedResults", "resultComparisonCount", "matchingNavigation", "previousMatch", "nextMatch", "compareRelated"]) assert.ok(storefrontLabels[locale][key].trim());
  }
  const client = readFileSync(join(repo, "components/catalogue/CatalogueResultPairPicker.tsx"), "utf8");
  assert.doesNotMatch(client, /localCatalogue|discoverCatalogue|server-only|localStorage|sessionStorage|fetch\(/);
  assert.match(client, /type="checkbox"/); assert.match(client, /comparisonHref/); assert.match(client, /publishedComparison/);
  const server = readFileSync(join(repo, "components/catalogue/ProductCatalogue.tsx"), "utf8");
  assert.match(server, /import "server-only"/); assert.match(server, /discoverCatalogue\(catalogue, locale, criteria\)/);
  assert.match(server, /<details/); assert.match(server, /<summary/);
  for (const path of ["app/products/[slug]/page.tsx", "app/[locale]/products/[slug]/page.tsx"]) {
    const source = readFileSync(join(repo, path), "utf8"), metadata = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default"));
    assert.doesNotMatch(metadata, /criteria|compareFirst|cartReturn/);
    assert.match(source, /readComparisonContext\(query\)/); assert.match(source, /readCartReturn\(query.cartReturn\)/);
  }
  driver.instances.clear(); driver.contexts.clear();
});
