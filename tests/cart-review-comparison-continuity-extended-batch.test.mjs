import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { cartReviewView, EMPTY_CART_REVIEW, CART_REVIEW_QUERY_LIMIT, CART_REVIEW_BRAND_LIMIT, readCartReturn } from "../lib/cart/cart-review-view.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";
import { comparisonLabels } from "../lib/comparison/labels.ts";
import { readComparisonContext, COMPARISON_DESTINATION } from "../lib/comparison/compare-selection.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";

const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot = dirname(require.resolve("react/package.json"));
// Existing Node/installed-TypeScript hook convention; synthetic, not browser evidence.
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,effects:[],subscriptions:new Map(),serial:0,rendering:false,dirty:false};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;if(driver.rendering)driver.dirty=true;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useEffect(effect){driver.effects.push(effect);}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/cart\/ShoppingCart\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const { default: ShoppingCart } = await import("../components/cart/ShoppingCart.tsx");
const { ProductDetail } = await import("../components/catalogue/ProductCatalogue.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts"), browserFavorites = await import("../lib/favorites/browser-favorites.ts");
const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const third = "32345678-abcd-1234-abcd-123456789abc", hidden = "42345678-abcd-1234-abcd-123456789abc";
const lines = [{ publicId: id.toUpperCase(), quantity: 5 }, { publicId: other, quantity: 8 }, { publicId: hidden, quantity: 9 }, { publicId: third, quantity: 8 }];
const products = [
  { publicId: id, slug: "one", brand: "Anua", names: { en: "Zulu", hu: "Zsálya", ko: "하나" } },
  { publicId: other, slug: "two", brand: "beplain", names: { en: "Alpha", hu: "Árvíz", ko: "가상" } },
  { publicId: third, slug: "three", brand: "Anua", names: { en: "Beta", hu: null, ko: null } },
];
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const boxes = tree => nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox");
const search = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "search");
const select = (tree, suffix) => nodes(tree).find(node => node.type === "select" && node.props.id.endsWith(suffix));
const props = (locale = "en", routeLocale = locale) => ({ products, locale, routeLocale });
function render(component, properties, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  let tree;
  for (let attempt = 0; attempt < 3; attempt++) {
    driver.active = driver.instances.get(key); driver.index = 0; driver.effects = []; driver.dirty = false; driver.rendering = true;
    try { tree = component(properties); } finally { driver.rendering = false; }
    if (!driver.dirty) break;
    assert.ok(attempt < 2);
  }
  for (const effect of driver.effects) effect();
  return tree;
}
const cart = properties => render(ShoppingCart, properties);
const check = (tree, indices) => indices.forEach(index => boxes(tree)[index].props.onChange({ target: { checked: true } }));
const change = (node, value) => node.props.onChange({ target: { value } });
async function stores(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart(lines)], [FAVORITES_STORAGE_KEY, serializeFavorites([])]]);
  const writes = [], navigation = [], events = new Set(), control = { readDenied: false, writeDenied: false, afterWrite: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { assign: href => navigation.push(href) }, localStorage: {
      getItem(key) { if (key === CART_STORAGE_KEY && control.readDenied) throw new Error("synthetic denied"); return values.get(key) ?? null; },
      setItem(key, value) { if (control.writeDenied) throw new Error("synthetic write denied"); writes.push(key); values.set(key, value); control.afterWrite?.(); },
    },
    addEventListener(type, callback) { if (type === "storage") events.add(callback); },
    removeEventListener(type, callback) { if (type === "storage") events.delete(callback); },
  } });
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key }));
  notify(null); driver.instances.clear();
  try { await run({ values, writes, control, notify, navigation }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.instances.clear();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

test("F1/F2 pure view keeps source row witnesses, bounded public search and stable original/name/quantity order", () => {
  const before = JSON.stringify([lines, products]);
  const view = criteria => cartReviewView(lines, products, "en", { ...EMPTY_CART_REVIEW, ...criteria });
  assert.deepEqual(view({}).rows.map(row => row.line.publicId), lines.map(line => line.publicId));
  assert.strictEqual(view({}).rows[0].line, lines[0]);
  assert.deepEqual(view({ sort: "name" }).rows.map(row => row.line.publicId), [other, third, id.toUpperCase(), hidden]);
  assert.deepEqual(view({ sort: "quantity" }).rows.map(row => row.line.publicId), [hidden, other, third, id.toUpperCase()]);
  assert.deepEqual(view({ query: " ANUA zUlU " }).rows.map(row => row.line.publicId), [id.toUpperCase()]);
  assert.equal(view({ query: hidden }).rows.length, 0);
  assert.equal(view({ query: "private-draft-secret" }).rows.length, 0);
  assert.deepEqual(view({}).brands, ["Anua", "beplain"]);
  assert.equal(view({ brand: "unpublished-secret" }).rows.length, 0);
  const missing = cartReviewView(lines, products, "hu", { ...EMPTY_CART_REVIEW, sort: "name" });
  assert.deepEqual(missing.rows.map(row => row.line.publicId), [other, id.toUpperCase(), hidden, third]);
  assert.equal(cartReviewView(lines, products, "hu", { ...EMPTY_CART_REVIEW, query: "Beta" }).rows.length, 0);
  assert.equal(view({ query: " ".repeat(CART_REVIEW_QUERY_LIMIT) + "Zulu" }).rows.length, lines.length);
  assert.equal(view({ brand: "x".repeat(CART_REVIEW_BRAND_LIMIT + 20) }).rows.length, 0);
  assert.equal(JSON.stringify([lines, products]), before);
});

test("F1 view-only search/brand/reset are localized and distinguish no match from empty persisted Cart without writes", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes }) => {
    const properties = props(locale), labels = cartLabels[locale], before = new Map(values);
    let tree = cart(properties);
    change(search(tree), "no-synthetic-match"); tree = cart(properties);
    assert.equal(boxes(tree).length, 0); assert.ok(text(tree).includes(labels.noReviewResults));
    assert.ok(!text(tree).includes(labels.empty)); assert.equal(values.get(CART_STORAGE_KEY), before.get(CART_STORAGE_KEY));
    button(tree, labels.resetReview).props.onClick(); tree = cart(properties); assert.equal(boxes(tree).length, 4);
    change(select(tree, "-brand"), "beplain"); tree = cart(properties); assert.equal(boxes(tree).length, 1);
    assert.ok(text(tree).includes(products[1].names[locale])); assert.ok(!text(tree).includes(products[0].names[locale]));
    button(tree, labels.resetReview).props.onClick(); tree = cart(properties);
    change(search(tree), "x".repeat(300)); tree = cart(properties); assert.equal(search(tree).props.value.length, CART_REVIEW_QUERY_LIMIT);
    assert.deepEqual(writes, []); assert.deepEqual(values, before);
  });
});

