import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { readShoppingPlan, planIntakeHref, shoppingPlanShareLink, shoppingPlanHref } from "../lib/catalog/catalogue-shopping-plan.ts";
import { portablePayload, readPortableLink } from "../lib/cart/cart-portable-handoff.ts";
import { cartDraftImpact } from "../lib/cart/cart-draft-impact.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { RECENT_STORAGE_KEY, serializeRecent } from "../lib/recently-viewed/recent-state.ts";
import { storefrontLabels, storefrontHref } from "../lib/storefront/localization.ts";
import { cartLabels } from "../lib/cart/labels.ts";

const id = index => `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`;
const records = [1, 2, 3].map(index => ({ publicId: id(index), slug: `synthetic-${index}`, brand: index === 1 ? "Anua" : "beplain", state: "published",
  translations: { en: { name: `Synthetic ${index}`, description: "Test only", images: [], usage: null, caution: null }, hu: null, ko: null } }));
const catalogue = createLocalCatalogueReader([...records, { ...records[0], publicId: id(99), slug: "private-test", state: "draft" }]);
const products = records.map(record => ({ publicId: record.publicId, slug: record.slug, brand: record.brand,
  names: { en: record.translations.en.name, hu: null, ko: null } }));
const savedProducts = products.map(product => ({ ...product, name: product.names.en }));
const comparisons = products.map(product => ({ ...product, name: product.names.en, description: "Test only", usage: null, caution: null, image: null }));
const lines = [{ publicId: id(1), quantity: 3 }, { publicId: id(2), quantity: 1 }];
const ctx = (prefix = "/en", plan = lines, query = "?q=synthetic&sort=name-desc") => ({ plan: readShoppingPlan(portablePayload(plan), records), path: `${prefix}/products`, query, publishedIds: records.map(record => record.publicId) });
const parsedPlan = href => readShoppingPlan(new URL(href, "https://synthetic.invalid").searchParams.get("cartPlan"), records);

