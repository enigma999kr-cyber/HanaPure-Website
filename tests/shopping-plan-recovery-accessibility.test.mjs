import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PLAN_RECOVERY_KEY, shoppingPlanHref, readShoppingPlan, setPlanQuantity } from "../lib/catalog/catalogue-shopping-plan.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";
import { CART_STORAGE_KEY, serializeCart } from "../lib/cart/cart-state.ts";

// WEB50-NODE-READ-LOSS-v1: generic handler/state model, never a browser/OS key.
const repo=resolve(process.cwd()),require=createRequire(pathToFileURL(join(repo,"package.json")));
const ts=require("typescript"),reactRoot=dirname(require.resolve("react/package.json"));
const hooks="data:text/javascript,"+encodeURIComponent(`
export const driver={state:[],deps:[],effects:[],cleanups:[],index:0,router:{push(){throw Error("Unexpected router push in recovery test");}}};
export function useState(initial){const state=driver.state,i=driver.index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];}
export function useRef(value){return useState(()=>({current:value}))[0];}
export function useEffect(fn,deps){const i=driver.index++,old=driver.deps[i];if(!deps||!old||deps.some((v,j)=>v!==old[j])){driver.deps[i]=deps;driver.effects.push(()=>{driver.cleanups[i]?.();driver.cleanups[i]=fn();});}}
export function createContext(){return {Provider:Symbol('synthetic')};}
export function useContext(){return null;}export function useId(){return 'web50-node';}
export function useSyncExternalStore(s,g){return g();}export function useTransition(){return [false,fn=>fn()];}
`);
registerHooks({
 resolve(specifier,context,next){
  if(specifier==="@/lib/cart/browser-cart"&&context.parentURL?.endsWith("/components/catalogue/CatalogueShoppingPlan.tsx"))return {url:"data:text/javascript,export const useBrowserCart=()=>({ready:false,persistent:false,invalid:false,lines:[]});",shortCircuit:true};
  if(specifier==="react"&&context.parentURL?.endsWith("/components/catalogue/CatalogueShoppingPlan.tsx"))return {url:hooks,shortCircuit:true};
  if(specifier==="react"||specifier==="react/jsx-runtime")return {url:pathToFileURL(join(reactRoot,specifier==="react"?"index.js":"jsx-runtime.js")).href,shortCircuit:true};
  if(specifier==="react-dom")return {url:pathToFileURL(join(dirname(require.resolve("react-dom/package.json")),"index.js")).href,shortCircuit:true};
  if(specifier==="next/navigation")return {url:"data:text/javascript,"+encodeURIComponent(`import {driver} from ${JSON.stringify(hooks)};export const useRouter=()=>driver.router;`),shortCircuit:true};
  if(specifier==="next/link")return next("next/link.js",context);
  if(specifier.startsWith("@/"))specifier=pathToFileURL(join(repo,specifier.slice(2))).href;
  try{return next(specifier,context);}catch(e){if(e.code!=="ERR_MODULE_NOT_FOUND")throw e;for(const ext of [".ts",".tsx"]){try{return next(specifier+ext,context);}catch{}}throw e;}
 },
 load(url,context,next){return url.endsWith(".tsx")?{format:"module",shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}:next(url,context);}
});
const {driver}=await import(hooks);
const {ShoppingPlanRecovery,default:PlanUI}=await import(pathToFileURL(join(repo,"components/catalogue/CatalogueShoppingPlan.tsx")).href);
const nodes=n=>n==null||typeof n!=="object"?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==="boolean"?"":typeof n==="string"||typeof n==="number"?String(n):Array.isArray(n)?n.map(text).join(""):text(n.props?.children);
const button=(tree,label)=>nodes(tree).find(n=>n.type==="button"&&text(n)===label);
const message=tree=>nodes(tree).find(n=>n.props?.["aria-live"]==="polite"&&n.props?.["aria-atomic"]==="true");
const id=n=>`9200000${n}-abcd-1234-abcd-123456789abc`;
const products=[{publicId:id(1)},{publicId:id(2)}],current=[{publicId:id(1),quantity:3},{publicId:id(2),quantity:3}],savedLines=[{publicId:id(1),quantity:2},{publicId:id(2),quantity:3}];
function reset(){driver.cleanups.forEach(fn=>fn?.());driver.state=[];driver.deps=[];driver.effects=[];driver.cleanups=[];}
function render(props){driver.index=0;driver.effects=[];const tree=ShoppingPlanRecovery(props);driver.effects.forEach(fn=>fn());return tree;}
function scenario(action,locale,run){
 const original=Object.getOwnPropertyDescriptor(globalThis,"window"),calls=[],control={denied:false,getterDenied:false,loseReadAfterWrite:false};
 const path="/"+locale+"/products",query="?view=list";
 const values=new Map([[CART_STORAGE_KEY,serializeCart([{publicId:id(3),quantity:9}])]]);
 if(action!=="save")values.set(PLAN_RECOVERY_KEY,JSON.stringify({version:1,href:shoppingPlanHref(path,query,savedLines)}));
 const initialRecovery=values.get(PLAN_RECOVERY_KEY)??null,initialCart=values.get(CART_STORAGE_KEY);
 const store={getItem(key){calls.push(["get",key]);if(control.denied&&key===PLAN_RECOVERY_KEY)throw Error("SYNTHETIC_DENIED");return values.get(key)??null;},
  setItem(key,value){calls.push(["set",key]);values.set(key,value);if(control.loseReadAfterWrite)control.denied=true;},removeItem(key){calls.push(["remove",key]);values.delete(key);}};
 const location={href:"http://synthetic.invalid"+shoppingPlanHref(path,query,current)};
 const window={location,get localStorage(){if(control.getterDenied)throw Error("SYNTHETIC_GETTER_DENIED");return store;},addEventListener(){},removeEventListener(){}};
 Object.defineProperty(globalThis,"window",{configurable:true,value:window});reset();
 const props={plan:readShoppingPlan(new URL(location.href).searchParams.get("cartPlan"),products),path,query,publishedIds:products.map(p=>p.publicId),locale,disabled:false};
 try{render(props);const tree=render(props);run({props,tree,labels:storefrontLabels[locale],calls,control,values,initialRecovery,initialCart,location});}
 finally{reset();original?Object.defineProperty(globalThis,"window",original):delete globalThis.window;}
}
for(const action of ["save","replace","forget"])test("WEB50 W1 new read-loss at enabled "+action+" reports unavailable, never an evidenced conflict",()=>{
 for(const locale of ["en","hu","ko"])scenario(action,locale,({props,tree,labels,calls,control,values,initialRecovery,initialCart,location})=>{
  const label=action==="save"?labels.planRecoverySave:action==="replace"?labels.planRecoveryReplace:labels.planRecoveryForget;
  const enabled=button(tree,label);assert.equal(enabled.props.disabled,false);const originalURL=location.href;control.denied=true;enabled.props.onClick();tree=render(props);
  assert.equal(calls.filter(c=>c[0]!=="get").length,0);assert.equal(values.get(PLAN_RECOVERY_KEY)??null,initialRecovery);assert.equal(values.get(CART_STORAGE_KEY),initialCart);assert.equal(location.href,originalURL);
  assert.ok(text(message(tree)).includes(labels.planRecoveryUnavailable),"denied read is unavailable, not evidence of changed data");
  assert.ok(!text(message(tree)).includes(labels.planRecoveryConflict));assert.ok(!text(message(tree)).includes(labels.planRecoverySaved));assert.ok(!text(message(tree)).includes(labels.planRecoveryForgotten));
  assert.equal(message(tree).props.role,"status");assert.equal(button(tree,labels.planRecoverySave).props.disabled,true);assert.equal(button(tree,labels.planRecoveryForget).props.disabled,true);
  if(action!=="forget")assert.ok(nodes(tree).some(n=>n.props?.["data-activation-feedback"]==="save"));
  enabled.props.onClick();assert.equal(calls.filter(c=>c[0]!=="get").length,0);
  button(tree,labels.planRecoveryReload).props.onClick();tree=render(props);assert.ok(text(message(tree)).includes(labels.planRecoveryCheckFailed));assert.ok(!text(message(tree)).includes(labels.planRecoveryChecked));
  control.denied=false;button(tree,labels.planRecoveryReload).props.onClick();tree=render(props);assert.ok(text(message(tree)).includes(labels.planRecoveryChecked+" (1)"));
  const next=button(tree,label);assert.equal(next.props.disabled,false);next.props.onClick();tree=render(props);assert.equal(calls.filter(c=>c[0]!=="get").length,1);assert.ok(text(message(tree)).includes(action==="forget"?labels.planRecoveryForgotten:labels.planRecoverySaved));
  assert.equal(values.get(CART_STORAGE_KEY),initialCart);assert.equal(location.href,originalURL);assert.ok(calls.every(c=>c[1]===PLAN_RECOVERY_KEY));
 });
});

