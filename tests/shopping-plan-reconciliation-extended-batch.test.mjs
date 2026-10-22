import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { readShoppingPlan, shoppingPlanHref } from "../lib/catalog/catalogue-shopping-plan.ts";
import { portablePayload, readPortableLink } from "../lib/cart/cart-portable-handoff.ts";
import { cartDraftImpact } from "../lib/cart/cart-draft-impact.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { RECENT_STORAGE_KEY, serializeRecent } from "../lib/recently-viewed/recent-state.ts";
import { storefrontLabels, storefrontHref } from "../lib/storefront/localization.ts";

const id = index => `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`;
const records = [1, 2, 3, 4].map(index => ({ publicId: id(index), slug: `synthetic-${index}`, brand: index === 1 ? "Anua" : "beplain", state: "published",
  translations: { en: { name: `Synthetic ${index}`, description: "Test only", images: [], usage: null, caution: null }, hu: null, ko: null } }));
const catalogue = createLocalCatalogueReader([...records, { ...records[0], publicId: id(99), slug: "private-test", state: "draft" }]);
const products = records.map(record => ({ publicId: record.publicId, slug: record.slug, brand: record.brand,
  names: { en: record.translations.en.name, hu: null, ko: null } }));
const comparisons = products.map(product => ({ ...product, name: product.names.en, description: "Test only", usage: null, caution: null, image: null }));
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
const { default: Plan } = await import("../components/catalogue/CatalogueShoppingPlan.tsx");
const { default: Cart } = await import("../components/cart/ShoppingCart.tsx");
const { ProductListing, ProductDetail } = await import("../components/catalogue/ProductCatalogue.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts"), favorites = await import("../lib/favorites/browser-favorites.ts"), recent = await import("../lib/recently-viewed/browser-recent.ts");
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = tree => nodes(tree).filter(node => typeof node === "string" || typeof node === "number").join("");
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


import { plannedReview, changePlannedLines, readFreshPlanCart, currentCartPlanHref, EMPTY_PLAN_VIEW } from "../lib/catalog/shopping-plan-workspace.ts";
const four = [3, 1, 5, 2].map((quantity, i) => ({ publicId: id(i + 1), quantity }));
const properties = (locale = "en", routeLocale = locale, lines = four) => ({
  plan: readShoppingPlan(portablePayload(lines), records), products: comparisons.map(product => ({ ...product, name: locale === "en" ? product.name : null })),
  publishedIds: records.map(product => product.publicId), visibleIds: [], locale, routeLocale,
  path: storefrontHref("/products", routeLocale), query: "?q=synthetic&sort=name-desc",
});
const ui = props => render(Plan, props, "plan");
const rows = tree => nodes(tree).filter(node => node.type === "li");
const search = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "search");
const bulkForm = tree => nodes(tree).find(node => node.type === "form" && button(node, storefrontLabels.en.planSetSelected));
const remove = (tree, locale = "en") => nodes(tree).find(node => node.type === "button" && text(node).startsWith(storefrontLabels[locale].planRemoveSelected + " ("));

