import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { catalogueQueryString, readCatalogueCriteria } from "../lib/catalog/catalogue-discovery.ts";
import { COMPARISON_DESTINATION, comparisonFieldState, comparisonHref, comparisonShareLink, publishedComparison, readComparisonContext } from "../lib/comparison/compare-selection.ts";
import { comparisonLabels } from "../lib/comparison/labels.ts";
import { storefrontLabels, storefrontHref, switchLocalePath } from "../lib/storefront/localization.ts";
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, serializeFavorites, inspectStoredFavorites } from "../lib/favorites/favorite-state.ts";
import { favoriteLabels } from "../lib/favorites/labels.ts";
import { CART_STORAGE_KEY, serializeCart } from "../lib/cart/cart-state.ts";
import { readCatalogueBrowse } from "../lib/catalog/catalogue-browse.ts";
import { portablePayload } from "../lib/cart/cart-portable-handoff.ts";
import { cartLabels } from "../lib/cart/labels.ts";

// Reuse the established installed-TypeScript/Node JSX fixture convention, not a browser runner.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot = dirname(require.resolve("react/package.json"));
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,subscriptions:new Map(),effects:[],serial:0};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useEffect(effect,deps){const state=driver.active,index=driver.index++,previous=state[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i])){previous?.cleanup?.();const entry={deps,cleanup:null};state[index]=entry;driver.effects.push(()=>{entry.cleanup=effect();});}}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/catalogue\/(ProductComparison|SaveProductButton)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
    if (specifier === "react") return { url: pathToFileURL(join(reactRoot, "index.js")).href, shortCircuit: true };
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
const { ProductListing, ProductDetail, catalogueHeaderQuery } = await import("../components/catalogue/ProductCatalogue.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { default: SaveProductButton } = await import("../components/catalogue/SaveProductButton.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts");
const browserFavorites = await import("../lib/favorites/browser-favorites.ts");
const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const third = "32345678-abcd-1234-abcd-123456789abc", hidden = "42345678-abcd-1234-abcd-123456789abc";
const content = name => ({ name, description: "Synthetic same text.", images: [], usage: "Synthetic usage.", caution: "Synthetic warning: always visible." });
const record = (publicId, slug, state = "published") => ({ publicId, slug, brand: "Anua", state,
  translations: { en: content(slug), hu: content(`Teszt ${slug}`), ko: content(`가상 ${slug}`) } });
const records = [record(id, "one"), record(other, "two"), record(third, "three"), record(hidden, "private-draft", "draft")];
const catalogue = createLocalCatalogueReader(records);
const projection = (locale = "en") => catalogue.listPublished().map(product => ({ publicId: product.publicId, slug: product.slug, brand: product.brand, ...product.translations[locale] }));
const criteria = { query: "árvíz 한국 &", brand: "Anua", sort: "name-desc" };
const query = catalogueQueryString(criteria);
const pair = [projection()[2], projection()[0]];
const origin = "https://synthetic.invalid";
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);

test("H1-F01 validated pair survives Header language transport with browse and Plan, without changing identities", () => {
  const browse = readCatalogueBrowse({ page: "2", withLocaleInfo: "1", withLocaleImage: "1", pickFirst: third });
  const payload = portablePayload([{ publicId: id, quantity: 2 }]);
  const comparison = readComparisonContext({ compareFirst: id.toUpperCase(), compareSecond: third });
  const before = JSON.stringify(records);
  for (const path of ["/products", "/products/one"]) {
    const suffix = catalogueHeaderQuery(criteria, browse, payload, catalogue, path, comparison);
    for (const from of [null, "en", "hu", "ko"]) for (const to of ["en", "hu", "ko"]) {
      const url = new URL(switchLocalePath(storefrontHref(path, from) + suffix, to), origin);
      assert.equal(url.pathname, storefrontHref(path, to));
      assert.equal(url.searchParams.get("compareFirst"), id);
      assert.equal(url.searchParams.get("compareSecond"), third);
      assert.equal(url.searchParams.get("q"), criteria.query);
      assert.equal(url.searchParams.get("brand"), criteria.brand);
      assert.equal(url.searchParams.get("sort"), criteria.sort);
      assert.equal(url.searchParams.get("page"), "2");
      assert.equal(url.searchParams.get("withLocaleImage"), "1");
      assert.equal(url.searchParams.get("cartPlan"), payload);
      assert.equal(url.searchParams.has("pickFirst"), false);
    }
  }
  assert.equal(JSON.stringify(records), before);
});

