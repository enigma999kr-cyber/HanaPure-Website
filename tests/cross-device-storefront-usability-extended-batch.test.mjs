import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { CART_STORAGE_KEY, serializeCart, inspectStoredCart } from "../lib/cart/cart-state.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";

// Existing installed-TypeScript/registerHooks pattern, not browser/hydration evidence.
const require = createRequire(import.meta.url);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,subscriptions:new Map(),serial:0,effects:[]};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useEffect(effect,deps){const s=driver.active,i=driver.index++,old=s[i];if(!old||!deps||!old.deps||deps.length!==old.deps.length||deps.some((v,j)=>!Object.is(v,old.deps[j]))){driver.effects.push(()=>{old?.cleanup?.();s[i]={effect:true,deps,cleanup:effect()};});}}
export function createContext(){return {Provider:Symbol("synthetic-provider")};}
export function useContext(){return null;}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/(components\/(cart\/AddToCart|catalogue\/(SearchSuggestions|CatalogueResultPairPicker)|brands\/BrandDirectory)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
    if (specifier === "react") return { url: reactEntry, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: jsxEntry, shortCircuit: true };
    if (specifier === "react-dom") return { url: pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "index.js")).href, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation" && context.parentURL?.endsWith("/components/layout/Header.tsx")) return { url: "data:text/javascript,export const usePathname=()=>'/en/products';", shortCircuit: true };
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
const { default: AddToCart } = await import("../components/cart/AddToCart.tsx");
const { default: Suggestions } = await import("../components/catalogue/SearchSuggestions.tsx");
const { default: PairPicker } = await import("../components/catalogue/CatalogueResultPairPicker.tsx");
const { default: Directory } = await import("../components/brands/BrandDirectory.tsx");
const { default: BrandCard } = await import("../components/brands/BrandCard.tsx");
const { default: Hero } = await import("../components/home/Hero.tsx");
const { default: Why } = await import("../components/home/WhyHanaPure.tsx");
const { default: Brands } = await import("../components/brands/BrandsContent.tsx");
const { default: Featured } = await import("../components/brands/FeaturedBrands.tsx");
const { marketingCopy } = await import("../lib/storefront/marketing-copy.ts");
const { portablePayload } = await import("../lib/cart/cart-portable-handoff.ts");
const browserCart = await import("../lib/cart/browser-cart.ts");
const id = n => String(n).padStart(8,"0")+"-abcd-1234-abcd-123456789abc";
const products = [1,2,3].map(n=>({publicId:id(n),slug:"fixture-"+n,brand:"Anua",name:"Synthetic "+n,description:"Test only"}));
function nodes(node) {
  if(node==null||typeof node==="boolean")return [];
  if(Array.isArray(node))return node.flatMap(nodes);
  if(typeof node!=="object")return [node];
  return [node,...nodes(node.props?.children)];
}
const text = tree=>nodes(tree).filter(n=>typeof n==="string"||typeof n==="number").join(" ");
const buttons = tree=>nodes(tree).filter(n=>n.type==="button");
function render(component,props,key=component.name) {
  if(!driver.instances.has(key))driver.instances.set(key,[]);
  driver.active=driver.instances.get(key);driver.index=0;driver.effects=[];
  const tree=component(props);for(const effect of driver.effects)effect();return tree;
}
function dispose(key){for(const hook of driver.instances.get(key)??[])if(hook?.effect)hook.cleanup?.();driver.instances.delete(key);}
async function stores(run,lines=[{publicId:id(1),quantity:5}]) {
  const old=Object.getOwnPropertyDescriptor(globalThis,"window");
  const values=new Map([[CART_STORAGE_KEY,serializeCart(lines)]]),writes=[],navigation=[],events=new Set();
  const control={readDenied:false,writeDenied:false,beforeRead:null,afterWrite:null};
  const location=new URL("https://synthetic.invalid/en/products?q=Synthetic");location.assign=href=>navigation.push(href);
  Object.defineProperty(globalThis,"window",{configurable:true,value:{location,localStorage:{
    getItem(key){control.beforeRead?.();if(control.readDenied)throw Error("synthetic denied");return values.get(key)??null;},
    setItem(key,value){if(control.writeDenied)throw Error("synthetic denied");writes.push(key);values.set(key,value);control.afterWrite?.();}
  },addEventListener(type,callback){if(type==="storage")events.add(callback);},removeEventListener(type,callback){if(type==="storage")events.delete(callback);}}});
  browserCart.useBrowserCart();const unsub=[...driver.subscriptions.keys()].map(s=>s(()=>{}));
  const notify=()=>events.forEach(fn=>fn({key:CART_STORAGE_KEY}));notify();
  try{await run({values,writes,navigation,control,location,notify});}
  finally{[...driver.instances.keys()].forEach(dispose);unsub.forEach(fn=>fn());driver.subscriptions.clear();if(old)Object.defineProperty(globalThis,"window",old);else delete globalThis.window;}
}
function detail(locale="en",publicId=id(1)){return render(AddToCart,{publicId,locale,routeLocale:locale},"detail");}
function quantity(tree,raw){nodes(tree).find(n=>n.type==="input"&&n.props.type==="number").props.onChange({target:{value:raw}});}
const submit=tree=>nodes(tree).find(n=>n.type==="form").props.onSubmit({preventDefault(){}});
test("F1 virgin empty Cart adds only on explicit submit with confirmed readback",async()=>stores(async({values,writes,notify})=>{
  values.delete(CART_STORAGE_KEY);notify();submit(detail());
  assert.deepEqual(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines,[{publicId:id(1),quantity:1}]);
  assert.ok(text(detail()).includes(cartLabels.en.added));assert.equal(writes.length,1);
},[]));
test("F1 changed final prewrite witness refuses without write; failed postwrite read cannot announce added",async()=>stores(async({values,writes,control})=>{
  const tree=detail();let reads=0;
  control.beforeRead=()=>{if(++reads===2)values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(2),quantity:1}]));};
  submit(tree);assert.deepEqual(writes,[]);assert.ok(text(detail()).includes(cartLabels.en.selectionConflict));
  dispose("detail");control.beforeRead=null;values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(1),quantity:5}]));
  control.afterWrite=()=>{control.readDenied=true;};submit(detail());assert.equal(writes.length,1);
  assert.ok(text(detail()).includes(cartLabels.en.selectionWriteFailed));assert.ok(!text(detail()).includes(cartLabels.en.added));
}));
test("F1 detail rejects alternate/malformed quantities without storage writes",async()=>stores(async({writes})=>{
  for(const raw of ["1e2","0x10","1.0","-1","0"," 2","2 ","Infinity","NaN","9007199254740992","9".repeat(33)]){
    quantity(detail(),raw);submit(detail());assert.ok(text(detail()).includes(cartLabels.en.invalid));
  }assert.deepEqual(writes,[]);
}));
test("F1 confirmed additive quantity preserves EN/HU/KO and legacy Cart destination",async()=>stores(async({values,writes})=>{
  for(const locale of ["en","hu","ko"]){dispose("detail");quantity(detail(locale),"0002");submit(detail(locale));
    assert.ok(text(detail(locale)).includes(cartLabels[locale].added));
    assert.equal(inspectStoredCart(values.get(CART_STORAGE_KEY)).lines[0].quantity,5+2*(["en","hu","ko"].indexOf(locale)+1));
  }assert.equal(writes.length,3);
  const legacy=render(AddToCart,{publicId:id(1),locale:"en",routeLocale:null},"legacy");
  assert.ok(nodes(legacy).some(n=>n.props?.href==="/cart"));
}));
for(const failure of ["read","write","conflict","mismatch","corrupt","overflow","identity"])test("F1 "+failure+" refuses misleading success and latches uncertain state",async()=>stores(async({values,writes,control,notify})=>{
  let publicId=failure==="identity"?"invalid":id(1),tree=detail("en",publicId);
  if(failure==="read")control.readDenied=true;
  if(failure==="write")control.writeDenied=true;
  if(failure==="conflict")values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(2),quantity:4}]));
  if(failure==="mismatch")control.afterWrite=()=>values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(2),quantity:4}]));
  if(failure==="corrupt")values.set(CART_STORAGE_KEY,"invalid");
  if(failure==="overflow"){values.set(CART_STORAGE_KEY,serializeCart([{publicId:id(1),quantity:Number.MAX_SAFE_INTEGER}]));notify();tree=detail();}
  submit(tree);tree=detail("en",publicId);assert.ok(!text(tree).includes(cartLabels.en.added));
  assert.equal(writes.length,failure==="mismatch"?1:0);
  if(["read","write","conflict","mismatch","corrupt"].includes(failure)){
    assert.equal(buttons(tree).find(n=>n.props.type==="submit").props.disabled,true);
    control.readDenied=false;control.writeDenied=false;notify();submit(detail());assert.equal(writes.length,failure==="mismatch"?1:0);
  }
}));
const suggestionProps=(locale="en",plan)=>({products,initialQuery:"Synthetic",locale,routeLocale:locale,appliedCriteria:{brand:"Anua",sort:"name-desc"},plan,children:null});
function focusFixture(tree,input={focus(){this.focused=true;}}){
  const links=nodes(tree).filter(n=>n.props?.["data-search-suggestion"]!==undefined).map(n=>({href:n.props.href,focus(){input.active=this;},getAttribute(key){return key==="href"?this.href:null;}}));
  tree.props.ref.current={querySelector:()=>input,querySelectorAll:()=>links};
  const key=(target,key,extra={})=>{const event={target,key,nativeEvent:{isComposing:false},prevented:false,preventDefault(){this.prevented=true;},...extra};tree.props.onKeyDown(event);return event;};
  return {links,input,key};
}
test("F2 arrows use actual input/current links without trapping Tab/Enter and Escape returns input",async()=>stores(async({writes})=>{
  const props=suggestionProps();let tree=render(Suggestions,props,"suggestions"),f=focusFixture(tree);
  assert.equal(f.key(f.input,"ArrowDown").prevented,true);assert.equal(f.input.active,f.links[0]);
  f.key(f.links[0],"ArrowDown");assert.equal(f.input.active,f.links[1]);
  f.key(f.links[1],"ArrowUp");assert.equal(f.input.active,f.links[0]);
  f.key(f.links[0],"ArrowUp");assert.equal(f.input.focused,true);
  assert.equal(f.key(f.links.at(-1),"ArrowDown").prevented,false);
  for(const key of ["Enter","Tab"])assert.equal(f.key(f.input,key).prevented,false);
  assert.equal(f.key(f.links[1],"Escape").prevented,true);
  tree=render(Suggestions,props,"suggestions");assert.equal(nodes(tree).filter(n=>n.type==="ul").length,0);
  f=focusFixture(tree);assert.equal(f.key(f.input,"Escape").prevented,false);assert.deepEqual(writes,[]);
}));
test("F2 modifiers/IME/handled/unrelated controls and absent/invalid links retain native behavior",async()=>stores(async()=>{
  let tree=render(Suggestions,suggestionProps(),"suggestions"),f=focusFixture(tree);
  for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{defaultPrevented:true},{nativeEvent:{isComposing:true}}])
    for(const key of ["ArrowDown","Escape"])assert.equal(f.key(f.input,key,extra).prevented,false);
  for(const target of [{}, {name:"other"}, {href:"/elsewhere"}])assert.equal(f.key(target,"Escape").prevented,false);
  f.links[0].href="javascript:invalid";assert.equal(f.key(f.links[0],"Escape").prevented,false);
  f.links.splice(0);assert.equal(f.key(f.input,"ArrowDown").prevented,false);
  dispose("suggestions");tree=render(Suggestions,{...suggestionProps(),products:[]},"suggestions");f=focusFixture(tree);assert.equal(f.key(f.input,"Escape").prevented,false);
}));
test("F2 oversized Plan URLs expose refusal rather than focusable suggestion links",async()=>stores(async()=>{
  const plan={status:"ready",lines:Array.from({length:40},(_,i)=>({publicId:id(i+1),quantity:Number.MAX_SAFE_INTEGER}))};
  const props={...suggestionProps("en",plan),products:products.map(product=>({...product,name:"a".repeat(3000)})),initialQuery:"a".repeat(3000),appliedCriteria:{brand:"x".repeat(4096),sort:"name-desc"}};
  const tree=render(Suggestions,props,"suggestions"),f=focusFixture(tree);
  assert.equal(f.links.length,0);assert.ok(text(tree).includes(storefrontLabels.en.planLimit));
  assert.equal(f.key(f.input,"ArrowDown").prevented,false);
}));
test("F2 typed input reopens results, zero matches and bounded Plan/locale links remain truthful",async()=>stores(async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,"HTMLInputElement");
  class Input{constructor(){this.id="catalogue-search";this.name="q";this.value="Synthetic";}focus(){}}
  Object.defineProperty(globalThis,"HTMLInputElement",{configurable:true,value:Input});
  try{for(const locale of ["en","hu","ko"]){
    dispose("suggestions");const plan={status:"ready",lines:[{publicId:id(1),quantity:2}]},props=suggestionProps(locale,plan);
    let tree=render(Suggestions,props,"suggestions"),input=new Input(),f=focusFixture(tree,input);
    assert.equal(nodes(tree).find(n=>n.type==="ul").props["aria-label"],nodes(tree).find(n=>n.props?.role==="status").props.children.split(":")[0]);
    assert.equal(f.links.length,3);assert.ok(f.links.every(link=>new URL(link.href,"https://synthetic.invalid").searchParams.get("cartPlan")===portablePayload(plan.lines)));
    f.key(input,"Escape");tree=render(Suggestions,props,"suggestions");focusFixture(tree,input);input.value="no matches";tree.props.onChange({target:input});tree=render(Suggestions,props,"suggestions");assert.equal(nodes(tree).filter(n=>n.type==="ul").length,0);
    focusFixture(tree,input);input.value="Synthetic";tree.props.onChange({target:input});tree=render(Suggestions,props,"suggestions");assert.equal(focusFixture(tree,input).links.length,3);
  }}finally{if(old)Object.defineProperty(globalThis,"HTMLInputElement",old);else delete globalThis.HTMLInputElement;}
}));
const pairProps={products,locale:"en",routeLocale:"en",catalogueQuery:"?q=Synthetic",children:null};
function pair(){return render(PairPicker,pairProps,"pair");}
function chosen(){let tree=pair();tree.props.value.toggle(id(1),true);tree=pair();tree.props.value.toggle(id(2),true);return pair();}
test("F3 valid pair navigates once, assign failure reports honestly and permits retry",async()=>stores(async({location,navigation,writes})=>{
  let tree=chosen(),button=buttons(tree)[0];const assign=location.assign;location.assign=()=>{throw Error("synthetic navigation denied");};
  button.props.onClick();assert.ok(text(pair()).includes(storefrontLabels.en.comparisonNavigationFailed));
  location.assign=assign;tree=pair();button=buttons(tree)[0];button.props.onClick();button.props.onClick();
  assert.equal(navigation.length,1);
  const destination=new URL(navigation[0],"https://synthetic.invalid");
  assert.equal(destination.searchParams.get("compareFirst"),id(1));assert.equal(destination.searchParams.get("compareSecond"),id(2));assert.deepEqual(writes,[]);
}));
test("F3 stale location/render/criteria/selection and unmount refuse navigation",async()=>stores(async({location,navigation,writes})=>{
  const tree=chosen(),old=buttons(tree)[0];location.search="?q=changed";old.props.onClick();assert.equal(navigation.length,0);
  location.search="?q=Synthetic";render(PairPicker,{...pairProps,catalogueQuery:"?q=other"},"pair");old.props.onClick();assert.equal(navigation.length,0);
  dispose("pair");old.props.onClick();assert.equal(navigation.length,0);assert.deepEqual(writes,[]);
}));
test("F3 unknown/duplicate/third identity cannot make a pair; two-ID/public options contract preserved",async()=>stores(async({navigation})=>{
  let tree=pair();tree.props.value.toggle("invalid",true);tree.props.value.toggle(id(1),true);tree=pair();tree.props.value.toggle(id(1).toUpperCase(),true);tree=pair();
  assert.equal(buttons(tree)[0].props.disabled,true);
  tree.props.value.toggle(id(2),true);tree=pair();tree.props.value.toggle(id(3),true);tree=pair();assert.equal(tree.props.value.ids.length,2);
  assert.deepEqual(tree.props.value.ids,[id(1),id(2)]);assert.deepEqual(navigation,[]);
}));
test("F4 A-Z wraps 44px boxes, exact filters/search/empty state keep only provided public destinations",()=>{
  const props={labels:marketingCopy.hu.directory,catalogueLinks:{Anua:"/hu/products?brand=Anua",beplain:"/hu/products?brand=beplain"},emptyState:{heading:"Empty",description:"None"}};
  let tree=render(Directory,props,"directory");const letters=buttons(tree);assert.equal(letters.length,27);
  assert.ok(letters.every(n=>/min-h-11/.test(n.props.className)&&/min-w-11/.test(n.props.className)));
  assert.ok(nodes(tree).some(n=>/flex min-w-0 flex-wrap gap-1.5/.test(n.props?.className??"")));
  letters.find(n=>text(n)==="A").props.onClick();tree=render(Directory,props,"directory");assert.equal(nodes(tree).filter(n=>n.props?.href).length,1);
  nodes(tree).find(n=>n.type==="input").props.onChange({target:{value:"no match"}});tree=render(Directory,props,"directory");assert.equal(nodes(tree).filter(n=>n.props?.href).length,0);
  dispose("directory");
  tree=render(Directory,{...props,catalogueLinks:{}},"directory");assert.equal(nodes(tree).filter(n=>n.props?.href).length,0);
});
test("F4 BrandCard minimum tap/focus and no tracking/translation hover shifts; publication gate unchanged",()=>{
  const props={name:"Anua",tagline:"Test",description:"Test only",accent:"",discover:"Discover",routeLocale:"ko"};
  assert.equal(nodes(BrandCard({...props,hasPublishedProduct:false})).filter(n=>n.props?.href).length,0);
  const tree=BrandCard({...props,hasPublishedProduct:true}),link=nodes(tree).find(n=>n.props?.href);
  assert.equal(link.props.href,"/ko/products?brand=Anua");assert.match(link.props.className,/min-h-11 min-w-11/);assert.match(link.props.className,/focus-visible:outline/);
  assert.ok(!nodes(tree).some(n=>/tracking-wide|translate-y|duration-300/.test(n.props?.className??"")));
});
test("F5 actual EN/HU/KO heading wording and Shop link remain; wrapping/scaling is source evidence, not viewport proof",()=>{
  for(const locale of ["en","hu","ko"]){
    const hero=Hero({locale,routeLocale:locale}),why=Why({locale}),brands=Brands({locale,routeLocale:locale}),featured=Featured({locale,routeLocale:locale});
    for(const [tree,word] of [[hero,marketingCopy[locale].hero.heading],[why,marketingCopy[locale].why.heading],[brands,marketingCopy[locale].brands.heading],[featured,marketingCopy[locale].featured.heading]]){
      const heading=nodes(tree).find(n=>["h1","h2"].includes(n.type));assert.ok(text(heading).includes(word));assert.match(heading.props.className,/break-words/);assert.match(heading.props.className,/text-3xl/);
    }assert.ok(nodes(hero).some(n=>n.props?.href==="/"+locale+"/products"));
    assert.equal(nodes(featured).find(n=>n.type==="br").props.className,"hidden sm:block");
  }
  assert.match(readFileSync(join(repo,"data/catalogue.ts"),"utf8"),/Object.freeze\(\[\]\)/);
});