test("F2 visible totals stay BigInt-exact and separate from selected totals; sorting retains identities and never writes", async () => stores(async ({ values, notify, writes }) => {
  const large = [{ ...lines[0], quantity: Number.MAX_SAFE_INTEGER }, { ...lines[1], quantity: Number.MAX_SAFE_INTEGER }, lines[2]];
  values.set(CART_STORAGE_KEY, serializeCart(large)); notify(CART_STORAGE_KEY);
  const properties = props(), labels = cartLabels.en;
  let tree = cart(properties); check(tree, [0]); tree = cart(properties);
  const overview = () => nodes(tree).find(node => node.type === "dl" && node.props["aria-label"] === labels.review);
  assert.ok(text(overview()).includes("18014398509481991"));
  assert.ok(text(nodes(tree).find(node => node.type === "dl" && node.props["aria-label"] === labels.selectionOverview)).includes("9007199254740991"));
  change(select(tree, "-sort"), "name"); tree = cart(properties);
  assert.equal(boxes(tree)[1].props.checked, true); assert.equal(boxes(tree)[0].props.checked, false);
  change(search(tree), "beplain"); tree = cart(properties);
  assert.ok(boxes(tree).every(box => !box.props.checked));
  assert.match(text(overview()), /\b1\s*\/\s*3\b/); assert.ok(text(overview()).includes("9007199254740991"));
  assert.equal(button(tree, labels.removeSelected).props.disabled, true);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, large); assert.deepEqual(writes, []);
}));

