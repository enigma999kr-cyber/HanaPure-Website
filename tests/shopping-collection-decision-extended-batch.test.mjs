import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { emptySavedView, normalizeSavedSearch, savedCollectionView, savedComparisonPair } from "../lib/favorites/saved-collection-view.ts";
import { cartSelectionSummary, browserCartOverlap, savedProductOverlap } from "../lib/cart/cart-selection-summary.ts";
import { serializeCart, CART_STORAGE_KEY } from "../lib/cart/cart-state.ts";
import { serializeFavorites, FAVORITES_STORAGE_KEY } from "../lib/favorites/favorite-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { favoriteLabels } from "../lib/favorites/labels.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";

const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const third = "32345678-abcd-1234-abcd-123456789abc", hidden = "42345678-abcd-1234-abcd-123456789abc";
const products = Object.freeze([
  { publicId: id, name: "Beta", brand: "Round Lab", slug: "beta" },
  { publicId: other, name: "Alpha", brand: "Anua", slug: "alpha" },
  { publicId: third, name: "Alpha", brand: "Round Lab", slug: "alpha-two" },
].map(Object.freeze));
const savedIds = Object.freeze([third.toUpperCase(), hidden, id, other]);
const comparison = products.map(product => ({ ...product, description: "Synthetic editorial text", usage: null, caution: null }));
const healthy = { ready: true, persistent: true, invalid: false };
const cartSnapshot = lines => ({ ...healthy, lines });
const savedSnapshot = ids => ({ ...healthy, ids });

test("F1/F2 saved search/brand intersection uses full saved-public data, ignores private identities and never mutates order", () => {
  const before = JSON.stringify([savedIds, products]);
  const full = savedCollectionView(savedIds, products, emptySavedView, "en");
  assert.deepEqual(full.rows.map(row => row.publicId), [third, id, other]);
  assert.deepEqual(full.brands, ["Round Lab", "Anua"]);
  assert.equal(full.total, 3);
  assert.deepEqual(savedCollectionView(savedIds, products, { query: "  aLpHa  ", brand: "ROUND LAB", sort: "saved" }, "en").rows, [products[2]]);
  assert.equal(savedCollectionView(savedIds, products, { ...emptySavedView, query: hidden }).rows.length, 0);
  assert.equal(savedCollectionView(savedIds, products, { ...emptySavedView, query: "unknown" }, "en").rows.length, 0);
  assert.deepEqual(savedCollectionView(savedIds, products, { ...emptySavedView, query: "alpha-two" }, "en").rows, [products[2]]);
  assert.deepEqual(savedCollectionView([], products, emptySavedView, "en"), { rows: [], brands: [], total: 0 });
  assert.deepEqual(savedCollectionView(["invalid"], products, emptySavedView, "en").rows, []);
  assert.deepEqual(savedCollectionView([id, id.toUpperCase()], products, emptySavedView, "en").rows, []);
  assert.equal(JSON.stringify([savedIds, products]), before);
});

test("F1/F2 search is normalized/bounded, sorting is stable in both directions and reset restores exact saved order", () => {
  assert.equal(normalizeSavedSearch("  ＡLPHA\t Beta  "), "alpha beta");
  assert.equal(normalizeSavedSearch("x".repeat(300)).length, 200);
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(savedCollectionView(savedIds, products, { ...emptySavedView, sort: "name-asc" }, locale).rows.map(row => row.publicId), [third, other, id]);
    assert.deepEqual(savedCollectionView(savedIds, products, { ...emptySavedView, sort: "name-desc" }, locale).rows.map(row => row.publicId), [id, third, other]);
    assert.deepEqual(savedCollectionView(savedIds, products, emptySavedView, locale).rows.map(row => row.publicId), [third, id, other]);
  }
});

test("F3 comparison entry admits exactly two visible saved public identities without general-comparison fallback", () => {
  for (const ids of [[], [id], [id, id.toUpperCase()], [id, other, third], [id, hidden], [id, "invalid"], null]) {
    assert.equal(savedComparisonPair(ids, savedIds, products, comparison), null);
  }
  assert.deepEqual(savedComparisonPair([other.toUpperCase(), id], savedIds, products, comparison), [comparison[1], comparison[0]]);
  assert.equal(savedComparisonPair([id, other], [id], products, comparison), null);
  assert.equal(savedComparisonPair([id, other], savedIds, [products[0]], comparison), null);
  assert.equal(savedComparisonPair([id, other], savedIds, products, [comparison[2]]), null);
  assert.equal(savedComparisonPair([id, other], savedIds, [], []), null);
});

