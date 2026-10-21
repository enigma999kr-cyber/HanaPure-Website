import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { stepQuantityDraft } from "../lib/cart/quantity-draft-controls.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { comparisonLabels } from "../lib/comparison/labels.ts";

test("F2/F3 pure draft step uses strict existing parser and exact safe positive boundaries without coercion", () => {
  assert.equal(stepQuantityDraft("1", -1), null);
  assert.equal(stepQuantityDraft("1", 1), "2");
  assert.equal(stepQuantityDraft("003", -1), "2");
  assert.equal(stepQuantityDraft("9007199254740991", 1), null);
  assert.equal(stepQuantityDraft("9007199254740991", -1), "9007199254740990");
  for (const raw of ["", " ", "0", "-1", "1.5", "1e2", " 2", "2 ", "NaN", "9007199254740992", null]) {
    assert.equal(stepQuantityDraft(raw, -1), null); assert.equal(stepQuantityDraft(raw, 1), null);
  }
});

// Existing Node/installed TypeScript synthetic hook pattern; not browser/hydration proof.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
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
    if (specifier === "react" && /\/(components\/(cart\/(ShoppingCart|QuickAdd)|catalogue\/ProductComparison)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const { default: ShoppingCart } = await import("../components/cart/ShoppingCart.tsx");
const { default: QuickAdd } = await import("../components/cart/QuickAdd.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts");
const browserFavorites = await import("../lib/favorites/browser-favorites.ts");
const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const lines = [{ publicId: id.toUpperCase(), quantity: 5 }, { publicId: other, quantity: 7 }];
const cartProducts = [{ publicId: id, slug: "one", brand: "Anua", names: { en: "Synthetic one", hu: "Teszt egy", ko: "가상 하나" } }];
const comparison = [id, other].map((publicId, index) => ({ publicId, slug: `test-${index}`, brand: "Anua", name: `Synthetic ${index}`, description: null, usage: null, caution: null }));
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  let tree;
  for (let attempt = 0; attempt < 3; attempt++) {
    driver.active = driver.instances.get(key); driver.index = 0; driver.effects = []; driver.dirty = false; driver.rendering = true;
    try { tree = component(props); } finally { driver.rendering = false; }
    if (!driver.dirty) break;
    assert.ok(attempt < 2, "render-phase draft resynchronization converges");
  }
  for (const effect of driver.effects) effect();
  return tree;
}
const submit = tree => nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
const input = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "number");
const change = (tree, value) => input(tree).props.onChange({ target: { value } });
const action = (tree, label) => nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === label);
function row(props, rootKey = "cart") {
  const parent = render(ShoppingCart, props, rootKey);
  const element = nodes(parent).find(node => typeof node.type === "function" && node.type.name === "QuantityForm");
  return { parent, element, form: element ? render(element.type, element.props, `${rootKey}-quantity`) : null };
}
async function stores(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart(lines)], [FAVORITES_STORAGE_KEY, serializeFavorites([])]]);
  const writes = [], events = new Set();
  const control = { readDenied: false, writeDenied: false, afterWrite: null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem(key) { if (key === CART_STORAGE_KEY && control.readDenied) throw new Error("synthetic read denial"); return values.get(key) ?? null; },
      setItem(key, value) { if (control.writeDenied) throw new Error("synthetic write denial"); writes.push(key); values.set(key, value); control.afterWrite?.(); },
    },
    addEventListener(type, callback) { if (type === "storage") events.add(callback); },
    removeEventListener(type, callback) { if (type === "storage") events.delete(callback); },
  } });
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key }));
  notify(null); driver.instances.clear();
  try { await run({ values, writes, control, notify }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.instances.clear();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}
const cartProps = locale => ({ products: cartProducts, locale, routeLocale: locale });

test("F1 row Update confirms absolute persistence/unchanged and preserves casing/order/unrelated rows in EN/HU/KO", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes }) => {
    const props = cartProps(locale), labels = cartLabels[locale];
    let current = row(props);
    change(current.form, "003"); current = row(props);
    assert.deepEqual(writes, []); submit(current.form); current = row(props);
    assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [{ ...lines[0], quantity: 3 }, lines[1]]);
    assert.ok(text(current.parent).includes(labels.selectionUpdated));
    submit(current.form); current = row(props);
    assert.ok(text(current.parent).includes(labels.selectionUnchanged)); assert.equal(writes.length, 1);
    change(current.form, "9007199254740991"); current = row(props); submit(current.form); current = row(props);
    assert.equal(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines[0].quantity, Number.MAX_SAFE_INTEGER);
    assert.ok(text(current.parent).includes(labels.selectionUpdated));
  });
});