test("H1-F01 private, unknown, repeated, same or incomplete comparison never becomes a Header pair", () => {
  for (const raw of [
    { compareFirst: hidden, compareSecond: id }, { compareFirst: id, compareSecond: hidden },
    { compareFirst: id, compareSecond: "ffffffff-abcd-1234-abcd-123456789abc" },
    { compareFirst: [id, third], compareSecond: other }, { compareFirst: id, compareSecond: [other] },
    { compareFirst: id, compareSecond: id }, { compareFirst: id },
    { compareFirst: id + " ", compareSecond: other },
  ]) {
    const suffix = catalogueHeaderQuery(criteria, readCatalogueBrowse(), undefined, catalogue, "/products/one", readComparisonContext(raw));
    const url = new URL("/en/products/one" + suffix, origin);
    assert.equal(url.searchParams.has("compareFirst"), false);
    assert.equal(url.searchParams.has("compareSecond"), false);
    assert.equal(url.searchParams.get("q"), criteria.query);
  }
});

test("H1-F01 absent comparison keeps clean direct links and oversized complete context fails closed", () => {
  const browse = readCatalogueBrowse();
  assert.equal(catalogueHeaderQuery(criteria, browse, undefined, catalogue, "/products/one"), query);
  assert.equal(catalogueHeaderQuery({ query: "", brand: "" }, browse, undefined, catalogue, "/products/one"), "");
  assert.equal(catalogueHeaderQuery({ query: "x".repeat(8192), brand: "" }, browse, undefined, catalogue, "/products/one", { first: id, second: third }), null);
  const nearLimit = { query: "x".repeat(8090), brand: "" };
  assert.notEqual(catalogueHeaderQuery(nearLimit, browse, undefined, catalogue, "/products/one"), null);
  assert.equal(catalogueHeaderQuery(nearLimit, browse, undefined, catalogue, "/products/one", { first: id, second: third }), null);
});

test("R1 Header accepts complete public pairs only, even without the route parser", () => {
  // The comparison UI intentionally allows a first-only hint and selects a default
  // partner. Header transport must never promote that UI default into URL state.
  assert.notEqual(publishedComparison(catalogue.listPublished(), { first: id }), null);
  for (const context of [
    { first: id }, { second: other }, { first: "invalid", second: other },
    { first: id, second: "invalid" }, { first: id, second: id },
    { first: hidden, second: other }, { first: id, second: hidden },
  ]) {
    const suffix = catalogueHeaderQuery(criteria, readCatalogueBrowse(), undefined, catalogue, "/products/one", context);
    const url = new URL("/en/products/one" + suffix, origin);
    assert.equal(url.searchParams.has("compareFirst"), false);
    assert.equal(url.searchParams.has("compareSecond"), false);
  }
});

test("R2 comparison transport drops presentation filters while ordinary detail Back preserves them", () => {
  const browse = readCatalogueBrowse({ withLocaleInfo: "1", withLocaleImage: "1", page: "2" });
  const start = query + "&withLocaleInfo=1&withLocaleImage=1&page=2";
  for (const locale of ["en", "hu", "ko"]) {
    const selected = [records[0], records[2]];
    const comparison = new URL(comparisonHref(`/${locale}/products`, selected, start), origin);
    assert.deepEqual([...comparison.searchParams.keys()], ["q", "brand", "sort", "compareFirst", "compareSecond"]);
    const detail = ProductDetail({ slug: "one", catalogue, locale, routeLocale: locale, criteria, browse, comparisonContext: { first: id, second: third } });
    const special = nodes(detail).find(node => node.props?.children === comparisonLabels[locale].backToComparison);
    assert.equal(special.props.href, comparison.pathname + comparison.search + `#${COMPARISON_DESTINATION}`);
    const ordinary = nodes(detail).find(node => node.props?.children === storefrontLabels[locale].back);
    const back = new URL(ordinary.props.href, origin);
    assert.equal(back.searchParams.get("withLocaleInfo"), "1");
    assert.equal(back.searchParams.get("withLocaleImage"), "1");
  }
});

