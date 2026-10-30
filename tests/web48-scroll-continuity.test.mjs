import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { storefrontLabels as labels } from "../lib/storefront/localization.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { readCatalogueBrowse } from "../lib/catalog/catalogue-browse.ts";
import { readShoppingPlan, shoppingPlanHref, shoppingPlanShareLink } from "../lib/catalog/catalogue-shopping-plan.ts";
import { portablePayload } from "../lib/cart/cart-portable-handoff.ts";

const require=createRequire(import.meta.url),repo=dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot=dirname(require.resolve("react/package.json"));
const hooks="data:text/javascript,"+encodeURIComponent(`
export const driver={state:[],index:0,effects:[],cleanups:[],transition:false,context:null,pushes:[],throwPush:false};
driver.router={push(href,options){if(driver.throwPush)throw Error('router failure');driver.pushes.push({href,options});}};
export function useState(initial){const i=driver.index++;if(!(i in driver.state))driver.state[i]=typeof initial==='function'?initial():initial;return [driver.state[i],v=>driver.state[i]=typeof v==='function'?v(driver.state[i]):v];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=>'synthetic-heading-'+driver.index)[0];}
export function useEffect(effect){driver.effects.push(effect);}
export function createContext(){return {Provider:Symbol('provider')};}
export function useContext(){return driver.context;}
export function useSyncExternalStore(sub,get){return get();}
export function useTransition(){return [driver.transition,fn=>{driver.transition=true;fn();}];}
`);
const navigation="data:text/javascript,"+encodeURIComponent(`import {driver} from ${JSON.stringify(hooks)};export function useRouter(){return driver.router;}export function notFound(){throw Error('not found');}`);
registerHooks({
 resolve(specifier,context,next){
  if(specifier==='react'&&context.parentURL?.endsWith('/components/catalogue/CatalogueShoppingPlan.tsx'))return {url:hooks,shortCircuit:true};
  if(specifier==='react'||specifier==='react/jsx-runtime')return {url:pathToFileURL(join(reactRoot,specifier==='react'?'index.js':'jsx-runtime.js')).href,shortCircuit:true};
  if(specifier==='react-dom')return {url:pathToFileURL(join(dirname(require.resolve('react-dom/package.json')),'index.js')).href,shortCircuit:true};
  if(specifier==='next/navigation')return {url:navigation,shortCircuit:true};
  if(specifier==='next/link')return next('next/link.js',context);
  if(specifier==='@/lib/cart/browser-cart'&&context.parentURL?.endsWith('/components/catalogue/CatalogueShoppingPlan.tsx'))return {url:'data:text/javascript,export const useBrowserCart=()=>({lines:[],ready:false,persistent:false,invalid:false});',shortCircuit:true};
  if(specifier.startsWith('@/'))specifier=pathToFileURL(join(repo,specifier.slice(2))).href;
  try{return next(specifier,context);}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;for(const ext of ['.ts','.tsx']){try{return next(specifier+ext,context);}catch{}}throw e;}
 },
 load(url,context,next){return url.endsWith('.tsx')?{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}:next(url,context);}
});
const {driver}=await import(hooks);
const {default:Plan,ShoppingPlanSearchGuard}=await import('../components/catalogue/CatalogueShoppingPlan.tsx');
const {ProductListing}=await import('../components/catalogue/ProductCatalogue.tsx');
const nodes=n=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
const findButton=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n)===label);
const id=n=>`${String(n).padStart(8,'0')}-abcd-1234-abcd-123456789abc`;
const records=Array.from({length:3},(_,i)=>({publicId:id(i+1),slug:`synthetic-${i+1}`,brand:'beplain',state:'published',translations:{en:{name:`Synthetic ${i+1}`,description:'Test only',images:[],usage:null,caution:null},hu:null,ko:null}}));
const products=records.map(r=>({publicId:r.publicId,slug:r.slug,brand:r.brand,name:r.translations.en.name}));
const query='?q=Synthetic&brand=beplain&sort=name-desc&view=list';
const initial=[{publicId:id(1),quantity:1},{publicId:id(2),quantity:1}];
function render(Component,props){driver.index=0;driver.effects=[];const tree=Component(props);driver.cleanups.forEach(fn=>fn?.());driver.cleanups=driver.effects.map(fn=>fn());return tree;}
function reset(){driver.state=[];driver.index=0;driver.cleanups.forEach(fn=>fn?.());driver.cleanups=[];driver.effects=[];driver.pushes=[];driver.transition=false;driver.throwPush=false;}
class Element {constructor(attrs={}){this.attrs=attrs;this.isConnected=true;}hasAttribute(k){return k in this.attrs;}getAttribute(k){return this.attrs[k]??null;}}
class Form extends Element {constructor(entries,attrs={}){super({'data-catalogue-search':'',action:'/products',...attrs});this.entries=entries;this.method=attrs.method??'get';this.target=attrs.target??'';}}
class Input extends Element {constructor(attrs={}){super(attrs);this.type=attrs.type??'submit';}}
class Data {constructor(form,submitter){this.entries=[...form.entries];if(submitter?.attrs.name)this.entries.push([submitter.attrs.name,submitter.attrs.value??'']);}*[Symbol.iterator](){yield* this.entries;}}
function browser(run){const keys=['window','document','HTMLElement','HTMLFormElement','HTMLInputElement','FormData'],old=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 const body={isConnected:true},focuses=[];const doc={body,activeElement:body};const win={location:{href:'https://synthetic.invalid/products'},get localStorage(){assert.fail('no browser store access');},get sessionStorage(){assert.fail('no scroll storage');}};
 for(const[k,v]of Object.entries({window:win,document:doc,HTMLElement:Element,HTMLFormElement:Form,HTMLInputElement:Input,FormData:Data}))Object.defineProperty(globalThis,k,{configurable:true,value:v});reset();
 try{run({win,doc,focuses});}finally{reset();keys.forEach((k,i)=>old[i]?Object.defineProperty(globalThis,k,old[i]):delete globalThis[k]);}}