test("F1 invalid draft never writes and does not irreversibly lock a healthy form", async () => stores(async ({ writes }) => {
  const props = cartProps("en");
  for (const raw of ["", "0", "-1", "1.1", "1e2", "9007199254740992"]) {
    let current = row(props); change(current.form, raw); current = row(props); submit(current.form); current = row(props);
    assert.ok(text(current.parent).includes(cartLabels.en.invalid));
    assert.equal(nodes(current.form).find(node => node.type === "button" && node.props.type === "submit").props.disabled, false);
  }
  assert.deepEqual(writes, []);
}));

test("F1 storage failure/conflict/readback uncertainty never announces success and requires reload, even after storage refresh", async () => {
  for (const mode of ["write", "read", "missing", "corrupt", "conflict", "removed", "confirmation-read", "confirmation-change"]) await stores(async ({ values, writes, control, notify }) => {
    const props = cartProps("en");
    let current = row(props); change(current.form, "4"); current = row(props);
    const expected = ["conflict", "removed"].includes(mode) ? cartLabels.en.selectionConflict : ["write", "confirmation-read", "confirmation-change"].includes(mode) ? cartLabels.en.selectionWriteFailed : cartLabels.en.selectionUnavailable;
    if (mode === "write") control.writeDenied = true;
    if (mode === "read") control.readDenied = true;
    if (mode === "missing") values.delete(CART_STORAGE_KEY);
    if (mode === "corrupt") values.set(CART_STORAGE_KEY, "{");
    if (mode === "conflict") values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 9 }, lines[1]]));
    if (mode === "removed") values.set(CART_STORAGE_KEY, serializeCart([lines[1]]));
    if (mode === "confirmation-read") control.afterWrite = () => { control.readDenied = true; };
    if (mode === "confirmation-change") control.afterWrite = () => values.set(CART_STORAGE_KEY, serializeCart(lines));
    submit(current.form); current = row(props);
    assert.ok(text(current.parent).includes(expected));
    assert.ok(!text(current.parent).includes(cartLabels.en.selectionUpdated));
    assert.equal(input(current.form).props.value, "4");
    assert.equal(nodes(current.form).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
    assert.ok(!nodes(current.parent).some(node => node.type === "dl"));
    const count = writes.length;
    control.readDenied = false; control.writeDenied = false; control.afterWrite = null;
    values.set(CART_STORAGE_KEY, serializeCart(lines)); notify(CART_STORAGE_KEY);
    current = row(props); submit(current.form); current = row(props);
    assert.equal(writes.length, count); assert.equal(input(current.form).props.value, "4");
    assert.equal(nodes(current.form).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
  });
});

test("F1 Remove and Empty cannot write after quantity conflict/failure, including after external storage notification", async () => {
  for (const locale of ["en", "hu", "ko"]) for (const mode of ["conflict", "write", "confirmation-read"]) await stores(async ({ values, writes, control, notify }) => {
    const props = cartProps(locale), labels = cartLabels[locale];
    let current = row(props); change(current.form, "4"); current = row(props);
    if (mode === "conflict") values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 9 }, lines[1]]));
    if (mode === "write") control.writeDenied = true;
    if (mode === "confirmation-read") control.afterWrite = () => { control.readDenied = true; };
    submit(current.form); current = row(props);
    const expected = mode === "conflict" ? labels.selectionConflict : labels.selectionWriteFailed;
    const count = writes.length;
    // Restore usable storage first: the UI trust latch, not a storage exception, must block writes.
    control.readDenied = false; control.writeDenied = false; control.afterWrite = null;
    for (const externalNotification of [false, true]) {
      if (externalNotification) { values.set(CART_STORAGE_KEY, serializeCart(lines)); notify(CART_STORAGE_KEY); }
      current = row(props);
      const stored = values.get(CART_STORAGE_KEY);
      const removals = nodes(current.parent).filter(node => node.type === "button" && node.props["aria-label"]?.startsWith(`${labels.remove}:`));
      const empty = nodes(current.parent).find(node => node.type === "button" && text(node) === labels.clear);
      assert.equal(removals.length, 2); assert.ok(empty);
      for (const button of [...removals, empty]) {
        assert.equal(button.props.disabled, true);
        // Bypass native disabled dispatch deliberately to exercise removeSelection's own guard.
        button.props.onClick();
        assert.equal(writes.length, count);
        assert.equal(values.get(CART_STORAGE_KEY), stored);
      }
      current = row(props);
      assert.ok(text(current.parent).includes(expected));
      assert.equal(input(current.form).props.value, "4");
      assert.equal(nodes(current.form).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
    }
  });
});

