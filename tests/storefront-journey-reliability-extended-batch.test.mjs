import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { readShoppingPlan } from "../lib/catalog/catalogue-shopping-plan.ts";
import { portablePayload } from "../lib/cart/cart-portable-handoff.ts";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { RECENT_STORAGE_KEY, serializeRecent } from "../lib/recently-viewed/recent-state.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";

const id = index => `${String(index).padStart(8, "0")}-abcd-1234-abcd-123456789abc`;
const records = [1, 2, 3, 4].map(index => ({ publicId: id(index), slug: `synthetic-${index}`, brand: index === 1 ? "Anua" : "beplain", state: "published",
  translations: { en: { name: `Synthetic ${index}`, description: "Test only", images: [], usage: null, caution: null }, hu: null, ko: null } }));
const products = records.map(record => ({ publicId: record.publicId, slug: record.slug, brand: record.brand,
  names: { en: record.translations.en.name, hu: null, ko: null } }));
const comparisons = products.map(product => ({ ...product, name: product.names.en, description: "Test only", usage: null, caution: null, image: null }));

// Existing installed Node/TS JSX + hook/store convention, not hydrated browser evidence.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={pathname:'/en/products',rendering:false,dirty:false,instances:new Map(),active:[],index:0,effects:[],subscriptions:new Map(),serial:0,context:null};
export function useState(initial){const s=driver.active,i=driver.index++;if(!(i in s))s[i]=typeof initial==='function'?initial():initial;return [s[i],v=>{s[i]=typeof v==='function'?v(s[i]):v;if(driver.rendering)driver.dirty=true;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function createContext(){return {Provider:Symbol('plan-provider')};}
export function useContext(){return driver.context;}
export function useEffect(effect,deps){const s=driver.active,i=driver.index++,old=s[i];if(!old||!deps||!old.deps||deps.some((v,j)=>!Object.is(v,old.deps[j]))||deps.length!==old.deps.length){driver.effects.push(()=>{old?.cleanup?.();s[i]={effect:true,deps,cleanup:effect()};});}}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/(catalogue\/(CatalogueShoppingPlan|SavedProductsBar|RecentlyViewedProducts|ProductComparison|CopySearchLink)|cart\/(ShoppingCart|AddToCart)|layout\/Header)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites|recently-viewed\/browser-recent)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
    if (specifier === "react") return { url: reactEntry, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: jsxEntry, shortCircuit: true };
    if (specifier === "react-dom") return { url: pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "index.js")).href, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation" && context.parentURL?.endsWith("/components/layout/Header.tsx")) return { url: "data:text/javascript," + encodeURIComponent("import {driver} from " + JSON.stringify(hooksUrl) + ";export const usePathname=()=>driver.pathname;"), shortCircuit: true };
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
const browserCart = await import("../lib/cart/browser-cart.ts"), favorites = await import("../lib/favorites/browser-favorites.ts"), recent = await import("../lib/recently-viewed/browser-recent.ts");
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = tree => nodes(tree).filter(node => typeof node === "string" || typeof node === "number").join("");
const links = tree => nodes(tree).filter(node => typeof node.props?.href === "string");
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  let tree;
  for(let pass=0;pass<4;pass++) {
    driver.active = driver.instances.get(key); driver.index=0; driver.effects=[]; driver.dirty=false; driver.rendering=true;
    try { tree=component(props); } finally { driver.rendering=false; }
    if(!driver.dirty) break;
    assert.ok(pass<3,"conditional state reset converges");
  }
  for (const effect of driver.effects) effect();
  return tree;
}
function dispose(key) {
  for (const hook of driver.instances.get(key) ?? []) if (hook?.effect) hook.cleanup?.();
  driver.instances.delete(key);
}
async function stores(run, initialCart = [{ publicId: id(1), quantity: 5 }]) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: {}, activeElement: null, addEventListener() {}, removeEventListener() {} } });
  const values = new Map([[CART_STORAGE_KEY, serializeCart(initialCart)], [FAVORITES_STORAGE_KEY, serializeFavorites([id(1), id(2), id(3)])], [RECENT_STORAGE_KEY, serializeRecent([id(3), id(2), id(1)])]]);
  const writes = [], navigation = [], copied = [], events = new Map();
  const location = new URL("https://synthetic.invalid/en/products?q=synthetic");
  location.assign = href => navigation.push(href);
  const control = { denied: false, writeDenied: false, beforeRead: null, afterWrite: null, clipboard: async value => { copied.push(value); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), localStorage: {
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
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else delete globalThis.document;
  }
}
function select(root, indexes) {
  const checkboxes = nodes(root).filter(node => node.type === "input" && node.props.type === "checkbox");
  for (const index of indexes) checkboxes[index].props.onChange({ target: { checked: true } });
}
const { default: ShoppingCart } = await import("../components/cart/ShoppingCart.tsx");
const { default: CopySearchLink } = await import("../components/catalogue/CopySearchLink.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { cartLabels } = await import("../lib/cart/labels.ts");
const { comparisonLabels } = await import("../lib/comparison/labels.ts");
const { formatCartShoppingList } = await import("../lib/cart/cart-shopping-list.ts");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const cartProps = { products, locale: "en", routeLocale: "en" };
const cart = (props = cartProps) => render(ShoppingCart, props, "cart");
function deferred() { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }

for (const retrySucceeds of [true, false]) test("Correction F1 reset failure then retry " + (retrySucceeds ? "confirmed success restores trust" : "failure retains refusal"), async () => stores(async ({ values, notify, control, writes }) => {
  values.set(CART_STORAGE_KEY, "corrupt"); notify(CART_STORAGE_KEY);
  control.writeDenied = true;
  button(cart(), cartLabels.en.reset).props.onClick();
  let tree = cart();
  assert.ok(text(tree).includes(cartLabels.en.selectionUnavailable));
  assert.equal(nodes(tree).find(node => node.type === "input" && node.props.type === "search").props.disabled, true);
  control.writeDenied = !retrySucceeds;
  button(tree, cartLabels.en.reset).props.onClick(); tree = cart();
  assert.equal(text(tree).includes(cartLabels.en.updated), retrySucceeds);
  assert.equal(nodes(tree).find(node => node.type === "input" && node.props.type === "search").props.disabled, !retrySucceeds);
  assert.equal(writes.length, retrySucceeds ? 1 : 0);
  if (retrySucceeds) {
    assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines, []);
    assert.ok(!text(tree).includes(cartLabels.en.storage));
  } else assert.ok(text(tree).includes(cartLabels.en.selectionUnavailable));
}));