function submit(entries,attrs={},submitter=null,extra={}){const form=new Form(entries,attrs),event={target:form,currentTarget:{contains:x=>x===form},nativeEvent:{submitter},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};const tree=render(ShoppingPlanSearchGuard,{path:'/products',locale:'en',children:null});tree.props.onSubmit(event);return event;}
function planProps(lines=initial){return {plan:readShoppingPlan(portablePayload(lines),records),products,publishedIds:records.map(r=>r.publicId),visibleIds:records.map(r=>r.publicId),locale:'en',routeLocale:null,path:'/products',query};}
function planRender(props,env){const tree=render(Plan,props);const section=nodes(tree).find(n=>n.type==='section'&&n.props['aria-labelledby']);section.props.ref.current={focus:opts=>env.focuses.push(opts)};return tree;}
function selectAll(tree){findButton(tree,labels.en.planSelectDisplayed).props.onClick();}
function setBulk(tree,raw){nodes(tree).find(n=>n.type==='input'&&n.props.type==='number'&&typeof n.props.value==='string').props.onChange({target:{value:raw}});}
function bulkSubmit(tree){const form=nodes(tree).find(n=>n.type==='form');form.props.onSubmit({preventDefault(){}});}
function committed(props,env){const push=driver.pushes.at(-1);env.win.location.href=new URL(push.href,env.win.location.href).href;driver.transition=false;const raw=new URL(env.win.location.href).searchParams.get('cartPlan');props={...props,plan:readShoppingPlan(raw??undefined,records)};return {props,tree:planRender(props,env)};}