test("F4 coherent selected summary counts distinct lines and exact BigInt units including stale publication rows", () => {
  const lines = [{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }, { publicId: hidden, quantity: Number.MAX_SAFE_INTEGER }];
  const cart = cartSnapshot(lines);
  assert.deepEqual(cartSelectionSummary(cart, lines, [], products), { lines: 0, units: "0", unavailable: 0 });
  assert.deepEqual(cartSelectionSummary(cart, lines, [id, id.toUpperCase()], products), { lines: 1, units: "9007199254740991", unavailable: 0 });
  assert.deepEqual(cartSelectionSummary(cart, lines, [id, hidden], products), { lines: 2, units: "18014398509481982", unavailable: 1 });
  assert.equal(cartSelectionSummary(cart, [...lines], [id], products), null);
  for (const patch of [{ ready: false }, { persistent: false }, { invalid: true }]) assert.equal(cartSelectionSummary({ ...cart, ...patch }, lines, [id], products), null);
  for (const ids of [["bad"], [other], null]) assert.equal(cartSelectionSummary(cart, lines, ids, products), null);
  const malformed = [{ publicId: id, quantity: 0 }];
  assert.equal(cartSelectionSummary(cartSnapshot(malformed), malformed, [id], products), null);
});

test("F5 casefold overlap is read-only; unknown/corrupt opposite store never emits a positive indicator", () => {
  const lines = [{ publicId: id.toUpperCase(), quantity: 3 }];
  const cart = cartSnapshot(lines), saved = savedSnapshot([id.toUpperCase()]);
  const before = JSON.stringify([cart, saved]);
  assert.equal(browserCartOverlap(cart, id), 3);
  assert.equal(browserCartOverlap(cart, other), null);
  assert.equal(savedProductOverlap(saved, id), true);
  assert.equal(savedProductOverlap(saved, other), false);
  for (const patch of [{ ready: false }, { persistent: false }, { invalid: true }]) {
    assert.equal(browserCartOverlap({ ...cart, ...patch }, id), null);
    assert.equal(savedProductOverlap({ ...saved, ...patch }, id), false);
  }
  assert.equal(browserCartOverlap(cartSnapshot([{ publicId: id, quantity: -1 }]), id), null);
  assert.equal(savedProductOverlap(savedSnapshot([id, id.toUpperCase()]), id), false);
  assert.equal(JSON.stringify([cart, saved]), before);
});