test("F1 pure planned review is bounded/localized/presentation-only and leaves full serialized plan intact", () => {
  const props = properties(), before = portablePayload(four);
  const view = plannedReview(props.plan, props.products, "en", { query: "synthetic", brand: "beplain", sort: "name" });
  assert.deepEqual(view.rows.map(row => row.line.publicId), [id(2), id(3), id(4)]);
  assert.equal(view.total, 4); assert.equal(portablePayload(props.plan.lines), before);
  assert.equal(plannedReview(props.plan, props.products, "en", { ...EMPTY_PLAN_VIEW, query: "no-match" }).rows.length, 0);
  assert.equal(plannedReview(props.plan, props.products.map(product => ({ ...product, name: null })), "hu", EMPTY_PLAN_VIEW).rows.length, 4);
  assert.equal(plannedReview({ status: "invalid", lines: [] }, props.products, "ko", EMPTY_PLAN_VIEW).total, 0);
});
test("F3/F4 bulk is absolute, whole-plan validated and preserves untouched quantities/order including deliberate empty result", () => {
  const props = properties(), ids = four.map(line => line.publicId);
  assert.deepEqual(changePlannedLines(props.plan, [id(2), id(3)], ids, records, { kind: "remove" }).lines, [four[0], four[3]]);
  assert.deepEqual(changePlannedLines(props.plan, [id(1), id(3)], ids, records, { kind: "set", raw: "4" }).lines.map(line => line.quantity), [4, 1, 4, 2]);
  assert.equal(changePlannedLines(props.plan, [id(1)], ids, records, { kind: "set", raw: "3" }).status, "unchanged");
  assert.deepEqual(changePlannedLines(props.plan, ids, ids, records, { kind: "remove" }).lines, []);
  for (const raw of ["0", "-1", "1.5", "1e2", "9007199254740992", "", " 4"]) assert.equal(changePlannedLines(props.plan, [id(1)], ids, records, { kind: "set", raw }).status, "invalid");
  for (const chosen of [[], [id(99)], [id(1), id(1)]]) assert.equal(changePlannedLines(props.plan, chosen, ids, records, { kind: "remove" }).status, "invalid");
  assert.equal(changePlannedLines(props.plan, [id(1)], [id(2)], records, { kind: "remove" }).status, "invalid");
  assert.equal(changePlannedLines(props.plan, [id(1)], ids, records.slice(0, 2), { kind: "remove" }).status, "invalid");
});
test("F5 canonical priority moves preserve quantities and reject hidden/sorted full-view ambiguity", () => {
  const props = properties(), ids = four.map(line => line.publicId);
  assert.deepEqual(changePlannedLines(props.plan, [id(4)], ids, records, { kind: "move", direction: -1 }).lines, [four[0], four[1], four[3], four[2]]);
  assert.equal(changePlannedLines(props.plan, [id(1)], ids, records, { kind: "move", direction: -1 }).status, "unchanged");
  for (const view of [ids.slice(1), [...ids].reverse()]) assert.equal(changePlannedLines(props.plan, [id(4)], view, records, { kind: "move", direction: -1 }).status, "invalid");
});
test("F1/F2 legacy EN/HU/KO native review/filter/reset controls invalidate hidden selection without writes", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ navigation, writes }) => {
    const locale = routeLocale ?? "en", labels = storefrontLabels[locale], props = properties(locale, routeLocale);
    let tree = ui(props); select(tree, [1, 2]); tree = ui(props);
    assert.ok(text(tree).includes(labels.planSelected + ": 2"));
    search(tree).props.onChange({ target: { value: "no-match" } }); tree = ui(props);
    assert.equal(rows(tree).length, 0); assert.equal(remove(tree, locale).props.disabled, true);
    assert.ok(text(tree).includes(labels.noResults));
    button(tree, labels.planResetView).props.onClick(); tree = ui(props); assert.equal(rows(tree).length, 4);
    button(tree, labels.planSelectDisplayed).props.onClick(); tree = ui(props); assert.ok(text(tree).includes(labels.planSelected + ": 4"));
    button(tree, labels.planClearSelection).props.onClick(); tree = ui(props); assert.equal(remove(tree, locale).props.disabled, true);
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => /min-h-11/.test(node.props.className)));
    if (locale !== "en") assert.ok(!text(tree).includes("Synthetic 1"));
    assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
  });
});
test("F3 explicit remove selected preserves other lines; remove all uses clean empty-plan URL, not empty Cart", async () => {
  for (const all of [false, true]) await stores(async ({ navigation, writes, values }) => {
    const props = properties(), before = values.get(CART_STORAGE_KEY); let tree = ui(props);
    if (all) button(tree, storefrontLabels.en.planSelectDisplayed).props.onClick(); else select(tree, [1, 2]);
    tree = ui(props); remove(tree).props.onClick(); assert.equal(navigation.length, 1);
    if (all) assert.equal(new URL(navigation[0], "https://synthetic.invalid").searchParams.has("cartPlan"), false);
    else assert.deepEqual(parsedPlan(navigation[0]).lines, [four[0], four[3]]);
    assert.equal(values.get(CART_STORAGE_KEY), before); assert.deepEqual(writes, []);
  });
});
test("F4 selected quantity form navigates only after valid whole-plan Set; invalid/unchanged drafts do not act", async () => {
  for (const raw of ["4", "3", "0", "1.5", "9007199254740992"]) await stores(async ({ navigation, writes }) => {
    const props = properties(); let tree = ui(props); select(tree, raw === "3" ? [0] : [0, 2]); tree = ui(props);
    nodes(bulkForm(tree)).find(node => node.type === "input").props.onChange({ target: { value: raw } });
    tree = ui(props); bulkForm(tree).props.onSubmit({ preventDefault() {} }); tree = ui(props);
    if (raw === "4") assert.deepEqual(parsedPlan(navigation[0]).lines.map(line => line.quantity), [4, 1, 4, 2]);
    else { assert.deepEqual(navigation, []); assert.ok(text(tree).includes(raw === "3" ? storefrontLabels.en.planUnchanged : storefrontLabels.en.planInvalidQuantity)); }
    assert.deepEqual(writes, []);
  });
});
test("F2/F3 payload/publication/locale change or unmount revokes obsolete selected handlers", async () => {
  for (const mode of ["payload", "publication", "locale", "unmount"]) await stores(async ({ navigation, writes }) => {
    const props = properties(); let tree = ui(props); select(tree, [1, 2]); tree = ui(props); const old = remove(tree);
    if (mode === "payload") ui({ ...props, plan: readShoppingPlan(portablePayload([four[0]]), records) });
    if (mode === "publication") ui({ ...props, publishedIds: [id(1)] });
    if (mode === "locale") ui(properties("hu"));
    if (mode === "unmount") dispose("plan");
    old.props.onClick(); assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
  });
});
test("F5 filtered moves refuse; reordered payload survives detail and unchanged Cart handoff", async () => stores(async ({ navigation, writes }) => {
  const props = properties(); let tree = ui(props);
  nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === storefrontLabels.en.planMoveUp + ": Synthetic 4").props.onClick();
  const changed = parsedPlan(navigation[0]); assert.deepEqual(changed.lines.map(line => line.publicId), [id(1), id(2), id(4), id(3)]);
  dispose("plan"); tree = ui(props); search(tree).props.onChange({ target: { value: "synthetic" } }); tree = ui(props);
  const refused = nodes(tree).filter(node => node.type === "button" && node.props["aria-label"]?.startsWith(storefrontLabels.en.planMoveUp));
  assert.ok(refused.every(node => node.props.disabled)); refused.at(-1).props.onClick(); assert.equal(navigation.length, 1);
  dispose("plan"); tree = ui({ ...props, plan: changed });
  const handoff = links(tree).find(link => text(link) === storefrontLabels.en.planReviewCart);
  assert.deepEqual(readPortableLink(new URL(handoff.props.href, "https://synthetic.invalid").href).lines, changed.lines);
  const detail = ProductDetail({ catalogue, slug: records[0].slug, locale: "en", routeLocale: "en", planHint: portablePayload(changed.lines) });
  assert.deepEqual(nodes(detail).find(node => node.type === Plan).props.plan.lines, changed.lines); assert.deepEqual(writes, []);
}));
test("F6 fresh read-only Cart overlap is hypothetical; denied/corrupt/stale/overflow show no trusted numbers", async () => {
  for (const mode of ["ready", "denied", "corrupt", "stale", "overflow"]) await stores(async ({ control, values, notify, writes }) => {
    if (mode === "denied") control.denied = true;
    if (mode === "corrupt") values.set(CART_STORAGE_KEY, "bad");
    if (mode === "stale") values.set(CART_STORAGE_KEY, serializeCart([]));
    if (mode === "overflow") { values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id(1), quantity: Number.MAX_SAFE_INTEGER }])); notify(CART_STORAGE_KEY); }
    const tree = ui(properties()); assert.ok(text(tree).includes(storefrontLabels.en.planImpact));
    if (mode === "ready") assert.ok(text(tree).includes(storefrontLabels.en.planExpected));
    else { assert.ok(text(tree).includes(storefrontLabels.en.planImpactUnsafe)); assert.ok(!text(tree).includes(storefrontLabels.en.planExpected)); }
    assert.deepEqual(writes, []);
  });
});
test("F7 explicit new-only keeps exact non-overlapping quantities/order, not subtraction or a store mutation", async () => stores(async ({ values, notify, navigation, writes }) => {
  values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id(1), quantity: 5 }, { publicId: id(3), quantity: 1 }])); notify(CART_STORAGE_KEY);
  const before = values.get(CART_STORAGE_KEY), tree = ui(properties()); button(tree, storefrontLabels.en.planNewOnly).props.onClick();
  assert.deepEqual(parsedPlan(navigation[0]).lines, [four[1], four[3]]); assert.equal(values.get(CART_STORAGE_KEY), before); assert.deepEqual(writes, []);
}));
test("F7 changed persisted witness, notified update and all-overlap refuse the entire derived action", async () => {
  for (const mode of ["stale", "notify", "all"]) await stores(async ({ values, notify, navigation, writes }) => {
    if (mode === "all") { values.set(CART_STORAGE_KEY, serializeCart(four)); notify(CART_STORAGE_KEY); }
    const props = properties(), tree = ui(props), action = button(tree, storefrontLabels.en.planNewOnly);
    if (mode !== "all") values.set(CART_STORAGE_KEY, serializeCart([]));
    if (mode === "notify") { notify(CART_STORAGE_KEY); ui(props); }
    if (mode === "all") { assert.equal(action.props.disabled, true); assert.ok(text(tree).includes(storefrontLabels.en.planAllOverlap)); }
    action.props.onClick(); assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
  });
});
test("F8 complete-Cart pure export casefolds identity but rejects private/ambiguous/invalid/oversized input all-or-nothing", () => {
  for (const prefix of ["", "/en", "/hu", "/ko"]) assert.deepEqual(parsedPlan(currentCartPlanHref(prefix + "/products", [{ ...four[0], publicId: id(1).toUpperCase() }, four[1]], records)).lines, four.slice(0, 2));
  for (const current of [[], [{ publicId: id(99), quantity: 1 }], [...four, four[0]], [{ ...four[0], quantity: 0 }], [{ ...four[0], extra: true }]]) assert.equal(currentCartPlanHref("/products", current, records), null);
  assert.equal(currentCartPlanHref("/cart", four, records), null);
  const many = Array.from({ length: 41 }, (_, i) => ({ publicId: id(i + 1), quantity: 1 }));
  assert.equal(currentCartPlanHref("/products", many, many), null);
});
test("F8 direct Cart resume exports full saved order independently of current filter in every locale, zero writes", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ navigation, writes }) => {
    const locale = routeLocale ?? "en"; let tree = cart({ locale, routeLocale });
    search(tree.root).props.onChange({ target: { value: "no-match" } }); tree = cart({ locale, routeLocale });
    button(tree.root, storefrontLabels[locale].planCartResume).props.onClick();
    assert.equal(new URL(navigation[0], "https://synthetic.invalid").pathname, storefrontHref("/products", routeLocale));
    assert.deepEqual(parsedPlan(navigation[0]).lines, [{ publicId: id(2), quantity: 4 }, { publicId: id(1), quantity: 2 }]); assert.deepEqual(writes, []);
  }, [{ publicId: id(2), quantity: 4 }, { publicId: id(1).toUpperCase(), quantity: 2 }]);
});
test("F8 stale/denied/private snapshot rejects, and unsafe quantity latch remains disabled after storage notification", async () => {
  for (const mode of ["stale", "denied", "private", "latch", "location", "unmount", "assign-denied"]) await stores(async ({ values, control, notify, navigation, writes, location }) => {
    let tree = cart(), old = button(tree.root, storefrontLabels.en.planCartResume);
    if (mode === "stale") values.set(CART_STORAGE_KEY, serializeCart([]));
    if (mode === "denied") control.denied = true;
    if (mode === "location") location.pathname = "/hu/cart";
    if (mode === "assign-denied") location.assign = () => { throw new Error("Synthetic navigation denied"); };
    if (mode === "unmount") dispose("cart");
    if (mode === "private") { values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id(99), quantity: 1 }])); notify(CART_STORAGE_KEY); tree = cart(); old = button(tree.root, storefrontLabels.en.planCartResume); }
    if (mode === "latch") {
      nodes(tree.root).find(node => node.type?.name === "QuantityForm").props.announce("write-failed"); notify(CART_STORAGE_KEY); tree = cart();
      assert.equal(button(tree.root, storefrontLabels.en.planCartResume).props.disabled, true);
    }
    old.props.onClick(); assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
  });
});
test("F1/F2 brand and presentation sort are local, invalidate selection and disable priority changes", async () => stores(async ({ navigation, writes }) => {
  const props = properties(), before = portablePayload(props.plan.lines); let tree = ui(props); select(tree, [0]); tree = ui(props);
  const selects = nodes(tree).filter(node => node.type === "select");
  selects.find(node => node.props.value === "").props.onChange({ target: { value: "beplain" } }); tree = ui(props);
  assert.equal(rows(tree).length, 3); assert.equal(remove(tree).props.disabled, true);
  nodes(tree).find(node => node.type === "select" && node.props.value === "order").props.onChange({ target: { value: "brand" } }); tree = ui(props);
  assert.ok(nodes(tree).filter(node => node.type === "button" && node.props["aria-label"]?.startsWith(storefrontLabels.en.planMoveUp)).every(node => node.props.disabled));
  assert.equal(portablePayload(props.plan.lines), before); assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
}));