for (const surface of ["whole", "selected"]) for (const change of ["cart", "selection", "filter", "locale", "projection", "route"])
  test("Correction F3 " + surface + " completed receipt expires on " + change, async () => stores(async ({ values, notify, location, copied, writes }) => {
    let props = cartProps, tree = cart(props);
    if (surface === "selected") { select(tree, [0]); tree = cart(props); }
    await button(tree, surface === "whole" ? cartLabels.en.copyShoppingList : cartLabels.en.copySelectedList).props.onClick();
    tree = cart(props);
    const success = surface === "whole" ? cartLabels.en.shoppingListCopied : cartLabels.en.selectedListCopied;
    assert.ok(text(tree).includes(success));
    const originalText = copied[0];
    if (change === "cart") { values.set(CART_STORAGE_KEY, serializeCart([{ publicId: id(2), quantity: 3 }])); notify(CART_STORAGE_KEY); }
    if (change === "selection") nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: surface !== "selected" } });
    if (change === "filter") nodes(tree).find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "none" } });
    if (change === "locale") props = { ...props, locale: "hu", routeLocale: "hu" };
    if (change === "projection") props = { ...props, products: [] };
    if (change === "route") location.search = "?q=changed";
    assert.ok(!text(cart(props)).includes(success));
    if (change === "locale" || change === "projection") assert.ok(!text(cart(cartProps)).includes(success), "returning to earlier props must not revive receipt");
    if (change === "route") { location.search = "?q=synthetic"; assert.ok(!text(cart(props)).includes(success)); }
    assert.deepEqual(copied, [originalText]); assert.deepEqual(writes, []);
  }));

for (const change of ["href", "locale"]) test("Correction F4 completed Search receipt expires on " + change, async () => stores(async ({ copied, writes }) => {
  const initial = { relativeHref: "/en/products?q=synthetic", locale: "en" };
  const component = props => render(CopySearchLink, props, "copy");
  await button(component(initial), storefrontLabels.en.copySearchLink).props.onClick();
  assert.ok(text(component(initial)).includes(storefrontLabels.en.searchLinkCopied));
  const next = change === "href" ? { ...initial, relativeHref: "/en/products?q=other" } : { ...initial, locale: "hu" };
  assert.ok(!text(component(next)).includes(storefrontLabels.en.searchLinkCopied));
  assert.ok(!text(component(initial)).includes(storefrontLabels.en.searchLinkCopied));
  assert.deepEqual(copied, ["https://synthetic.invalid/en/products?q=synthetic"]); assert.deepEqual(writes, []);
}));