// Existing installed Node/TS JSX + hook/store convention, not hydrated browser evidence.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,effects:[],subscriptions:new Map(),serial:0,context:null};
export function useState(initial){const s=driver.active,i=driver.index++;if(!(i in s))s[i]=typeof initial==='function'?initial():initial;return [s[i],v=>{s[i]=typeof v==='function'?v(s[i]):v;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function createContext(){return {Provider:Symbol('plan-provider')};}
export function useContext(){return driver.context;}
export function useEffect(effect,deps){const s=driver.active,i=driver.index++,old=s[i];if(!old||!deps||!old.deps||deps.some((v,j)=>!Object.is(v,old.deps[j]))||deps.length!==old.deps.length){driver.effects.push(()=>{old?.cleanup?.();s[i]={effect:true,deps,cleanup:effect()};});}}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/(catalogue\/(CatalogueShoppingPlan|SavedProductsBar|RecentlyViewedProducts|ProductComparison)|cart\/ShoppingCart)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites|recently-viewed\/browser-recent)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const { default: Saved } = await import("../components/catalogue/SavedProductsBar.tsx");
const { default: Recent } = await import("../components/catalogue/RecentlyViewedProducts.tsx");
const { default: Comparison } = await import("../components/catalogue/ProductComparison.tsx");
const { default: Plan, ShoppingPlanIntake } = await import("../components/catalogue/CatalogueShoppingPlan.tsx");
const { default: Cart } = await import("../components/cart/ShoppingCart.tsx");
const { ProductListing, ProductDetail } = await import("../components/catalogue/ProductCatalogue.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts"), favorites = await import("../lib/favorites/browser-favorites.ts"), recent = await import("../lib/recently-viewed/browser-recent.ts");
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = tree => nodes(tree).filter(node => typeof node === "string" || typeof node === "number").join(" ");
const links = tree => nodes(tree).filter(node => typeof node.props?.href === "string");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  driver.active = driver.instances.get(key); driver.index = 0; driver.effects = [];
  const tree = component(props);
  for (const effect of driver.effects) effect();
  return tree;
}
function dispose(key) {
  for (const hook of driver.instances.get(key) ?? []) if (hook?.effect) hook.cleanup?.();
  driver.instances.delete(key);
}
const child = (root, component) => nodes(root).find(node => node.type === component);
async function stores(run, initialCart = [{ publicId: id(1), quantity: 5 }]) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const values = new Map([[CART_STORAGE_KEY, serializeCart(initialCart)], [FAVORITES_STORAGE_KEY, serializeFavorites([id(1), id(2), id(3)])], [RECENT_STORAGE_KEY, serializeRecent([id(3), id(2), id(1)])]]);
  const writes = [], navigation = [], copied = [], events = new Map();
  const location = new URL("https://synthetic.invalid/en/products?q=synthetic");
  location.assign = href => navigation.push(href);
  const control = { denied: false, writeDenied: false, beforeRead: null, afterWrite: null, clipboard: async value => { copied.push(value); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, localStorage: {
    getItem(key) { control.beforeRead?.(key); if (control.denied) throw new Error("Synthetic denied"); return values.get(key) ?? null; },
    setItem(key, value) { if (control.writeDenied) throw new Error("Synthetic write denied"); writes.push(key); values.set(key, value); control.afterWrite?.(); },
  }, addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); }, removeEventListener(type, fn) { events.get(type)?.delete(fn); } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: value => control.clipboard(value) } } });
  browserCart.useBrowserCart(); favorites.useBrowserFavorites(); recent.useBrowserRecent();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.get("storage")?.forEach(callback => callback({ key }));
  notify(null);
  try { await run({ values, writes, navigation, copied, control, location, notify }); }
  finally {
    [...driver.instances.keys()].forEach(dispose); unsubscribers.forEach(unsubscribe => unsubscribe()); driver.subscriptions.clear();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else delete globalThis.window;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator;
  }
}
function collection(Component, properties) {
  const root = render(Component, properties, "collection");
  const element = child(root, ShoppingPlanIntake);
  return { root, element, intake: render(ShoppingPlanIntake, element.props, "intake") };
}
function select(root, indexes) {
  const checkboxes = nodes(root).filter(node => node.type === "input" && node.props.type === "checkbox");
  for (const index of indexes) checkboxes[index].props.onChange({ target: { checked: true } });
}
function cart(properties = {}) {
  const root = render(Cart, { products, locale: "en", routeLocale: "en", ...properties }, "cart");
  const handoff = nodes(root).find(node => node.type?.name === "PortableCartHandoff");
  const panel = render(handoff.type, handoff.props, "handoff");
  return { root, panel: render(panel.type, panel.props, `panel:${panel.key}`) };
}
const draftUrl = (incoming = [{ publicId: id(1), quantity: 2 }, { publicId: id(2), quantity: 4 }], path = "/en/cart") => `https://synthetic.invalid${path}?${new URLSearchParams({ cartDraft: portablePayload(incoming) })}`;

test("F1/F2 pure composition preserves previous quantities/order, aliases, whole limits and private identity refusal", () => {
  assert.deepEqual(parsedPlan(planIntakeHref(ctx(), [id(2).toUpperCase(), id(3)]).href).lines, [...lines, { publicId: id(3), quantity: 1 }]);
  assert.equal(planIntakeHref(ctx(), [id(1), id(2)]).status, "unchanged");
  for (const ids of [[], [id(99)], ["bad"]]) assert.equal(planIntakeHref(ctx(), ids).status, "invalid");
  assert.equal(planIntakeHref({ ...ctx(), publishedIds: [id(1), id(1)] }, [id(1)]).status, "invalid");
  assert.equal(planIntakeHref({ ...ctx(), query: "?q=" + "x".repeat(8192) }, [id(3)]).status, "limit");
  const many = Array.from({ length: 41 }, (_, index) => ({ publicId: id(index + 1) }));
  const forty = { ...ctx(), plan: readShoppingPlan(portablePayload(many.slice(0, 40).map(product => ({ publicId: product.publicId, quantity: 1 }))), many), publishedIds: many.map(product => product.publicId) };
  assert.equal(planIntakeHref(forty, [id(41)]).status, "limit");
});

