import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { savedShoppingList } from "../lib/favorites/saved-shopping-list.ts";
import { recentComparisonPair } from "../lib/recently-viewed/recent-comparison.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, serializeFavorites, inspectStoredFavorites } from "../lib/favorites/favorite-state.ts";
import { RECENT_STORAGE_KEY, serializeRecent, inspectStoredRecent } from "../lib/recently-viewed/recent-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { favoriteLabels } from "../lib/favorites/labels.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";

const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const third = "32345678-abcd-1234-abcd-123456789abc", hidden = "42345678-abcd-1234-abcd-123456789abc";
const products = [{ publicId: id, slug: "one", brand: "Anua", name: "Alpha" }, { publicId: other, slug: "two", brand: "beplain", name: "Beta" }, { publicId: third, slug: "three", brand: "Anua", name: "Gamma" }];
const comparison = products.map(product => ({ ...product, description: "Synthetic fixture only.", usage: null, caution: null }));
const savedIds = [third.toUpperCase(), hidden, id, other];
const history = [other.toUpperCase(), hidden, id, third];

test("F5 pure adapter retains visible order, uses one unit per saved interest and the CLOSED sanitization/bound/disclaimer", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const selected = [products[2], { ...products[0], name: "<b>가상\nTeszt</b>\u202e label" }];
    const before = JSON.stringify([savedIds, selected]);
    const result = savedShoppingList(savedIds, [id.toUpperCase(), third, id], selected, locale);
    assert.equal(result.status, "ready");
    assert.ok(result.text.indexOf("Gamma") < result.text.indexOf("가상 Teszt label"));
    assert.equal((result.text.match(new RegExp(`${cartLabels[locale].quantity}: 1`, "g")) ?? []).length, 2);
    assert.ok(result.text.includes(cartLabels[locale].shoppingListNotice));
    assert.ok(!result.text.includes(hidden));
    assert.doesNotMatch(result.text, /<b>|\u202e/);
    assert.equal(JSON.stringify([savedIds, selected]), before);
  }
  assert.equal(savedShoppingList(savedIds, [], products, "en").status, "empty");
  for (const ids of [[hidden], ["invalid"], [id, hidden], null]) assert.equal(savedShoppingList(savedIds, ids, products, "en").status, "invalid");
  assert.equal(savedShoppingList([id, id.toUpperCase()], [id], products, "en").status, "invalid");
  assert.equal(savedShoppingList(savedIds, [id], [{ ...products[0], name: "x".repeat(16001) }], "en").status, "too-large");
});

test("F4 exact recent gate cannot fall back to unselected, hidden, stale, invalid or duplicate-only products", () => {
  assert.deepEqual(recentComparisonPair([id.toUpperCase(), other], history, products, comparison), [comparison[0], comparison[1]]);
  for (const ids of [[], [id], [id, id.toUpperCase()], [id, other, third], [id, hidden], [id, "bad"], null]) assert.equal(recentComparisonPair(ids, history, products, comparison), null);
  assert.equal(recentComparisonPair([id, other], [id], products, comparison), null);
  assert.equal(recentComparisonPair([id, other], history, [products[0]], comparison), null);
  assert.equal(recentComparisonPair([id, other], history, products, [comparison[2]]), null);
  assert.equal(recentComparisonPair([id, other], [id, id.toUpperCase(), other], products, comparison), null);
});