test("F1 explicit corrupt reset confirms empty readback and announces only confirmed success", async () => stores(async ({values,notify,writes}) => {
  values.set(CART_STORAGE_KEY,"corrupt");notify(CART_STORAGE_KEY);
  const tree=cart();button(tree,cartLabels.en.reset).props.onClick();
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines,[]);
  assert.equal(writes.length,1);assert.ok(text(cart()).includes(cartLabels.en.updated));
}));
for(const failure of ["write","read","mismatch","concurrent"]) test("F1 reset refuses "+failure+" without false saved confirmation", async () => stores(async ({values,notify,control,writes}) => {
  values.set(CART_STORAGE_KEY,"corrupt");notify(CART_STORAGE_KEY);const tree=cart();
  if(failure==="write") control.writeDenied=true;
  if(failure==="read") control.denied=true;
  if(failure==="mismatch") control.afterWrite=()=>values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(2),quantity:2}]));
  if(failure==="concurrent") control.beforeRead=()=>values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(2),quantity:2}]));
  button(tree,cartLabels.en.reset).props.onClick();
  assert.ok(!text(cart()).includes(cartLabels.en.updated));assert.ok(text(cart()).includes(cartLabels.en.selectionUnavailable));
  if(failure!=="mismatch")assert.equal(writes.length,0);
}));
function planProps() { return {plan:readShoppingPlan(portablePayload([{publicId:id(1),quantity:2},{publicId:id(2),quantity:3}]),records),
  products:comparisons,publishedIds:records.map(p=>p.publicId),visibleIds:records.map(p=>p.publicId),locale:"en",routeLocale:"en",path:"/en/products",query:"?q=synthetic"}; }
