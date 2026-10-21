import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { CART_STORAGE_KEY, inspectStoredCart, serializeCart } from "../lib/cart/cart-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { PORTABLE_CART_PARAM, MAX_PORTABLE_LINK, MAX_PORTABLE_LINES, portablePayload, readPortableLink,
  resolvePortableLines, portableCartLink, planPortableMerge } from "../lib/cart/cart-portable-handoff.ts";

const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc";
const hidden = "32345678-abcd-1234-abcd-123456789abc";
const products = [
  { publicId: id, slug: "synthetic-one", brand: "Anua", names: { en: "Synthetic one", hu: "Teszt egy", ko: "가상 하나" } },
  { publicId: other, slug: "synthetic-two", brand: "beplain", names: { en: "Synthetic two", hu: null, ko: null } },
];
const lines = [{ publicId: id.toUpperCase(), quantity: 5 }, { publicId: hidden, quantity: 9 }];
const incoming = [{ publicId: id, quantity: 2 }, { publicId: other, quantity: 3 }];
const origin = "https://synthetic.invalid";
const linkFor = (selection = incoming, path = "/cart") => portableCartLink(origin, path, selection, products).url;
const fromPayload = payload => `${origin}/cart?${new URLSearchParams({ [PORTABLE_CART_PARAM]: payload })}`;

test("F1 deterministic legacy/EN/HU/KO link contains only canonical public identities and quantities in cart order", () => {
  const selection = [lines[1], { publicId: other, quantity: 3 }, lines[0]];
  for (const path of ["/cart", "/en/cart", "/hu/cart", "/ko/cart"]) {
    const result = portableCartLink(origin, path, selection, [...products].reverse());
    assert.equal(result.status, "ready"); assert.equal(result.omitted, 1);
    assert.deepEqual(result, portableCartLink(origin, path, selection, products));
    const url = new URL(result.url);
    assert.equal(url.origin, origin); assert.equal(url.pathname, path); assert.equal(url.hash, "");
    assert.deepEqual([...url.searchParams.keys()], [PORTABLE_CART_PARAM]);
    assert.ok(result.url.length <= MAX_PORTABLE_LINK);
    const parsed = readPortableLink(result.url);
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.signature, portablePayload(parsed.lines));
    assert.deepEqual(parsed.lines, [{ publicId: other, quantity: 3 }, { publicId: id, quantity: 5 }]);
    assert.equal(parsed.units, "8");
    for (const excluded of [hidden, "Synthetic", "Anua", "names", "price", "stock", "slug"]) assert.ok(!decodeURIComponent(result.url).includes(excluded));
  }
});

test("F1 bounds reject instead of truncating; invalid origin/route, empty or ambiguous public projection fail closed", () => {
  const many = Array.from({ length: 41 }, (_, index) => ({ publicId: `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`, quantity: 1 }));
  assert.equal(portableCartLink(origin, "/cart", many.slice(0, 40), many).status, "ready");
  assert.equal(portableCartLink(origin, "/cart", many, many).status, "too-large");
  assert.equal(portableCartLink(`https://${"a".repeat(MAX_PORTABLE_LINK)}.invalid`, "/cart", incoming, products).status, "too-large");
  assert.equal(portableCartLink(origin, "/cart", lines, []).status, "empty");
  assert.equal(portableCartLink(origin, "/cart", [], products).status, "empty");
  for (const badOrigin of ["https://synthetic.invalid/", "https://user:secret@synthetic.invalid", "file:///cart", "javascript:alert(1)", "not-url"]) assert.equal(portableCartLink(badOrigin, "/cart", incoming, products).status, "invalid");
  for (const path of ["//external.invalid/cart", "/products", "/cart/", "/xx/cart", "/cart?next=evil", "/cart#fragment"]) assert.equal(portableCartLink(origin, path, incoming, products).status, "invalid");
  assert.equal(portableCartLink(origin, "/cart", incoming, [...products, products[0]]).status, "invalid");
  assert.equal(MAX_PORTABLE_LINES, 40); assert.equal(MAX_PORTABLE_LINK, 8192);
});