test("F1 Saved selection uses display order, retains full plan and performs zero store writes", async () => stores(async ({ navigation, writes }) => {
  const props = { products: savedProducts, comparisonProducts: comparisons, locale: "en", routeLocale: "en", planContext: ctx() };
  let tree = collection(Saved, props); select(tree.root, [2, 1]); tree = collection(Saved, props);
  button(tree.intake, storefrontLabels.en.planAddCollection).props.onClick();
  assert.deepEqual(parsedPlan(navigation[0]).lines, [...lines, { publicId: id(3), quantity: 1 }]);
  button(tree.intake, storefrontLabels.en.planAddCollection).props.onClick(); assert.equal(navigation.length, 1);
  assert.deepEqual(writes, []);
}));

test("F1 Saved stale storage, changed filter and denied reads refuse intake without partial navigation", async () => {
  for (const mode of ["stale", "filter", "denied"]) await stores(async ({ values, control, navigation, writes }) => {
    const props = { products: savedProducts, locale: "en", routeLocale: "en", planContext: ctx() };
    let tree = collection(Saved, props); select(tree.root, [1, 2]); tree = collection(Saved, props);
    const oldAction = button(tree.intake, storefrontLabels.en.planAddCollection);
    if (mode === "stale") values.set(FAVORITES_STORAGE_KEY, serializeFavorites([id(1)]));
    if (mode === "denied") control.denied = true;
    if (mode === "filter") {
      nodes(tree.root).find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "no matches" } });
      collection(Saved, props);
    }
    oldAction.props.onClick(); assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
  });
});

test("F2 Recent intake follows visible MRU order and refuses unnotified changed history, denied reads or obsolete selection", async () => {
  for (const mode of ["ready", "stale", "notification", "same-notification", "denied"]) await stores(async ({ values, control, navigation, writes, notify }) => {
    const props = { products: savedProducts, comparisonProducts: comparisons, locale: "en", routeLocale: "en", planContext: ctx("/en", [lines[0]]) };
    let tree = collection(Recent, props); select(tree.root, [1, 0]); tree = collection(Recent, props);
    const action = button(tree.intake, storefrontLabels.en.planAddCollection);
    if (mode === "stale" || mode === "notification") values.set(RECENT_STORAGE_KEY, serializeRecent([id(1)]));
    if (mode === "notification") { notify(RECENT_STORAGE_KEY); collection(Recent, props); }
    if (mode === "same-notification") notify(RECENT_STORAGE_KEY);
    if (mode === "denied") control.denied = true;
    action.props.onClick();
    if (mode === "ready") assert.deepEqual(parsedPlan(navigation[0]).lines, [lines[0], { publicId: id(3), quantity: 1 }, { publicId: id(2), quantity: 1 }]);
    else assert.deepEqual(navigation, []);
    assert.deepEqual(writes, []);
  });
});