test("F2 direct plan edit/remove/card-add and anchors reject stale location and render handlers, no storage writes", async () => stores(async ({location,navigation,writes})=>{
  const props=planProps(), old=render(Plan,props,"plan");
  const quantity=nodes(old).find(node=>typeof node.type==="function"&&node.type.name==="PlannedQuantity");
  location.search="?q=changed";
  quantity.props.apply("4");nodes(old).find(node=>node.type==="button"&&node.props["aria-label"]?.startsWith(storefrontLabels.en.planRemove+":")).props.onClick();
  old.props.value.add([id(3)]);
  let prevented=0;links(old).filter(node=>text(node)===storefrontLabels.en.planClear||text(node)===storefrontLabels.en.planReviewCart).forEach(node=>node.props.onClick({preventDefault(){prevented++;}}));
  assert.equal(prevented,2);assert.deepEqual(navigation,[]);
  location.search="?q=synthetic";render(Plan,{...props,query:"?q=new"},"plan");quantity.props.apply("5");
  assert.deepEqual(navigation,[]);assert.deepEqual(writes,[]);
}));
test("F2 current direct edit navigates once, duplicate blocked, assign failure unlocks safe retry", async () => stores(async ({location,navigation,writes})=>{
  const props=planProps();let tree=render(Plan,props,"plan");
  const apply=nodes(tree).find(node=>typeof node.type==="function"&&node.type.name==="PlannedQuantity").props.apply;
  apply("0");apply("999999999999999999999999999999999999");assert.equal(navigation.length,0);
  const assign=location.assign;location.assign=()=>{throw new Error("synthetic navigation denied");};apply("4");
  location.assign=assign;apply("4");apply("5");assert.equal(navigation.length,1);
  const plan=readShoppingPlan(new URL(navigation[0],"https://synthetic.invalid").searchParams.get("cartPlan"),records);
  assert.equal(plan.lines[0].quantity,4);assert.deepEqual(writes,[]);
}));
test("F2 current row removal/card add/priority move preserve full Plan and invalid context cannot navigate",async()=>stores(async({navigation,writes})=>{
  const props=planProps();
  let tree=render(Plan,props,"plan");
  nodes(tree).find(node=>node.type==="button"&&node.props["aria-label"]?.startsWith(storefrontLabels.en.planRemove+":")).props.onClick();
  assert.equal(readShoppingPlan(new URL(navigation.at(-1),"https://synthetic.invalid").searchParams.get("cartPlan"),records).lines.length,1);
  dispose("plan");tree=render(Plan,props,"plan");tree.props.value.add([id(3)]);
  assert.equal(readShoppingPlan(new URL(navigation.at(-1),"https://synthetic.invalid").searchParams.get("cartPlan"),records).lines.length,3);
  dispose("plan");tree=render(Plan,props,"plan");
  nodes(tree).find(node=>node.type==="button"&&node.props["aria-label"]?.startsWith(storefrontLabels.en.planMoveDown+":")).props.onClick();
  assert.equal(readShoppingPlan(new URL(navigation.at(-1),"https://synthetic.invalid").searchParams.get("cartPlan"),records).lines[0].publicId,id(2));
  const count=navigation.length;dispose("plan");tree=render(Plan,{...props,plan:{status:"invalid",lines:[]}},"plan");tree.props.value.add([id(3)]);
  assert.equal(navigation.length,count);assert.deepEqual(writes,[]);
}));
for(const surface of ["whole","selected"]) {
  for(const change of ["cart","selection","filter","locale","projection","route","unmount","denied","corrupt"]) test("F3 "+surface+" copy suppresses delayed success after "+change,async()=>stores(async({values,notify,control,location,writes})=>{
    let props=cartProps,tree=cart(props);
    if(surface==="selected"){select(tree,[0]);tree=cart(props);}
    const delayed=deferred();control.clipboard=()=>delayed.promise;
    const pending=button(tree,surface==="whole"?cartLabels.en.copyShoppingList:cartLabels.en.copySelectedList).props.onClick();
    if(change==="cart"){values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(2),quantity:3}]));notify(CART_STORAGE_KEY);cart(props);}
    if(change==="selection"){nodes(tree).find(node=>node.type==="input"&&node.props.type==="checkbox").props.onChange({target:{checked:surface!=="selected"}});cart(props);}
    if(change==="filter"){nodes(tree).find(node=>node.type==="input"&&node.props.type==="search").props.onChange({target:{value:"none"}});cart(props);}
    if(change==="locale"){props={...props,locale:"hu",routeLocale:"hu"};cart(props);}
    if(change==="projection"){props={...props,products:[]};cart(props);}
    if(change==="route")location.search="?q=changed";
    if(change==="unmount")dispose("cart");
    if(change==="denied")control.denied=true;
    if(change==="corrupt")values.set(CART_STORAGE_KEY,"corrupt");
    delayed.resolve();await pending;
    if(change!=="unmount"){const result=text(cart(props));assert.ok(!result.includes(cartLabels.en.shoppingListCopied));assert.ok(!result.includes(cartLabels.en.selectedListCopied));}
    assert.deepEqual(writes,[]);
  }));
  for(const reject of [false,true]) test("F3 "+surface+" current clipboard "+(reject?"rejection":"success and exact original text"),async()=>stores(async({control,copied,writes})=>{
    let tree=cart();if(surface==="selected"){select(tree,[0]);tree=cart();}
    const delayed=deferred();control.clipboard=value=>{copied.push(value);return delayed.promise;};
    const label=surface==="whole"?cartLabels.en.copyShoppingList:cartLabels.en.copySelectedList;
    const pending=button(tree,label).props.onClick();button(tree,label).props.onClick();
    assert.equal(copied.length,1);assert.equal(copied[0],formatCartShoppingList([{publicId:id(1),quantity:5}],products,"en").text);
    if(reject) delayed.reject(new Error("denied")); else delayed.resolve();await pending;
    assert.ok(text(cart()).includes(reject?cartLabels.en.shoppingListFailed:surface==="whole"?cartLabels.en.shoppingListCopied:cartLabels.en.selectedListCopied));
    assert.deepEqual(writes,[]);
  }));
}
for(const surface of ["whole","selected"])test("F3 "+surface+" preserves unpublished omissions without exposing hidden text or storage writes",async()=>stores(async({copied,writes})=>{
  let tree=cart();if(surface==="selected"){select(tree,[0,1]);tree=cart();}
  await button(tree,surface==="whole"?cartLabels.en.copyShoppingList:cartLabels.en.copySelectedList).props.onClick();
  assert.equal(copied.length,1);assert.ok(!copied[0].includes(id(99)));
  assert.ok(text(cart()).includes((surface==="whole"?cartLabels.en.shoppingListCopiedOmitted:cartLabels.en.selectedListCopiedOmitted)+" 1."));
  assert.deepEqual(writes,[]);
},[{publicId:id(1),quantity:5},{publicId:id(99),quantity:2}]));
for(const change of ["props","locale","route","unmount","reject","none"])test("F4 canonical Search copy lifecycle "+change,async()=>stores(async({control,copied,location,writes})=>{
  let props={relativeHref:"/en/products?q=synthetic",locale:"en"};
  const component=()=>render(CopySearchLink,props,"copy");const delayed=deferred();control.clipboard=value=>{copied.push(value);return delayed.promise;};
  let tree=component();const pending=button(tree,storefrontLabels.en.copySearchLink).props.onClick();
  button(tree,storefrontLabels.en.copySearchLink).props.onClick();assert.equal(copied.length,1);
  if(change==="props"){props={...props,relativeHref:"/en/products?q=other"};component();}
  if(change==="locale"){props={relativeHref:"/hu/products?q=synthetic",locale:"hu"};component();}
  if(change==="route")location.search="?q=other";
  if(change==="unmount")dispose("copy");
  if(change==="reject")delayed.reject(new Error("denied"));else delayed.resolve();await pending;
  if(change!=="unmount")assert.equal(text(component()).includes(storefrontLabels.en.searchLinkCopied),change==="none");
  assert.deepEqual(writes,[]);
}));
test("F4 invalid/noncanonical/oversized link and unavailable clipboard fail without copy; safe retry works",async()=>stores(async({copied})=>{
  for(const relativeHref of ["/en/products?q=x&private=y","https://elsewhere.invalid/products?q=x","/en/products?q="+"x".repeat(8192)]){
    const props={relativeHref,locale:"en"}, tree=render(CopySearchLink,props,"copy");
    await button(tree,storefrontLabels.en.copySearchLink).props.onClick();assert.ok(text(render(CopySearchLink,props,"copy")).includes(storefrontLabels.en.searchLinkFailed));dispose("copy");
  }
  assert.equal(copied.length,0);
  const props={relativeHref:"/en/products?q=synthetic",locale:"en"};
  const clipboard=navigator.clipboard;navigator.clipboard=undefined;
  await button(render(CopySearchLink,props,"copy"),storefrontLabels.en.copySearchLink).props.onClick();
  navigator.clipboard=clipboard;
  await button(render(CopySearchLink,props,"copy"),storefrontLabels.en.copySearchLink).props.onClick();assert.equal(copied.length,1);
}));
test("F5 EN/HU/KO changed pair/swap/mode polite status, unchanged/invalid selection has no false receipt",async()=>stores(async({writes})=>{
  for(const locale of ["en","hu","ko"]){
    const props={products:comparisons,locale,routeLocale:locale,initialPublicId:id(1),initialSecondPublicId:id(2)},key="comparison-"+locale;
    let tree=render(ProductComparison,props,key);
    const status=()=>nodes(tree).find(node=>node.type==="p"&&node.props.role==="status");
    assert.equal(text(status()),"");
    const selects=()=>nodes(tree).filter(node=>node.type==="select");
    selects()[0].props.onChange({target:{value:id(1)}});tree=render(ProductComparison,props,key);assert.equal(text(status()),"");
    selects()[0].props.onChange({target:{value:"invalid"}});tree=render(ProductComparison,props,key);assert.equal(text(status()),"");
    selects()[0].props.onChange({target:{value:id(3)}});tree=render(ProductComparison,props,key);
    assert.ok(text(status()).includes("Synthetic 3"));assert.ok(text(status()).includes(comparisonLabels[locale].first));
    button(tree,comparisonLabels[locale].swap).props.onClick();tree=render(ProductComparison,props,key);assert.ok(text(status()).includes("Synthetic 2"));
    button(tree,comparisonLabels[locale].focusDifferences).props.onClick();tree=render(ProductComparison,props,key);
    assert.equal(text(status()),comparisonLabels[locale].differencesShown);
    assert.equal(button(tree,comparisonLabels[locale].showAll).props["aria-pressed"],true);
    button(tree,comparisonLabels[locale].showAll).props.onClick();tree=render(ProductComparison,props,key);
    assert.equal(text(status()),comparisonLabels[locale].allDetailsShown);
  }assert.deepEqual(writes,[]);
}));
