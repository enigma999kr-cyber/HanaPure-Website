import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { comparisonLabels } from "../lib/comparison/labels.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";

// Existing installed-TypeScript/registerHooks pattern, not browser/hydration evidence.
const require = createRequire(import.meta.url);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,subscriptions:new Map(),serial:0};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/(cart\/AddToCart|catalogue\/ProductComparison)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const { ProductDetail, ProductListing } = await import("../components/catalogue/ProductCatalogue.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { default: AddToCart } = await import("../components/cart/AddToCart.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts");
const browserFavorites = await import("../lib/favorites/browser-favorites.ts");
const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const third = "32345678-abcd-1234-abcd-123456789abc", hidden = "42345678-abcd-1234-abcd-123456789abc";
const content = name => ({ name, description: "Synthetic description only.", images: [], usage: "Synthetic usage.", caution: "Synthetic caution." });
const record = (publicId, slug, patch = {}) => ({ publicId, slug, brand: "Anua", state: "published",
  translations: { en: content(slug), hu: { ...content(slug), name: `Teszt ${slug}` }, ko: { ...content(slug), name: `가상 ${slug}` } }, ...patch });
const records = [record(id, "one"), record(other, "two"), record(third, "three")];
const catalogue = createLocalCatalogueReader(records);
const projection = locale => records.map(product => ({ publicId: product.publicId, slug: product.slug, brand: product.brand, ...product.translations[locale] }));
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  driver.active = driver.instances.get(key); driver.index = 0;
  return component(props);
}
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
function stores(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart([{ publicId: id.toUpperCase(), quantity: 5 }])], [FAVORITES_STORAGE_KEY, serializeFavorites([other.toUpperCase()])]]);
  const writes = [], events = new Set();
  const control = { denied: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem(key) { if (control.denied === key) throw new Error("synthetic denied"); return values.get(key) ?? null; }, setItem(key, value) { writes.push(key); values.set(key, value); } },
    addEventListener(type, callback) { if (type === "storage") events.add(callback); },
    removeEventListener(type, callback) { if (type === "storage") events.delete(callback); },
  } });
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key }));
  notify(null); driver.instances.clear();
  try { run({ values, writes, notify, control }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.instances.clear();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

test("F1/F2 native detail jumps have real unique targets and preselect the current published identity in every locale/legacy route", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en";
    driver.instances.clear();
    const detail = ProductDetail({ slug: "three", catalogue, locale, routeLocale, criteria: { query: "árvíz 한국", brand: "Anua", sort: "name-desc" } });
    const nav = nodes(detail).find(node => node.type === "nav" && node.props["aria-label"] === storefrontLabels[locale].detailNavigation);
    assert.match(nav.props.className, /flex-wrap/);
    const comparison = nodes(detail).find(node => node.type === ProductComparison);
    assert.equal(comparison.props.destinationId, "product-comparison");
    assert.equal(comparison.props.initialPublicId, third);
    const board = render(ProductComparison, comparison.props);
    const all = [...nodes(detail), ...nodes(board)];
    const jumps = nodes(nav).filter(node => node.type === "a");
    assert.deepEqual(jumps.map(node => node.props.href), ["#product-description", "#product-usage", "#product-caution", "#product-selection", "#product-comparison"]);
    for (const jump of jumps) {
      assert.equal(jump.props.onClick, undefined);
      assert.match(jump.props.className, /min-h-11/);
      assert.match(jump.props.className, /break-words/);
      const targets = all.filter(node => node.props?.id === jump.props.href.slice(1));
      assert.equal(targets.length, 1);
      assert.equal(targets[0].props.tabIndex, -1);
      assert.match(targets[0].props.className, /scroll-mt-24/);
      assert.match(targets[0].props.className, /focus-visible:outline/);
    }
    const selects = nodes(board).filter(node => node.type === "select");
    assert.equal(selects[0].props.value, third);
    assert.notEqual(selects[1].props.value, third);
    assert.deepEqual(comparison.props.products.map(product => product.publicId), [id, other, third]);
    const root = routeLocale ? `/${locale}/products` : "/products";
    assert.ok(nodes(detail).some(node => node.props?.href === `${root}?q=%C3%A1rv%C3%ADz+%ED%95%9C%EA%B5%AD&brand=Anua&sort=name-desc`));
    const listing = nodes(ProductListing({ catalogue, locale, routeLocale })).find(node => node.type === ProductComparison);
    assert.equal(listing.props.destinationId, undefined);
  }
});

