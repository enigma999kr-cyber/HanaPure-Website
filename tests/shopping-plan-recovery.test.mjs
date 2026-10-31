import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { registerHooks, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import * as cartState from "../lib/cart/cart-state.ts";
import * as cartUndo from "../lib/cart/cart-undo.ts";
import { PLAN_RECOVERY_KEY, inspectPlanRecovery, readPlanRecovery, savePlanRecovery, forgetPlanRecovery } from "../lib/catalog/catalogue-shopping-plan.ts";
import { shoppingPlanHref, readShoppingPlan, shoppingPlanCartHref } from "../lib/catalog/catalogue-shopping-plan.ts";
import { portablePayload } from "../lib/cart/cart-portable-handoff.ts";
import { storefrontLabels, switchLocalePath, shoppingReadingClass } from "../lib/storefront/localization.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
const id=n=>`${String(n).padStart(8,'0')}-abcd-1234-abcd-123456789abc`;
function memory(initial=null){let raw=initial;const calls=[];const control={read:false,write:false,mismatch:false};return {calls,control,get raw(){return raw;},external(v){raw=v;},getItem(key){if(control.read)throw Error('denied');calls.push(['get',key]);return raw;},setItem(key,v){if(control.write)throw Error('quota');calls.push(['set',key]);raw=control.mismatch?'conflicted':v;},removeItem(key){if(control.write)throw Error('denied');calls.push(['remove',key]);raw=null;}};}
function cartModule(storage){const listeners=new Set(),module={exports:{}};const window={localStorage:storage,addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn)};
 const code=ts.transpileModule(readFileSync(new URL('../lib/cart/browser-cart.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{module,exports:module.exports,window,require:s=>s==='react'?{useSyncExternalStore:(subscribe,getSnapshot,getServerSnapshot)=>({subscribe,getSnapshot,getServerSnapshot})}:s==='./cart-state'?cartState:cartUndo});
 const api=module.exports,access=api.useBrowserCart(),unsub=access.subscribe(()=>{});return {api,access,close:unsub,notify:key=>listeners.forEach(fn=>fn({key}))};}
test('RED #49 stale Cart snapshot cannot overwrite an unnotified other-tab update',()=>{
 const a=[{publicId:id(1),quantity:2}],b=[{publicId:id(2),quantity:7}],store=memory(cartState.serializeCart(a)),m=cartModule(store);
 store.external(cartState.serializeCart(b));assert.equal(m.api.changeBrowserCart(lines=>cartState.addCartLine(lines,id(3),1)),null);assert.equal(store.raw,cartState.serializeCart(b));assert.equal(store.calls.filter(x=>x[0]==='set').length,0);m.close();
});
const products=Array.from({length:41},(_,i)=>({publicId:id(i+1)}));
const lines=[{publicId:id(1),quantity:2},{publicId:id(2),quantity:7}];
const href=(next=lines,path='/products',query='?q=Synthetic&brand=beplain&sort=name-desc&view=list&page=2')=>shoppingPlanHref(path,query,next);
const saved=(next=lines,path='/products',query)=>JSON.stringify({version:1,href:href(next,path,query)});
test('explicit recovery write/read preserves exact order quantities locale and browse; Cart key untouched',()=>{
 const store=memory();assert.equal(readPlanRecovery(store,products).status,'absent');const target=href(lines,'/hu/products');assert.equal(savePlanRecovery(store,null,target,products),'saved');
 const result=readPlanRecovery(store,products);assert.equal(result.status,'ready');assert.equal(result.href,target);assert.deepEqual(result.lines,lines);assert.equal(cartState.cartQuantity(result.lines),'9');assert.ok(store.calls.every(x=>x[1]===PLAN_RECOVERY_KEY));assert.notEqual(PLAN_RECOVERY_KEY,cartState.CART_STORAGE_KEY);
 for(const locale of ['en','hu','ko']){const next=switchLocalePath(result.href,locale);const p=new URL(next,'http://localhost').searchParams;assert.equal(p.get('view'),'list');assert.equal(p.get('q'),'Synthetic');assert.equal(p.get('page'),'2');assert.deepEqual(readShoppingPlan(p.get('cartPlan'),products).lines,lines);}
});
test('malformed version extra fields duplicates aliases UUID quantity and40/8192 bounds reject whole copy',()=>{
 const badPayloads=['v2.'+id(1)+':1','v1.'+id(1)+':0','v1.'+id(1)+':-1','v1.'+id(1)+':1.5','v1.'+id(1)+':9007199254740992','v1.'+id(1)+':01','v1.'+id(1).toUpperCase()+':1','v1.'+id(1)+':1,'+id(1)+':2','v1.invalid:1'];
 for(const raw of ['', '{bad',JSON.stringify({version:2,href:href()}),JSON.stringify({version:1,href:href(),price:5}), 'x'.repeat(16385),...badPayloads.map(cartPlan=>JSON.stringify({version:1,href:'/products?'+new URLSearchParams({cartPlan})}))])assert.equal(inspectPlanRecovery(raw,products).status,'invalid');
 const forty=products.slice(0,40).map(p=>({...p,quantity:Number.MAX_SAFE_INTEGER}));const r=inspectPlanRecovery(saved(forty),products);assert.equal(r.status,'ready');assert.equal(cartState.cartQuantity(r.lines),(BigInt(Number.MAX_SAFE_INTEGER)*40n).toString());assert.equal(href([...forty,{...products[40],quantity:1}]),null);
 assert.equal(inspectPlanRecovery(JSON.stringify({version:1,href:'/products?q='+'x'.repeat(8192)}),products).status,'invalid');
});
test('stale or ambiguous current published projection never partially restores',()=>{
 assert.equal(inspectPlanRecovery(saved(),[products[0]]).status,'stale');assert.equal(inspectPlanRecovery(saved(),[...products,products[0]]).status,'stale');assert.equal(inspectPlanRecovery(saved(),[]).status,'stale');
 for(const target of ['https://outside.invalid/products','//outside.invalid/products','/products?cartPlan=bad','/cart?cartPlan=bad',href()+'#anchor',href()+'&other=x',href().replace('view=list','view=grid'),href()+'&view=list'])assert.equal(inspectPlanRecovery(JSON.stringify({version:1,href:target}),products).status,'invalid');
});
test('corruption not overwritten; explicit Forget only exact witnessed copy; unavailable and quota honest',()=>{
 const store=memory('{broken');assert.equal(savePlanRecovery(store,store.raw,href(),products),'invalid');assert.equal(store.raw,'{broken');assert.equal(forgetPlanRecovery(store,'{broken'),'forgotten');assert.equal(store.raw,null);
 store.control.read=true;assert.equal(readPlanRecovery(store,products).status,'unavailable');assert.equal(savePlanRecovery(store,null,href(),products),'unavailable');assert.equal(forgetPlanRecovery(store,null),'unavailable');
 store.control.read=false;store.control.write=true;assert.equal(savePlanRecovery(store,null,href(),products),'unavailable');assert.equal(store.raw,null);store.control.write=false;store.control.mismatch=true;assert.equal(savePlanRecovery(store,null,href(),products),'conflict');
});
test('conflicting tab changes cannot overwrite or remove newest copy; current URL need never change',()=>{
 const a=saved(),b=saved([{publicId:id(3),quantity:4}]),store=memory(a);const old=readPlanRecovery(store,products);store.external(b);
 assert.equal(savePlanRecovery(store,old.raw,href([{publicId:id(1),quantity:9}]),products),'conflict');assert.equal(forgetPlanRecovery(store,old.raw),'conflict');assert.equal(store.raw,b);assert.equal(store.calls.filter(x=>x[0]==='set'||x[0]==='remove').length,0);
});
test('Cart SSR stable initial snapshot, hydration restore, event and explicit corruption reset preserve contracts',()=>{
 const store=memory(cartState.serializeCart(lines)),m=cartModule(store);assert.equal(m.access.getServerSnapshot(),m.access.getServerSnapshot());assert.equal(m.access.getServerSnapshot().ready,false);assert.deepEqual(m.access.getSnapshot().lines,lines);
 const malformed='{bad';store.external(malformed);m.notify(cartState.CART_STORAGE_KEY);assert.equal(m.access.getSnapshot().invalid,true);assert.equal(m.api.changeBrowserCart(a=>a),null);assert.equal(m.api.resetBrowserCart(),true);assert.equal(store.raw,cartState.serializeCart([]));m.close();
});
test('Cart quota/readback failure retains safe in-tab selection without claiming persistence; denied reads do not write',()=>{
 const store=memory(cartState.serializeCart(lines)),m=cartModule(store);store.control.write=true;const result=m.api.changeBrowserCart(a=>cartState.addCartLine(a,id(3),1));assert.equal(result.persistent,false);assert.equal(m.access.getSnapshot().lines.length,3);assert.equal(store.raw,cartState.serializeCart(lines));
 store.control.read=true;const writes=store.calls.filter(x=>x[0]==='set').length;assert.equal(m.api.changeBrowserCart(a=>cartState.addCartLine(a,id(4),1)),null);assert.equal(store.calls.filter(x=>x[0]==='set').length,writes);m.close();
 const mismatch=memory(cartState.serializeCart(lines)),n=cartModule(mismatch);mismatch.control.mismatch=true;assert.equal(n.api.changeBrowserCart(a=>cartState.addCartLine(a,id(3),1)).persistent,false);n.close();
});
test('Cart callback-time cross-tab race and invalid quantity rejected before write',()=>{
 const store=memory(cartState.serializeCart(lines)),m=cartModule(store),newer=cartState.serializeCart([{publicId:id(3),quantity:8}]);assert.equal(m.api.changeBrowserCart(a=>{store.external(newer);return cartState.addCartLine(a,id(4),1);}),null);assert.equal(store.raw,newer);
 assert.equal(m.api.changeBrowserCart(()=>[{publicId:id(3),quantity:Infinity}]),null);assert.equal(store.calls.filter(x=>x[0]==='set').length,0);m.close();
});
test('initial denied Cart hydration can recover on a later explicit action without overwriting unseen valid selection',()=>{
 const store=memory(cartState.serializeCart(lines));store.control.read=true;const m=cartModule(store);assert.equal(m.access.getSnapshot().persistent,false);assert.equal(m.access.getSnapshot().lines.length,0);store.control.read=false;
 assert.equal(m.api.changeBrowserCart(a=>cartState.addCartLine(a,id(3),1)),null);assert.deepEqual(m.access.getSnapshot().lines,lines);assert.equal(store.raw,cartState.serializeCart(lines));assert.equal(m.api.changeBrowserCart(a=>cartState.addCartLine(a,id(3),1)).persistent,true);assert.equal(cartState.inspectStoredCart(store.raw).lines.length,3);m.close();
});
test('explicit next Cart action can persist its own unsaved in-tab copy only while stored base is unchanged',()=>{
 const store=memory(cartState.serializeCart(lines)),m=cartModule(store);store.control.write=true;assert.equal(m.api.changeBrowserCart(a=>cartState.addCartLine(a,id(3),1)).persistent,false);
 store.control.write=false;assert.equal(m.api.changeBrowserCart(a=>cartState.addCartLine(a,id(4),2)).persistent,true);assert.equal(cartState.inspectStoredCart(store.raw).lines.length,4);m.close();
 const other=memory(cartState.serializeCart(lines)),n=cartModule(other);other.control.write=true;n.api.changeBrowserCart(a=>cartState.addCartLine(a,id(3),1));other.control.write=false;const external=cartState.serializeCart([{publicId:id(5),quantity:9}]);other.external(external);assert.equal(n.api.changeBrowserCart(a=>cartState.addCartLine(a,id(4),1)),null);assert.equal(other.raw,external);assert.equal(n.access.getSnapshot().lines.length,3);n.close();
});
test('actual published-only reader excludes draft recovery all-or-nothing',()=>{
 const content={name:'SYNTHETIC ONLY',description:'Test only',images:[],usage:null,caution:null};const rows=[{publicId:id(1),slug:'synthetic-public',brand:'beplain',state:'published',translations:{en:content,hu:null,ko:null}},{publicId:id(2),slug:'synthetic-draft',brand:'beplain',state:'draft',translations:{en:content,hu:null,ko:null}}];const reader=createLocalCatalogueReader(rows);assert.equal(reader.listPublished().length,1);assert.equal(inspectPlanRecovery(saved(),reader.listPublished()).status,'stale');
});

// Focused real component/handler execution with explicitly simulated React commit and browser storage.
const require=createRequire(import.meta.url),repo=dirname(dirname(fileURLToPath(import.meta.url))),reactRoot=dirname(require.resolve('react/package.json'));
const hook='data:text/javascript,'+encodeURIComponent(`
export const driver={state:[],deps:[],cleanups:[],effects:[],index:0,pushes:[],transition:false};
driver.router={push(href,options){driver.pushes.push({href,options});}};
export function useState(init){const i=driver.index++;if(!(i in driver.state))driver.state[i]=typeof init==='function'?init():init;return [driver.state[i],v=>driver.state[i]=typeof v==='function'?v(driver.state[i]):v];}
export function useRef(current){return useState(()=>({current}))[0];}
export function createContext(){return {Provider:Symbol('test-provider')};}export function useContext(){return null;}export function useId(){return 'test-id';}export function useSyncExternalStore(s,g){return g();}export function useTransition(){return [false,fn=>fn()];}
export function useEffect(fn,deps){const i=driver.index++,old=driver.deps[i];if(!deps||!old||deps.some((x,j)=>x!==old[j])){driver.deps[i]=deps;driver.effects.push(()=>{driver.cleanups[i]?.();driver.cleanups[i]=fn();});}}
`);
registerHooks({resolve(specifier,context,next){
 if(specifier==='react'&&context.parentURL?.endsWith('/components/catalogue/CatalogueShoppingPlan.tsx'))return {url:hook,shortCircuit:true};
 if(specifier==='next/navigation')return {url:'data:text/javascript,'+encodeURIComponent(`import {driver} from ${JSON.stringify(hook)};export const useRouter=()=>driver.router;export const notFound=()=>{throw Error('not found')};`),shortCircuit:true};
 if(specifier==='@/lib/cart/browser-cart'&&context.parentURL?.endsWith('/components/catalogue/CatalogueShoppingPlan.tsx'))return {url:'data:text/javascript,export const useBrowserCart=()=>({ready:false,persistent:false,invalid:false,lines:[]});',shortCircuit:true};
 if(specifier==='react'||specifier==='react/jsx-runtime')return {url:pathToFileURL(join(reactRoot,specifier==='react'?'index.js':'jsx-runtime.js')).href,shortCircuit:true};
 if(specifier==='react-dom')return {url:pathToFileURL(join(dirname(require.resolve('react-dom/package.json')),'index.js')).href,shortCircuit:true};
 if(specifier==='next/link')return next('next/link.js',context);
 if(specifier.startsWith('@/'))specifier=pathToFileURL(join(repo,specifier.slice(2))).href;
 try{return next(specifier,context);}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;for(const ext of ['.ts','.tsx']){try{return next(specifier+ext,context);}catch{}}throw e;}
},load(url,context,next){return url.endsWith('.tsx')?{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}:next(url,context);}});
const {driver}=await import(hook),{ShoppingPlanRecovery:RecoveryUI,default:PlanUI,ShoppingPlanSearchGuard,ShoppingPlanIntake}=await import('../components/catalogue/CatalogueShoppingPlan.tsx');
const nodes=n=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
const button=(t,label)=>nodes(t).find(n=>n.type==='button'&&text(n)===label);
const link=t=>nodes(t).find(n=>n.props?.href);
function reset(){driver.cleanups.forEach(fn=>fn?.());driver.state=[];driver.deps=[];driver.cleanups=[];driver.effects=[];driver.pushes=[];}
function ui(props,commit=true){driver.index=0;driver.effects=[];const t=RecoveryUI(props);if(commit)driver.effects.forEach(fn=>fn());return t;}
const baseProps=()=>({plan:readShoppingPlan(undefined,products),path:'/products',query:'?view=list',publishedIds:products.map(p=>p.publicId),locale:'en',disabled:false});
function browser(run,raw=null){const old=Object.getOwnPropertyDescriptor(globalThis,'window'),store=memory(raw),events=new Set();const location={href:'https://synthetic.invalid/products?view=list'};
 const window={localStorage:store,location,addEventListener:(type,fn)=>events.add(fn),removeEventListener:(type,fn)=>events.delete(fn)};Object.defineProperty(globalThis,'window',{configurable:true,value:window});reset();
 try{run({store,location,notify:key=>events.forEach(fn=>fn({key}))});}finally{reset();old?Object.defineProperty(globalThis,'window',old):delete globalThis.window;}}
test('recovery component initial SSR render inert; no storage/global reads before effect',()=>{
 assert.equal(typeof window,'undefined');reset();const t=ui(baseProps(),false);assert.equal(link(t),undefined);assert.ok(nodes(t).filter(n=>n.type==='button').every(n=>n.props.disabled||text(n)===storefrontLabels.en.planRecoveryReload));reset();
});
test('no URL plan offers explicit scoped recovery, does not auto navigate or write; restore uses whole saved page',()=>browser(({store,location})=>{
 const props=baseProps();ui(props);const t=ui(props),restore=link(t);assert.ok(restore);assert.equal(restore.props.href,href());assert.equal(restore.props.scroll,false);assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
 let prevented=false;restore.props.onClick({preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(location.href,'https://synthetic.invalid/products?view=list');
 location.href='https://synthetic.invalid'+restore.props.href;props.plan=readShoppingPlan(new URL(location.href).searchParams.get('cartPlan'),products);ui(props);assert.equal(link(ui(props)),undefined);
 assert.ok(store.calls.every(c=>c[1]===PLAN_RECOVERY_KEY));
},saved()));
test('valid different shared URL and explicit invalid URL both override saved recovery; no silent merge or replay',()=>{
 for(const status of ['ready','invalid'])browser(({store,location})=>{const props=baseProps();props.plan=status==='ready'?readShoppingPlan(portablePayload([{publicId:id(3),quantity:8}]),products):{status:'invalid',lines:[]};location.href='https://synthetic.invalid/products?cartPlan='+encodeURIComponent(status==='ready'?portablePayload(props.plan.lines):'bad');ui(props);const t=ui(props);assert.equal(link(t),undefined);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryUrlPriority));assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);},saved());
});
test('UI explicit Save/Replace and Forget use isolated key and truthful read-back; no autosave after edit',()=>browser(({store,location})=>{
 const props={...baseProps(),plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);let t=ui(props);button(t,storefrontLabels.en.planRecoverySave).props.onClick();t=ui(props);assert.ok(text(t).includes(storefrontLabels.en.planRecoverySaved));const old=store.raw;
 props.plan=readShoppingPlan(portablePayload([{publicId:id(1),quantity:9}]),products);location.href='https://synthetic.invalid'+href(props.plan.lines);ui(props);t=ui(props);assert.equal(store.raw,old);button(t,storefrontLabels.en.planRecoveryReplace).props.onClick();t=ui(props);assert.deepEqual(readPlanRecovery(store,products).lines,props.plan.lines);
 button(t,storefrontLabels.en.planRecoveryForget).props.onClick();t=ui(props);assert.equal(store.raw,null);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryForgotten));assert.ok(location.href.includes('cartPlan='));
}));
test('damaged snapshot cannot be saved over; explicit UI Forget unblocks a new copy and locales have parity',()=>browser(({store,location})=>{
 const props={...baseProps(),plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);let t=ui(props);assert.equal(button(t,storefrontLabels.en.planRecoverySave).props.disabled,true);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryInvalid));button(t,storefrontLabels.en.planRecoveryForget).props.onClick();t=ui(props);assert.equal(store.raw,null);assert.equal(button(t,storefrontLabels.en.planRecoverySave).props.disabled,false);
 const keys=Object.keys(storefrontLabels.en).filter(k=>k.startsWith('planRecovery'));for(const loc of ['hu','ko'])for(const k of keys)assert.ok(storefrontLabels[loc][k]);
},'{bad'));
test('cross-tab event refreshes saved status without URL mutation; stale restore handlers refuse lost witnesses',()=>browser(({store,location,notify})=>{
 const props=baseProps();ui(props);const retained=link(ui(props));const previous=location.href;store.external(saved([{publicId:id(3),quantity:9}]));let prevented=false;retained.props.onClick({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(location.href,previous);
 notify(PLAN_RECOVERY_KEY);let t=ui(props);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryConflict));assert.equal(link(t).props.href,href([{publicId:id(3),quantity:9}]));
 const old=link(t);location.href='https://synthetic.invalid/products?cartPlan=bad';old.props.onClick({preventDefault(){prevented=true;}});assert.equal(location.href,'https://synthetic.invalid/products?cartPlan=bad');assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
},saved()));
test('UI unavailable/quota/failed confirmation never says saved; read retry safe and disabled pending Plan does not write',()=>browser(({store,location})=>{
 const props={...baseProps(),plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();store.control.read=true;ui(props);let t=ui(props);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryUnavailable));store.control.read=false;button(t,storefrontLabels.en.planRecoveryReload).props.onClick();t=ui(props);store.control.write=true;button(t,storefrontLabels.en.planRecoverySave).props.onClick();t=ui(props);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryUnavailable));assert.ok(!text(t).includes(storefrontLabels.en.planRecoverySaved));assert.equal(store.raw,null);
 props.disabled=true;ui(props);t=ui(props);const writes=store.calls.filter(c=>c[0]==='set').length;button(t,storefrontLabels.en.planRecoverySave).props.onClick();assert.equal(store.calls.filter(c=>c[0]==='set').length,writes);
}));
test('detail/cart/back helpers keep protocols distinct and recovered URL restores exact scope on fresh read',()=>{
 const copy=inspectPlanRecovery(saved(lines,'/ko/products/synthetic-1','?view=list&q=Synthetic'),products);assert.equal(copy.status,'ready');const plan=readShoppingPlan(new URL(copy.href,'http://localhost').searchParams.get('cartPlan'),products);const cart=shoppingPlanCartHref('/ko/cart',plan,products);assert.ok(cart.includes('cartDraft='));assert.ok(!cart.includes('cartPlan='));assert.deepEqual(inspectPlanRecovery(copy.raw,products).lines,lines);
});