test("F2 Select displayed acts on visible identities, resets on filter change and cannot delete hidden selections", async () => stores(async ({ values, writes }) => {
  const properties = props(), labels = cartLabels.en;
  let tree = cart(properties); button(tree, labels.selectDisplayed).props.onClick(); tree = cart(properties);
  assert.ok(boxes(tree).every(box => box.props.checked));
  change(select(tree, "-brand"), "beplain"); tree = cart(properties);
  assert.ok(boxes(tree).every(box => !box.props.checked));
  button(tree, labels.removeSelected).props.onClick(); assert.deepEqual(writes, []);
  button(tree, labels.selectDisplayed).props.onClick(); tree = cart(properties);
  button(tree, labels.removeSelected).props.onClick(); tree = cart(properties);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [lines[0], lines[2], lines[3]]);
  button(tree, labels.undo).props.onClick(); tree = cart(properties);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, lines); assert.equal(writes.length, 2);
  button(tree, labels.resetReview).props.onClick(); tree = cart(properties);
  assert.equal(boxes(tree).length, 4); assert.ok(boxes(tree).every(box => !box.props.checked));
}));

test("F3 unpublished review selects only absent public identities; cleanup uses the existing guarded Remove and Undo", async () => stores(async ({ values, writes, notify }) => {
  const properties = props(), labels = cartLabels.en;
  let tree = cart(properties); button(tree, labels.selectUnpublished).props.onClick(); tree = cart(properties);
  assert.equal(boxes(tree).length, 1); assert.equal(boxes(tree)[0].props.checked, true);
  assert.ok(text(tree).includes(labels.unavailable)); assert.ok(!text(tree).includes(hidden)); assert.ok(!text(tree).includes("private-draft-secret"));
  assert.deepEqual(writes, []);
  button(tree, labels.removeSelected).props.onClick(); tree = cart(properties);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [lines[0], lines[1], lines[3]]);
  assert.ok(text(tree).includes(labels.noReviewResults));
  button(tree, labels.undo).props.onClick(); tree = cart(properties);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, lines);
  button(tree, labels.selectUnpublished).props.onClick(); tree = cart(properties);
  values.set(CART_STORAGE_KEY, serializeCart([lines[2]])); notify(CART_STORAGE_KEY); tree = cart(properties);
  assert.equal(boxes(tree)[0].props.checked, false); assert.equal(button(tree, labels.removeSelected).props.disabled, true);
  button(tree, labels.selectUnpublished).props.onClick(); tree = cart(properties); assert.equal(boxes(tree)[0].props.checked, true);
  assert.equal(writes.length, 2);
}));

test("F3 invalid/denied/unconfirmed states block review, unpublished cleanup and comparison without writes", async () => {
  for (const mode of ["invalid", "denied", "write", "conflict"]) await stores(async ({ values, notify, control, writes, navigation }) => {
    const properties = props(), labels = cartLabels.en;
    let tree = cart(properties);
    if (mode === "invalid") { values.set(CART_STORAGE_KEY, "{"); notify(CART_STORAGE_KEY); }
    if (mode === "denied") { control.readDenied = true; notify(CART_STORAGE_KEY); }
    if (mode === "write" || mode === "conflict") {
      const element = nodes(tree).find(node => typeof node.type === "function" && node.type.name === "QuantityForm");
      let form = render(element.type, element.props, "quantity");
      change(nodes(form).find(node => node.type === "input"), "4"); form = render(element.type, element.props, "quantity");
      if (mode === "write") control.writeDenied = true;
      else values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 6 }, ...lines.slice(1)]));
      nodes(form).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    }
    tree = cart(properties);
    for (const label of [labels.selectUnpublished, labels.reviewUnpublished, labels.selectDisplayed]) {
      assert.equal(button(tree, label).props.disabled, true); button(tree, label).props.onClick();
    }
    assert.equal(search(tree).props.disabled, true); assert.ok(!button(tree, labels.compareSelected));
    const count = writes.length;
    control.writeDenied = false; control.readDenied = false;
    values.set(CART_STORAGE_KEY, serializeCart(lines)); notify(CART_STORAGE_KEY); tree = cart(properties);
    if (mode === "write" || mode === "conflict") {
      assert.equal(button(tree, labels.selectUnpublished).props.disabled, true);
      for (const trigger of nodes(tree).filter(node => node.type === "button" && (node.props["aria-label"]?.startsWith(labels.remove + ":") || text(node) === labels.clear))) trigger.props.onClick();
      assert.equal(writes.length, count);
    }
    assert.deepEqual(navigation, []);
  });
});