test("F1 healthy Remove/Empty still persist and support one-step Undo", async () => stores(async ({ values, writes }) => {
  const props = cartProps("en"), labels = cartLabels.en;
  const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
  let current = row(props);
  const remove = action(current.parent, `${labels.remove}: ${cartProducts[0].names.en}`);
  assert.equal(remove.props.disabled, false); remove.props.onClick(); current = row(props);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [lines[1]]);
  assert.notEqual(button(current.parent, labels.undo).props.disabled, true);
  button(current.parent, labels.undo).props.onClick(); current = row(props);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, lines);
  assert.equal(button(current.parent, labels.clear).props.disabled, false);
  button(current.parent, labels.clear).props.onClick(); current = row(props);
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, []);
  assert.notEqual(button(current.parent, labels.undo).props.disabled, true);
  button(current.parent, labels.undo).props.onClick();
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, lines);
  assert.equal(writes.length, 4);
}));

test("F2 Cart steppers edit draft only, preserve typed text on unrelated changes and resync actual external quantity", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, notify }) => {
    const props = cartProps(locale), name = cartProducts[0].names[locale], labels = cartLabels[locale];
    let current = row(props);
    const plus = action(current.form, `${labels.increaseDraft}: ${name}`);
    assert.equal(plus.props.type, "button"); assert.match(plus.props.className, /min-w-11/);
    plus.props.onClick(); current = row(props); assert.equal(input(current.form).props.value, "6");
    action(current.form, `${labels.decreaseDraft}: ${name}`).props.onClick(); current = row(props); assert.equal(input(current.form).props.value, "5");
    for (const [raw, disabledMinus, disabledPlus] of [["1", true, false], ["9007199254740991", false, true], ["", true, true], ["1.5", true, true]]) {
      change(current.form, raw); current = row(props);
      assert.equal(action(current.form, `${labels.decreaseDraft}: ${name}`).props.disabled, disabledMinus);
      assert.equal(action(current.form, `${labels.increaseDraft}: ${name}`).props.disabled, disabledPlus);
      assert.equal(input(current.form).props.value, raw);
    }
    change(current.form, "4"); current = row(props);
    values.set(CART_STORAGE_KEY, serializeCart([lines[0], { ...lines[1], quantity: 8 }])); notify(CART_STORAGE_KEY);
    current = row(props); assert.equal(input(current.form).props.value, "4");
    values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 9 }, lines[1]])); notify(CART_STORAGE_KEY);
    current = row(props); assert.equal(input(current.form).props.value, "9");
    assert.deepEqual(writes, []);
  });
});

test("F3 shared QuickAdd steppers retain strict manual draft and write chosen quantity only after explicit Add", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, notify }) => {
    const props = { publicId: id, name: "Synthetic", locale }, labels = cartLabels[locale];
    let tree = render(QuickAdd, props);
    assert.equal(action(tree, `${labels.decreaseDraft}: Synthetic`).props.disabled, true);
    action(tree, `${labels.increaseDraft}: Synthetic`).props.onClick(); tree = render(QuickAdd, props);
    action(tree, `${labels.increaseDraft}: Synthetic`).props.onClick(); tree = render(QuickAdd, props);
    assert.equal(input(tree).props.value, "3"); assert.deepEqual(writes, []);
    submit(tree); tree = render(QuickAdd, props);
    assert.equal(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines[0].quantity, 8);
    assert.ok(text(tree).includes(labels.added)); assert.equal(writes.length, 1);
    for (const raw of ["", "1.5", "1e2", "9007199254740992"]) {
      change(tree, raw); tree = render(QuickAdd, props);
      assert.equal(action(tree, `${labels.increaseDraft}: Synthetic`).props.disabled, true);
      assert.equal(action(tree, `${labels.decreaseDraft}: Synthetic`).props.disabled, true);
      submit(tree); tree = render(QuickAdd, props); assert.equal(writes.length, 1);
    }
    change(tree, "9007199254740991"); tree = render(QuickAdd, props);
    assert.equal(action(tree, `${labels.increaseDraft}: Synthetic`).props.disabled, true);
    values.set(CART_STORAGE_KEY, "{"); notify(CART_STORAGE_KEY); tree = render(QuickAdd, props);
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => node.props.disabled));
  });
});

function verifyJumps(tree, labels) {
  const nav = nodes(tree).find(node => node.type === "nav" && node.props["aria-label"] === labels);
  assert.ok(nav); assert.match(nav.props.className, /flex-wrap/);
  const jumps = nodes(nav).filter(node => node.type === "a");
  for (const jump of jumps) {
    assert.equal(jump.props.onClick, undefined); assert.match(jump.props.className, /min-h-11/);
    const targets = nodes(tree).filter(node => node.props?.id === jump.props.href.slice(1));
    assert.equal(targets.length, 1); assert.equal(targets[0].props.tabIndex, -1);
    assert.match(targets[0].props.className, /scroll-mt-24/); assert.match(targets[0].props.className, /focus-visible:outline/);
  }
  return jumps;
}