test('H6 RED event summary refresh must not re-arm Replace without explicit Check',()=>browser(({store,location,notify})=>{
 const a=[{publicId:id(1),quantity:3},{publicId:id(2),quantity:3}],b=[{publicId:id(1),quantity:2},{publicId:id(2),quantity:3}];
 const props={...baseProps(),plan:readShoppingPlan(portablePayload(a),products)};location.href='https://synthetic.invalid'+href(a);ui(props);ui(props);
 store.external(saved(b));notify(PLAN_RECOVERY_KEY);const t=ui(props);
 button(t,storefrontLabels.en.planRecoveryReplace).props.onClick();assert.deepEqual(readPlanRecovery(store,products).lines,b);assert.equal(store.calls.filter(c=>c[0]==='set').length,0);
},saved()));

test('H6 deliberate Check re-arms only reviewed copy; repeated conflicts and stale closures re-lock',()=>browser(({store,location,notify})=>{
 const props={...baseProps(),plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);const old=ui(props);
 const b=saved([{publicId:id(3),quantity:5}]);store.external(b);notify(PLAN_RECOVERY_KEY);let t=ui(props);assert.equal(button(t,storefrontLabels.en.planRecoveryReplace).props.disabled,true);assert.equal(button(t,storefrontLabels.en.planRecoveryForget).props.disabled,true);
 button(t,storefrontLabels.en.planRecoveryForget).props.onClick();assert.equal(store.raw,b);
 const before=store.calls.length;button(t,storefrontLabels.en.planRecoveryReload).props.onClick();t=ui(props);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryChecked));assert.ok(store.calls.slice(before).every(c=>c[0]==='get'));assert.equal(button(t,storefrontLabels.en.planRecoveryReplace).props.disabled,false);
 button(old,storefrontLabels.en.planRecoveryReplace).props.onClick();assert.equal(store.raw,b);const replace=button(t,storefrontLabels.en.planRecoveryReplace);replace.props.onClick();replace.props.onClick();assert.deepEqual(readPlanRecovery(store,products).lines,lines);assert.equal(store.calls.filter(c=>c[0]==='set').length,1);
 notify(PLAN_RECOVERY_KEY);t=ui(props);assert.equal(button(t,storefrontLabels.en.planRecoveryForget).props.disabled,true);button(t,storefrontLabels.en.planRecoveryReload).props.onClick();t=ui(props);button(t,storefrontLabels.en.planRecoveryForget).props.onClick();assert.equal(store.raw,null);
},saved()));