test("F2 exact hostile/schema/version/duplicate/unsafe quantity parsing rejects the whole incoming draft", () => {
  for (const raw of ["", "v1.", "v2." + `${id}:1`, JSON.stringify({ version: 1, lines: incoming }),
    `v1.${id}:0`, `v1.${id}:-1`, `v1.${id}:1.2`, `v1.${id}:1e2`, `v1.${id}:01`, `v1.${id}:9007199254740992`,
    `v1.${id}:1:extra`, `v1.${id}:1,${id}:2`, `v1.${id.toUpperCase()}:1`, `v1.${id}:1\n`, `v1.${id}:1\u0000`,
    `v1.${id}:1,`, `v1.bad:1`, `v1.${id}:1,{"price":2}`]) assert.equal(readPortableLink(fromPayload(raw)).status, "invalid", raw);
  const good = linkFor();
  assert.equal(readPortableLink(good + `&${PORTABLE_CART_PARAM}=v1.${id}:1`).status, "invalid");
  assert.equal(readPortableLink(good + "&cart%44raft=bad").status, "invalid");
  assert.equal(readPortableLink(good + "&extra=secret").status, "invalid");
  assert.equal(readPortableLink(good + "#" + "x".repeat(MAX_PORTABLE_LINK)).status, "invalid");
  assert.equal(readPortableLink(good.replace("/cart?", "/products?")).status, "invalid");
  assert.equal(readPortableLink(good.replace("https:", "file:")).status, "invalid");
  assert.equal(readPortableLink(good.replace("https://", "https://secret@ ")).status, "invalid");
  const over = Array.from({ length: 41 }, (_, index) => `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc:1`).join(",");
  assert.equal(readPortableLink(fromPayload("v1." + over)).status, "invalid");
  assert.equal(readPortableLink(`${origin}/cart#cart-item-${id}`).status, "none");
  assert.equal(readPortableLink("").status, "none");
});

test("F2 actual public reader excludes drafts; any unresolved identity rejects every incoming row, totals are exact BigInt", () => {
  const content = { name: "Synthetic", description: "Test only", images: [], usage: null, caution: null };
  const published = createLocalCatalogueReader([
    { publicId: id, slug: "synthetic", brand: "Anua", state: "published", translations: { en: content, hu: null, ko: null } },
    { publicId: other, slug: "private", brand: "beplain", state: "draft", translations: { en: { ...content, name: "PRIVATE SECRET" }, hu: null, ko: null } },
  ]).listPublished();
  assert.equal(resolvePortableLines(incoming, published), null);
  assert.equal(resolvePortableLines([incoming[0]], published).length, 1);
  assert.equal(resolvePortableLines(incoming, [...products, products[0]]), null);
  const maximum = incoming.map(line => ({ ...line, quantity: Number.MAX_SAFE_INTEGER }));
  const parsed = readPortableLink(linkFor(maximum));
  assert.equal(parsed.status, "ready"); assert.equal(parsed.units, (BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2)).toString());
});

test("F3 pure additive merge retains unrelated/case/order/unpublished lines and appends in incoming order; no partial overflow", () => {
  const frozen = Object.freeze(lines.map(line => Object.freeze({ ...line })));
  const before = JSON.stringify(frozen);
  const plan = planPortableMerge(frozen, incoming, products);
  assert.deepEqual(plan, { status: "ready", after: [{ publicId: id.toUpperCase(), quantity: 7 }, lines[1], { publicId: other, quantity: 3 }] });
  assert.equal(JSON.stringify(frozen), before); assert.strictEqual(plan.after[1], frozen[1]);
  assert.deepEqual(planPortableMerge([], incoming, products), { status: "ready", after: incoming });
  assert.deepEqual(planPortableMerge([{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }], incoming, products), { status: "overflow" });
  for (const invalid of [[...incoming, incoming[0]], [{ publicId: hidden, quantity: 1 }], [{ publicId: id, quantity: 0 }], [{ publicId: id, quantity: 1, stock: 2 }]]) assert.equal(planPortableMerge(lines, invalid, products).status, "invalid");
  assert.equal(planPortableMerge([{ ...lines[0], quantity: 0 }], incoming, products).status, "invalid");
});