test("F1/F2 missing-locale or optional content never creates empty targets; zero/one product has no comparison destination", () => {
  const missing = record(id, "missing", { translations: { en: content("missing"), hu: null, ko: null } });
  for (const locale of ["hu", "ko"]) {
    const detail = ProductDetail({ slug: "missing", catalogue: createLocalCatalogueReader([missing]), locale, routeLocale: locale });
    const nav = nodes(detail).find(node => node.type === "nav");
    assert.deepEqual(nodes(nav).filter(node => node.type === "a").map(node => node.props.href), ["#product-selection"]);
    for (const target of ["product-description", "product-usage", "product-caution", "product-comparison"]) assert.ok(!nodes(detail).some(node => node.props?.id === target));
    assert.ok(text(detail).includes(storefrontLabels[locale].missing));
    assert.ok(!nodes(detail).some(node => node.type === ProductComparison));
  }
  const minimal = record(id, "minimal", { translations: { en: { ...content("minimal"), usage: null, caution: null }, hu: null, ko: null } });
  const detail = ProductDetail({ slug: "minimal", catalogue: createLocalCatalogueReader([minimal]) });
  assert.deepEqual(nodes(nodes(detail).find(node => node.type === "nav")).filter(node => node.type === "a").map(node => node.props.href), ["#product-description", "#product-selection"]);
  for (const reader of [createLocalCatalogueReader([]), createLocalCatalogueReader([record(id, "draft", { state: "draft" })])]) assert.throws(() => ProductDetail({ slug: "draft", catalogue: reader }));
});

test("F3 swap handlers exchange only the selected identities and retain options/duplicate exclusion without writes", () => {
  for (const locale of ["en", "hu", "ko"]) for (const products of [projection(locale), projection(locale).slice(1)]) stores(({ writes }) => {
    const props = { products, locale, routeLocale: locale, initialPublicId: products[1].publicId };
    let tree = render(ProductComparison, props);
    const selections = view => nodes(view).filter(node => node.type === "select");
    const before = selections(tree).map(node => node.props.value);
    const swap = button(tree, comparisonLabels[locale].swap);
    assert.equal(swap.props.type, "button");
    assert.match(swap.props.className, /min-h-11/);
    assert.match(swap.props.className, /focus-visible:outline/);
    swap.props.onClick(); tree = render(ProductComparison, props);
    assert.deepEqual(selections(tree).map(node => node.props.value), [before[1], before[0]]);
    assert.equal(button(tree, comparisonLabels[locale].swap).key, swap.key);
    for (const [slot, select] of selections(tree).entries()) {
      const options = nodes(select).filter(node => node.type === "option");
      assert.deepEqual(options.map(node => node.props.value), products.map(product => product.publicId));
      assert.equal(options.find(node => node.props.disabled).props.value, selections(tree)[1 - slot].props.value);
    }
    button(tree, comparisonLabels[locale].swap).props.onClick(); tree = render(ProductComparison, props);
    assert.deepEqual(selections(tree).map(node => node.props.value), before);
    if (products.length > 2) {
      selections(tree)[0].props.onChange({ target: { value: products[2].publicId } });
      tree = render(ProductComparison, props);
      const chosen = selections(tree).map(node => node.props.value);
      button(tree, comparisonLabels[locale].swap).props.onClick(); tree = render(ProductComparison, props);
      assert.deepEqual(selections(tree).map(node => node.props.value), chosen.reverse());
    }
    assert.deepEqual(writes, []);
  });
});

test("F3 null/single/alias-only comparison has no controls, anchors or swap and SSR invents no browser selection", () => {
  for (const products of [[], [projection("en")[0]], [projection("en")[0], { ...projection("en")[0], publicId: id.toUpperCase() }]]) {
    driver.instances.clear();
    assert.equal(render(ProductComparison, { products, locale: "en", routeLocale: null, destinationId: "product-comparison" }), null);
  }
  driver.instances.clear();
  const tree = render(ProductComparison, { products: projection("en"), locale: "en", routeLocale: null });
  assert.ok(!text(tree).includes(comparisonLabels.en.inBrowserCart));
  assert.ok(!text(tree).includes(comparisonLabels.en.saved));
});

test("F4 presets change only additive input draft; explicit submit/manual validation/add semantics stay separate", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) stores(({ writes, values }) => {
    const locale = routeLocale ?? "en", labels = cartLabels[locale], props = { publicId: id, locale, routeLocale };
    let tree = render(AddToCart, props);
    const initial = new Map(values);
    for (const quantity of [1, 2, 3]) {
      const preset = nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === `${labels.presetQuantity}: ${quantity}`);
      assert.equal(preset.props.type, "button");
      assert.match(preset.props.className, /min-h-11/);
      preset.props.onClick(); tree = render(AddToCart, props);
      assert.equal(nodes(tree).find(node => node.type === "input").props.value, String(quantity));
      assert.deepEqual(writes, []); assert.deepEqual(values, initial);
    }
    const form = nodes(tree).find(node => node.type === "form");
    let prevented = false;
    form.props.onSubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(writes, [CART_STORAGE_KEY]);
    assert.equal(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines[0].quantity, 8);
    tree = render(AddToCart, props);
    nodes(tree).find(node => node.type === "input").props.onChange({ target: { value: "0" } });
    tree = render(AddToCart, props);
    nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 1);
    tree = render(AddToCart, props); assert.ok(text(tree).includes(labels.invalid));
    assert.ok(nodes(tree).some(node => node.props?.href === (routeLocale ? `/${locale}/cart` : "/cart")));
  });
});