test('H6 Restore and unobserved changed copy require Check; unavailable check never re-arms',()=>browser(({store,notify})=>{
 const props=baseProps();ui(props);let t=ui(props);const old=link(t);const b=saved([{publicId:id(3),quantity:5}]);store.external(b);let prevented=false;old.props.onClick({preventDefault(){prevented=true;}});assert.equal(prevented,true);t=ui(props);assert.equal(link(t).props['aria-disabled'],true);
 store.control.read=true;button(t,storefrontLabels.en.planRecoveryReload).props.onClick();t=ui(props);assert.ok(!text(t).includes(storefrontLabels.en.planRecoveryChecked));assert.ok(text(t).includes(storefrontLabels.en.planRecoveryCheckFailed));assert.equal(link(t),undefined);
 store.control.read=false;button(t,storefrontLabels.en.planRecoveryReload).props.onClick();t=ui(props);assert.equal(link(t).props['aria-disabled'],false);notify(PLAN_RECOVERY_KEY);t=ui(props);prevented=false;link(t).props.onNavigate({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
},saved()));

test('H6 review gate survives URL props changes and damaged copy; Check plus Forget recovers',()=>browser(({store,location,notify})=>{
 const props={...baseProps(),plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);ui(props);store.external('{broken');notify(PLAN_RECOVERY_KEY);let t=ui(props);props.locale='hu';ui(props);t=ui(props);assert.equal(button(t,storefrontLabels.hu.planRecoveryForget).props.disabled,true);
 button(t,storefrontLabels.hu.planRecoveryReload).props.onClick();t=ui(props);assert.ok(text(t).includes(storefrontLabels.hu.planRecoveryInvalid));button(t,storefrontLabels.hu.planRecoveryForget).props.onClick();t=ui(props);assert.equal(store.raw,null);assert.equal(button(t,storefrontLabels.hu.planRecoverySave).props.disabled,false);
 props.disabled=true;ui(props);t=ui(props);button(t,storefrontLabels.hu.planRecoverySave).props.onClick();assert.equal(store.raw,null);
},saved()));

function planUI(props,element){driver.index=0;driver.effects=[];const t=PlanUI(props);const region=nodes(t).find(n=>n.type==='section'&&n.props['aria-labelledby']);region.props.ref.current=element;driver.effects.forEach(fn=>fn());return t;}
test('UX02 deliberate Restore scrolls/focuses Plan TOP once only after target and props commit; Back does not replay',()=>browser(({location})=>{
 const p=baseProps();ui(p);const restore=link(ui(p));restore.props.onNavigate({preventDefault(){assert.fail('valid restore refused');}});reset();location.href='https://synthetic.invalid'+restore.props.href;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),body={};Object.defineProperty(globalThis,'document',{configurable:true,value:{body,activeElement:body}});
 try{const scrolls=[],focuses=[],element={scrollIntoView:x=>scrolls.push(x),focus:x=>focuses.push(x)};
 const props={plan:{status:'empty',lines:[]},path:'/products',query:'?view=list',products:products.map(x=>({...x,slug:'synthetic-'+x.publicId,name:'SYNTHETIC',brand:'beplain'})),publishedIds:products.map(x=>x.publicId),visibleIds:[],locale:'en',routeLocale:'en'};
 planUI(props,element);assert.equal(scrolls.length,0);props.plan=readShoppingPlan(new URL(location.href).searchParams.get('cartPlan'),products);const browse=new URLSearchParams(new URL(location.href).search);browse.delete('cartPlan');props.query='?'+browse;let t=planUI(props,element);assert.deepEqual(scrolls,[{block:'start',behavior:'instant'}]);assert.deepEqual(focuses,[{preventScroll:true}]);t=planUI(props,element);assert.ok(text(t).includes(storefrontLabels.en.planRestored));
 location.href='https://synthetic.invalid/products?view=list';props.plan={status:'empty',lines:[]};planUI(props,element);location.href='https://synthetic.invalid'+restore.props.href;props.plan=readShoppingPlan(new URL(location.href).searchParams.get('cartPlan'),products);planUI(props,element);assert.equal(scrolls.length,1);
 }finally{previous?Object.defineProperty(globalThis,'document',previous):delete globalThis.document;}
},saved()));

test('UX01 exact current Plan counts and selected row contrast; UX04 scoped KO min20percent and locale parity',()=>browser(({location})=>{
 const props={plan:readShoppingPlan(portablePayload(lines),products),path:'/products',query:'?view=list',products:products.map(x=>({...x,slug:'synthetic-'+x.publicId,name:'SYNTHETIC',brand:'beplain'})),publishedIds:products.map(x=>x.publicId),visibleIds:[],locale:'en',routeLocale:'en'};location.href='https://synthetic.invalid'+href(lines);let t=planUI(props,{});assert.ok(text(t).includes(storefrontLabels.en.planLines+': 2'));assert.ok(text(t).includes(storefrontLabels.en.planUnits+': 9'));assert.ok(text(t).includes(storefrontLabels.en.planCartUnconfirmed));
 button(t,storefrontLabels.en.planSelectDisplayed).props.onClick();t=planUI(props,{});assert.ok(text(t).includes(storefrontLabels.en.planSelected+': 2'));assert.equal(nodes(t).filter(n=>n.type==='li'&&n.props.className?.includes('border-hanapure-text')).length,2);
 assert.ok(shoppingReadingClass('ko').includes('text-[1.2rem]'));assert.ok(shoppingReadingClass('ko').includes('[&_.text-sm]:text-[1.05rem]'));assert.ok(shoppingReadingClass('ko').includes('[&_.text-base]:text-[1.2rem]'));assert.ok(1.05/.875>=1.2);assert.ok(1.2/1>=1.2);for(const loc of ['en','hu'])assert.ok(!shoppingReadingClass(loc).includes('rem]'));
 for(const key of ['planRecoveryChecked','planPending','planRestored','planCurrentSummary','planStoredCart','planNotCommitted'])for(const loc of ['en','hu','ko'])assert.ok(storefrontLabels[loc][key]);
}));

test('UX04/05 installed Tailwind emits scoped KO sizes and native active/disabled styles without root changes',async()=>{
 const {compile}=await import('tailwindcss');const compiler=await compile('@theme { --color-hanapure-beige: #e4d4c2; } @tailwind utilities;');
 const css=compiler.build(shoppingReadingClass('ko').split(' '));assert.match(css,/font-size: 1\.05rem/);assert.match(css,/font-size: 1\.2rem/);assert.match(css,/\.text-sm/);assert.match(css,/:enabled:active/);assert.match(css,/cursor: not-allowed/);assert.ok(!css.includes('font-family:'));assert.ok(!css.includes('html {'));
});

test('H9 Forget uses stable recovery-region focus without scroll; repeated Check announces read-only results',()=>browser(({store})=>{
 const props=baseProps();ui(props);let t=ui(props);const focuses=[];t.props.ref.current={focus:x=>focuses.push(x)};button(t,storefrontLabels.en.planRecoveryForget).props.onClick();t=ui(props);assert.deepEqual(focuses,[{preventScroll:true}]);assert.equal(store.raw,null);
 let check=button(t,storefrontLabels.en.planRecoveryReload);check.props.onClick();t=ui(props);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryChecked+' (1)'));check=button(t,storefrontLabels.en.planRecoveryReload);check.props.onClick();t=ui(props);assert.ok(text(t).includes(storefrontLabels.en.planRecoveryChecked+' (2)'));assert.equal(store.calls.filter(c=>c[0]==='set').length,0);
},saved()));