test('U1 Apply A–Z/Z–A and Enter preserve successful controls and use push scroll:false',()=>browser(()=>{
 const raw=portablePayload(initial);
 for(const sort of ['name-asc','name-desc']){const entries=[['q','Synthetic & café'],['brand','beplain'],['sort',sort],['view','list'],['cartPlan',raw],['unknown',''],['unknown','second']];
 const e=submit(entries);assert.equal(e.defaultPrevented,true);assert.deepEqual(driver.pushes.at(-1),{href:'/products?'+new URLSearchParams(entries),options:{scroll:false}});}
 const button=new Element({name:'apply',value:'yes'});submit([['q','Synthetic']],{},button);assert.ok(driver.pushes.at(-1).href.endsWith('&apply=yes'));
}));
test('U1 unsafe own form action/method/target, foreign path and submitter overrides refuse',()=>browser(({win})=>{
 for(const attrs of [{action:'https://external.invalid/products'},{action:'/products/other'},{method:'post'},{target:'_blank'}])assert.equal(submit([['q','safe']],attrs).defaultPrevented,true);
 for(const attrs of [{formaction:'//external.invalid'},{formmethod:'post'},{formtarget:'_blank'}])assert.equal(submit([['q','safe']],{},new Element(attrs)).defaultPrevented,true);
 assert.equal(submit([['q','safe']],{},new Input({type:'image'})).defaultPrevented,true);
 win.location.href='https://synthetic.invalid/hu/products';assert.equal(submit([['q','safe']]).defaultPrevented,true);assert.equal(driver.pushes.length,0);
}));
test('U1 8192 boundary exact, oversized entire plan and nonstring payload refused without truncation',()=>browser(()=>{
 submit([['q','x'.repeat(8192-('/products?q='.length))]]);assert.equal(driver.pushes[0].href.length,8192);
 const e=submit([['q','x'.repeat(8100)],['cartPlan','x'.repeat(200)]]);assert.equal(e.defaultPrevented,true);assert.equal(driver.pushes.length,1);
 submit([['file',{}]]);assert.equal(driver.pushes.length,1);
}));
test('U1 unrelated nested form and already prevented submit untouched; router failure announces refusal',()=>browser(()=>{
 const unrelated=new Form([]);delete unrelated.attrs['data-catalogue-search'];const e={target:unrelated,defaultPrevented:false,preventDefault(){assert.fail('unrelated form intercepted');}};
 render(ShoppingPlanSearchGuard,{path:'/products',locale:'en',children:null}).props.onSubmit(e);
 const prevented=submit([['q','test']],{},null,{defaultPrevented:true,preventDefault(){assert.fail('already prevented');}});assert.equal(prevented.defaultPrevented,true);
 driver.throwPush=true;submit([['q','test']]);const status=render(ShoppingPlanSearchGuard,{path:'/products',locale:'en',children:null});assert.ok(text(status).includes(labels.en.planChanged));assert.equal(driver.pushes.length,0);
}));
test('U2 two selected quantities become2/2 then legitimate U3 removal succeeds after committed URL+Plan',()=>browser(env=>{
 let props=planProps();env.win.location.href='https://synthetic.invalid'+shoppingPlanHref('/products',query,initial);let tree=planRender(props,env);
 selectAll(tree);tree=planRender(props,env);setBulk(tree,'2');tree=planRender(props,env);const old=tree;bulkSubmit(tree);bulkSubmit(old);assert.equal(driver.pushes.length,1);
 const p=new URL(driver.pushes[0].href,'https://synthetic.invalid');assert.equal(p.searchParams.get('view'),'list');assert.equal(p.searchParams.get('q'),'Synthetic');assert.equal(p.searchParams.get('sort'),'name-desc');
 assert.deepEqual(readShoppingPlan(p.searchParams.get('cartPlan'),records).lines,initial.map(x=>({...x,quantity:2})));
 tree=planRender(props,env);findButton(tree,labels.en.planRemoveSelected+' (2)').props.onClick();assert.equal(driver.pushes.length,1);
 ({props,tree}=committed(props,env));assert.ok(text(tree).includes(labels.en.planUnits+': 4'));
 const check=nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox');check.props.onChange({target:{checked:true}});tree=planRender(props,env);
 const removedFocus=new Element();env.doc.activeElement=removedFocus;findButton(tree,labels.en.planRemoveSelected+' (1)').props.onClick();assert.equal(driver.pushes.length,2);
 removedFocus.isConnected=false;env.doc.activeElement=env.doc.body;({props,tree}=committed(props,env));assert.deepEqual(props.plan.lines,[{publicId:id(2),quantity:2}]);assert.deepEqual(env.focuses,[{preventScroll:true}]);assert.ok(text(tree).includes(labels.en.planUnits+': 2'));
 assert.ok(driver.pushes.every(p=>p.options.scroll===false));
}));
test('U2 target URL alone, unrelated rerender and old handlers do not unlock stale Plan',()=>browser(env=>{
 let props=planProps();env.win.location.href='https://synthetic.invalid'+shoppingPlanHref('/products',query,initial);let tree=planRender(props,env);selectAll(tree);tree=planRender(props,env);setBulk(tree,'2');tree=planRender(props,env);bulkSubmit(tree);
 const retained=tree;env.win.location.href=new URL(driver.pushes[0].href,env.win.location.href).href;tree=planRender(props,env);bulkSubmit(tree);bulkSubmit(retained);assert.equal(driver.pushes.length,1);
 ({props,tree}=committed(props,env));bulkSubmit(retained);assert.equal(driver.pushes.length,1);selectAll(tree);tree=planRender(props,env);findButton(tree,labels.en.planRemoveSelected+' (2)').props.onClick();assert.equal(driver.pushes.length,2);
}));
test('U2 aborted transition, unexpected route and thrown router fail closed without duplicates',()=>{
 for(const kind of ['abort','route','throw'])browser(env=>{let props=planProps();env.win.location.href='https://synthetic.invalid'+shoppingPlanHref('/products',query,initial);let tree=planRender(props,env);selectAll(tree);tree=planRender(props,env);setBulk(tree,'2');tree=planRender(props,env);driver.throwPush=kind==='throw';bulkSubmit(tree);tree=planRender(props,env);
 if(kind==='route')env.win.location.href='https://synthetic.invalid/brands';driver.transition=false;tree=planRender(props,env);bulkSubmit(tree);tree=planRender(props,env);assert.equal(driver.pushes.length,kind==='throw'?0:1);assert.ok(text(tree).includes(labels.en.planChanged));});
});
test('Plan invalid quantities and8192 budget refuse, no context shortening or storage mutation',()=>browser(env=>{
 let props=planProps();env.win.location.href='https://synthetic.invalid'+shoppingPlanHref('/products',query,initial);let tree=planRender(props,env);selectAll(tree);tree=planRender(props,env);setBulk(tree,'0');tree=planRender(props,env);bulkSubmit(tree);assert.equal(driver.pushes.length,0);assert.ok(text(planRender(props,env)).includes(labels.en.planInvalidQuantity));
 props={...props,query:'?q='+'x'.repeat(8190)+'&view=list'};tree=planRender(props,env);findButton(tree,labels.en.planRemoveSelected+' (0)').props.onClick();assert.equal(driver.pushes.length,0);assert.ok(text(tree).includes(labels.en.planLimit));
}));
test('full share/new-tab restoration unchanged; non-action focus does not get stolen',()=>browser(env=>{
 let props=planProps();env.win.location.href='https://synthetic.invalid'+shoppingPlanHref('/products',query,initial);let tree=planRender(props,env);selectAll(tree);tree=planRender(props,env);setBulk(tree,'2');tree=planRender(props,env);bulkSubmit(tree);const other=new Element();env.doc.activeElement=other;({props,tree}=committed(props,env));assert.deepEqual(env.focuses,[]);
 const share=shoppingPlanShareLink('https://synthetic.invalid',{plan:props.plan,path:'/products',query,publishedIds:records.map(r=>r.publicId)});const raw=new URL(share).searchParams.get('cartPlan');assert.deepEqual(readShoppingPlan(raw,records),props.plan);assert.equal(new URL(share).searchParams.get('view'),'list');
}));
test('Back-style committed URL+server Plan restoration permits a fresh action, rejects future stale handler',()=>browser(env=>{
 let props=planProps();const back='https://synthetic.invalid'+shoppingPlanHref('/products',query,initial);env.win.location.href=back;let tree=planRender(props,env);selectAll(tree);tree=planRender(props,env);setBulk(tree,'2');tree=planRender(props,env);bulkSubmit(tree);({props,tree}=committed(props,env));const future=tree;
 env.win.location.href=back;props=planProps();tree=planRender(props,env);bulkSubmit(future);assert.equal(driver.pushes.length,1);
 selectAll(tree);tree=planRender(props,env);setBulk(tree,'3');tree=planRender(props,env);bulkSubmit(tree);assert.equal(driver.pushes.length,2);
 assert.deepEqual(readShoppingPlan(new URL(driver.pushes[1].href,'https://synthetic.invalid').searchParams.get('cartPlan'),records).lines,initial.map(x=>({...x,quantity:3})));
}));
test('actual parent keeps native GET fallback, stable Plan key and historical chip scroll:false',()=>{
 const catalogue=createLocalCatalogueReader(records),criteria={query:'Synthetic',brand:'beplain',sort:'name-desc'},browse=readCatalogueBrowse({view:'list'});
 const build=lines=>ProductListing({catalogue,criteria,browse,planHint:portablePayload(lines)});
 const a=build(initial),b=build(initial.map(x=>({...x,quantity:2})));const island=t=>nodes(t).find(n=>n.type===Plan);assert.equal(island(a).key,island(b).key);
 const form=nodes(a).find(n=>n.type==='form');assert.equal(form.props.method,'get');assert.equal(form.props.action,'/products');assert.equal(form.props['data-catalogue-search'],'');
 assert.ok(nodes(a).some(n=>n.type==='input'&&n.props.name==='view'&&n.props.value==='list'));
 const applied=nodes(a).find(n=>n.type==='section'&&n.props['aria-labelledby']==='catalogue-active-filters');const chips=nodes(applied).filter(n=>n.props?.['aria-label']?.startsWith(labels.en.removeFilter+':'));assert.ok(chips.length>0);assert.ok(chips.every(n=>n.props.scroll===false));
 const source=readFileSync(new URL('../components/catalogue/CatalogueShoppingPlan.tsx',import.meta.url),'utf8');
 assert.equal(source.split('window.location.assign(').length-1,1,'only unchanged ShoppingPlanIntake still hard navigates');
 assert.ok(!source.includes('router.replace('));assert.ok(!source.includes('scrollTo('));
});