// Reuse the installed Node/TypeScript synthetic hook/store conventions. No browser launched.
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
    if (specifier === "react" && /\/(components\/cart\/ShoppingCart\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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
const browserCart = await import("../lib/cart/browser-cart.ts"), browserFavorites = await import("../lib/favorites/browser-favorites.ts");
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = tree => nodes(tree).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  let tree;
  for (let attempt = 0; attempt < 4; attempt++) {
    driver.active = driver.instances.get(key); driver.index = 0; driver.effects = []; driver.dirty = false; driver.rendering = true;
    try { tree = component(props); } finally { driver.rendering = false; }
    if (!driver.dirty) break;
    assert.ok(attempt < 3, "draft resynchronization converges");
  }
  for (const cleanup of driver.cleanups.get(key) ?? []) cleanup();
  driver.cleanups.set(key, driver.effects.map(effect => effect()).filter(cleanup => typeof cleanup === "function"));
  return tree;
}
const props = (locale = "en", routeLocale = locale, projection = products) => ({ products: projection, locale, routeLocale });
function cart(properties = props()) {
  const root = render(ShoppingCart, properties, "root");
  const wrapper = nodes(root).find(node => typeof node.type === "function" && node.type.name === "PortableCartHandoff");
  const panel = render(wrapper.type, wrapper.props, "handoff");
  return { root, panel: render(panel.type, panel.props, `panel:${panel.key}`) };
}
async function stores(run, initial = lines) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const values = new Map(initial === null ? [] : [[CART_STORAGE_KEY, serializeCart(initial)]]), writes = [], copied = [], events = new Map();
  const location = new URL(linkFor());
  const control = { readDenied: false, writeDenied: false, afterWrite: null, beforeRead: null, reads: 0, clipboard: async value => { copied.push(value); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location,
    localStorage: {
      getItem(key) { if (key === CART_STORAGE_KEY) { control.beforeRead?.(++control.reads); if (control.readDenied) throw new Error("synthetic read denial"); } return values.get(key) ?? null; },
      setItem(key, value) { if (control.writeDenied) throw new Error("synthetic write denial"); writes.push(key); values.set(key, value); control.afterWrite?.(); },
    },
    addEventListener(type, callback) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(callback); },
    removeEventListener(type, callback) { events.get(type)?.delete(callback); },
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: value => control.clipboard(value) } } });
  browserCart.useBrowserCart(); browserFavorites.useBrowserFavorites();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.get("storage")?.forEach(callback => callback({ key }));
  notify(null); driver.instances.clear();
  try { await run({ values, writes, copied, control, notify, location }); }
  finally {
    [...driver.cleanups.values()].flat().forEach(cleanup => cleanup()); driver.cleanups.clear();
    unsubscribers.forEach(unsubscribe => unsubscribe()); driver.instances.clear();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator;
  }
}

test("F2 SSR incoming URL is not read, preview absent and export disabled before hydration", () => {
  const tree = cart(props()).panel;
  assert.ok(!text(tree).includes(cartLabels.en.portablePreview));
  assert.equal(button(tree, cartLabels.en.portableCopy).props.disabled, true);
  assert.equal(button(tree, cartLabels.en.portableMerge), undefined);
  driver.instances.clear();
});

test("F2 read-only preview uses exact locale/neutral fallback/BigInt counts without cart writes or URL change", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ location, writes }) => {
    location.href = linkFor(incoming.map(line => ({ ...line, quantity: Number.MAX_SAFE_INTEGER })), `/${locale}/cart`) + `#cart-item-${id}`;
    const before = location.href, tree = cart(props(locale)).panel;
    assert.ok(text(tree).includes(products[0].names[locale]));
    assert.ok(text(tree).includes((BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2)).toString()));
    if (locale !== "en") { assert.ok(text(tree).includes(storefrontLabels[locale].details)); assert.ok(!text(tree).includes("Synthetic two")); }
    assert.equal(button(tree, cartLabels[locale].portableMerge).props.disabled, false);
    assert.deepEqual(writes, []); assert.equal(location.href, before);
    assert.match(tree.props.className, /min-w-0/);
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => /max-w-full.*break-words/.test(node.props.className)));
    assert.equal(nodes(tree).filter(node => node.type === "li").length, 2);
    assert.ok(!text(tree).includes(hidden));
  });
});

test("F2 malformed/repeated/missing/unpublished incoming preview rejects all rows with neutral feedback", async () => stores(async ({ location, writes }) => {
  for (const href of [fromPayload("bad"), linkFor() + "&cartDraft=bad", fromPayload(`v1.${id}:1,${hidden}:2`)]) {
    location.href = href;
    const tree = cart(props()).panel;
    assert.ok(text(tree).includes(cartLabels.en.portableInvalid));
    assert.equal(button(tree, cartLabels.en.portableMerge), undefined);
    assert.equal(nodes(tree).filter(node => node.type === "li").length, 0);
    assert.ok(!text(tree).includes(hidden)); assert.ok(!text(tree).includes(products[0].names.en));
  }
  location.href = linkFor();
  assert.equal(button(cart(props("en", "en", [])).panel, cartLabels.en.portableMerge), undefined);
  assert.deepEqual(writes, []);
}));