// Reuse the existing installed-TypeScript/Node hook/store convention. No browser hydration.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,effects:[],subscriptions:new Map(),serial:0};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useEffect(effect){driver.effects.push(effect);}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/(catalogue\/(SavedProductsBar|RecentlyViewedProducts|SaveProductButton)|cart\/ShoppingCart)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites|recently-viewed\/browser-recent)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const { default: RecentlyViewedProducts, recentlyViewedLabels } = await import("../components/catalogue/RecentlyViewedProducts.tsx");
const { default: SaveProductButton } = await import("../components/catalogue/SaveProductButton.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { ProductListing } = await import("../components/catalogue/ProductCatalogue.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts");
const browserFavorites = await import("../lib/favorites/browser-favorites.ts");
const browserRecent = await import("../lib/recently-viewed/browser-recent.ts");
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const checkboxes = tree => nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox");
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  driver.active = driver.instances.get(key); driver.index = 0; driver.effects = [];
  const tree = component(props);
  for (const effect of driver.effects) effect();
  return tree;
}
async function stores(run) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const values = new Map([[CART_STORAGE_KEY, serializeCart([{ publicId: id.toUpperCase(), quantity: 5 }, { publicId: hidden, quantity: 7 }])], [FAVORITES_STORAGE_KEY, serializeFavorites(savedIds)], [RECENT_STORAGE_KEY, serializeRecent(history)]]);
  const writes = [], copies = [], events = new Set();
  const control = { denied: null, clipboard: async () => {} };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem(key) { if (control.denied === key) throw new Error("synthetic denied"); return values.get(key) ?? null; }, setItem(key, value) { writes.push(key); values.set(key, value); } },
    addEventListener(type, callback) { if (type === "storage") events.add(callback); },
    removeEventListener(type, callback) { if (type === "storage") events.delete(callback); },
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText(value) { copies.push(value); return control.clipboard(value); } } } });
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites(); browserRecent.useBrowserRecent();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key }));
  notify(null); driver.instances.clear();
  try { await run({ values, writes, copies, control, notify }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.instances.clear();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator;
  }
}
const savedProps = locale => ({ products, comparisonProducts: comparison, locale, routeLocale: locale });
const recentProps = locale => ({ products, comparisonProducts: comparison, locale, routeLocale: locale });

test("F1 select displayed respects Saved filter/sort order, reset/clear/store changes remain transient", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, notify }) => {
    const props = savedProps(locale), labels = favoriteLabels[locale];
    const before = new Map(values);
    let tree = render(SavedProductsBar, props);
    nodes(tree).find(node => node.type === "select").props.onChange({ target: { value: "Anua" } });
    tree = render(SavedProductsBar, props);
    nodes(tree).filter(node => node.type === "select")[1].props.onChange({ target: { value: "name-asc" } });
    tree = render(SavedProductsBar, props);
    button(tree, labels.selectDisplayed).props.onClick(); tree = render(SavedProductsBar, props);
    assert.equal(checkboxes(tree).length, 2); assert.ok(checkboxes(tree).every(node => node.props.checked));
    button(tree, labels.compareSelected).props.onClick(); tree = render(SavedProductsBar, props);
    assert.deepEqual(nodes(tree).find(node => node.type === ProductComparison).props.products.map(product => product.publicId), [id, third]);
    button(tree, labels.clearSelection).props.onClick(); tree = render(SavedProductsBar, props);
    assert.ok(checkboxes(tree).every(node => !node.props.checked));
    button(tree, labels.selectDisplayed).props.onClick(); tree = render(SavedProductsBar, props);
    nodes(tree).find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "no-match" } });
    tree = render(SavedProductsBar, props); assert.equal(button(tree, labels.selectDisplayed).props.disabled, true);
    assert.equal(button(tree, labels.copySelected).props.disabled, true);
    button(tree, labels.resetView).props.onClick(); tree = render(SavedProductsBar, props);
    button(tree, labels.selectDisplayed).props.onClick();
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites([id])); notify(FAVORITES_STORAGE_KEY);
    tree = render(SavedProductsBar, props); assert.ok(checkboxes(tree).every(node => !node.props.checked));
    assert.equal(button(tree, labels.copySelected).props.disabled, true);
    assert.deepEqual(writes, []); assert.equal(values.get(CART_STORAGE_KEY), before.get(CART_STORAGE_KEY));
  });
});