function choiceUI(Component,props){driver.index=0;driver.effects=[];const t=Component(props);driver.effects.forEach(fn=>fn());return t;}
test('UX05 Apply refuses identical pending submit, permits changed filter intent and unlocks on committed URL',()=>browser(({location})=>{
 class Element{constructor(attrs={}){this.attrs=attrs;}hasAttribute(k){return k in this.attrs;}getAttribute(k){return this.attrs[k]??null;}}
 class Form extends Element{constructor(){super({'data-catalogue-search':'',action:'/products'});this.method='get';this.target='';this.entries=[['q','Synthetic'],['sort','name-asc'],['view','list']];}}
 class Input extends Element{};class Data{constructor(form){this.entries=form.entries;}*[Symbol.iterator](){yield* this.entries;}}
 const entries={HTMLElement:Element,HTMLFormElement:Form,HTMLInputElement:Input,FormData:Data},original=Object.keys(entries).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 for(const[k,v]of Object.entries(entries))Object.defineProperty(globalThis,k,{configurable:true,value:v});
 try{const props={path:'/products',locale:'en',children:null},form=new Form(),event=()=>({target:form,currentTarget:{contains:x=>x===form},nativeEvent:{submitter:null},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
 let t=choiceUI(ShoppingPlanSearchGuard,props);t.props.onSubmit(event());t.props.onSubmit(event());assert.equal(driver.pushes.length,1);t=choiceUI(ShoppingPlanSearchGuard,props);assert.ok(text(t).includes(storefrontLabels.en.planApplyPending));form.entries[1][1]='name-desc';t.props.onSubmit(event());assert.equal(driver.pushes.length,2);assert.ok(driver.pushes.every(p=>p.options.scroll===false));
 location.href='https://synthetic.invalid'+driver.pushes[1].href;choiceUI(ShoppingPlanSearchGuard,props);t=choiceUI(ShoppingPlanSearchGuard,props);assert.ok(text(t).includes(storefrontLabels.en.planApplyDone));t.props.onSubmit(event());assert.equal(driver.pushes.length,3);
 }finally{for(const[k,v]of original)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];}
}));

test('UX05 Plan Add intake announces actual navigation pending, disables repeat and rejects retained action',()=>browser(({location})=>{
 const assigned=[];location.assign=href=>assigned.push(href);const props={context:{plan:readShoppingPlan(undefined,products),path:'/products',query:'?view=list',publishedIds:products.map(p=>p.publicId)},ids:[id(1)],guard:()=>true,locale:'ko'};
 let t=choiceUI(ShoppingPlanIntake,props),add=nodes(t).find(n=>n.type==='button');add.props.onClick();add.props.onClick();assert.equal(assigned.length,1);t=choiceUI(ShoppingPlanIntake,props);assert.equal(t.props['aria-busy'],true);assert.equal(nodes(t).find(n=>n.type==='button').props.disabled,true);assert.ok(text(t).includes(storefrontLabels.ko.planPending));add.props.onClick();assert.equal(assigned.length,1);
}));

test('FINAL A dark primary pressed foreground compiles above white base and remains readable on ancestor beige',async t=>{
 const source=readFileSync(new URL('../components/cart/AddToCart.tsx',import.meta.url),'utf8');
 const primary=source.match(/<button type="submit" disabled=\{!healthy\} className=\{`([^`]+)`\}/)?.[1];assert.ok(primary);assert.ok(primary.includes('enabled:active:text-hanapure-text'),'primary needs its own active foreground regardless of ancestor background specificity');
 const {cartControl}=await import('../components/cart/AddToCart.tsx');const {compile}=await import('tailwindcss');
 const globals=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');const color=name=>globals.match(new RegExp('--hanapure-'+name+': (#[0-9a-f]{6})'))[1];
 const theme='@theme { '+['white','text','beige'].map(n=>'--color-hanapure-'+n+': '+color(n)+';').join(' ')+' } @tailwind utilities;';
 const css=(await compile(theme)).build([...primary.replace('${cartControl}',cartControl).split(' '),...shoppingReadingClass('en').split(' ')]);
 assert.ok(css.includes('.enabled\\:active\\:text-hanapure-text'));assert.ok(css.includes('&:enabled'));assert.ok(css.includes('&:active'));assert.ok(css.includes('color: var(--color-hanapure-text)'));assert.ok(css.includes('background-color: var(--color-hanapure-beige)'));assert.ok(css.includes('button:enabled:active'));
 const luminance=hex=>hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const previous=contrast(color('white'),color('beige')),fixed=contrast(color('text'),color('beige'));assert.ok(previous<4.5);assert.ok(fixed>=4.5);t.diagnostic(JSON.stringify({oldWhiteOnBeige:previous,darkOnBeige:fixed,foregroundSpecificity:[0,3,0],whiteBaseSpecificity:[0,1,0],ancestorBeigeChangesBackgroundOnly:true,browserComputed:'NOT_EVALUATED'}));
});

test('FINAL B denied Check has no success prefix or write; locks all locales until a successful explicit Check',()=>{
 for(const locale of ['en','hu','ko'])browser(({store,location,notify})=>{
  const labels=storefrontLabels[locale],props={...baseProps(),locale,plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);let tree=ui(props);const retained=button(tree,labels.planRecoveryReplace);store.external(saved([{publicId:id(3),quantity:5}]));notify(PLAN_RECOVERY_KEY);tree=ui(props);store.control.read=true;
  button(tree,labels.planRecoveryReload).props.onClick();tree=ui(props);assert.ok(text(tree).includes(labels.planRecoveryCheckFailed));assert.ok(!text(tree).includes(labels.planRecoveryChecked));assert.ok(!text(tree).includes(labels.planRecoverySaved));assert.equal(button(tree,labels.planRecoverySave).props.disabled,true);assert.equal(button(tree,labels.planRecoveryForget).props.disabled,true);retained.props.onClick();assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
  store.control.read=false;button(tree,labels.planRecoveryReload).props.onClick();tree=ui(props);assert.ok(text(tree).includes(labels.planRecoveryChecked+' (1)'));assert.equal(button(tree,labels.planRecoveryReplace).props.disabled,false);assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
 },saved());
});

// Handler-level native-click model only: detail=0 represents keyboard activation,
// not a claim to have dispatched a real browser key or observed a native frame.
function cueClock(run){const previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout,tasks=new Map(),all=new Map();let serial=0;
 globalThis.setTimeout=(fn,ms)=>{const id=++serial;tasks.set(id,{fn,ms});all.set(id,{fn,ms});return id;};globalThis.clearTimeout=id=>tasks.delete(id);
 try{run({tasks,all,fire:id=>{tasks.delete(id);all.get(id).fn();}});}finally{globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;}}
test('ENTER RED Check click performs read-only action and leaves a visible acknowledgement until a later task',()=>cueClock(clock=>browser(({store})=>{
 const props=baseProps();ui(props);let tree=ui(props);button(tree,storefrontLabels.en.planRecoveryReload).props.onClick({detail:0});tree=ui(props);const checked=button(tree,storefrontLabels.en.planRecoveryReload);
 assert.ok(text(tree).includes(storefrontLabels.en.planRecoveryChecked));assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
 assert.equal(checked.props['data-activation-feedback'],'check');assert.equal(checked.props.style.backgroundColor,'var(--hanapure-beige)');assert.equal(checked.props.style.color,'var(--hanapure-text)');assert.equal(typeof checked.props.onKeyDown,'undefined');
 assert.equal(clock.tasks.size,1);const [id,task]=[...clock.tasks][0];assert.ok(task.ms>0&&task.ms<=1000);clock.fire(id);tree=ui(props);assert.equal(button(tree,storefrontLabels.en.planRecoveryReload).props['data-activation-feedback'],undefined);
})));
test('ENTER RED Replace click commits once without waiting for visual timer and keeps a visible acknowledgement',()=>cueClock(clock=>browser(({store,location})=>{
 const next=[{publicId:id(1),quantity:3},{publicId:id(2),quantity:3}],props={...baseProps(),plan:readShoppingPlan(portablePayload(next),products)};location.href='https://synthetic.invalid'+href(next);ui(props);let tree=ui(props);const replace=button(tree,storefrontLabels.en.planRecoveryReplace);replace.props.onClick({detail:0});replace.props.onClick({detail:0});tree=ui(props);
 assert.deepEqual(readPlanRecovery(store,products).lines,next);assert.equal(store.calls.filter(c=>c[0]==='set').length,1);assert.equal(button(tree,storefrontLabels.en.planRecoveryReplace).props['data-activation-feedback'],'save');assert.ok(clock.tasks.size<=1);assert.ok(text(tree).includes(storefrontLabels.en.planRecoverySaved));
 button(tree,storefrontLabels.en.planRecoveryReplace).props.onClick({detail:0});tree=ui(props);assert.equal(store.calls.filter(c=>c[0]==='set').length,1);const timer=[...clock.tasks.keys()][0];clock.fire(timer);tree=ui(props);button(tree,storefrontLabels.en.planRecoveryReplace).props.onClick({detail:0});tree=ui(props);assert.equal(store.calls.filter(c=>c[0]==='set').length,1);
 props.plan=readShoppingPlan(portablePayload([{publicId:id(1),quantity:4}]),products);location.href='https://synthetic.invalid'+href(props.plan.lines);ui(props);tree=ui(props);button(tree,storefrontLabels.en.planRecoveryReplace).props.onClick({detail:0});assert.equal(store.calls.filter(c=>c[0]==='set').length,2);assert.deepEqual(readPlanRecovery(store,products).lines,props.plan.lines);
},saved())));

test('ENTER cue is modality-neutral across EN/HU/KO, preserves focus and has a compiled reduced-motion safeguard',async()=>{
 for(const locale of ['en','hu','ko'])for(const mode of ['Enter','Space','pointer'])cueClock(clock=>browser(({store,location})=>{
  const labels=storefrontLabels[locale],props={...baseProps(),locale,plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);let tree=ui(props);const check=button(tree,labels.planRecoveryReload),event={detail:mode==='pointer'?1:0,preventDefault(){assert.fail('native activation must not be suppressed');}};
  assert.ok(check.props.className.includes('focus-visible:outline-2'));assert.ok(check.props.className.includes('motion-reduce:transition-none'));assert.equal(check.props.style.transitionProperty,'none');check.props.onClick(event);tree=ui(props);assert.equal(button(tree,labels.planRecoveryReload).props['data-activation-feedback'],'check');assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
  const replace=button(tree,labels.planRecoveryReplace);replace.props.onClick(event);tree=ui(props);const active=button(tree,labels.planRecoveryReplace);assert.equal(active.props['data-activation-feedback'],'save');assert.equal(active.props.style.transitionProperty,'none');assert.ok(active.props.style.boxShadow.includes('inset'));assert.equal(active.props['aria-pressed'],undefined);assert.equal(store.calls.filter(c=>c[0]==='set').length,1);assert.ok(clock.tasks.size<=1);
 },saved()));
 const {compile}=await import('tailwindcss');const css=(await compile('@tailwind utilities;')).build(['motion-reduce:transition-none']);assert.match(css,/prefers-reduced-motion: reduce/);assert.match(css,/transition-property: none/);
});
test('ENTER cue repeat keeps one timer; superseded queued callback cannot clear new cue; navigation/unmount cancels',()=>cueClock(clock=>browser(()=>{
 const props=baseProps();ui(props);let tree=ui(props);button(tree,storefrontLabels.en.planRecoveryReload).props.onClick({detail:0});const first=[...clock.tasks.keys()][0];tree=ui(props);button(tree,storefrontLabels.en.planRecoveryReload).props.onClick({detail:0});const second=[...clock.tasks.keys()][0];assert.notEqual(first,second);assert.equal(clock.tasks.size,1);
 clock.fire(first);tree=ui(props);assert.equal(button(tree,storefrontLabels.en.planRecoveryReload).props['data-activation-feedback'],'check');props.locale='hu';ui(props);tree=ui(props);assert.equal(clock.tasks.size,0);assert.equal(button(tree,storefrontLabels.hu.planRecoveryReload).props['data-activation-feedback'],undefined);clock.fire(second);assert.equal(button(ui(props),storefrontLabels.hu.planRecoveryReload).props['data-activation-feedback'],undefined);
 button(ui(props),storefrontLabels.hu.planRecoveryReload).props.onClick({detail:0});const last=[...clock.tasks.keys()][0];const stale=button(ui(props),storefrontLabels.hu.planRecoveryReload);reset();assert.equal(clock.tasks.size,0);clock.fire(last);stale.props.onClick({detail:0});assert.deepEqual(driver.state,[]);assert.equal(clock.tasks.size,0);
})));
test('ENTER refused changed-copy Replace and failed Check acknowledge input without write or false saved result',()=>cueClock(clock=>browser(({store,location})=>{
 const props={...baseProps(),plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);let tree=ui(props);const newer=saved([{publicId:id(3),quantity:5}]);store.external(newer);button(tree,storefrontLabels.en.planRecoveryReplace).props.onClick({detail:0});tree=ui(props);assert.equal(store.raw,newer);assert.equal(button(tree,storefrontLabels.en.planRecoveryReplace).props.disabled,true);assert.equal(button(tree,storefrontLabels.en.planRecoveryReplace).props['data-activation-feedback'],'save');assert.ok(text(tree).includes(storefrontLabels.en.planRecoveryConflict));assert.ok(!text(tree).includes(storefrontLabels.en.planRecoverySaved));
 store.control.read=true;button(tree,storefrontLabels.en.planRecoveryReload).props.onClick({detail:0});tree=ui(props);assert.equal(button(tree,storefrontLabels.en.planRecoveryReload).props['data-activation-feedback'],'check');assert.ok(text(tree).includes(storefrontLabels.en.planRecoveryCheckFailed));assert.ok(!text(tree).includes(storefrontLabels.en.planRecoveryChecked));assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);assert.ok(clock.tasks.size<=1);
},saved())));
test('ENTER disabled or superseded URL callbacks cannot acknowledge, write, or schedule timers',()=>cueClock(clock=>browser(({store,location})=>{
 const props={...baseProps(),disabled:true,plan:readShoppingPlan(portablePayload(lines),products)};location.href='https://synthetic.invalid'+href();ui(props);let tree=ui(props);for(const label of [storefrontLabels.en.planRecoveryReload,storefrontLabels.en.planRecoveryReplace])button(tree,label).props.onClick({detail:0});tree=ui(props);assert.equal(clock.tasks.size,0);assert.equal(nodes(tree).filter(n=>n.props?.['data-activation-feedback']).length,0);
 props.disabled=false;ui(props);tree=ui(props);location.href='https://synthetic.invalid/products?cartPlan=bad';button(tree,storefrontLabels.en.planRecoveryReplace).props.onClick({detail:0});button(tree,storefrontLabels.en.planRecoveryReload).props.onClick({detail:0});assert.equal(clock.tasks.size,0);assert.equal(store.calls.filter(c=>c[0]!=='get').length,0);
},saved())));
