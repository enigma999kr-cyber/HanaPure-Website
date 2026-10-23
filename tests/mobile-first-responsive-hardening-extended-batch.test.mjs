import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { readShoppingPlan } from "../lib/catalog/catalogue-shopping-plan.ts";
import { portablePayload } from "../lib/cart/cart-portable-handoff.ts";
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
    if (specifier === "react" && /\/(components\/(catalogue\/(CatalogueShoppingPlan|SavedProductsBar|RecentlyViewedProducts|ProductComparison)|cart\/(ShoppingCart|AddToCart)|layout\/Header)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites|recently-viewed\/browser-recent)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
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



const { default: Header } = await import("../components/layout/Header.tsx");
const { default: AddToCart, cartControl } = await import("../components/cart/AddToCart.tsx");
const { cartLabels } = await import("../lib/cart/labels.ts");
function header(query = "") { return render(Header, { catalogueQuery: query }, "header"); }
function menu(tree) { return nodes(tree).find(node => node.type === "button" && node.props["aria-controls"] === "mobile-navigation"); }
function nav(tree) { return nodes(tree).find(node => node.props?.id === "mobile-navigation"); }

test("F1 null context has native disabled non-links and a single warning outside fixed header in every locale", async () => stores(async ({ writes }) => {
  for (const locale of ["en", "hu", "ko"]) {
    driver.pathname = "/" + locale + "/products"; dispose("header");
    const tree = header(null), labels = storefrontLabels[locale], shell = nodes(tree).find(node => node.type === "header");
    for (const label of [labels.shop, labels.search]) {
      const controls = nodes(tree).filter(node => node.type === "button" && text(node) === label);
      assert.equal(controls.length, 2); assert.ok(controls.every(node => node.props.disabled && !node.props.href && !node.props.onClick && node.props.role !== "link"));
      assert.ok(!links(tree).some(node => text(node) === label));
    }
    assert.equal(nodes(tree).filter(node => node.props?.role === "status" && text(node) === labels.planLimit).length, 1);
    assert.ok(!text(shell).includes(labels.planLimit), "warning must not consume fixed header/menu height");
    assert.equal(nav(tree).props.hidden, true); menu(tree).props.onClick(); assert.equal(nav(header(null)).props.hidden, false);
  }
  assert.deepEqual(writes, []);
}));

test("F1 valid desktop/mobile navigation retains plan/query, locale controls and route change dismisses menu permanently", async () => stores(async ({ writes }) => {
  const payload = portablePayload(records.slice(0,2).map(product => ({ publicId: product.publicId, quantity: 2 })));
  for (const routeLocale of [null,"en","hu","ko"]) {
    const locale=routeLocale??"en", path=storefrontHref("/products",routeLocale);
    driver.pathname=path;dispose("header");
    const query="?"+new URLSearchParams({q:"árvíz 한국",brand:"Anua",cartPlan:payload});
    let tree=header(query);
    const shop=links(tree).filter(node=>text(node)===storefrontLabels[locale].shop);
    assert.equal(shop.length,2); assert.ok(shop.every(node=>node.props.href===path+query));
    menu(tree).props.onClick();tree=header(query);assert.equal(nav(tree).props.hidden,false);
    driver.pathname=storefrontHref("/brands",routeLocale);tree=header(query);assert.equal(nav(tree).props.hidden,true);
    driver.pathname=path;tree=header(query);assert.equal(nav(tree).props.hidden,true);
  }
  assert.deepEqual(writes,[]);
}));

test("F1 synthetic Escape/outside/breakpoint focus cleanup preserves listeners and uses Brands fallback for refused Shop", async () => stores(async ({ writes }) => {
  const previousDocument=Object.getOwnPropertyDescriptor(globalThis,"document"), previousNode=Object.getOwnPropertyDescriptor(globalThis,"Node");
  const documentListeners=new Map(), mediaListeners=new Set(), body={}, focus={menu:0,shop:0,brands:0};
  const listen=(type,fn)=>{if(!documentListeners.has(type))documentListeners.set(type,new Set());documentListeners.get(type).add(fn);};
  const document={body,activeElement:body,addEventListener:listen,removeEventListener:(type,fn)=>documentListeners.get(type)?.delete(fn)};
  class FakeNode {}
  Object.defineProperty(globalThis,"document",{configurable:true,value:document});
  Object.defineProperty(globalThis,"Node",{configurable:true,value:FakeNode});
  window.matchMedia=()=>({matches:true,addEventListener:(_,fn)=>mediaListeners.add(fn),removeEventListener:(_,fn)=>mediaListeners.delete(fn)});
  const emit=(type,event)=>[...(documentListeners.get(type)??[])].forEach(fn=>fn(event));
  function attach(tree) {
    const shell=nodes(tree).find(node=>node.type==="header");
    shell.props.ref.current={contains:()=>false,querySelector:()=>({contains:()=>false})};
    menu(tree).props.ref.current={focus:()=>focus.menu++};
    for(const node of nodes(tree))if(node.props?.ref && typeof node.props.ref==="object" && typeof node.props.href==="string") {
      if(text(node)===storefrontLabels.en.shop)node.props.ref.current={focus:()=>focus.shop++};
      if(node.props.href==="/en/brands")node.props.ref.current={focus:()=>focus.brands++};
    }
  }
  try {
    driver.pathname="/en/products";
    for(const query of ["",null]){
      dispose("header");let tree=header(query);attach(tree);menu(tree).props.onClick();tree=header(query);attach(tree);
      let prevented=0;emit("keydown",{key:"Escape",preventDefault(){prevented++;}});tree=header(query);
      assert.equal(nav(tree).props.hidden,true);assert.equal(prevented,1);
      attach(tree);menu(tree).props.onClick();tree=header(query);attach(tree);
      emit("pointerdown",{target:new FakeNode()});assert.equal(nav(header(query)).props.hidden,true);
      tree=header(query);attach(tree);menu(tree).props.onClick();tree=header(query);attach(tree);
      [...mediaListeners].forEach(fn=>fn({matches:true}));assert.equal(nav(header(query)).props.hidden,true);
      assert.equal(mediaListeners.size,0);assert.equal(documentListeners.get("keydown").size,0);
    }
    assert.ok(focus.menu>=2);assert.equal(focus.shop,1);assert.equal(focus.brands,1);assert.deepEqual(writes,[]);
  } finally {
    dispose("header");
    if(previousDocument)Object.defineProperty(globalThis,"document",previousDocument);else delete globalThis.document;
    if(previousNode)Object.defineProperty(globalThis,"Node",previousNode);else delete globalThis.Node;
  }
}));

test("F2 native GET and published card/detail URLs retain exact browse contract with shrinkable controls", () => {
  const raw=portablePayload(records.slice(0,2).map(product=>({publicId:product.publicId,quantity:2})));
  for(const routeLocale of [null,"en","hu","ko"]){
    const locale=routeLocale??"en",root=ProductListing({catalogue,locale,routeLocale,criteria:{query:locale==="en"?"synthetic":"",brand:"",sort:"name-desc"},planHint:raw});
    const form=nodes(root).find(node=>node.type==="form");
    assert.equal(form.props.method,"get");assert.equal(form.props.action,storefrontHref("/products",routeLocale));
    assert.ok(nodes(form).some(node=>node.type==="input"&&node.props.name==="cartPlan"&&node.props.value===raw));
    const controls=nodes(form).filter(node=>["input","select"].includes(node.type)&&!["hidden","checkbox"].includes(node.props.type));
    assert.ok(controls.length>0);assert.ok(controls.every(node=>/min-w-0/.test(node.props.className)));
    const details=links(root).filter(node=>node.props.href.includes("/products/synthetic-"));
    assert.ok(details.length>0);assert.ok(details.every(node=>new URL(node.props.href,"https://synthetic.invalid").searchParams.get("cartPlan")===raw));
    assert.throws(()=>ProductDetail({catalogue,slug:"private-test",locale,routeLocale}));
  }
});

test("F3/F5 shared Cart control styling permits shrinking/wrapping without implicit quantity writes or changed explicit Add", async () => stores(async ({ writes, values }) => {
  assert.match(cartControl,/min-w-0/);assert.match(cartControl,/max-w-full/);assert.match(cartControl,/whitespace-normal/);
  const props={publicId:id(1),locale:"hu",routeLocale:"hu"};let tree=render(AddToCart,props,"add");
  const form=nodes(tree).find(node=>node.type==="form");
  assert.ok(/min-w-0/.test(form.props.className));assert.equal(writes.length,0);
  nodes(form).find(node=>node.type==="input").props.onChange({target:{value:"2"}});
  tree=render(AddToCart,props,"add");nodes(tree).find(node=>node.type==="form").props.onSubmit({preventDefault(){}});
  assert.equal(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines[0].quantity,7);
  assert.equal(writes.length,1);assert.ok(text(tree).includes(cartLabels.hu.add));
}));

test("F4 planned and catalogue selection labels have shrinkable text distinct from native checkbox and preserve state", async () => stores(async ({ writes }) => {
  const props={plan:readShoppingPlan(portablePayload(records.map(product=>({publicId:product.publicId,quantity:1}))),records),
    products:comparisons.map(product=>({...product,name:"Hosszú".repeat(60)})),publishedIds:records.map(product=>product.publicId),
    visibleIds:[],locale:"hu",routeLocale:"hu",path:"/hu/products",query:""};
  let tree=render(Plan,props,"plan");
  const labels=nodes(tree).filter(node=>node.type==="label"&&nodes(node).some(child=>child.type==="input"&&child.props.type==="checkbox"));
  assert.equal(labels.length,4);
  assert.ok(labels.every(label=>nodes(label).some(child=>child.type==="span"&&/min-w-0/.test(child.props.className)&&text(child).includes("Hosszú"))));
  select(tree,[0,1]);tree=render(Plan,props,"plan");
  assert.equal(nodes(tree).filter(node=>node.type==="input"&&node.props.type==="checkbox"&&node.props.checked).length,2);
  assert.deepEqual(writes,[]);
}));

test("F6 no global clipping/viewport claims and only public synthetic fixture data is used", () => {
  assert.match(readFileSync(join(repo,"data/catalogue.ts"),"utf8"),/Object.freeze\(\[\]\)/);
  const css=readFileSync(join(repo,"app/globals.css"),"utf8");
  assert.match(css,/prefers-reduced-motion: reduce/);
  assert.ok(!/overflow-x:\s*hidden/.test(css));
});