test("H1-F03 detail return links keep explicit wrapping gaps, order and original destinations in every locale", () => {
  const before = JSON.stringify(records);
  for (const locale of ["en", "hu", "ko"]) for (const routeLocale of [null, locale]) {
    for (const cartReturn of [false, true]) for (const withComparison of [false, true]) {
      const browse = readCatalogueBrowse({ page: "2", withLocaleInfo: "1", withLocaleImage: "1" });
      const detail = ProductDetail({ slug: "one", catalogue, locale, routeLocale, criteria, browse, cartReturn,
        comparisonContext: withComparison ? { first: id, second: third } : {} });
      const ordinary = nodes(detail).find(node => node.props?.children === storefrontLabels[locale].back);
      const group = nodes(detail).find(node => node.type === "div" && Array.isArray(node.props?.children) && node.props.children.includes(ordinary));
      assert.ok(group, "Return links share one layout container");
      for (const token of ["flex", "min-w-0", "flex-wrap", "items-start", "gap-x-6", "gap-y-3"]) {
        assert.ok(group.props.className.split(" ").includes(token));
      }
      const links = group.props.children.filter(Boolean);
      assert.deepEqual(links.map(link => link.props.children), [storefrontLabels[locale].back,
        ...(cartReturn ? [cartLabels[locale].backToCart] : []),
        ...(withComparison ? [comparisonLabels[locale].backToComparison] : [])]);
      const back = new URL(links[0].props.href, origin);
      assert.equal(back.pathname, storefrontHref("/products", routeLocale));
      assert.equal(back.searchParams.get("q"), criteria.query);
      assert.equal(back.searchParams.get("brand"), criteria.brand);
      assert.equal(back.searchParams.get("sort"), criteria.sort);
      assert.equal(back.searchParams.get("withLocaleInfo"), "1");
      assert.equal(back.searchParams.get("withLocaleImage"), "1");
      if (cartReturn) assert.equal(links[1].props.href, storefrontHref("/cart", routeLocale));
      if (withComparison) assert.equal(links.at(-1).props.href,
        comparisonHref(storefrontHref("/products", routeLocale), [records[0], records[2]], query) + `#${COMPARISON_DESTINATION}`);
      for (const link of links) {
        const classes = link.props.className.split(" ");
        for (const token of ["inline-flex", "min-w-0", "max-w-full", "break-words", "min-h-11", "focus-visible:outline-2"]) assert.ok(classes.includes(token));
        assert.ok(!classes.includes("block") && !classes.some(token => /nowrap|truncate/.test(token)));
        assert.equal(link.props.tabIndex, undefined);
      }
    }
  }
  assert.equal(JSON.stringify(records), before);
});

test("H5-F02 Korean listing heading uses a narrow mobile size without changing copy or other locale typography", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const heading = nodes(ProductListing({ catalogue, locale, routeLocale: locale })).find(node => node.type === "h1");
    assert.equal(text(heading), storefrontLabels[locale].heading);
    assert.doesNotMatch(heading.props.className, /nowrap|truncate/);
    if (locale === "ko") assert.match(heading.props.className, /text-3xl min-\[375px\]:text-4xl/);
    else assert.match(heading.props.className, /(?:^| )text-4xl(?: |$)/);
    assert.match(heading.props.className, /sm:text-5xl/);
  }
});
const controls = tree => nodes(tree).filter(node => node.type === "select");
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  driver.active = driver.instances.get(key); driver.index = 0; driver.effects = [];
  const tree = component(props);
  for (const effect of driver.effects) effect();
  return tree;
}
function unmount(key) {
  for (const value of driver.instances.get(key) ?? []) value?.cleanup?.();
  driver.instances.delete(key);
}
const copyElement = tree => nodes(tree).find(node => typeof node.type === "function" && node.type.name === "CopyComparisonLink");
async function stores(run) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const values = new Map([[CART_STORAGE_KEY, serializeCart([])], [FAVORITES_STORAGE_KEY, serializeFavorites([])]]);
  const writes = [], events = new Set(), control = { readDenied: false, writeDenied: false, clipboard: [] };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { origin }, localStorage: {
      getItem(key) { if (control.readDenied && key === FAVORITES_STORAGE_KEY) throw new Error("synthetic read denial"); return values.get(key) ?? null; },
      setItem(key, value) { if (control.writeDenied) throw new Error("synthetic write denial"); writes.push(key); values.set(key, value); },
    },
    addEventListener(type, callback) { if (type === "storage") events.add(callback); },
    removeEventListener(type, callback) { if (type === "storage") events.delete(callback); },
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async value => { control.clipboard.push(value); } } } });
  driver.instances.clear();
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key }));
  notify(null);
  try { await run({ values, writes, control, notify }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    for (const key of driver.instances.keys()) unmount(key);
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator;
  }
}