test("F4 preset edits never unlock failed existing-quantity confirmation, hide warnings or invoke absolute Set", () => {
  for (const failure of ["write-failed", "conflict", "unavailable"]) stores(({ writes }) => {
    const props = { publicId: id, locale: "en", routeLocale: null };
    let tree = render(AddToCart, props);
    const existing = nodes(tree).find(node => typeof node.type === "function" && node.type.name === "ExistingQuantityForm");
    assert.ok(existing);
    existing.props.announce(failure); tree = render(AddToCart, props);
    assert.ok(!nodes(tree).some(node => typeof node.type === "function" && node.type.name === "ExistingQuantityForm"));
    assert.ok(!text(tree).includes(cartLabels.en.inBrowserCart));
    const before = text(tree);
    nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === `${cartLabels.en.presetQuantity}: 2`).props.onClick();
    tree = render(AddToCart, props);
    assert.equal(nodes(tree).find(node => node.type === "input").props.value, "2");
    assert.equal(text(tree), before);
    assert.deepEqual(writes, []);
  });
});

test("F5 positive overlap follows case-insensitive identities and cross-tab changes; corrupt/denied/absent stores stay unknown", () => {
  for (const locale of ["en", "hu", "ko"]) stores(({ values, writes, notify, control }) => {
    const props = { products: projection(locale), locale, routeLocale: locale };
    let tree = render(ProductComparison, props);
    const articles = view => nodes(view).filter(node => node.type === "article");
    const quantity = article => nodes(article).find(node => node.type === "p" && node.props.children?.[0] === comparisonLabels[locale].inBrowserCart)?.props.children[2];
    assert.equal(quantity(articles(tree)[0]), 5);
    assert.ok(text(articles(tree)[1]).includes(comparisonLabels[locale].saved));
    assert.ok(!text(articles(tree)[0]).includes(comparisonLabels[locale].saved));
    values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id, quantity: 9 }])); notify(CART_STORAGE_KEY);
    tree = render(ProductComparison, props); assert.equal(quantity(articles(tree)[0]), 9);
    for (const raw of ["{", null]) {
      if (raw === null) { values.delete(CART_STORAGE_KEY); values.delete(FAVORITES_STORAGE_KEY); }
      else { values.set(CART_STORAGE_KEY, raw); values.set(FAVORITES_STORAGE_KEY, raw); }
      notify(null); tree = render(ProductComparison, props);
      assert.ok(!text(tree).includes(comparisonLabels[locale].inBrowserCart));
      assert.ok(!text(tree).includes(comparisonLabels[locale].saved));
    }
    for (const key of [CART_STORAGE_KEY, FAVORITES_STORAGE_KEY]) {
      control.denied = key; notify(key); tree = render(ProductComparison, props);
      assert.ok(!text(tree).includes(key === CART_STORAGE_KEY ? comparisonLabels[locale].inBrowserCart : comparisonLabels[locale].saved));
    }
    assert.deepEqual(writes, []);
    assert.ok(!text(tree).includes(hidden));
  });
});

test("new EN/HU/KO technical labels are complete and presets/awareness remain SSR-safe and bounded to existing controls", () => {
  assert.equal(typeof window, "undefined");
  for (const locale of ["en", "hu", "ko"]) {
    driver.instances.clear();
    const tree = render(AddToCart, { publicId: id, locale, routeLocale: locale });
    const presets = nodes(tree).filter(node => node.type === "button" && node.props.type === "button");
    assert.equal(presets.length, 3);
    assert.ok(!nodes(tree).some(node => typeof node.type === "function" && node.type.name === "ExistingQuantityForm"));
    assert.deepEqual(Object.keys(comparisonLabels[locale]), Object.keys(comparisonLabels.en));
    assert.deepEqual(Object.keys(storefrontLabels[locale]), Object.keys(storefrontLabels.en));
    assert.deepEqual(Object.keys(cartLabels[locale]), Object.keys(cartLabels.en));
    for (const key of ["swap", "inBrowserCart", "saved"]) assert.ok(comparisonLabels[locale][key].trim());
    for (const key of ["detailNavigation", "description", "detailSelection", "compareAnother"]) assert.ok(storefrontLabels[locale][key].trim());
    for (const key of ["draftPresets", "presetQuantity"]) assert.ok(cartLabels[locale][key].trim());
    assert.match(nodes(tree).find(node => node.type === "fieldset").props.className, /flex-wrap/);
  }
  for (const path of ["components/catalogue/ProductComparison.tsx", "components/cart/AddToCart.tsx"]) assert.doesNotMatch(readFileSync(join(repo, path), "utf8"), /localStorage|sessionStorage|fetch\(/);
  driver.instances.clear();
});