test("F4 whole edited URL exceeding its bound is refused even for a safe absolute selected quantity", async () => stores(async ({ navigation, writes }) => {
  const props = properties(), overhead = shoppingPlanHref(props.path, "?q=", four).length;
  props.query = "?q=" + "x".repeat(8192 - overhead - 1);
  let tree = ui(props); select(tree, [0]); tree = ui(props);
  nodes(bulkForm(tree)).find(node => node.type === "input").props.onChange({ target: { value: String(Number.MAX_SAFE_INTEGER) } });
  tree = ui(props); bulkForm(tree).props.onSubmit({ preventDefault() {} }); tree = ui(props);
  assert.ok(text(tree).includes(storefrontLabels.en.planLimit)); assert.deepEqual(navigation, []); assert.deepEqual(writes, []);
}));

test("F6/F7 SSR has no trusted Cart numbers and new plan actions cannot navigate before hydration", () => {
  const props = properties(), tree = ui(props);
  assert.ok(text(tree).includes(storefrontLabels.en.planImpactUnsafe)); assert.ok(!text(tree).includes(storefrontLabels.en.planExpected));
  assert.equal(button(tree, storefrontLabels.en.planSelectDisplayed).props.disabled, true);
  assert.equal(bulkForm(tree).props.children[1].props.disabled, true);
  dispose("plan");
});