test("F1 export awaits clipboard success, includes omission count, exact current origin and locale, changes no store", async () => {
  for (const routeLocale of [null, "en", "hu", "ko"]) await stores(async ({ copied, writes, location }) => {
    const locale = routeLocale ?? "en", path = `${routeLocale ? `/${routeLocale}` : ""}/cart`;
    location.href = origin + path;
    let tree = cart(props(locale, routeLocale)).panel;
    await button(tree, cartLabels[locale].portableCopy).props.onClick(); tree = cart(props(locale, routeLocale)).panel;
    assert.ok(text(tree).includes(`${cartLabels[locale].portableOmitted}: 1.`));
    assert.ok(text(tree).includes(cartLabels[locale].portableCopied)); assert.equal(copied.length, 1);
    assert.equal(new URL(copied[0]).pathname, path); assert.equal(new URL(copied[0]).origin, origin);
    assert.deepEqual(readPortableLink(copied[0]).lines, [{ publicId: id, quantity: 5 }]); assert.deepEqual(writes, []);
  });
});

test("F1 zero eligible public rows have explicit empty-export feedback and disabled copy without writes", async () => {
  for (const initial of [[], [lines[1]]]) await stores(async ({ copied, writes }) => {
    const tree = cart(props()).panel;
    assert.equal(button(tree, cartLabels.en.portableCopy).props.disabled, true);
    assert.ok(text(tree).includes(cartLabels.en.portableEmpty));
    assert.deepEqual(copied, []); assert.deepEqual(writes, []);
  }, initial);
});

test("F1 denied/missing clipboard, denied/corrupt/stale cart and oversized/empty export never claim copied", async () => {
  for (const mode of ["clipboard-denied", "clipboard-missing", "read", "corrupt", "changed", "oversize", "empty"]) await stores(async ({ values, copied, writes, control, location }) => {
    location.href = origin + "/cart";
    let tree = cart(props()).panel;
    if (mode === "clipboard-denied") control.clipboard = async () => { throw new Error("synthetic denial"); };
    if (mode === "clipboard-missing") Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    if (mode === "read") control.readDenied = true;
    if (mode === "corrupt") values.set(CART_STORAGE_KEY, "{");
    if (mode === "changed") values.set(CART_STORAGE_KEY, serializeCart([...lines].reverse()));
    if (mode === "oversize") { location.href = `https://${"a".repeat(MAX_PORTABLE_LINK)}.invalid/cart`; tree = cart(props()).panel; }
    if (mode === "empty") { values.set(CART_STORAGE_KEY, serializeCart([lines[1]])); tree = cart(props()).panel; }
    await button(tree, cartLabels.en.portableCopy).props.onClick(); tree = cart(props()).panel;
    assert.ok(!text(tree).includes(cartLabels.en.portableCopied)); assert.deepEqual(copied, []); assert.deepEqual(writes, []);
  });
});

test("F1 pending copy duplicate/stale completion guards include changed cart/projection/locale/URL and unmount", async () => {
  for (const mode of ["normal", "cart", "projection", "locale", "url", "unmount"]) await stores(async ({ values, copied, writes, control, notify, location }) => {
    let resolve;
    control.clipboard = value => { copied.push(value); return new Promise(done => { resolve = done; }); };
    let properties = props(), tree = cart(properties).panel;
    const stale = button(tree, cartLabels.en.portableCopy), pending = stale.props.onClick();
    await stale.props.onClick(); assert.equal(copied.length, 1);
    tree = cart(properties).panel; assert.ok(!text(tree).includes(cartLabels.en.portableCopied));
    if (mode === "cart") { values.set(CART_STORAGE_KEY, serializeCart([{ ...lines[0], quantity: 6 }, lines[1]])); notify(CART_STORAGE_KEY); cart(properties); }
    if (mode === "projection") { properties = props("en", "en", []); cart(properties); }
    if (mode === "locale") { properties = props("hu"); cart(properties); }
    if (mode === "url") location.hash = "changed";
    if (mode === "unmount") for (const [key, cleanups] of driver.cleanups) if (key.startsWith("panel:")) cleanups.forEach(cleanup => cleanup());
    resolve(); await pending; tree = cart(properties).panel;
    if (mode === "normal") assert.ok(text(tree).includes(cartLabels.en.portableCopied));
    else assert.ok(!text(tree).includes(cartLabels[properties.locale].portableCopied));
    assert.deepEqual(writes, []);
  });
});