test("F2 cart select-all keeps stale displayed rows, exact count/units and existing public-only move/clear guards", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, notify }) => {
    const labels = cartLabels[locale], props = { products: products.map(product => ({ ...product, names: { en: product.name, hu: product.name, ko: product.name } })), locale, routeLocale: locale };
    let tree = render(ShoppingCart, props);
    button(tree, labels.selectDisplayed).props.onClick(); tree = render(ShoppingCart, props);
    assert.ok(checkboxes(tree).every(node => node.props.checked));
    assert.equal(button(tree, labels.moveSelectedToSaved).props.disabled, true);
    assert.equal(button(tree, labels.removeSelected).props.disabled, false);
    const overview = nodes(tree).find(node => node.type === "dl" && node.props["aria-label"] === labels.selectionOverview);
    assert.deepEqual(nodes(overview).filter(node => node.type === "dd").map(node => node.props.children), ["12", 1]);
    button(tree, labels.clearSelection).props.onClick(); tree = render(ShoppingCart, props);
    assert.ok(checkboxes(tree).every(node => !node.props.checked));
    button(tree, labels.selectDisplayed).props.onClick();
    values.set(CART_STORAGE_KEY, serializeCart([{ publicId: other, quantity: 1 }])); notify(CART_STORAGE_KEY);
    tree = render(ShoppingCart, props); assert.ok(checkboxes(tree).every(node => !node.props.checked));
    values.set(CART_STORAGE_KEY, "{"); notify(CART_STORAGE_KEY);
    tree = render(ShoppingCart, props); assert.equal(button(tree, labels.selectDisplayed).props.disabled, true);
    assert.deepEqual(writes, []);
  });
});

test("F3 Recent rows delegate Save/Unsave to the CLOSED control; only Favorites changes and cap/denial stay guarded", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, notify, control }) => {
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites([])); notify(FAVORITES_STORAGE_KEY);
    const beforeCart = values.get(CART_STORAGE_KEY), beforeRecent = values.get(RECENT_STORAGE_KEY);
    const tree = render(RecentlyViewedProducts, recentProps(locale));
    const controls = nodes(tree).filter(node => node.type === SaveProductButton);
    assert.deepEqual(controls.map(node => node.props.publicId), [other, id, third]);
    assert.ok(controls.every(node => node.props.locale === locale && Object.keys(node.props).sort().join(",") === "locale,name,publicId"));
    let save = render(SaveProductButton, controls[0].props, "save");
    nodes(save).find(node => node.type === "button").props.onClick();
    assert.deepEqual(inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids, [other]);
    save = render(SaveProductButton, controls[0].props, "save"); assert.equal(nodes(save).find(node => node.type === "button").props["aria-pressed"], true);
    nodes(save).find(node => node.type === "button").props.onClick();
    assert.deepEqual(inspectStoredFavorites(values.get(FAVORITES_STORAGE_KEY)).ids, []);
    assert.deepEqual(writes, [FAVORITES_STORAGE_KEY, FAVORITES_STORAGE_KEY]);
    const full = Array.from({ length: MAX_FAVORITES }, (_, index) => `${String(index).padStart(8, "0")}-eeee-1234-abcd-123456789abc`);
    values.set(FAVORITES_STORAGE_KEY, serializeFavorites(full)); notify(FAVORITES_STORAGE_KEY);
    save = render(SaveProductButton, controls[0].props, "save"); assert.equal(nodes(save).find(node => node.type === "button").props.disabled, true);
    control.denied = FAVORITES_STORAGE_KEY; notify(FAVORITES_STORAGE_KEY);
    save = render(SaveProductButton, controls[0].props, "save"); assert.equal(nodes(save).find(node => node.type === "button").props.disabled, true);
    assert.equal(values.get(CART_STORAGE_KEY), beforeCart); assert.equal(values.get(RECENT_STORAGE_KEY), beforeRecent);
  });
});