test("F3 current pair after swap/reselection is used; obsolete pair handlers refuse, comparison share schema unchanged", async () => stores(async ({ navigation, writes }) => {
  const props = { products: comparisons, locale: "en", routeLocale: "en", initialPublicId: id(1), initialSecondPublicId: id(2), planContext: { ...ctx(), plan: { status: "empty", lines: [] } } };
  let root = render(Comparison, props, "comparison"), element = child(root, ShoppingPlanIntake), tree = render(ShoppingPlanIntake, element.props, "intake");
  const old = button(tree, storefrontLabels.en.planAddPair);
  const swap = nodes(root).find(node => node.type === "button" && node.props.onClick?.toString().includes("pair[1], pair[0]"));
  swap.props.onClick(); root = render(Comparison, props, "comparison"); element = child(root, ShoppingPlanIntake); render(ShoppingPlanIntake, element.props, "intake");
  old.props.onClick(); assert.deepEqual(navigation, []);
  nodes(root).find(node => node.type === "select").props.onChange({ target: { value: id(3) } });
  root = render(Comparison, props, "comparison"); element = child(root, ShoppingPlanIntake); tree = render(ShoppingPlanIntake, element.props, "intake");
  button(tree, storefrontLabels.en.planAddPair).props.onClick();
  assert.deepEqual(parsedPlan(navigation[0]).lines, [{ publicId: id(3), quantity: 1 }, { publicId: id(1), quantity: 1 }]);
  const share = nodes(root).find(node => node.type?.name === "CopyComparisonLink");
  assert.ok(!share.props.relativeHref.includes("cartPlan")); assert.deepEqual(writes, []);
}));

test("F4 share helper permits only canonical same-origin bounded public plans and preserves locale/browse fields", () => {
  for (const prefix of ["", "/en", "/hu", "/ko"]) {
    const url = new URL(shoppingPlanShareLink("https://synthetic.invalid", ctx(prefix)));
    assert.equal(url.pathname, `${prefix}/products`); assert.deepEqual(parsedPlan(url.href).lines, lines);
    assert.equal(url.searchParams.get("q"), "synthetic"); assert.equal(url.searchParams.get("sort"), "name-desc");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["cartPlan", "q", "sort"]);
  }
  for (const origin of ["javascript:x", "https://user@synthetic.invalid", "https://synthetic.invalid/path"]) assert.equal(shoppingPlanShareLink(origin, ctx()), null);
  for (const context of [{ ...ctx(), publishedIds: [id(1)] }, { ...ctx(), query: "?returnUrl=bad" }, { ...ctx(), path: "//other.invalid/products" }, { ...ctx(), query: "?q=" + "x".repeat(8192) }]) assert.equal(shoppingPlanShareLink("https://synthetic.invalid", context), null);
});

function copyPanel(context = ctx(), locale = "en", routeLocale = locale) {
  const plan = render(Plan, { ...context, products: comparisons, visibleIds: products.map(product => product.publicId), locale, routeLocale }, "plan");
  const element = nodes(plan).find(node => node.type?.name === "CopyShoppingPlan");
  if (!element) { dispose("copy"); return { element: null, tree: plan }; }
  return { element, tree: render(element.type, element.props, "copy") };
}

test("F4 clipboard is explicit/awaited, reentry guarded, and denial never claims copied; no stores are mutated", async () => {
  for (const mode of ["ready", "denied", "missing"]) await stores(async ({ control, copied, writes }) => {
    let resolve;
    control.clipboard = value => { copied.push(value); return new Promise((yes, no) => { resolve = mode === "denied" ? () => no(new Error("Denied")) : yes; }); };
    if (mode === "missing") Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    let panel = copyPanel(); const action = button(panel.tree, storefrontLabels.en.planCopy);
    const pending = action.props.onClick(); action.props.onClick();
    assert.ok(!text(copyPanel().tree).includes(storefrontLabels.en.planCopied));
    if (mode !== "missing") resolve(); await pending;
    panel = copyPanel();
    assert.equal(text(panel.tree).includes(storefrontLabels.en.planCopied), mode === "ready");
    assert.equal(copied.length, mode === "missing" ? 0 : 1); assert.deepEqual(writes, []);
  });
});

