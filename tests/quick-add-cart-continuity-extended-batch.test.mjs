import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { CART_STORAGE_KEY, inspectStoredCart, serializeCart } from "../lib/cart/cart-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { cartRowId, cartRowFromHash } from "../lib/cart/quick-add-continuity.ts";

// Installed TypeScript + existing synthetic JSX/store convention, not browser proof.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,effects:[],subscriptions:new Map(),serial:0,rendering:false,dirty:false,cleanups:new Map()};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;if(driver.rendering)driver.dirty=true;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useEffect(effect){driver.effects.push(effect);}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/cart\/(ShoppingCart|QuickAdd)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const { default: QuickAdd } = await import("../components/cart/QuickAdd.tsx");
const { default: ShoppingCart } = await import("../components/cart/ShoppingCart.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts");
const browserFavorites = await import("../lib/favorites/browser-favorites.ts");
const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const lines = [{ publicId: id.toUpperCase(), quantity: 5 }, { publicId: other, quantity: 7 }];
const products = [{ publicId: id, slug: "synthetic", brand: "Anua", names: { en: "Synthetic", hu: "Teszt", ko: "가상" } }];
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = tree => nodes(tree).filter(value => typeof value === "string" || typeof value === "number").join(" ");
function render(component, props, key = component.name, commit = () => {}) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  let tree;
  for (let attempt = 0; attempt < 4; attempt++) {
    driver.active = driver.instances.get(key); driver.index = 0; driver.effects = []; driver.dirty = false; driver.rendering = true;
    try { tree = component(props); } finally { driver.rendering = false; }
    if (!driver.dirty) break;
    assert.ok(attempt < 3, "draft resynchronization converges");
  }
  for (const cleanup of driver.cleanups.get(key) ?? []) cleanup();
  commit(tree);
  driver.cleanups.set(key, driver.effects.map(effect => effect()).filter(cleanup => typeof cleanup === "function"));
  return tree;
}
const props = locale => ({ publicId: id, locale, name: "Synthetic" });
const form = tree => nodes(tree).find(node => node.type === "form");
const input = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "number");
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} });
const edit = (tree, value) => input(tree).props.onChange({ target: { value } });
const setElement = tree => nodes(tree).find(node => typeof node.type === "function" && node.type.name === "SetQuantity");
function setForm(tree) { const element = setElement(tree); return element && render(element.type, element.props, "absolute"); }
const shortcut = tree => nodes(tree).find(node => node.type === "a");
async function stores(run, initial = lines) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart(initial)]]), writes = [], events = new Map();
  const control = { readDenied: false, writeDenied: false, afterWrite: null, beforeRead: null, reads: 0 };
  const location = { pathname: "/products", hash: "" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location,
    localStorage: {
      getItem(key) { if (key === CART_STORAGE_KEY) { control.beforeRead?.(++control.reads); if (control.readDenied) throw new Error("synthetic read denial"); } return values.get(key) ?? null; },
      setItem(key, value) { if (control.writeDenied) throw new Error("synthetic write denial"); writes.push(key); values.set(key, value); control.afterWrite?.(); },
    },
    addEventListener(type, callback) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(callback); },
    removeEventListener(type, callback) { events.get(type)?.delete(callback); },
  } });
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.get("storage")?.forEach(callback => callback({ key }));
  notify(null); driver.instances.clear();
  try { await run({ values, writes, control, notify, location, hashchange: () => events.get("hashchange")?.forEach(callback => callback()) }); }
  finally {
    [...driver.cleanups.values()].flat().forEach(cleanup => cleanup()); driver.cleanups.clear();
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.instances.clear();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

test("F1 SSR/unhydrated is unknown, not absence/quantity/link; first additive form remains native", () => {
  driver.instances.clear();
  const tree = render(QuickAdd, props("en"));
  assert.ok(text(tree).includes(cartLabels.en.loading));
  assert.ok(!text(tree).includes(cartLabels.en.notInBrowserCart));
  assert.ok(!text(tree).includes(cartLabels.en.inBrowserCart));
  assert.equal(shortcut(tree), undefined); assert.equal(setElement(tree), undefined);
  assert.equal(form(tree).props.onSubmit instanceof Function, true);
  assert.equal(nodes(tree).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
});

test("F1/F3 locale parity, case-safe quantity and exact legacy/EN/HU/KO shortcut", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ location, writes }) => {
    for (const prefix of ["", `/${locale}`]) {
      location.pathname = `${prefix}/products`;
      const tree = render(QuickAdd, props(locale));
      assert.ok(text(tree).includes(`${cartLabels[locale].inBrowserCart}: 5`));
      assert.ok(!text(tree).includes(cartLabels[locale].notInBrowserCart));
      assert.equal(shortcut(tree).props.href, `${prefix}/cart#cart-item-${id}`);
      assert.equal(text(shortcut(tree)), cartLabels[locale].reviewCartItem);
      assert.ok(setElement(tree)); assert.equal(input(tree).props.value, "1");
    }
    assert.deepEqual(writes, []);
  });
  assert.deepEqual(Object.keys(cartLabels.en).sort(), Object.keys(cartLabels.hu).sort());
  assert.deepEqual(Object.keys(cartLabels.en).sort(), Object.keys(cartLabels.ko).sort());
});