test("F4 Recent comparison is explicit/exact-two and dismisses on check, history, projection, removal and clear", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, notify }) => {
    const props = recentProps(locale), labels = recentlyViewedLabels[locale];
    let tree = render(RecentlyViewedProducts, props);
    assert.equal(button(tree, labels.compareSelected).props.disabled, true);
    assert.ok(!nodes(tree).some(node => node.type === ProductComparison));
    for (let count = 1; count <= 3; count++) {
      checkboxes(tree)[count - 1].props.onChange({ target: { checked: true } }); tree = render(RecentlyViewedProducts, props);
      assert.equal(button(tree, labels.compareSelected).props.disabled, count !== 2);
    }
    checkboxes(tree)[2].props.onChange({ target: { checked: false } }); tree = render(RecentlyViewedProducts, props);
    button(tree, labels.compareSelected).props.onClick(); tree = render(RecentlyViewedProducts, props);
    assert.deepEqual(nodes(tree).find(node => node.type === ProductComparison).props.products.map(product => product.publicId), [other, id]);
    tree = render(RecentlyViewedProducts, { ...props, products: [...products] });
    assert.ok(!nodes(tree).some(node => node.type === ProductComparison));
    assert.equal(button(tree, labels.compareSelected).props.disabled, true);
    tree = render(RecentlyViewedProducts, props);
    values.set(RECENT_STORAGE_KEY, serializeRecent([id, other])); notify(RECENT_STORAGE_KEY);
    tree = render(RecentlyViewedProducts, props); assert.ok(checkboxes(tree).every(node => !node.props.checked));
    assert.deepEqual(writes, []);
    for (const checkbox of checkboxes(tree)) checkbox.props.onChange({ target: { checked: true } });
    tree = render(RecentlyViewedProducts, props); button(tree, labels.compareSelected).props.onClick();
    tree = render(RecentlyViewedProducts, props);
    nodes(tree).find(node => node.type === "button" && node.props["aria-label"]?.startsWith(labels.remove + ":")).props.onClick();
    tree = render(RecentlyViewedProducts, props); assert.ok(!nodes(tree).some(node => node.type === ProductComparison));
    assert.deepEqual(inspectStoredRecent(values.get(RECENT_STORAGE_KEY)).ids, [other]);
    button(tree, labels.clear).props.onClick(); tree = render(RecentlyViewedProducts, props);
    assert.ok(!nodes(tree).some(node => node.type === ProductComparison));
    assert.deepEqual(writes, [RECENT_STORAGE_KEY, RECENT_STORAGE_KEY]);
  });
});

test("F5 awaited clipboard success is explicit, one-unit/localized and duplicate guarded with zero storage writes", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ values, writes, copies, control }) => {
    const locale = routeLocale ?? "en", labels = favoriteLabels[locale], props = { ...savedProps(locale), routeLocale };
    let tree = render(SavedProductsBar, props);
    button(tree, labels.selectDisplayed).props.onClick(); tree = render(SavedProductsBar, props);
    let finish; control.clipboard = () => new Promise(resolve => { finish = resolve; });
    const task = button(tree, labels.copySelected).props.onClick();
    await button(tree, labels.copySelected).props.onClick();
    tree = render(SavedProductsBar, props); assert.equal(button(tree, labels.copySelected).props.disabled, true);
    assert.ok(!text(tree).includes(labels.copied)); assert.equal(copies.length, 1);
    finish(); await task; tree = render(SavedProductsBar, props);
    assert.ok(text(tree).includes(labels.copied)); assert.equal(button(tree, labels.copySelected).props.disabled, false);
    assert.ok(copies[0].includes(cartLabels[locale].shoppingListNotice));
    assert.equal((copies[0].match(new RegExp(`${cartLabels[locale].quantity}: 1`, "g")) ?? []).length, 3);
    assert.ok(!copies[0].includes(hidden)); assert.deepEqual(writes, []);
    assert.equal(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines[0].quantity, 5);
  });
});

test("F5 conflicts, corrupt/blocked Favorites, rejected/unavailable clipboard and oversize never announce success", async () => {
  for (const failure of ["conflict", "invalid", "denied", "clipboard", "unavailable", "oversize"]) await stores(async ({ values, writes, copies, control }) => {
    const props = { ...savedProps("en"), ...(failure === "oversize" ? { products: [{ ...products[0], name: "x".repeat(16001) }] } : {}) };
    let tree = render(SavedProductsBar, props); button(tree, favoriteLabels.en.selectDisplayed).props.onClick(); tree = render(SavedProductsBar, props);
    if (failure === "conflict") values.set(FAVORITES_STORAGE_KEY, serializeFavorites([other]));
    if (failure === "invalid") values.set(FAVORITES_STORAGE_KEY, "{");
    if (failure === "denied") control.denied = FAVORITES_STORAGE_KEY;
    if (failure === "clipboard") control.clipboard = async () => { throw new Error("synthetic rejected"); };
    if (failure === "unavailable") globalThis.navigator.clipboard.writeText = undefined;
    await button(tree, favoriteLabels.en.copySelected).props.onClick(); tree = render(SavedProductsBar, props);
    assert.ok(!text(tree).includes(favoriteLabels.en.copied)); assert.deepEqual(writes, []);
    if (failure === "oversize") assert.ok(text(tree).includes(favoriteLabels.en.copyTooLarge));
    if (failure !== "clipboard") assert.equal(copies.length, 0);
  });
});