test("WEB50 W1 getter access revoked after render is unavailable, not changed; explicit recheck recovers",()=>{
 scenario("replace","hu",({props,tree,labels,calls,control,values,initialRecovery,initialCart})=>{
  control.getterDenied=true;button(tree,labels.planRecoveryReplace).props.onClick();tree=render(props);assert.ok(text(message(tree)).includes(labels.planRecoveryUnavailable));assert.ok(!text(message(tree)).includes(labels.planRecoveryConflict));assert.equal(calls.filter(c=>c[0]!=="get").length,0);assert.equal(values.get(PLAN_RECOVERY_KEY),initialRecovery);assert.equal(values.get(CART_STORAGE_KEY),initialCart);
  control.getterDenied=false;button(tree,labels.planRecoveryReload).props.onClick();tree=render(props);assert.equal(button(tree,labels.planRecoveryReplace).props.disabled,false);assert.equal(calls.filter(c=>c[0]!=="get").length,0);
 });
});

test("WEB50 W1 confirmation read lost AFTER write never claims saved or rollback and never touches Cart",()=>{
 scenario("replace","en",({props,tree,labels,calls,control,values,initialRecovery,initialCart})=>{
  control.loseReadAfterWrite=true;button(tree,labels.planRecoveryReplace).props.onClick();tree=render(props);assert.equal(calls.filter(c=>c[0]==="set").length,1);assert.notEqual(values.get(PLAN_RECOVERY_KEY),initialRecovery);assert.equal(values.get(CART_STORAGE_KEY),initialCart);
  assert.ok(text(message(tree)).includes(labels.planRecoveryUnavailable));assert.ok(!text(message(tree)).includes(labels.planRecoverySaved));assert.ok(!text(message(tree)).includes(labels.planRecoveryConflict));assert.ok(calls.every(c=>c[1]===PLAN_RECOVERY_KEY));
 });
});