test("F1 absence only healthy; invalid/read-denied never quantity, absence, Set or shortcut", async () => stores(async ({ values, notify, control }) => {
  values.set(CART_STORAGE_KEY, serializeCart([])); notify(CART_STORAGE_KEY);
  let tree = render(QuickAdd, props("en"));
  assert.ok(text(tree).includes(cartLabels.en.notInBrowserCart)); assert.equal(shortcut(tree), undefined);
  for (const mode of ["corrupt", "denied"]) {
    values.set(CART_STORAGE_KEY, mode === "corrupt" ? "{" : serializeCart(lines)); control.readDenied = mode === "denied"; notify(CART_STORAGE_KEY);
    tree = render(QuickAdd, props("en"));
    assert.ok(!text(tree).includes(cartLabels.en.notInBrowserCart)); assert.ok(!text(tree).includes(cartLabels.en.inBrowserCart));
    assert.equal(setElement(tree), undefined); assert.equal(shortcut(tree), undefined);
  }
}));

test("F1 genuine same-tab mutation and cross-tab notification refresh both shared QuickAdds", async () => stores(async ({ values, notify }) => {
  render(QuickAdd, props("en"), "second");
  let tree = render(QuickAdd, props("en")); submit(tree);
  assert.ok(text(render(QuickAdd, props("en"), "second")).includes(`${cartLabels.en.inBrowserCart}: 6`));
  values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 9 }, lines[1]])); notify(CART_STORAGE_KEY);
  tree = render(QuickAdd, props("en")); assert.ok(text(tree).includes(`${cartLabels.en.inBrowserCart}: 9`));
  assert.ok(text(render(QuickAdd, props("en"), "second")).includes(`${cartLabels.en.inBrowserCart}: 9`));
}));

test("F2 Add remains additive; separate Set is absolute, unchanged distinct; preserves casing/order and draft edits never write", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes }) => {
    let tree = render(QuickAdd, props(locale));
    let absolute = setForm(tree); edit(absolute, "003"); absolute = setForm(tree);
    assert.deepEqual(writes, []); submit(absolute);
    tree = render(QuickAdd, props(locale));
    assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [{ ...lines[0], quantity: 3 }, lines[1]]);
    assert.ok(text(tree).includes(cartLabels[locale].selectionUpdated));
    submit(setForm(tree)); tree = render(QuickAdd, props(locale));
    assert.ok(text(tree).includes(cartLabels[locale].selectionUnchanged)); assert.equal(writes.length, 1);
    edit(tree, "2"); tree = render(QuickAdd, props(locale)); assert.equal(writes.length, 1);
    submit(tree); tree = render(QuickAdd, props(locale));
    assert.ok(text(tree).includes(cartLabels[locale].added));
    assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [{ publicId: id, quantity: 5 }, lines[1]]);
    assert.equal(writes.length, 2); assert.equal(input(setForm(tree)).props.value, "5");
  });
});

test("F2/F4 invalid/unsafe Add and Set never write; additive overflow distinct and recoverable", async () => stores(async ({ values, notify, writes }) => {
  for (const raw of ["", "0", "-1", "1.5", "1e2", " 2", "9007199254740992"]) {
    let tree = render(QuickAdd, props("en")); edit(tree, raw); tree = render(QuickAdd, props("en")); submit(tree);
    let absolute = setForm(tree); edit(absolute, raw); absolute = setForm(tree); submit(absolute);
    assert.ok(text(render(QuickAdd, props("en"))).includes(cartLabels.en.invalid));
  }
  assert.deepEqual(writes, []);
  values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: Number.MAX_SAFE_INTEGER }, lines[1]])); notify(CART_STORAGE_KEY);
  let tree = render(QuickAdd, props("en")); edit(tree, "1"); tree = render(QuickAdd, props("en")); submit(tree);
  tree = render(QuickAdd, props("en")); assert.ok(text(tree).includes(cartLabels.en.addOverflow));
  assert.ok(setElement(tree)); assert.deepEqual(writes, []);
}));