test("F4 stale asynchronous copy after locale/publication/location change or unmount cannot announce success", async () => {
  for (const mode of ["locale", "publication", "location", "unmount"]) await stores(async ({ control, location, writes }) => {
    let resolve; control.clipboard = () => new Promise(yes => { resolve = yes; });
    let panel = copyPanel(); const pending = button(panel.tree, storefrontLabels.en.planCopy).props.onClick();
    if (mode === "locale") panel = copyPanel(ctx("/hu"), "hu");
    if (mode === "publication") panel = copyPanel({ ...ctx(), publishedIds: [id(1)] });
    if (mode === "location") location.href = "https://synthetic.invalid/ko/products";
    if (mode === "unmount") dispose("copy");
    resolve(); await pending;
    if (mode !== "unmount") assert.ok(!text(panel.element ? render(panel.element.type, panel.element.props, "copy") : panel.tree).includes(storefrontLabels.en.planCopied));
    assert.deepEqual(writes, []);
  });
});

test("F1–F4 legacy/EN/HU/KO intake and explicit copy keep native controls, full plan, locale and store bytes", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ navigation, writes, copied }) => {
    const locale = routeLocale ?? "en", prefix = routeLocale ? `/${locale}` : "", context = ctx(prefix);
    const projection = savedProducts.map(product => ({ ...product, name: locale === "en" ? product.name : storefrontLabels[locale].details }));
    const props = { products: projection, comparisonProducts: comparisons, locale, routeLocale, planContext: context };
    for (const Component of [Saved, Recent]) {
      dispose("collection"); dispose("intake");
      let tree = collection(Component, props); select(tree.root, [1, 2]); tree = collection(Component, props);
      const action = button(tree.intake, storefrontLabels[locale].planAddCollection);
      assert.equal(action.props.type, "button"); assert.match(action.props.className, /min-h-11.*max-w-full.*break-words/);
      action.props.onClick(); assert.equal(new URL(navigation.at(-1), "https://synthetic.invalid").pathname, `${prefix}/products`);
      assert.ok(parsedPlan(navigation.at(-1)).lines.some(line => line.publicId === id(1) && line.quantity === 3));
    }
    const pairProps = { products: comparisons, locale, routeLocale, initialPublicId: id(1), initialSecondPublicId: id(2), planContext: context };
    const pair = render(Comparison, pairProps, "pair-locale"), element = child(pair, ShoppingPlanIntake);
    const action = button(render(ShoppingPlanIntake, element.props, "pair-intake"), storefrontLabels[locale].planAddPair);
    assert.equal(action.props.type, "button"); assert.equal(action.props.disabled, false);
    let panel = copyPanel(context, locale, routeLocale);
    await button(panel.tree, storefrontLabels[locale].planCopy).props.onClick(); panel = copyPanel(context, locale, routeLocale);
    assert.ok(text(panel.tree).includes(storefrontLabels[locale].planCopied));
    assert.equal(new URL(copied[0]).pathname, `${prefix}/products`); assert.deepEqual(parsedPlan(copied[0]).lines, lines);
    assert.deepEqual(writes, []);
  });
});

test("F6 duplicate/repeated/unknown/oversized incoming drafts never offer an editable plan or mutate Cart", async () => {
  const payload = portablePayload(lines);
  for (const query of [new URLSearchParams({ cartDraft: `v1.${id(1)}:1,${id(1)}:2` }),
    `cartDraft=${payload}&cartDraft=${payload}`, new URLSearchParams({ cartDraft: `v1.${id(99)}:1` }),
    new URLSearchParams({ cartDraft: "x".repeat(8193) })]) await stores(async ({ location, writes }) => {
    location.href = `https://synthetic.invalid/en/cart?${query}`;
    const tree = cart().panel;
    assert.ok(text(tree).includes(cartLabels.en.portableInvalid));
    assert.ok(!links(tree).some(link => text(link) === storefrontLabels.en.planEditDraft));
    assert.deepEqual(writes, []);
  });
});