test("F4 exactly two public selected Cart rows compare in canonical cart order, independent of name sort and selection order", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ writes, navigation }) => {
    const locale = routeLocale ?? "en", properties = props(locale, routeLocale), labels = cartLabels[locale];
    let tree = cart(properties); assert.ok(!button(tree, labels.compareSelected));
    check(tree, [1]); tree = cart(properties); assert.ok(!button(tree, labels.compareSelected));
    check(tree, [0]); tree = cart(properties); assert.ok(button(tree, labels.compareSelected));
    change(select(tree, "-sort"), "name"); tree = cart(properties);
    button(tree, labels.compareSelected).props.onClick();
    assert.equal(navigation.length, 1);
    const url = new URL(navigation[0], "https://synthetic.invalid");
    assert.equal(url.pathname, routeLocale ? `/${locale}/products` : "/products");
    assert.equal(url.hash, `#${COMPARISON_DESTINATION}`);
    assert.deepEqual(readComparisonContext(Object.fromEntries(url.searchParams)), { first: id, second: other });
    assert.deepEqual(writes, []);
    button(tree, labels.selectDisplayed).props.onClick(); tree = cart(properties); assert.ok(!button(tree, labels.compareSelected));
  });
});

test("F4 unknown/duplicate/stale/denied/changed selections cannot navigate or mutate either store", async () => {
  for (const mode of ["unpublished", "changed", "missing", "invalid", "denied", "notification", "disappeared", "duplicate"]) await stores(async ({ values, control, notify, navigation, writes }) => {
    const properties = props(), labels = cartLabels.en;
    let tree = cart(properties); check(tree, [0, mode === "unpublished" ? 2 : 1]); tree = cart(properties);
    if (mode === "unpublished") { assert.ok(!button(tree, labels.compareSelected)); return; }
    const trigger = button(tree, labels.compareSelected); assert.ok(trigger);
    if (mode === "changed" || mode === "notification") values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 7 }, ...lines.slice(1)]));
    if (mode === "notification") { notify(CART_STORAGE_KEY); tree = cart(properties); assert.ok(!button(tree, labels.compareSelected)); return; }
    if (mode === "missing") values.delete(CART_STORAGE_KEY);
    if (mode === "invalid") values.set(CART_STORAGE_KEY, "{");
    if (mode === "denied") control.readDenied = true;
    if (mode === "duplicate") values.set(CART_STORAGE_KEY, serializeCart([lines[0], { ...lines[0], publicId: id }]));
    if (mode === "disappeared") { tree = cart({ ...properties, products: products.slice(0, 1) }); assert.ok(!button(tree, labels.compareSelected)); return; }
    trigger.props.onClick(); assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
    tree = cart(properties); assert.ok(text(tree).includes(labels.bulkSelectionChanged));
  });
});