test("F1 result-card Compare is published-only, distinct, deterministic, localized and preserves applied criteria", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", root = storefrontHref("/products", routeLocale);
    const listing = ProductListing({ catalogue, locale, routeLocale, criteria: { query: "", brand: "Anua", sort: "name-desc" } });
    const links = nodes(listing).filter(node => node.props?.["aria-label"]?.startsWith(`${comparisonLabels[locale].compare}:`));
    assert.equal(links.length, 3);
    for (const link of links) {
      const url = new URL(link.props.href, origin), context = readComparisonContext(Object.fromEntries(url.searchParams));
      assert.equal(url.pathname, root); assert.equal(url.hash, `#${COMPARISON_DESTINATION}`);
      assert.equal(url.searchParams.get("brand"), "Anua"); assert.equal(url.searchParams.get("sort"), "name-desc");
      assert.notEqual(context.first, context.second); assert.ok(publishedComparison(projection(locale), context));
      assert.ok(!link.props.href.includes(hidden)); assert.match(link.props.className, /focus-visible/);
    }
    const board = nodes(listing).find(node => node.type === ProductComparison);
    assert.equal(board.props.destinationId, COMPARISON_DESTINATION);
    assert.deepEqual(board.props.products.map(product => product.publicId), [id, other, third]);
    for (const entries of [[], [records[0]], [records[3]]]) {
      const empty = ProductListing({ catalogue: createLocalCatalogueReader(entries), locale, routeLocale });
      assert.ok(!nodes(empty).some(node => node.props?.["aria-label"]?.startsWith(`${comparisonLabels[locale].compare}:`)));
    }
  }
});

test("F2 exact and single-entry hints reconcile only public identities; invalid/repeated/oversized pairs reject wholly", () => {
  const products = projection();
  assert.deepEqual(publishedComparison(products, readComparisonContext({ compareFirst: third.toUpperCase(), compareSecond: id })), pair);
  assert.deepEqual(publishedComparison(products, readComparisonContext({ compareFirst: third })), pair);
  for (const params of [{}, { compareSecond: id }, { compareFirst: id, compareSecond: id.toUpperCase() },
    { compareFirst: [id], compareSecond: other }, { compareFirst: id, compareSecond: [other, third] },
    { compareFirst: id + " ", compareSecond: other }, { compareFirst: "x".repeat(9000), compareSecond: other },
    { compareFirst: hidden, compareSecond: other }, { compareFirst: id, compareSecond: hidden }]) {
    assert.equal(publishedComparison(products, readComparisonContext(params)), null);
    const listing = ProductListing({ catalogue, comparisonContext: readComparisonContext(params) });
    const board = nodes(listing).find(node => node.type === ProductComparison);
    assert.equal(board.props.initialPublicId, undefined); assert.equal(board.props.initialSecondPublicId, undefined);
  }
});

test("F2 share URL uses canonical ordered UUIDs, exact supported context and trusted same-origin listing only", () => {
  for (const locale of [null, "en", "hu", "ko"]) {
    const href = comparisonHref(storefrontHref("/products", locale), pair, query) + `#${COMPARISON_DESTINATION}`;
    const url = new URL(comparisonShareLink(href, origin, projection()));
    assert.equal(url.origin, origin); assert.deepEqual(readCatalogueCriteria(Object.fromEntries(url.searchParams)), criteria);
    assert.deepEqual(url.searchParams.getAll("compareFirst"), [third]); assert.equal(url.searchParams.get("compareSecond"), id);
    assert.equal(switchLocalePath(href, "ko"), href.replace(/^\/(?:(?:en|hu|ko)\/)?products/, "/ko/products"));
    for (const bad of [origin + href, "//evil.invalid" + href, href + "&extra=1", href.replace(`compareSecond=${id}`, `compareSecond=${hidden}`),
      href.replace(`compareSecond=${id}`, `compareSecond=${third}`), href.replace("compareFirst=", `compareFirst=${third}&compareFirst=`),
      href.replace(`#${COMPARISON_DESTINATION}`, ""), href.replace("/products?", "/products/one?"), href.replace("?q=", "?unexpected=x&q=")]) {
      assert.equal(comparisonShareLink(bad, origin, projection()), null);
    }
    for (const badOrigin of ["file:///tmp/", origin + "/path", origin + "/?secret=1", "https://user:pass@synthetic.invalid"]) assert.equal(comparisonShareLink(href, badOrigin, projection()), null);
  }
  assert.equal(comparisonHref("//evil.invalid/products", pair, query), null);
  assert.equal(comparisonHref("/products", pair, "?q=" + "x".repeat(9000)), null);
});