for (const action of ["add", "set"]) test(`F2/F4 ${action}: preflight stale/missing/corrupt/denied and readback failures latch until remount; zero repeated unsafe writes`, async () => {
  for (const mode of ["changed", "order", "removed", "missing", "corrupt", "denied", "write-denied", "post-read", "post-change", "post-missing", "post-corrupt"]) await stores(async ({ values, writes, control, notify }) => {
    let tree = render(QuickAdd, props("en"));
    if (action === "set") { let absolute = setForm(tree); edit(absolute, "3"); tree = render(QuickAdd, props("en")); }
    const stale = action === "add" ? tree : setForm(tree);
    if (mode === "changed") values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 9 }, lines[1]]));
    if (mode === "order") values.set(CART_STORAGE_KEY, serializeCart([...lines].reverse()));
    if (mode === "removed") values.set(CART_STORAGE_KEY, serializeCart([lines[1]]));
    if (mode === "missing") values.delete(CART_STORAGE_KEY);
    if (mode === "corrupt") values.set(CART_STORAGE_KEY, "{");
    if (mode === "denied") control.readDenied = true;
    if (mode === "write-denied") control.writeDenied = true;
    if (mode.startsWith("post-")) control.afterWrite = () => {
      if (mode === "post-read") control.readDenied = true;
      if (mode === "post-change") values.set(CART_STORAGE_KEY, serializeCart(lines));
      if (mode === "post-missing") values.delete(CART_STORAGE_KEY);
      if (mode === "post-corrupt") values.set(CART_STORAGE_KEY, "{");
    };
    submit(stale); const count = writes.length; submit(stale); assert.equal(writes.length, count);
    tree = render(QuickAdd, props("en"));
    assert.ok(!text(tree).includes(cartLabels.en.added)); assert.ok(!text(tree).includes(cartLabels.en.selectionUpdated));
    assert.ok(!text(tree).includes(cartLabels.en.inBrowserCart)); assert.ok(!text(tree).includes(cartLabels.en.notInBrowserCart));
    assert.equal(shortcut(tree), undefined); assert.equal(setElement(tree), undefined);
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => node.props.disabled));
    control.readDenied = false; control.writeDenied = false; control.afterWrite = null;
    values.set(CART_STORAGE_KEY, serializeCart(lines)); notify(CART_STORAGE_KEY);
    tree = render(QuickAdd, props("en")); submit(tree); submit(stale); assert.equal(writes.length, count);
    assert.equal(setElement(tree), undefined); assert.equal(shortcut(tree), undefined);
    assert.ok(text(render(QuickAdd, props("en"), "reinitialized")).includes(cartLabels.en.inBrowserCart));
  });
});

test("F4 first empty browser store can Add; disappearance of nonempty snapshot cannot", async () => stores(async ({ values, writes, notify }) => {
  values.delete(CART_STORAGE_KEY); notify(CART_STORAGE_KEY);
  let tree = render(QuickAdd, props("en")); submit(tree); tree = render(QuickAdd, props("en"));
  assert.ok(text(tree).includes(cartLabels.en.added)); assert.equal(writes.length, 1);
  values.delete(CART_STORAGE_KEY); submit(tree); tree = render(QuickAdd, props("en"));
  assert.ok(!text(tree).includes(cartLabels.en.added)); assert.equal(writes.length, 1);
}, []));

test("F4 race between persisted witness and mutation refuses before write; stale successful handler cannot repeat", async () => stores(async ({ values, writes, control }) => {
  let tree = render(QuickAdd, props("en"));
  const start = control.reads;
  control.beforeRead = count => { if (count === start + 2) values.set(CART_STORAGE_KEY, serializeCart([...lines].reverse())); };
  submit(tree); tree = render(QuickAdd, props("en"));
  assert.ok(text(tree).includes(cartLabels.en.selectionConflict)); assert.deepEqual(writes, []);
  control.beforeRead = null; values.set(CART_STORAGE_KEY, serializeCart(lines));
  tree = render(QuickAdd, props("en"), "fresh"); submit(tree); submit(tree);
  assert.equal(writes.length, 1); assert.ok(text(render(QuickAdd, props("en"), "fresh")).includes(cartLabels.en.selectionConflict));
}));

test("F3 fragment accepts exact UUID only, canonicalizes case, rejects redirects/encoding/injection", () => {
  assert.equal(cartRowId(id.toUpperCase()), `cart-item-${id}`);
  assert.equal(cartRowFromHash(`#cart-item-${id.toUpperCase()}`), `cart-item-${id}`);
  for (const value of ["", "bad", `${id}?q=secret`, `${id}/../cart`, `${id}\n`, "%31" + id.slice(1)]) assert.equal(cartRowId(value), null);
  for (const value of ["", `#${id}`, `#cart-item-${id}/`, `#cart-item-${id}%0a`, `https://example.invalid/#cart-item-${id}`]) assert.equal(cartRowFromHash(value), null);
});