test("F5 impact composes CLOSED additive merger, retains hidden/case/order lines and gives exact hypothetical quantities", () => {
  const current = [{ publicId: id(99), quantity: 8 }, { publicId: id(1).toUpperCase(), quantity: 5 }], incoming = [{ publicId: id(1), quantity: 2 }, { publicId: id(2), quantity: 4 }];
  const before = JSON.stringify(current), impact = cartDraftImpact(current, incoming, products);
  assert.deepEqual(impact, { status: "ready", rows: [{ publicId: id(1), current: 5, added: 2, expected: 7 }, { publicId: id(2), current: null, added: 4, expected: 4 }], newLines: 1, existingLines: 1, units: "11" });
  assert.equal(JSON.stringify(current), before);
  assert.equal(cartDraftImpact([{ publicId: id(1), quantity: Number.MAX_SAFE_INTEGER }], incoming, products).status, "overflow");
  assert.equal(cartDraftImpact(current, [{ publicId: id(99), quantity: 1 }], products).status, "invalid");
  const huge = products.slice(0, 2).map(product => ({ publicId: product.publicId, quantity: Number.MAX_SAFE_INTEGER }));
  assert.equal(cartDraftImpact([], huge, products).units, (BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2)).toString());
});

test("F5/F6 healthy Cart impact is labelled not saved, edit is clean/localized and byte-for-byte storage remains unchanged", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ location, values, writes }) => {
    const locale = routeLocale ?? "en"; location.href = draftUrl(undefined, storefrontHref("/cart", routeLocale));
    const before = values.get(CART_STORAGE_KEY), tree = cart({ locale, routeLocale }).panel, labels = storefrontLabels[locale];
    assert.ok(text(tree).includes(labels.planImpact)); assert.ok(text(tree).includes(labels.planAbsent));
    assert.ok(text(tree).includes(labels.planExpected));
    const edit = links(tree).find(link => text(link) === labels.planEditDraft);
    assert.equal(new URL(edit.props.href, location).pathname, storefrontHref("/products", routeLocale));
    assert.deepEqual(parsedPlan(edit.props.href).lines, readPortableLink(location.href).lines);
    assert.deepEqual([...new URL(edit.props.href, location).searchParams.keys()], ["cartPlan"]);
    assert.equal(values.get(CART_STORAGE_KEY), before); assert.deepEqual(writes, []);
  });
});

test("F5/F6 denied/corrupt/stale/overflow Cart cannot promise merge impact; invalid drafts have no edit link", async () => {
  for (const mode of ["denied", "corrupt", "stale", "overflow", "invalid-draft"]) await stores(async ({ location, values, writes, control, notify }) => {
    location.href = draftUrl();
    if (mode === "denied") control.denied = true;
    if (mode === "corrupt") values.set(CART_STORAGE_KEY, "bad");
    if (mode === "stale") values.set(CART_STORAGE_KEY, serializeCart([]));
    if (mode === "overflow") { values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id(1), quantity: Number.MAX_SAFE_INTEGER }])); notify(CART_STORAGE_KEY); }
    if (mode === "invalid-draft") location.href = draftUrl([{ publicId: id(99), quantity: 1 }]);
    // Snapshot can remain stale; fresh persisted witness is mandatory even without notification.
    const tree = cart().panel;
    if (mode !== "invalid-draft") assert.ok(text(tree).includes(storefrontLabels.en.planImpactUnsafe));
    else assert.ok(!links(tree).some(link => text(link) === storefrontLabels.en.planEditDraft));
    assert.deepEqual(writes, []);
  });
});