// WEB50 W2a: isolated React instances/windows share only the synthetic store.
// No RSC/browser/OS event is claimed; each URL+props commit is explicit below.
function actorContext(actor,run){
 const keys=["state","deps","effects","cleanups","index"],previous=Object.fromEntries(keys.map(k=>[k,driver[k]])),old=Object.getOwnPropertyDescriptor(globalThis,"window");
 Object.assign(driver,actor.hooks);Object.defineProperty(globalThis,"window",{configurable:true,value:actor.window});
 try{return run();}finally{for(const k of keys)actor.hooks[k]=driver[k];Object.assign(driver,previous);old?Object.defineProperty(globalThis,"window",old):delete globalThis.window;}
}
test("WEB50 W2a three contexts distinguish unconfirmed B from saved2/4 and delivered/missing/inter-handler events",t=>{
 const snapshots=[];
 for(const mode of ["B_not_committed","B_saved_event_delivered","B_saved_event_missing","B_saved_between_click_and_navigate"]){
  const path="/en/products",query="?view=list",original=JSON.stringify({version:1,href:shoppingPlanHref(path,query,savedLines)});
  const cartRaw=serializeCart([{publicId:id(1),quantity:3},{publicId:id(2),quantity:3}]);
  const values=new Map([[PLAN_RECOVERY_KEY,original],[CART_STORAGE_KEY,cartRaw]]),calls=[],events=[],actors=[];let actorName="setup";
  const store={getItem(key){calls.push([actorName,"get",key]);return values.get(key)??null;},setItem(key,value){calls.push([actorName,"set",key]);values.set(key,value);},removeItem(key){calls.push([actorName,"remove",key]);values.delete(key);}};
  function actor(name,invalid=false){const listeners=new Map(),url="http://synthetic.invalid"+path+(invalid?"?cartPlan=INVALID":"?view=list");
   const a={name,hooks:{state:[],deps:[],effects:[],cleanups:[],index:0},window:{location:{href:url},localStorage:store,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}},listeners,
    props:{plan:readShoppingPlan(invalid?"INVALID":undefined,products),path,query,publishedIds:products.map(p=>p.publicId),locale:"en",disabled:invalid}};
   actors.push(a);return a;
  }
  const run=(a,fn)=>actorContext(a,()=>{const before=actorName;actorName=a.name;try{return fn();}finally{actorName=before;}});
  const draw=a=>run(a,()=>render(a.props)),mount=a=>{draw(a);return draw(a);};
  const restore=tree=>nodes(tree).find(n=>n.props?.href);
  function linkAction(a,element,phase="both"){return run(a,()=>{let prevented=false;const event={preventDefault(){prevented=true;}};
   if(phase!=="navigate")element.props.onClick(event);if(!prevented&&phase!=="click")element.props.onNavigate(event);return !prevented;});}
  function commit(a,target,lines){a.window.location.href="http://synthetic.invalid"+target;a.props={...a.props,plan:readShoppingPlan(new URL(a.window.location.href).searchParams.get("cartPlan"),products),disabled:false};assert.deepEqual(a.props.plan.lines,lines);draw(a);return draw(a);}
  try{
   const A=actor("A"),B=actor("B"),at=mount(A),oldA=restore(at),bt=mount(B),restoreB=restore(bt);
   assert.equal(linkAction(B,restoreB),true);
   B.window.location.href="http://synthetic.invalid"+restoreB.props.href;B.props={...B.props,plan:{status:"ready",lines:current}};
   draw(B);let intermediate=draw(B);assert.ok(text(message(intermediate)).includes(storefrontLabels.en.planPending),"URL alone with mismatched props must wait for actual committed lines");
   let btree=commit(B,restoreB.props.href,savedLines);
   assert.ok(!text(message(btree)).includes(storefrontLabels.en.planPending),"a committed restored URL+plan must not keep announcing pending");
   let changed={status:"ready",lines:savedLines};for(const line of savedLines){const result=setPlanQuantity(changed,line.publicId,"2",products);if(result.status==="changed")changed={status:"ready",lines:result.lines};else assert.equal(result.status,"unchanged");}
   const four=changed.lines,target=shoppingPlanHref(path,query,four),retainedB=button(btree,storefrontLabels.en.planRecoveryReplace);
   let bConfirmed=false,bMessage="",firstAllowed=false;
   if(mode==="B_not_committed"){
    // URL changed but server plan/effect witness has not committed; stale click.
    B.window.location.href="http://synthetic.invalid"+target;run(B,()=>retainedB.props.onClick());btree=draw(B);bMessage=text(message(btree));
    assert.equal(values.get(PLAN_RECOVERY_KEY),original);assert.equal(calls.filter(c=>c[1]==="set").length,0);assert.ok(!bMessage.includes(storefrontLabels.en.planRecoverySaved));
    assert.equal(linkAction(A,oldA),true);commit(A,oldA.props.href,savedLines);
   }else{
    if(mode==="B_saved_between_click_and_navigate")assert.equal(linkAction(A,oldA,"click"),true);
    btree=commit(B,target,four);run(B,()=>retainedB.props.onClick());assert.equal(calls.filter(c=>c[1]==="set").length,0);
    run(B,()=>button(btree,storefrontLabels.en.planRecoveryReplace).props.onClick());btree=draw(B);bMessage=text(message(btree));
    const actual=JSON.parse(values.get(PLAN_RECOVERY_KEY));assert.equal(actual.href,target);assert.deepEqual(readShoppingPlan(new URL(actual.href,"http://synthetic.invalid").searchParams.get("cartPlan"),products).lines,four);assert.ok(bMessage.includes(storefrontLabels.en.planRecoverySaved));assert.equal(calls.filter(c=>c[1]==="set").length,1);bConfirmed=true;
    if(mode==="B_saved_event_delivered")run(A,()=>{events.push("A storage delivered");A.listeners.get("storage").forEach(fn=>fn({key:PLAN_RECOVERY_KEY}));});else events.push("A storage intentionally missing");
    firstAllowed=linkAction(A,oldA,mode==="B_saved_between_click_and_navigate"?"navigate":"both");assert.equal(firstAllowed,false);assert.ok(!A.window.location.href.includes("cartPlan="));
    let anew=draw(A);assert.ok(text(message(anew)).includes(storefrontLabels.en.planRecoveryConflict));assert.equal(restore(anew).props["aria-disabled"],true);
    run(A,()=>button(anew,storefrontLabels.en.planRecoveryReload).props.onClick());anew=draw(A);assert.ok(text(message(anew)).includes(storefrontLabels.en.planRecoveryChecked));assert.equal(linkAction(A,restore(anew)),true);commit(A,restore(anew).props.href,four);
   }
   const C=actor("C",true),ct=mount(C),expected=bConfirmed?four:savedLines;assert.equal(restore(ct),undefined);assert.equal(C.props.plan.status,"invalid");assert.ok(text(ct).includes(storefrontLabels.en.planRecoveryUrlPriority));
   const savedHref=JSON.parse(values.get(PLAN_RECOVERY_KEY)).href,savedPlan=readShoppingPlan(new URL(savedHref,"http://synthetic.invalid").searchParams.get("cartPlan"),products);assert.deepEqual(savedPlan.lines,expected);assert.deepEqual(A.props.plan.lines,expected);assert.equal(values.get(CART_STORAGE_KEY),cartRaw);assert.ok(calls.every(c=>c[2]===PLAN_RECOVERY_KEY));
   snapshots.push({mode,B_confirmed_2_4:bConfirmed,B_message:bMessage,storageEvents:events,get:calls.filter(c=>c[1]==="get").length,set:calls.filter(c=>c[1]==="set").length,remove:calls.filter(c=>c[1]==="remove").length,firstAAllowed:mode==="B_not_committed"?true:firstAllowed,A_URL_lines:A.props.plan.lines,savedRaw:values.get(PLAN_RECOVERY_KEY),C_invalid_savedUnits:bConfirmed?4:5,CartRaw:cartRaw});
  }finally{for(const a of actors)run(a,()=>a.hooks.cleanups.forEach(fn=>fn?.()));}
 }
 t.diagnostic(JSON.stringify({RUN_MODE:"NODE_SIMULATED",fixture:"WEB50-W2a-shared-memory-v1",snapshots}));
});