test("F5 literal single cartReturn creates only a canonical locale Cart link; catalogue/comparison Back remain distinct", () => {
  for (const value of [undefined, null, "", "01", "true", 1, ["1"], ["1", "1"], "1 ", "https://evil.invalid", "1".repeat(500)]) assert.equal(readCartReturn(value), false);
  assert.equal(readCartReturn("1"), true);
  const content = name => ({ name, description: "Synthetic only.", images: [], usage: null, caution: null });
  const record = (publicId, slug, state = "published") => ({ publicId, slug, brand: "Anua", state, translations: { en: content(slug), hu: content(slug), ko: content(slug) } });
  const catalogue = createLocalCatalogueReader([record(id, "one"), record(other, "two"), record(hidden, "private", "draft")]);
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", options = { slug: "one", catalogue, locale, routeLocale,
      criteria: { query: "árvíz 한국", brand: "Anua", sort: "name-desc" }, comparisonContext: { first: id, second: other } };
    const detail = ProductDetail({ ...options, cartReturn: readCartReturn("1") });
    const links = nodes(detail).filter(node => node.props?.href);
    assert.equal(links.find(node => node.props.children === cartLabels[locale].backToCart).props.href, routeLocale ? `/${locale}/cart` : "/cart");
    assert.ok(links.some(node => node.props.children === storefrontLabels[locale].back && !node.props.href.includes("cartReturn")));
    assert.ok(links.some(node => node.props.children === comparisonLabels[locale].backToComparison));
    assert.ok(!nodes(ProductDetail(options)).some(node => node.props?.children === cartLabels[locale].backToCart));
    for (const slug of ["private", "unknown"]) assert.throws(() => ProductDetail({ ...options, slug, cartReturn: true }));
  }
});

test("F5 cart links carry only cartReturn=1 and preserve immutable public slugs in every route locale", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ writes }) => {
    const locale = routeLocale ?? "en", tree = cart(props(locale, routeLocale));
    const links = nodes(tree).filter(node => node.props?.href?.includes("cartReturn="));
    assert.equal(links.length, 3);
    assert.deepEqual(links.map(node => node.props.href), products.map(product => `${routeLocale ? "/" + locale : ""}/products/${product.slug}?cartReturn=1`));
    assert.deepEqual(writes, []);
  });
});

test("F2 focus after sorted individual removal targets a visible survivor by identity, not original array index", async () => stores(async ({ values }) => {
  const properties = props(); let tree = cart(properties);
  change(select(tree, "-sort"), "name"); tree = cart(properties);
  const focused = [];
  const removals = nodes(tree).filter(node => node.type === "button" && node.props["aria-label"]?.startsWith(cartLabels.en.remove + ":"));
  removals.forEach(node => node.props.ref({ focus: () => focused.push(node.props["aria-label"]) }));
  removals[0].props.onClick();
  assert.deepEqual(focused, [`${cartLabels.en.remove}: Beta`]);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [lines[0], lines[2], lines[3]]);
}));

test("F1–F5 source boundaries, exact route parsing, locale labels and native mobile controls stay bounded", () => {
  for (const path of ["app/products/[slug]/page.tsx", "app/[locale]/products/[slug]/page.tsx"]) {
    const source = readFileSync(join(repo, path), "utf8");
    assert.match(source, /cartReturn: readCartReturn\(query.cartReturn\)/);
    const metadata = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default"));
    assert.doesNotMatch(metadata, /cartReturn|readCartReturn/);
  }
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(cartLabels[locale]), Object.keys(cartLabels.en));
    for (const value of Object.values(cartLabels[locale])) assert.ok(value.trim());
    driver.instances.clear();
    const tree = cart(props(locale));
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => node.props.type === "button"));
    assert.equal(search(tree).props.maxLength, CART_REVIEW_QUERY_LIMIT);
    for (const control of [search(tree), select(tree, "-brand"), select(tree, "-sort")]) {
      assert.ok(nodes(tree).some(node => node.type === "label" && node.props.htmlFor === control.props.id));
      assert.match(control.props.className, /min-w-0 max-w-full/);
    }
  }
  assert.doesNotMatch(readFileSync(join(repo, "lib/cart/cart-review-view.ts"), "utf8"), /window|document|localStorage|sessionStorage|fetch\(/);
  const source = readFileSync(join(repo, "components/cart/ShoppingCart.tsx"), "utf8");
  assert.match(source, /readBulkSelection\(cart, checked.ids\)/); assert.match(source, /comparisonHref/);
  assert.doesNotMatch(source, /import ProductComparison|localStorage.setItem|sessionStorage|fetch\(/);
  driver.instances.clear();
});