test("F3/F4 explicit merge adds, preserves hidden line/order/casing, confirms whole result, disables same open draft repeat", async () => {
  for (const locale of ["en", "hu", "ko"]) await stores(async ({ values, writes, location }) => {
    location.href = linkFor(incoming, `/${locale}/cart`);
    let tree = cart(props(locale)).panel;
    const stale = button(tree, cartLabels[locale].portableMerge);
    assert.deepEqual(writes, []); stale.props.onClick(); stale.props.onClick();
    tree = cart(props(locale)).panel;
    assert.equal(writes.length, 1); assert.deepEqual(writes, [CART_STORAGE_KEY]);
    assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, [{ publicId: id.toUpperCase(), quantity: 7 }, lines[1], { publicId: other, quantity: 3 }]);
    assert.ok(text(tree).includes(cartLabels[locale].portableMerged));
    assert.equal(button(tree, cartLabels[locale].portableMerge).props.disabled, true);
    button(tree, cartLabels[locale].portableMerge).props.onClick(); assert.equal(writes.length, 1);
    location.hash = `cart-item-${id}`; tree = cart(props(locale)).panel;
    assert.equal(button(tree, cartLabels[locale].portableMerge).props.disabled, true);
    button(tree, cartLabels[locale].portableMerge).props.onClick(); assert.equal(writes.length, 1);
    assert.ok(!text(tree).includes(hidden));
  });
});

test("F3 virgin empty browser storage can merge; vanished nonempty witness cannot; overflow never partially writes", async () => {
  await stores(async ({ values, writes }) => {
    button(cart(props()).panel, cartLabels.en.portableMerge).props.onClick();
    assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, incoming); assert.equal(writes.length, 1);
  }, null);
  await stores(async ({ values, writes }) => {
    const tree = cart(props()).panel; values.delete(CART_STORAGE_KEY);
    button(tree, cartLabels.en.portableMerge).props.onClick();
    assert.ok(text(cart(props()).panel).includes(cartLabels.en.portableConflict)); assert.deepEqual(writes, []);
  });
  await stores(async ({ writes }) => {
    button(cart(props()).panel, cartLabels.en.portableMerge).props.onClick();
    assert.ok(text(cart(props()).panel).includes(cartLabels.en.portableOverflow)); assert.deepEqual(writes, []);
  }, [{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }]);
});

test("F4 corrupt/denied/changed/prewrite/postwrite failures never say merged; stale double-click and notifications cannot unlock", async () => {
  for (const mode of ["changed", "corrupt", "read", "prewrite", "write", "post-read", "post-change", "post-missing", "post-corrupt"]) await stores(async ({ values, writes, control, notify }) => {
    let tree = cart(props()).panel;
    const stale = button(tree, cartLabels.en.portableMerge);
    if (mode === "changed") values.set(CART_STORAGE_KEY, serializeCart([...lines].reverse()));
    if (mode === "corrupt") values.set(CART_STORAGE_KEY, "{");
    if (mode === "read") control.readDenied = true;
    if (mode === "prewrite") { const start = control.reads; control.beforeRead = count => { if (count === start + 2) values.set(CART_STORAGE_KEY, serializeCart([...lines].reverse())); }; }
    if (mode === "write") control.writeDenied = true;
    if (mode.startsWith("post-")) control.afterWrite = () => {
      if (mode === "post-read") control.readDenied = true;
      if (mode === "post-change") values.set(CART_STORAGE_KEY, serializeCart(lines));
      if (mode === "post-missing") values.delete(CART_STORAGE_KEY);
      if (mode === "post-corrupt") values.set(CART_STORAGE_KEY, "{");
    };
    stale.props.onClick(); const count = writes.length; stale.props.onClick(); assert.equal(writes.length, count);
    tree = cart(props()).panel;
    assert.ok(!text(tree).includes(cartLabels.en.portableMerged));
    const expected = ["changed", "prewrite"].includes(mode) ? cartLabels.en.portableConflict : ["corrupt", "read"].includes(mode) ? cartLabels.en.portableUnavailable : cartLabels.en.portableWriteFailed;
    assert.ok(text(tree).includes(expected), mode);
    assert.equal(button(tree, cartLabels.en.portableMerge).props.disabled, true);
    control.readDenied = false; control.writeDenied = false; control.afterWrite = null; control.beforeRead = null;
    values.set(CART_STORAGE_KEY, serializeCart(lines)); notify(CART_STORAGE_KEY);
    tree = cart(props()).panel; button(tree, cartLabels.en.portableMerge).props.onClick(); stale.props.onClick();
    assert.equal(writes.length, count); assert.ok(!text(tree).includes(cartLabels.en.portableMerged));
    assert.equal(button(tree, cartLabels.en.portableMerge).props.disabled, true);
  });
});