test("WEB50 UX02 Restore retains Recovery anchor without heading jump, focuses only after exact commit, no history/remount replay",()=>{
 for(const locale of ["en","hu","ko"])scenario("replace",locale,({values,initialCart,location})=>{
  reset();
  const labels=storefrontLabels[locale],path="/"+locale+"/products",query="?view=list";
  location.href="http://synthetic.invalid"+path+query;
  const props={plan:readShoppingPlan(undefined,products),path,query,publishedIds:products.map(p=>p.publicId),locale,disabled:false};
  render(props);let recovery=render(props);
  assert.equal(recovery.props.tabIndex,-1);
  const restore=nodes(recovery).find(n=>n.props?.href);assert.equal(restore.props.scroll,false);
  let anchorTop=180,scrollY=900;const corrections=[];
  recovery.props.ref.current={getBoundingClientRect:()=>({top:anchorTop})};
  window.scrollBy=options=>{corrections.push(options);scrollY+=options.top;anchorTop-=options.top;};
  restore.props.onClick({preventDefault(){assert.fail("valid click blocked");}});
  restore.props.onNavigate({preventDefault(){assert.fail("valid navigation blocked");}});
  const target="http://synthetic.invalid"+restore.props.href,raw=values.get(PLAN_RECOVERY_KEY);
  reset();
  const scrolls=[],focuses=[],rootFocus=[],local={focus:x=>focuses.push(x),getBoundingClientRect:()=>({top:anchorTop})},root={scrollIntoView:x=>scrolls.push(x),focus:x=>rootFocus.push(x),querySelector:s=>{assert.equal(s,"[data-plan-recovery]");return local;}};
  const p={plan:readShoppingPlan(undefined,products),path,query,products:products.map(x=>({...x,slug:"synthetic-"+x.publicId,name:"SYNTHETIC",brand:"beplain"})),publishedIds:products.map(x=>x.publicId),visibleIds:[],locale,routeLocale:locale};
  function draw(){driver.index=0;driver.effects=[];const tree=PlanUI(p),region=nodes(tree).find(n=>n.type==="section"&&n.props["aria-labelledby"]);region.props.ref.current=root;driver.effects.forEach(fn=>fn());return tree;}
  draw();assert.equal(focuses.length,0);
  location.href=target;draw();assert.equal(focuses.length,0,"URL alone cannot confirm");assert.ok(!text(draw()).includes(labels.planRestored));
  p.plan=readShoppingPlan(new URL(target).searchParams.get("cartPlan"),products);
  p.query="?"+new URLSearchParams([...new URL(target).searchParams].filter(([k])=>k!=="cartPlan"));
  anchorTop=980;assert.equal(scrollY,900,"unchanged scrollY alone cannot preserve an inserted-content anchor");
  draw();assert.ok(Math.abs(anchorTop-180)<=1,"Recovery viewport context must survive Plan insertion");assert.deepEqual(corrections,[{top:800,behavior:"instant"}]);
  assert.deepEqual(scrolls,[],"Restore must not jump to Plan heading");
  assert.equal(recovery.props["data-plan-recovery"],true);
  assert.deepEqual(focuses,[{preventScroll:true}]);assert.deepEqual(rootFocus,[],"focus belongs in Recovery, not Plan TOP or Cart");
  assert.ok(text(draw()).includes(labels.planRestored));draw();assert.equal(focuses.length,1);
  location.href="http://synthetic.invalid"+path+query;p.plan=readShoppingPlan(undefined,products);draw();
  location.href=target;p.plan=readShoppingPlan(new URL(target).searchParams.get("cartPlan"),products);draw();assert.equal(focuses.length,1,"Back/Forward must not replay");
  reset();draw();assert.equal(focuses.length,1,"remount without intent must not replay");assert.equal(corrections.length,1,"anchor correction consumed once");assert.deepEqual(scrolls,[]);
  assert.equal(values.get(PLAN_RECOVERY_KEY),raw);assert.equal(values.get(CART_STORAGE_KEY),initialCart);
 });
});