test("F5 async completion after view/selection or Favorites changes cannot resurrect a stale confirmation", async () => {
  for (const change of ["view", "selection", "history"]) await stores(async ({ values, writes, control, notify }) => {
    const props = savedProps("en");
    let tree = render(SavedProductsBar, props); button(tree, favoriteLabels.en.selectDisplayed).props.onClick(); tree = render(SavedProductsBar, props);
    let finish; control.clipboard = () => new Promise(resolve => { finish = resolve; });
    const task = button(tree, favoriteLabels.en.copySelected).props.onClick();
    if (change === "view") nodes(tree).find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "Alpha" } });
    if (change === "selection") button(tree, favoriteLabels.en.clearSelection).props.onClick();
    if (change === "history") { values.set(FAVORITES_STORAGE_KEY, serializeFavorites([id])); notify(FAVORITES_STORAGE_KEY); }
    tree = render(SavedProductsBar, props); finish(); await task; tree = render(SavedProductsBar, props);
    assert.ok(!text(tree).includes(favoriteLabels.en.copied)); assert.deepEqual(writes, []);
  });
});

test("SSR, empty/invalid stores and full-public projections keep new controls inactive and private records hidden", async () => {
  assert.equal(typeof window, "undefined"); driver.instances.clear();
  assert.equal(render(RecentlyViewedProducts, recentProps("en")), null);
  const saved = render(SavedProductsBar, savedProps("en"));
  assert.equal(button(saved, favoriteLabels.en.selectDisplayed).props.disabled, true);
  assert.equal(button(saved, favoriteLabels.en.copySelected).props.disabled, true);
  const content = name => ({ name, description: "Synthetic only.", images: [], usage: null, caution: null });
  const record = (publicId, slug, state) => ({ publicId, slug, brand: "Anua", state, translations: { en: content(slug), hu: null, ko: null } });
  const catalogue = createLocalCatalogueReader([record(id, "public", "published"), record(other, "second", "published"), record(hidden, "private", "draft")]);
  for (const locale of ["en", "hu", "ko"]) {
    const tree = ProductListing({ catalogue, locale, routeLocale: locale, criteria: { query: "no-results", brand: "beplain" } });
    const recent = nodes(tree).find(node => node.type === RecentlyViewedProducts);
    assert.deepEqual(recent.props.comparisonProducts.map(product => product.publicId), [id, other]);
    if (locale !== "en") assert.ok(recent.props.comparisonProducts.every(product => product.name === null));
    assert.deepEqual(Object.keys(recent.props.comparisonProducts[0]).sort(), ["brand", "caution", "description", "image", "name", "publicId", "slug", "usage"]);
    assert.deepEqual(Object.keys(recentlyViewedLabels[locale]), Object.keys(recentlyViewedLabels.en));
    assert.deepEqual(Object.keys(favoriteLabels[locale]), Object.keys(favoriteLabels.en));
    for (const key of ["selectDisplayed", "clearSelection", "copySelected", "copied", "copyFailed", "copyTooLarge"]) assert.ok(favoriteLabels[locale][key].trim());
    for (const key of ["selectDisplayed", "clearSelection"]) assert.ok(cartLabels[locale][key].trim());
  }
  await stores(async ({ values, notify, writes }) => {
    for (const raw of [serializeFavorites([]), "{"]) {
      values.set(FAVORITES_STORAGE_KEY, raw); notify(FAVORITES_STORAGE_KEY);
      const tree = render(SavedProductsBar, savedProps("en")); assert.equal(button(tree, favoriteLabels.en.selectDisplayed).props.disabled, true);
    }
    assert.deepEqual(writes, []);
  });
  driver.instances.clear();
});