test("F7 verified merge alone exposes public visible row targets, hidden rows explained, hash cannot reset consumed draft", async () => stores(async ({ location, writes }) => {
  location.href = draftUrl(); let tree = cart();
  assert.ok(!nodes(tree.panel).some(node => node.props?.["aria-label"] === storefrontLabels.en.planReviewSaved));
  button(tree.panel, cartLabels.en.portableMerge).props.onClick(); tree = cart();
  const review = nodes(tree.panel).find(node => node.props?.["aria-label"] === storefrontLabels.en.planReviewSaved);
  assert.ok(review); assert.deepEqual(links(review).map(link => link.props.href), [`#cart-item-${id(1)}`, `#cart-item-${id(2)}`]);
  assert.ok(!links(tree.panel).some(link => text(link) === storefrontLabels.en.planEditDraft));
  const search = nodes(tree.root).find(node => node.type === "input" && node.props.type === "search");
  search.props.onChange({ target: { value: "no-match" } }); tree = cart();
  assert.ok(text(tree.panel).includes(storefrontLabels.en.planReviewHidden));
  assert.equal(links(nodes(tree.panel).find(node => node.props?.["aria-label"] === storefrontLabels.en.planReviewSaved)).length, 0);
  location.hash = `#cart-item-${id(1)}`; tree = cart();
  assert.equal(button(tree.panel, cartLabels.en.portableMerge).props.disabled, true);
  button(tree.panel, cartLabels.en.portableMerge).props.onClick(); assert.equal(writes.length, 1);
}));

test("F7 stale or uncertain merge never exposes saved targets; subsequent storage changes revoke confirmed targets", async () => {
  for (const mode of ["conflict", "write-failed", "readback", "post-change"]) await stores(async ({ values, location, control, notify, writes }) => {
    location.href = draftUrl(); let tree = cart();
    if (mode === "conflict") values.set(CART_STORAGE_KEY, serializeCart([]));
    if (mode === "write-failed") control.writeDenied = true;
    if (mode === "readback") control.afterWrite = () => values.set(CART_STORAGE_KEY, "bad");
    button(tree.panel, cartLabels.en.portableMerge).props.onClick(); tree = cart();
    if (mode === "post-change") {
      assert.ok(nodes(tree.panel).some(node => node.props?.["aria-label"] === storefrontLabels.en.planReviewSaved));
      values.set(CART_STORAGE_KEY, serializeCart([])); notify(CART_STORAGE_KEY); tree = cart();
    }
    assert.ok(!nodes(tree.panel).some(node => node.props?.["aria-label"] === storefrontLabels.en.planReviewSaved));
    assert.equal(writes.length, mode === "post-change" || mode === "readback" ? 1 : 0);
  });
});

test("Server projection supplies validated public-only plan context to Saved/Recent/comparison, including detail; routes/SEO/stores stay unchanged", () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) {
    const locale = routeLocale ?? "en", root = ProductListing({ catalogue, locale, routeLocale, planHint: portablePayload(lines) });
    for (const Component of [Saved, Recent, Comparison]) {
      const projection = child(root, Component).props.planContext;
      assert.deepEqual(projection.plan.lines, lines); assert.deepEqual(projection.publishedIds, records.map(record => record.publicId));
      assert.equal(projection.path, storefrontHref("/products", routeLocale));
      assert.ok(!JSON.stringify(projection).includes(id(99)));
      assert.deepEqual(Object.keys(projection).sort(), ["path", "plan", "publishedIds", "query"]);
    }
    const detail = ProductDetail({ catalogue, slug: records[0].slug, locale, routeLocale, planHint: portablePayload(lines) });
    assert.deepEqual(child(detail, Comparison).props.planContext.plan.lines, lines);
  }
  assert.match(readFileSync(join(repo, "data/catalogue.ts"), "utf8"), /Object.freeze\(\[\]\)/);
  assert.deepEqual(Object.keys(storefrontLabels.en).sort(), Object.keys(storefrontLabels.hu).sort());
  assert.deepEqual(Object.keys(storefrontLabels.en).sort(), Object.keys(storefrontLabels.ko).sort());
  assert.equal(shoppingPlanHref("/products", "", lines)?.includes("cartDraft"), false);
  assert.equal(inspectStoredCart(serializeCart(lines)).invalid, false);
});