test("F2 UI copies the changed/swapped current pair, not initial defaults; success waits for clipboard resolve", async () => stores(async ({ control, writes }) => {
  const props = { products: projection(), locale: "hu", routeLocale: "hu", catalogueQuery: query };
  let tree = render(ProductComparison, props);
  controls(tree)[0].props.onChange({ target: { value: third } }); tree = render(ProductComparison, props);
  button(tree, comparisonLabels.hu.swap).props.onClick(); tree = render(ProductComparison, props);
  const expected = controls(tree).map(node => node.props.value);
  const element = copyElement(tree), key = element.key;
  let copy = render(element.type, element.props, key), resolve;
  navigator.clipboard.writeText = value => { control.clipboard.push(value); return new Promise(done => { resolve = done; }); };
  const pending = button(copy, comparisonLabels.hu.copyLink).props.onClick();
  copy = render(element.type, element.props, key);
  assert.equal(button(copy, comparisonLabels.hu.copyLink).props.disabled, true);
  assert.ok(!text(copy).includes(comparisonLabels.hu.copied));
  await button(copy, comparisonLabels.hu.copyLink).props.onClick(); assert.equal(control.clipboard.length, 1);
  resolve(); await pending; copy = render(element.type, element.props, key);
  assert.ok(text(copy).includes(comparisonLabels.hu.copied));
  const url = new URL(control.clipboard[0]);
  assert.deepEqual([url.searchParams.get("compareFirst"), url.searchParams.get("compareSecond")], expected);
  assert.deepEqual(writes, []);
}));

test("F2 denied/missing clipboard and invalid URL never announce copied; pair-change/unmount suppresses stale completion", async () => {
  for (const mode of ["deny", "missing", "bad-url", "stale", "projection-change"]) await stores(async ({ control }) => {
    const props = { products: projection(), locale: "en", routeLocale: null };
    const element = copyElement(render(ProductComparison, props)), key = element.key;
    const copyProps = mode === "bad-url" ? { ...element.props, relativeHref: "https://evil.invalid/products" } : element.props;
    let copy = render(element.type, copyProps, key), resolve;
    if (mode === "deny") navigator.clipboard.writeText = async () => { throw new Error("denied"); };
    if (mode === "missing") delete navigator.clipboard;
    if (["stale", "projection-change"].includes(mode)) navigator.clipboard.writeText = () => new Promise(done => { resolve = done; });
    const pending = button(copy, comparisonLabels.en.copyLink).props.onClick();
    if (mode === "stale") {
      const oldState = driver.instances.get(key);
      const board = render(ProductComparison, props); button(board, comparisonLabels.en.swap).props.onClick();
      const next = copyElement(render(ProductComparison, props)); assert.notEqual(next.key, key);
      unmount(key); resolve(); await pending;
      assert.ok(!oldState.includes(comparisonLabels.en.copied));
      copy = render(next.type, next.props, next.key);
    } else if (mode === "projection-change") {
      render(element.type, { ...copyProps, products: props.products.slice(0, 1) }, key);
      resolve(); await pending;
      copy = render(element.type, { ...copyProps, products: props.products.slice(0, 1) }, key);
    } else { await pending; copy = render(element.type, copyProps, key); assert.ok(text(copy).includes(comparisonLabels.en.copyFailed)); }
    assert.ok(!text(copy).includes(comparisonLabels.en.copied)); assert.deepEqual(control.clipboard, []);
  });
});