test("F3 hydration-ready public row scrolls/focuses once; hashchange works, stale/unpublished/unsafe targets do not", async () => stores(async ({ location, hashchange, writes, values, notify }) => {
  const focused = [], scrolled = [];
  function commit(tree) {
    for (const row of nodes(tree).filter(node => node.type === "li" && node.props.ref)) row.props.ref({
      focus(options) { focused.push([row.props.id, options]); }, scrollIntoView(options) { scrolled.push([row.props.id, options]); },
    });
  }
  location.hash = `#cart-item-${id}`;
  const cartProps = { products, locale: "en", routeLocale: null };
  let tree = render(ShoppingCart, cartProps, "rows", commit);
  assert.deepEqual(focused, [[`cart-item-${id}`, { preventScroll: true }]]); assert.equal(scrolled.length, 1);
  const row = nodes(tree).find(node => node.type === "li" && node.props.id);
  assert.equal(row.props.tabIndex, -1); assert.match(row.props.className, /scroll-mt-24.*focus-visible:outline/);
  assert.equal(nodes(tree).filter(node => node.type === "li" && node.props.id).length, 1);
  render(ShoppingCart, cartProps, "rows", commit); assert.equal(focused.length, 1);
  for (const hash of [`#cart-item-${other}`, "#cart-item-bad", `#cart-item-${id}%0a`]) { location.hash = hash; hashchange(); }
  assert.equal(focused.length, 1);
  location.hash = `#cart-item-${id.toUpperCase()}`; hashchange(); assert.equal(focused.length, 2);
  values.set(CART_STORAGE_KEY, serializeCart([lines[1]])); notify(CART_STORAGE_KEY);
  render(ShoppingCart, cartProps, "rows", commit);
  assert.equal(focused.length, 2); assert.deepEqual(writes, []);
}));

test("F3 SSR -> hydration delayed readiness, empty/default/filtered cart and unpublished row remain safe", async () => {
  driver.instances.clear();
  const cartProps = { products, locale: "hu", routeLocale: "hu" };
  assert.ok(!nodes(render(ShoppingCart, cartProps, "ssr-rows")).some(node => node.type === "li" && node.props.id));
  await stores(async ({ location, values, notify, writes }) => {
    location.hash = `#cart-item-${id}`;
    let focused = 0;
    const commit = tree => nodes(tree).filter(node => node.type === "li" && node.props.ref).forEach(row => row.props.ref({ focus() { focused++; }, scrollIntoView() {} }));
    let tree = render(ShoppingCart, cartProps, "ssr-rows", commit); assert.equal(focused, 1);
    const search = nodes(tree).find(node => node.type === "input" && node.props.type === "search");
    search.props.onChange({ target: { value: "no-such-product" } });
    tree = render(ShoppingCart, cartProps, "ssr-rows", commit);
    assert.ok(text(tree).includes(cartLabels.hu.noReviewResults)); assert.equal(focused, 1);
    assert.equal(nodes(tree).filter(node => node.type === "li" && node.props.id).length, 0);
    values.set(CART_STORAGE_KEY, serializeCart([])); notify(CART_STORAGE_KEY);
    tree = render(ShoppingCart, cartProps, "ssr-rows", commit);
    assert.ok(text(tree).includes(cartLabels.hu.empty)); assert.deepEqual(writes, []);
  });
});

test("Boundaries: only existing cart key/pathway; pure fragment utility, empty production catalogue and distinct localized actions", () => {
  const source = readFileSync(join(repo, "components/cart/QuickAdd.tsx"), "utf8");
  assert.match(source, /detailCartQuantity/); assert.match(source, /setDetailCartQuantity/); assert.match(source, /detailSelectionNeedsReload/);
  assert.match(source, /sameCartSelection\(confirmed.lines, after\)/);
  assert.doesNotMatch(source, /localStorage\.setItem|sessionStorage|fetch\(/);
  const helper = readFileSync(join(repo, "lib/cart/quick-add-continuity.ts"), "utf8");
  assert.doesNotMatch(helper, /window|localStorage|react|next\//);
  assert.match(readFileSync(join(repo, "data/catalogue.ts"), "utf8"), /Object.freeze\(\[\]\)/);
  for (const locale of ["en", "hu", "ko"]) {
    assert.notEqual(cartLabels[locale].addQuantity, cartLabels[locale].setCartQuantity);
    assert.ok(cartLabels[locale].reviewCartItem); assert.ok(cartLabels[locale].addOverflow);
  }
});