// Same installed-TypeScript/registerHooks convention as catalogue-storefront tests.
// Synthetic hook state below exercises JSX handlers, not a browser or hydration.
const require = createRequire(import.meta.url);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={states:[],index:0,subscriptions:new Map()};
export function useState(initial){const index=driver.index++;if(!(index in driver.states))driver.states[index]=typeof initial==='function'?initial():initial;return [driver.states[index],value=>{driver.states[index]=typeof value==='function'?value(driver.states[index]):value;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return 'synthetic-id';}
export function useEffect(){}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/(catalogue\/SavedProductsBar|cart\/ShoppingCart)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const { driver } = await import(hooksUrl);
const { default: SavedProductsBar } = await import("../components/catalogue/SavedProductsBar.tsx");
const { default: ShoppingCart } = await import("../components/cart/ShoppingCart.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { ProductListing } = await import("../components/catalogue/ProductCatalogue.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts");
const browserFavorites = await import("../lib/favorites/browser-favorites.ts");
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const render = (component, props) => { driver.index = 0; return component(props); };
const find = (tree, type, label) => nodes(tree).find(node => node.type === type && (!label || text(node) === label));

function withStores(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[FAVORITES_STORAGE_KEY, serializeFavorites(savedIds)], [CART_STORAGE_KEY, serializeCart([{ publicId: id.toUpperCase(), quantity: 5 }])]]);
  const events = new Set(), writes = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { writes.push(key); values.set(key, value); } },
    addEventListener(type, callback) { if (type === "storage") events.add(callback); },
    removeEventListener(type, callback) { if (type === "storage") events.delete(callback); },
  } });
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key }));
  notify(null); driver.states = [];
  try { run({ values, writes, notify }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.states = [];
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

test("F1–F3/F5 actual Saved JSX handlers filter/reset/sort, compare only the selected two and invalidate after store/view changes", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) withStores(({ values, writes, notify }) => {
    const locale = routeLocale ?? "en", labels = favoriteLabels[locale];
    const props = { products, comparisonProducts: comparison, locale, routeLocale };
    let tree = render(SavedProductsBar, props);
    assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").length, 3);
    assert.deepEqual(nodes(tree).find(node => node.type === "p" && node.props.children?.[0] === labels.inBrowserCart).props.children, [labels.inBrowserCart, ": ", 5]);
    const choices = nodes(tree).filter(node => node.type === "select");
    assert.equal(choices.length, 2);
    assert.equal(nodes(choices[0]).filter(node => node.type === "option").length, 3);
    for (const control of nodes(tree).filter(node => node.type === "select" || node.type === "input" && node.props.type === "search")) {
      assert.ok(nodes(tree).some(node => node.type === "label" && node.props.htmlFor === control.props.id));
      assert.match(control.props.className, /min-h-11/);
    }
    let button = find(tree, "button", labels.compareSelected);
    assert.equal(button.props.disabled, true);
    for (const count of [1, 2, 3]) {
      const checkboxes = nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox");
      checkboxes[count - 1].props.onChange({ target: { checked: true } });
      tree = render(SavedProductsBar, props);
      assert.equal(find(tree, "button", labels.compareSelected).props.disabled, count !== 2);
    }
    nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox")[2].props.onChange({ target: { checked: false } });
    tree = render(SavedProductsBar, props);
    find(tree, "button", labels.compareSelected).props.onClick();
    tree = render(SavedProductsBar, props);
    const panel = nodes(tree).find(node => node.type === ProductComparison);
    assert.deepEqual(panel.props.products.map(product => product.publicId), [third, id]);
    assert.equal(panel.props.routeLocale, routeLocale);
    assert.ok(!panel.props.products.some(product => product.publicId === other));
    find(tree, "input").props.onChange({ target: { value: "no-match" } });
    tree = render(SavedProductsBar, props);
    assert.ok(text(tree).includes(labels.noMatches));
    assert.ok(!nodes(tree).some(node => node.type === ProductComparison));
    assert.equal(find(tree, "button", labels.compareSelected).props.disabled, true);
    find(tree, "button", labels.resetView).props.onClick();
    tree = render(SavedProductsBar, props);
    assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").length, 3);
    const search = nodes(tree).find(node => node.type === "input" && node.props.type === "search");
    search.props.onChange({ target: { value: "Alpha" } });
    tree = render(SavedProductsBar, props);
    nodes(tree).find(node => node.type === "select").props.onChange({ target: { value: "Round Lab" } });
    tree = render(SavedProductsBar, props);
    nodes(tree).filter(node => node.type === "select")[1].props.onChange({ target: { value: "name-desc" } });
    tree = render(SavedProductsBar, props);
    assert.equal(nodes(tree).find(node => node.type === "input" && node.props.type === "search").props.value, "Alpha");
    assert.equal(nodes(tree).find(node => node.type === "select").props.value, "Round Lab");
    assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").length, 1);
    find(tree, "button", labels.resetView).props.onClick();
    tree = render(SavedProductsBar, props);
    for (const checkbox of nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").slice(0, 2)) checkbox.props.onChange({ target: { checked: true } });
    tree = render(SavedProductsBar, props);
    find(tree, "button", labels.compareSelected).props.onClick();
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites([id])); notify(FAVORITES_STORAGE_KEY);
    tree = render(SavedProductsBar, props);
    assert.equal(find(tree, "button", labels.compareSelected).props.disabled, true);
    assert.ok(!nodes(tree).some(node => node.type === ProductComparison));
    values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id, quantity: 8 }])); notify(CART_STORAGE_KEY);
    tree = render(SavedProductsBar, props);
    assert.deepEqual(nodes(tree).find(node => node.type === "p" && node.props.children?.[0] === labels.inBrowserCart).props.children, [labels.inBrowserCart, ": ", 8]);
    values.set(CART_STORAGE_KEY, "{"); notify(CART_STORAGE_KEY);
    tree = render(SavedProductsBar, props);
    assert.ok(!text(tree).includes(labels.inBrowserCart));
    assert.deepEqual(writes, []);
  });
});