test("F3 focus is reversible, literal/unknown-aware, leaves cautions visible and resets after changing or swapping pair", () => {
  assert.equal(comparisonFieldState(null, null), "unknown"); assert.equal(comparisonFieldState("", "text"), "unknown");
  assert.equal(comparisonFieldState("same", "same"), "same"); assert.equal(comparisonFieldState("one", "two"), "different");
  for (const locale of ["en", "hu", "ko"]) {
    driver.instances.clear();
    const products = projection(locale).map((product, index) => ({ ...product, description: index ? "Synthetic different." : product.description, usage: index ? null : product.usage }));
    const props = { products, locale, routeLocale: locale }, labels = comparisonLabels[locale];
    let tree = render(ProductComparison, props);
    assert.equal(button(tree, labels.focusDifferences).props["aria-pressed"], false);
    button(tree, labels.focusDifferences).props.onClick(); tree = render(ProductComparison, props);
    assert.ok(text(tree).includes(labels.same)); assert.ok(text(tree).includes(labels.different)); assert.ok(text(tree).includes(labels.unknown));
    const cautions = nodes(tree).filter(node => node.type === "dd" && text(node) === content("").caution);
    assert.equal(cautions.length, 2); cautions.forEach(node => assert.doesNotMatch(node.props.className, /hidden|opacity/));
    button(tree, labels.showAll).props.onClick(); tree = render(ProductComparison, props); assert.ok(button(tree, labels.focusDifferences));
    button(tree, labels.focusDifferences).props.onClick(); tree = render(ProductComparison, props);
    controls(tree)[1].props.onChange({ target: { value: third } }); tree = render(ProductComparison, props); assert.ok(button(tree, labels.focusDifferences));
    button(tree, labels.focusDifferences).props.onClick(); tree = render(ProductComparison, props);
    button(tree, labels.swap).props.onClick(); tree = render(ProductComparison, props); assert.ok(button(tree, labels.focusDifferences));
  }
});

test("F4 comparison reuses actual SaveProductButton on canonical current identities; save/unsave/cross-tab never writes Cart", async () => stores(async ({ values, writes, notify }) => {
  for (const locale of ["en", "hu", "ko"]) {
    const props = { products: projection(locale), locale, routeLocale: locale };
    let tree = render(ProductComparison, props, locale);
    const buttons = view => nodes(view).filter(node => node.type === SaveProductButton);
    assert.deepEqual(buttons(tree).map(node => node.props.publicId), [id, other]);
    let save = render(SaveProductButton, buttons(tree)[0].props, "save-" + locale);
    const trigger = view => nodes(view).find(node => node.type === "button");
    assert.equal(trigger(save).props.disabled, false); trigger(save).props.onClick();
    save = render(SaveProductButton, buttons(tree)[0].props, "save-" + locale);
    assert.equal(trigger(save).props["aria-pressed"], true);
    assert.deepEqual(inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids, [id]);
    tree = render(ProductComparison, props, locale); assert.ok(text(tree).includes(comparisonLabels[locale].saved));
    trigger(save).props.onClick();
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites([other])); notify(FAVORITES_STORAGE_KEY);
    tree = render(ProductComparison, props, locale); button(tree, comparisonLabels[locale].swap).props.onClick(); tree = render(ProductComparison, props, locale);
    assert.deepEqual(buttons(tree).map(node => node.props.publicId), [other, id]);
    save = render(SaveProductButton, buttons(tree)[0].props, "save-swapped-" + locale);
    assert.equal(trigger(save).props["aria-pressed"], true); trigger(save).props.onClick();
    assert.deepEqual(inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids, []);
    assert.ok(writes.every(key => key === FAVORITES_STORAGE_KEY));
  }
}));

test("F4 existing Favorites full/invalid/denied/unready/failed-write guards remain authoritative", async () => {
  driver.instances.clear();
  const props = { publicId: id, locale: "en", name: "Synthetic" };
  assert.equal(nodes(render(SaveProductButton, props, "ssr")).find(node => node.type === "button").props.disabled, true);
  for (const mode of ["full", "invalid", "denied", "write"]) await stores(async ({ values, writes, notify, control }) => {
    if (mode === "full") values.set(FAVORITES_STORAGE_KEY, serializeFavorites(Array.from({ length: MAX_FAVORITES }, (_, index) => `${String(index).padStart(8, "0")}-1111-2222-3333-444444444444`)));
    if (mode === "invalid") values.set(FAVORITES_STORAGE_KEY, "{");
    if (mode === "denied") control.readDenied = true;
    notify(FAVORITES_STORAGE_KEY);
    let tree = render(SaveProductButton, props), trigger = nodes(tree).find(node => node.type === "button");
    if (mode === "write") {
      control.writeDenied = true; trigger.props.onClick(); tree = render(SaveProductButton, props);
      assert.ok(text(tree).includes(favoriteLabels.en.storage));
    } else assert.equal(trigger.props.disabled, true);
    assert.equal(nodes(tree).find(node => node.type === "button").props.disabled, true); assert.deepEqual(writes, []);
  });
});