test("F1–F4 maximum 40-line workspace keeps BigInt totals and applies one whole bounded quantity action", async () => stores(async ({ navigation, writes }) => {
  const publicProducts = Array.from({ length: 40 }, (_, index) => ({ publicId: id(index + 1), slug: "synthetic-" + (index + 1), brand: "Anua", name: "Synthetic " + (index + 1) }));
  const lines = publicProducts.map(product => ({ publicId: product.publicId, quantity: Number.MAX_SAFE_INTEGER }));
  const props = { ...properties(), plan: readShoppingPlan(portablePayload(lines), publicProducts), products: publicProducts, publishedIds: publicProducts.map(product => product.publicId) };
  let tree = ui(props); assert.equal(rows(tree).length, 40);
  assert.ok(text(tree).includes((BigInt(Number.MAX_SAFE_INTEGER) * BigInt(40)).toString()));
  button(tree, storefrontLabels.en.planSelectDisplayed).props.onClick(); tree = ui(props);
  bulkForm(tree).props.onSubmit({ preventDefault() {} });
  assert.ok(navigation[0].length <= 8192);
  const parsed = readShoppingPlan(new URL(navigation[0], "https://synthetic.invalid").searchParams.get("cartPlan"), publicProducts);
  assert.equal(parsed.lines.length, 40); assert.ok(parsed.lines.every((line, index) => line.publicId === publicProducts[index].publicId && line.quantity === 1));
  assert.deepEqual(writes, []);
}));

test("Boundaries: read-only helper, strict locale parity, unchanged public catalogue and existing authority", () => {
  assert.match(readFileSync(join(repo, "data/catalogue.ts"), "utf8"), /Object.freeze\(\[\]\)/);
  assert.doesNotMatch(readFileSync(join(repo, "lib/catalog/shopping-plan-workspace.ts"), "utf8"), /setItem|removeItem|changeBrowserCart|fetch\(|sessionStorage/);
  assert.deepEqual(Object.keys(storefrontLabels.en), Object.keys(storefrontLabels.hu)); assert.deepEqual(Object.keys(storefrontLabels.en), Object.keys(storefrontLabels.ko));
  assert.equal(currentCartPlanHref("/products", four, [...records, records[0]]), null);
  assert.equal(cartDraftImpact([], four, records).units, "11"); assert.equal(inspectStoredCart(serializeCart(four)).invalid, false);
  assert.equal(typeof readFreshPlanCart, "function");
  const root = ProductListing({ catalogue, planHint: portablePayload(four) }); assert.deepEqual(nodes(root).find(node => node.type === Plan).props.plan.lines, four);
  assert.equal(typeof shoppingPlanHref, "function");
});