test("F4/F5 Cart JSX summary/overlap follows checkboxes and cross-tab invalidation without writes", () => {
  for (const locale of ["en", "hu", "ko"]) withStores(({ values, writes, notify }) => {
    const lines = [{ publicId: id.toUpperCase(), quantity: Number.MAX_SAFE_INTEGER }, { publicId: hidden, quantity: Number.MAX_SAFE_INTEGER }];
    values.set(CART_STORAGE_KEY, serializeCart(lines)); notify(CART_STORAGE_KEY);
    const props = { products: [{ ...products[0], names: { en: "Beta", hu: null, ko: null } }], locale, routeLocale: locale };
    let tree = render(ShoppingCart, props);
    assert.equal(nodes(tree).filter(node => node === cartLabels[locale].alsoSaved).length, 1);
    assert.ok(text(tree).includes("Selected") || locale !== "en");
    for (const checkbox of nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox")) checkbox.props.onChange({ target: { checked: true } });
    tree = render(ShoppingCart, props);
    assert.ok(text(tree).includes("18014398509481982"));
    const summary = nodes(tree).find(node => node.type === "dl" && node.props["aria-label"] === cartLabels[locale].selectionOverview);
    assert.deepEqual(nodes(summary).filter(node => node.type === "dd").map(node => node.props.children), ["18014398509481982", 1]);
    values.set(CART_STORAGE_KEY, serializeCart([lines[0]])); notify(CART_STORAGE_KEY);
    tree = render(ShoppingCart, props);
    assert.ok(!nodes(tree).some(node => node.type === "dl"));
    assert.ok(text(tree).includes(cartLabels[locale].selectionUnknown));
    values.set(FAVORITES_STORAGE_KEY, "{"); notify(FAVORITES_STORAGE_KEY);
    tree = render(ShoppingCart, props);
    assert.ok(!text(tree).includes(cartLabels[locale].alsoSaved));
    assert.deepEqual(writes, []);
  });
});

test("server projection is full-public-only and localized, independent of global catalogue results", () => {
  const content = name => ({ name, description: "Synthetic fixture only.", images: [], usage: null, caution: null });
  const record = (publicId, slug, brand, state = "published") => ({ publicId, slug, brand, state, translations: { en: content(slug), hu: null, ko: null } });
  const reader = createLocalCatalogueReader([record(id, "first", "Anua"), record(other, "second", "beplain"), record(hidden, "secret-draft", "Round Lab", "draft")]);
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    const listing = ProductListing({ catalogue: reader, locale, routeLocale, criteria: { query: "none", brand: "beplain", sort: "name-desc" } });
    const saved = nodes(listing).find(node => node.type === SavedProductsBar);
    assert.deepEqual(saved.props.products.map(product => product.publicId), [id, other]);
    assert.deepEqual(saved.props.comparisonProducts.map(product => product.publicId), [id, other]);
    assert.ok(saved.props.products.every(product => Object.keys(product).sort().join(",") === "brand,name,publicId,slug"));
    assert.ok(saved.props.comparisonProducts.every(product => Object.keys(product).sort().join(",") === "brand,caution,description,name,publicId,slug,usage"));
    if (locale !== "en") {
      assert.ok(saved.props.comparisonProducts.every(product => product.name === null && product.description === null));
      assert.ok(saved.props.products.every(product => product.name.includes(product.slug) && !product.name.includes("Synthetic")));
    }
  }
  const empty = nodes(ProductListing()).find(node => node.type === SavedProductsBar);
  assert.deepEqual(empty.props.products, []); assert.deepEqual(empty.props.comparisonProducts, []);
});

test("SSR is storage-free; native local controls have complete locale labels and no new mutation or persistence", () => {
  assert.equal(typeof window, "undefined");
  driver.states = [];
  const tree = render(SavedProductsBar, { products, comparisonProducts: comparison, locale: "ko", routeLocale: "ko" });
  assert.ok(text(tree).includes(favoriteLabels.ko.loading));
  assert.ok(!nodes(tree).some(node => node.type === "select" || node.type === ProductComparison));
  assert.equal(find(tree, "button", favoriteLabels.ko.compareSelected).props.disabled, true);
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(favoriteLabels[locale]), Object.keys(favoriteLabels.en));
    assert.deepEqual(Object.keys(cartLabels[locale]), Object.keys(cartLabels.en));
    for (const key of ["searchSaved", "savedBrand", "allSavedBrands", "sortSaved", "savedOrder", "nameAscending", "nameDescending", "resetView", "matches", "noMatches", "compareSelected", "inBrowserCart"]) assert.ok(favoriteLabels[locale][key].trim());
    for (const key of ["selectionOverview", "selectedUnits", "selectedUnavailable", "selectionUnknown", "alsoSaved"]) assert.ok(cartLabels[locale][key].trim());
  }
  for (const path of ["lib/favorites/saved-collection-view.ts", "lib/cart/cart-selection-summary.ts"]) {
    assert.doesNotMatch(readFileSync(join(repo, path), "utf8"), /window|document|navigator|localStorage|sessionStorage|setItem|browser-cart|browser-favorites/);
  }
  const source = readFileSync(join(repo, "components/catalogue/SavedProductsBar.tsx"), "utf8");
  assert.match(source, /setComparisonRequest\(null\)/);
  assert.match(source, /setChecked\(\{ baseline: state.ids, ids: \[\] \}\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|URLSearchParams|<form/);
  driver.states = [];
});