test("F5 exact pair listing → detail → special Back restores order/context while ordinary Back stays clean of pair", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    driver.instances.clear();
    const locale = routeLocale ?? "en", root = storefrontHref("/products", routeLocale);
    const context = { first: third, second: id };
    const listing = ProductListing({ catalogue, locale, routeLocale, criteria, comparisonContext: context });
    const element = nodes(listing).find(node => node.type === ProductComparison);
    const board = render(ProductComparison, element.props);
    assert.deepEqual(controls(board).map(node => node.props.value), [third, id]);
    for (const link of nodes(board).filter(node => node.props?.href?.startsWith(root + "/"))) {
      const url = new URL(link.props.href, origin), received = readComparisonContext(Object.fromEntries(url.searchParams));
      const detail = ProductDetail({ slug: url.pathname.split("/").at(-1), catalogue, locale, routeLocale, criteria: readCatalogueCriteria(Object.fromEntries(url.searchParams)), comparisonContext: received });
      const special = nodes(detail).find(node => node.props?.children === comparisonLabels[locale].backToComparison);
      assert.equal(special.props.href, comparisonHref(root, pair, query) + `#${COMPARISON_DESTINATION}`);
      assert.ok(nodes(detail).some(node => node.props?.children === storefrontLabels[locale].back && node.props.href === root + query));
    }
    for (const invalid of [{}, { first: id }, { first: id, second: hidden }, { first: third, second: other }, { first: id, second: id }]) {
      const detail = ProductDetail({ slug: "one", catalogue, locale, routeLocale, comparisonContext: invalid });
      assert.ok(!nodes(detail).some(node => node.props?.children === comparisonLabels[locale].backToComparison));
    }
    assert.throws(() => ProductDetail({ slug: "private-draft", catalogue, locale, routeLocale, comparisonContext: context }));
    assert.throws(() => ProductDetail({ slug: "unknown", catalogue, locale, routeLocale, comparisonContext: context }));
  }
});

test("route wiring covers legacy/localized listings/details, leaves metadata and search authority separate", () => {
  for (const path of ["app/products/page.tsx", "app/[locale]/products/page.tsx", "app/products/[slug]/page.tsx", "app/[locale]/products/[slug]/page.tsx"]) {
    const source = readFileSync(join(repo, path), "utf8");
    assert.match(source, /readComparisonContext\(query\)/); assert.match(source, /readCatalogueCriteria\(query\)/);
    const metadata = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default"));
    assert.doesNotMatch(metadata, /compareFirst|comparisonContext|readComparisonContext/);
  }
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(comparisonLabels[locale]), Object.keys(comparisonLabels.en));
    for (const value of Object.values(comparisonLabels[locale])) assert.ok(value.trim());
    driver.instances.clear();
    const tree = render(ProductComparison, { products: projection(locale), locale, routeLocale: locale });
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => node.props.type === "button"));
    assert.match(nodes(tree).find(node => node.type === "section").props.className, /min-w-0/);
    assert.ok(nodes(tree).filter(node => node.type === "select").every(node => /min-h-11.*min-w-0/.test(node.props.className)));
    for (const products of [[], projection(locale).slice(0, 1)]) assert.equal(render(ProductComparison, { products, locale, routeLocale: locale }, "empty-" + products.length), null);
  }
  const source = readFileSync(join(repo, "components/catalogue/ProductComparison.tsx"), "utf8");
  assert.match(source, /import SaveProductButton/);
  assert.doesNotMatch(source, /changeBrowserFavorite|changeBrowserCart|localStorage|sessionStorage|fetch\(/);
  assert.equal(createLocalCatalogueReader([]).listPublished().length, 0);
});