test("F4 stale incoming URL/projection/handler rejected before writes; a deliberately fresh draft is independently reviewed", async () => stores(async ({ location, writes }) => {
  const original = cart(props()).panel, stale = button(original, cartLabels.en.portableMerge);
  cart(props("en", "en", [])); stale.props.onClick(); assert.deepEqual(writes, []);
  location.href = linkFor([{ publicId: other, quantity: 1 }]);
  let tree = cart(props()).panel;
  assert.equal(nodes(tree).filter(node => node.type === "li").length, 1);
  button(tree, cartLabels.en.portableMerge).props.onClick(); tree = cart(props()).panel;
  assert.ok(text(tree).includes(cartLabels.en.portableMerged)); assert.equal(writes.length, 1);
}));

test("F4 callback-time public projection or incoming link changes refuse before the existing-store write", async () => {
  for (const mode of ["projection", "incoming"]) await stores(async ({ control, location, writes }) => {
    const stale = button(cart(props()).panel, cartLabels.en.portableMerge), start = control.reads;
    control.beforeRead = count => {
      if (count !== start + 2) return;
      if (mode === "projection") cart(props("en", "en", []));
      else location.href = linkFor([{ publicId: other, quantity: 1 }]);
    };
    stale.props.onClick(); assert.deepEqual(writes, []);
  });
});

test("F2/F4 storage invalid/unavailable preview remains read-only with disabled merge and cannot reset storage", async () => {
  for (const mode of ["corrupt", "denied"]) await stores(async ({ values, writes, control, notify }) => {
    if (mode === "corrupt") values.set(CART_STORAGE_KEY, "{"); else control.readDenied = true;
    notify(CART_STORAGE_KEY);
    const tree = cart(props()).panel;
    assert.ok(text(tree).includes(cartLabels.en.portablePreview));
    assert.equal(button(tree, cartLabels.en.portableMerge).props.disabled, true);
    button(tree, cartLabels.en.portableMerge).props.onClick(); assert.deepEqual(writes, []);
  });
});

test("Boundaries: only Cart UI integration, pure bounded helper, no new storage write/key, localized neutral labels and empty catalogue", () => {
  const helper = readFileSync(join(repo, "lib/cart/cart-portable-handoff.ts"), "utf8");
  assert.doesNotMatch(helper, /\bwindow\b|navigator|localStorage|sessionStorage|server-only|local-catalogue|fetch\(/);
  const source = readFileSync(join(repo, "components/cart/ShoppingCart.tsx"), "utf8");
  assert.doesNotMatch(source, /localStorage\.setItem|sessionStorage|history\.(pushState|replaceState)/);
  assert.match(source, /sameCartSelection\(confirmed.lines, planned.after\)/);
  assert.match(source, /current !== cart.lines/); assert.match(source, /confirmationUsed.current = true/);
  assert.match(source, /cartRowFromHash/); assert.match(source, /formatCartShoppingList/);
  assert.match(readFileSync(join(repo, "data/catalogue.ts"), "utf8"), /Object.freeze\(\[\]\)/);
  assert.deepEqual(Object.keys(cartLabels.en).sort(), Object.keys(cartLabels.hu).sort());
  assert.deepEqual(Object.keys(cartLabels.en).sort(), Object.keys(cartLabels.ko).sort());
  for (const locale of ["en", "hu", "ko"]) for (const key of Object.keys(cartLabels.en).filter(key => key.startsWith("portable"))) assert.ok(cartLabels[locale][key].trim());
});