test("F4 comparison jump IDs are instance-local and slot-stable after swap, with real headings and no writes", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ writes }) => {
    const locale = routeLocale ?? "en", props = { products: comparison, locale, routeLocale };
    let tree = render(ProductComparison, props, "compare-a");
    const jumps = verifyJumps(tree, comparisonLabels[locale].panelNavigation);
    const second = render(ProductComparison, props, "compare-b");
    const others = verifyJumps(second, comparisonLabels[locale].panelNavigation);
    assert.equal(new Set([...jumps, ...others].map(node => node.props.href)).size, 4);
    const before = nodes(tree).filter(node => node.type === "h3").map(text);
    nodes(tree).find(node => node.type === "button" && text(node) === comparisonLabels[locale].swap).props.onClick();
    tree = render(ProductComparison, props, "compare-a");
    assert.deepEqual(verifyJumps(tree, comparisonLabels[locale].panelNavigation).map(node => node.props.href), jumps.map(node => node.props.href));
    assert.deepEqual(nodes(tree).filter(node => node.type === "h3").map(text), before.reverse());
    for (const card of nodes(tree).filter(node => node.type === "article")) assert.ok(nodes(card).some(node => node.type === "h3" && node.props.id === card.props["aria-labelledby"]));
    assert.deepEqual(writes, []);
    for (const products of [[], [comparison[0]], [comparison[0], { ...comparison[0], publicId: id.toUpperCase() }]]) {
      assert.equal(render(ProductComparison, { ...props, products }, "small-" + products.length), null);
    }
  });
});

test("F5 valid Cart links reach instance-local rows/actions; empty, invalid, unreadable or SSR Cart has no dead jumps", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, control, notify }) => {
    const props = cartProps(locale), labels = cartLabels[locale];
    const first = render(ShoppingCart, props, "cart-a"), second = render(ShoppingCart, props, "cart-b");
    for (const tree of [first, second]) {
      verifyJumps(tree, labels.cartNavigation);
      const links = nodes(tree).filter(node => node.type === "a" && node.props.href.startsWith("#"));
      assert.equal(links.length, 2);
      for (const link of links) assert.equal(nodes(tree).filter(node => node.props?.id === link.props.href.slice(1)).length, 1);
    }
    // Public deep-link row IDs are identity-stable; navigation/control IDs remain instance-local.
    for (const tree of [first, second]) {
      const ids = nodes(tree).filter(node => node.props?.id).map(node => node.props.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(ids.filter(value => value === `cart-item-${id}`).length, 1);
    }
    const allIds = [...nodes(first), ...nodes(second)].filter(node => node.props?.id && !node.props.id.startsWith("cart-item-")).map(node => node.props.id);
    assert.equal(new Set(allIds).size, allIds.length);
    for (const raw of [serializeCart([]), "{"]) {
      values.set(CART_STORAGE_KEY, raw); notify(CART_STORAGE_KEY);
      assert.ok(!nodes(render(ShoppingCart, props, "cart-a")).some(node => node.type === "a" && node.props.href.startsWith("#")));
    }
    values.set(CART_STORAGE_KEY, serializeCart(lines)); control.readDenied = true; notify(CART_STORAGE_KEY);
    assert.ok(!nodes(render(ShoppingCart, props, "cart-a")).some(node => node.type === "a" && node.props.href.startsWith("#")));
    assert.deepEqual(writes, []);
  });
  driver.instances.clear();
  assert.equal(typeof window, "undefined");
  assert.ok(!nodes(render(ShoppingCart, cartProps("en"))).some(node => node.type === "a" && node.props.href.startsWith("#")));
});

test("SSR step controls are inactive, shared labels are locale-complete and no new browser protocol is imported", () => {
  for (const locale of ["en", "hu", "ko"]) {
    driver.instances.clear();
    const tree = render(QuickAdd, { publicId: id, locale, name: "Synthetic" });
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => node.props.disabled));
    assert.deepEqual(Object.keys(cartLabels[locale]), Object.keys(cartLabels.en));
    assert.deepEqual(Object.keys(comparisonLabels[locale]), Object.keys(comparisonLabels.en));
    for (const key of ["draftQuantity", "decreaseDraft", "increaseDraft", "cartNavigation", "cartRows", "jumpToActions", "backToRows"]) assert.ok(cartLabels[locale][key].trim());
    for (const key of ["panelNavigation", "jumpFirst", "jumpSecond"]) assert.ok(comparisonLabels[locale][key].trim());
  }
  const source = readFileSync(join(repo, "lib/cart/quantity-draft-controls.ts"), "utf8");
  assert.doesNotMatch(source, /window|document|navigator|localStorage|browser-cart|fetch\(/);
  driver.instances.clear();
});
