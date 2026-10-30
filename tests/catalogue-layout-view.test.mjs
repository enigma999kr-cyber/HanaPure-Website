import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { readCatalogueBrowse, catalogueBrowseHref, catalogueBrowseQuery, catalogueResultPage } from "../lib/catalog/catalogue-browse.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { readShoppingPlan, shoppingPlanHref, carryShoppingPlan, planIntakeHref, shoppingPlanShareLink, setPlanQuantity, shoppingPlanCartHref } from "../lib/catalog/catalogue-shopping-plan.ts";
import { comparisonHref, comparisonShareLink, publishedComparison } from "../lib/comparison/compare-selection.ts";
import { portablePayload } from "../lib/cart/cart-portable-handoff.ts";
import { storefrontLabels, switchLocalePath } from "../lib/storefront/localization.ts";
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot = dirname(require.resolve("react/package.json"));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react" || specifier === "react/jsx-runtime") return {url:pathToFileURL(join(reactRoot,specifier === "react" ? "index.js" : "jsx-runtime.js")).href,shortCircuit:true};
    if (specifier === "react-dom") return {url:pathToFileURL(join(dirname(require.resolve("react-dom/package.json")),"index.js")).href,shortCircuit:true};
    if (specifier === "next/link") return next("next/link.js",context);
    if (specifier === "next/navigation") return next("next/dist/client/components/navigation.react-server.js",context);
    if (specifier.startsWith("@/")) specifier = pathToFileURL(join(repo,specifier.slice(2))).href;
    try { return next(specifier,context); } catch(e) {
      if(e.code !== "ERR_MODULE_NOT_FOUND") throw e;
      for(const ext of [".ts",".tsx"]) {try{return next(specifier+ext,context);}catch{}}
      throw e;
    }
  },
  load(url,context,next) { return url.endsWith(".tsx") ? {format:"module",shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText} : next(url,context); }
});
const {ProductListing, ProductDetail, catalogueHeaderQuery, carryCataloguePlan} = await import("../components/catalogue/ProductCatalogue.tsx");
const {suggestionDetailHref} = await import("../components/catalogue/SearchSuggestions.tsx");
const id = n => `${String(n).padStart(8,"0")}-abcd-1234-abcd-123456789abc`;
const content = n => ({name:`Synthetic ${n}`,description:"Synthetic only",images:n%2 ? [{src:"/synthetic-only.svg",alt:"Synthetic"}] : [],usage:null,caution:null});
const records = Array.from({length:25},(_,i)=>({publicId:id(i+1),slug:`synthetic-${i+1}`,brand:"beplain",state:"published",translations:{en:content(i),hu:i%3?content(i):null,ko:null}}));
const draft={...records[0],publicId:id(99),slug:"private-draft",state:"draft"};
const catalogue=createLocalCatalogueReader([...records,draft]);
const nodes = node => node==null || typeof node!=="object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node,...nodes(node.props?.children)];
const listing=(params={},locale="en",extra={})=>ProductListing({catalogue,locale,routeLocale:locale,browse:readCatalogueBrowse(params),...extra});
const cardList=tree=>nodes(tree).find(n=>n.props?.["data-catalogue-view"]);
test("strict canonical list input and default-grid normalization",()=>{
  for(const view of [undefined,"grid","LIST"," list","list ","x".repeat(9000),["list"],["list","list"],{},null]) assert.equal(readCatalogueBrowse({view}).view,undefined);
  assert.equal(readCatalogueBrowse({view:"list"}).view,"list");
  assert.equal(catalogueBrowseQuery("?view=list",readCatalogueBrowse()),"");
  assert.equal(catalogueBrowseQuery("",readCatalogueBrowse({view:"list"})),"?view=list");
});
test("query, filters, sort, page and pickFirst survive canonical serialization",()=>{
 const href=catalogueBrowseHref("/hu/products","?q=synthetic&brand=beplain&sort=name-desc",readCatalogueBrowse({view:"list",page:"2",withLocaleInfo:"1",withLocaleImage:"1",pickFirst:id(1)}));
 const p=new URL(href,"https://synthetic.invalid").searchParams;
 for(const [k,v] of Object.entries({view:"list",page:"2",q:"synthetic",brand:"beplain",sort:"name-desc",withLocaleInfo:"1",withLocaleImage:"1",pickFirst:id(1)})) assert.equal(p.get(k),v);
 assert.equal(catalogueBrowseHref("//bad/products","",readCatalogueBrowse()),null);
 assert.equal(catalogueBrowseQuery("x".repeat(8193),readCatalogueBrowse({view:"list"})),null);
 assert.equal(catalogueBrowseHref("/products","?q="+"x".repeat(8180),readCatalogueBrowse({view:"list"})),null);
});
test("published-only membership and clamp independent of layout",()=>{
 for(const view of [undefined,"list"]) {
  const p=catalogueResultPage(catalogue.listPublished(),"en",readCatalogueBrowse({view,page:"999999"}));
  assert.equal(p.page,3);assert.equal(p.total,25);assert.equal(p.items.length,1);assert.ok(!p.all.some(x=>x.publicId===draft.publicId));
 }
 assert.equal(catalogueResultPage([],"en",readCatalogueBrowse({view:"list"})).total,0);
 assert.equal(catalogueResultPage(catalogue.listPublished(),"ko",readCatalogueBrowse({view:"list",withLocaleInfo:"1"})).total,0);
 assert.equal(catalogueResultPage(catalogue.listPublished(),"hu",readCatalogueBrowse({view:"list",withLocaleImage:"1"})).total,8);
});
test("server element output distinct compact layout, stable ids, unchanged grid and no draft",()=>{
 const grid=cardList(listing()),list=cardList(listing({view:"list"}));
 assert.equal(grid.props.className,"mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3");
 assert.match(list.props.className,/grid-cols-1/);
 const cards=nodes(list).filter(n=>n.type==="li");assert.equal(cards.length,12);
 assert.match(cards[0].props.className,/w-20/);assert.match(cards[0].props.className,/sm:/);
 assert.deepEqual(cards.map(n=>n.props.id),nodes(grid).filter(n=>n.type==="li").map(n=>n.props.id));
 assert.ok(!nodes(list).some(n=>typeof n.props?.href === "string" && n.props.href.includes("private-draft")));
});
test("labelled keyboard-native selector and current state for all locales",()=>{
 for(const locale of ["en","hu","ko"]) for(const view of [undefined,"list"]) {
  const tree=listing({view},locale),labels=storefrontLabels[locale];
  const nav=nodes(tree).find(n=>n.type==="nav"&&n.props["aria-label"]===labels.layoutSelector);
  assert.ok(nav);const choices=nodes(nav).filter(n=>n.props?.refusal);assert.equal(choices.length,2);
  assert.equal(choices.filter(n=>n.props["aria-current"]==="true").length,1);
  assert.ok(choices.every(n=>n.props.scroll===false&&n.props.className.includes("focus-visible")&&n.props.href.startsWith(`/${locale}/products`)));
 }
});
test("search form carries list and validated first selection, paging keeps list",()=>{
 const tree=listing({view:"list",pickFirst:id(1),page:"2"});
 assert.ok(nodes(tree).some(n=>n.type==="input"&&n.props.name==="view"&&n.props.value==="list"));
 assert.ok(nodes(tree).some(n=>n.type==="input"&&n.props.name==="pickFirst"&&n.props.value===id(1)));
 assert.ok(nodes(tree).filter(n=>n.props?.rel==="next"||n.props?.rel==="prev").every(n=>n.props.href.includes("view=list")));
});
test("whole plan and canonical view carried by bounded server adapter and locale header",()=>{
 const lines=[{publicId:id(1),quantity:7},{publicId:id(2),quantity:3}],raw=portablePayload(lines),plan=readShoppingPlan(raw,records);
 const href=carryCataloguePlan("/products?q=Synthetic&view=list#catalogue-result-"+id(1),plan);
 assert.equal(new URL(href,"https://synthetic.invalid").searchParams.get("cartPlan"),raw);
 for(const locale of ["en","hu","ko"]) {
  const query=catalogueHeaderQuery({query:"",brand:""},readCatalogueBrowse({view:"list"}),raw,catalogue);
  assert.ok(query);const link=switchLocalePath("/products"+query,locale);assert.ok(link.includes("view=list"));assert.ok(link.includes("cartPlan="));
 }
 assert.equal(carryCataloguePlan("/products?q="+"x".repeat(8180)+"&view=list",plan),null);
});
test("comparison pair and whole plan preserved on server view toggle",()=>{
 const raw=portablePayload([{publicId:id(1),quantity:9}]);
 const tree=listing({},"en",{planHint:raw,comparisonContext:{first:id(1),second:id(2)}});
 const selector=nodes(tree).find(n=>n.type==="nav"&&n.props["aria-label"]===storefrontLabels.en.layoutSelector);
 const list=nodes(selector).find(n=>n.props?.href?.includes("view=list"));const p=new URL(list.props.href,"https://synthetic.invalid").searchParams;
 assert.equal(p.get("compareFirst"),id(1));assert.equal(p.get("compareSecond"),id(2));assert.equal(p.get("cartPlan"),raw);
});
test("canonical Plan serializer supports list and parent supplies list to unchanged plan island",()=>{
 assert.ok(shoppingPlanHref("/products","?view=list",[{publicId:id(1),quantity:2}]).includes("view=list"));
 const tree=listing({view:"list"});assert.ok(nodes(tree).some(n=>n.props?.query?.includes("view=list")&&n.props?.plan));
});
test("Plan rejects malformed view and unknown keys with whole multiline plan intact",()=>{
 const lines=[{publicId:id(1),quantity:2},{publicId:id(2),quantity:7}],plan=readShoppingPlan(portablePayload(lines),records);
 for(const query of ["?view=grid","?view=","?view=LIST","?view=%20list","?view=list&view=list","?view[]=list","?other=x","?cartPlan=fake","?view="+"x".repeat(8193)]) assert.equal(shoppingPlanHref("/products",query,lines),null);
 const href=carryShoppingPlan("/hu/products?page=2&view=list",plan);const p=new URL(href,"https://synthetic.invalid").searchParams;
 assert.deepEqual(readShoppingPlan(p.get("cartPlan"),records).lines,lines);assert.equal(p.get("view"),"list");
 assert.equal(shoppingPlanHref("/products","?q="+"x".repeat(8170)+"&view=list",lines),null);
 assert.equal(shoppingPlanHref("//bad/products","?view=list",lines),null);
 assert.equal(shoppingPlanHref("/products","?view=list",[{publicId:id(1),quantity:0}]),null);
});
test("Plan pure operation paths retain canonical view: edit remove clear share detail intake and cart review",()=>{
 const lines=[{publicId:id(1),quantity:2},{publicId:id(2),quantity:7}],plan=readShoppingPlan(portablePayload(lines),records);
 const context={plan,path:"/ko/products",query:"?view=list&page=2",publishedIds:records.map(x=>x.publicId)};
 const changed=setPlanQuantity(plan,id(1),"5",records);assert.equal(changed.status,"changed");
 for(const next of [changed.lines,lines.slice(1),[]]) {
  const href=shoppingPlanHref(context.path,context.query,next);const p=new URL(href,"https://synthetic.invalid").searchParams;
  assert.equal(p.get("view"),"list");assert.deepEqual(readShoppingPlan(p.get("cartPlan")??undefined,records).lines,next);
 }
 const share=shoppingPlanShareLink("https://synthetic.invalid",context);assert.ok(share.includes("view=list"));
 assert.equal(shoppingPlanShareLink("https://synthetic.invalid",{...context,query:"?view=list&evil=x"}),null);
 const intake=planIntakeHref(context,[id(3)]);assert.equal(intake.status,"changed");assert.ok(intake.href.includes("view=list"));
 assert.equal(readShoppingPlan(new URL(intake.href,"https://synthetic.invalid").searchParams.get("cartPlan"),records).lines.length,3);
 assert.ok(shoppingPlanHref("/ko/products/synthetic-1",context.query,lines).includes("view=list"));
 // Cart route uses its CLOSED cartDraft protocol; presentation is catalogue-only.
 assert.ok(shoppingPlanCartHref("/ko/cart",plan,records).includes("cartDraft="));
 assert.ok(shoppingPlanHref("/products","",lines).startsWith("/products?cartPlan="));
});
test("comparison list transport and strict canonical share without broadening pair authority",()=>{
 const pair=[records[0],records[1]],href=comparisonHref("/hu/products",pair,"?q=Synthetic&view=list");
 assert.ok(href.includes("view=list"));const share=href+"#catalogue-comparison";
 assert.equal(comparisonShareLink(share,"https://synthetic.invalid",records),"https://synthetic.invalid"+share);
 assert.equal(comparisonShareLink(share.replace("#","&evil=x#"),"https://synthetic.invalid",records),null);
 for(const query of ["?view=grid","?view=LIST","?view=list&view=list","?evil=list"]) assert.equal(comparisonHref("/products",pair,query),null);
 assert.equal(comparisonHref("/products",[records[0],records[0]],"?view=list"),null);
 assert.equal(publishedComparison(catalogue.listPublished(),{first:draft.publicId,second:id(1)}),null);
 assert.equal(comparisonShareLink(share,"https://other.invalid/path",records),null);
 assert.equal(comparisonHref("/products",pair,"x".repeat(8193)),null);
});
test("live suggestion helper preserves list brand sort and whole plan; keyboard/render source symmetry",()=>{
 const raw=portablePayload([{publicId:id(1),quantity:3}]),plan=readShoppingPlan(raw,records);
 const href=suggestionDetailHref("synthetic-1","hu","live Synthetic","beplain","name-desc","list");
 const p=new URL(carryShoppingPlan(href,plan),"https://synthetic.invalid").searchParams;
 assert.equal(p.get("q"),"live Synthetic");assert.equal(p.get("brand"),"beplain");assert.equal(p.get("sort"),"name-desc");assert.equal(p.get("view"),"list");assert.equal(p.get("cartPlan"),raw);
 assert.ok(!suggestionDetailHref("synthetic-1",null,"Synthetic").includes("view="));
 const source=readFileSync(new URL("../components/catalogue/SearchSuggestions.tsx",import.meta.url),"utf8");
 assert.equal(source.split("suggestionDetailHref(product.slug, routeLocale, query, appliedCriteria.brand, appliedCriteria.sort, view)").length-1,2);
 assert.match(source,/allowed\.has\(link\.getAttribute\("href"\)/);
});
test("parent canonical props drive both unchanged comparison islands and suggestion presentation",()=>{
 const tree=listing({view:"list"});
 const suggestions=nodes(tree).find(n=>n.type?.name==="SearchSuggestions");assert.equal(suggestions.props.view,"list");
 const islands=nodes(tree).filter(n=>n.props?.catalogueQuery!==undefined);assert.ok(islands.length>=2);
 assert.ok(islands.every(n=>new URLSearchParams(n.props.catalogueQuery).get("view")==="list"));
});
test("zero, one, drafts-only and real public EMPTY remain safe",()=>{
 for(const products of [[],[draft],[records[0]]]) for(const view of [undefined,"list"]) {
  const tree=listing({view},"ko",{catalogue:createLocalCatalogueReader(products)});
  assert.equal(cardList(tree)?.props.children.length??0,products[0]?.state==="published"?1:0);
 }
 assert.match(readFileSync(new URL("../data/catalogue.ts",import.meta.url),"utf8"),/Object\.freeze\(\[\]\)/);
});
test("RED regression: refused long parent browse must not produce shorter pair return or share context",()=>{
 const criteria={query:"x".repeat(9000),brand:"beplain",sort:"name-desc"};
 assert.equal(catalogueBrowseQuery("?q="+criteria.query,readCatalogueBrowse({view:"list"})),null);
 const context={first:id(1),second:id(2)};
 for(const tree of [ProductListing({catalogue,criteria,browse:readCatalogueBrowse({view:"list"}),comparisonContext:context}),
   ProductDetail({slug:"synthetic-1",catalogue,criteria,browse:readCatalogueBrowse({view:"list"}),comparisonContext:context})]) {
  // Explicit user resets may intentionally discard q; comparison/return links may not.
  const hrefs=nodes(tree).filter(n=>!n.props?.["aria-label"]?.startsWith(storefrontLabels.en.removeFilter+":") && n.props?.children!==storefrontLabels.en.clear).map(n=>n.props?.href).filter(href=>typeof href==="string");
  assert.ok(!hrefs.some(href=>href.includes("compareFirst=")),"no shorter comparison/return link: "+hrefs.filter(href=>href.includes("compareFirst=")).join(" | "));
  assert.ok(!nodes(tree).some(n=>n.type?.name==="ProductComparison"),"refused context must not reach panel's clean fallback");
 }
 assert.equal(comparisonHref("/products",[records[0],records[1]],"?view=invalid"),null);
});
test("short detail return preserves search and list; maximum loaded plan hidden payload not dropped",()=>{
 const criteria={query:"Synthetic",brand:"beplain",sort:"name-desc"};
 const tree=ProductDetail({slug:"synthetic-1",catalogue,criteria,browse:readCatalogueBrowse({view:"list"}),comparisonContext:{first:id(1),second:id(2)}});
 const href=nodes(tree).map(n=>n.props?.href).find(h=>typeof h==="string"&&h.includes("compareFirst="));
 const p=new URL(href,"https://synthetic.invalid").searchParams;assert.equal(p.get("q"),"Synthetic");assert.equal(p.get("view"),"list");assert.equal(p.get("brand"),"beplain");assert.equal(p.get("sort"),"name-desc");
 const forty=Array.from({length:40},(_,i)=>({...records[0],publicId:id(i+1),slug:`max-${i+1}`}));
 const reader=createLocalCatalogueReader(forty),lines=forty.map(r=>({publicId:r.publicId,quantity:Number.MAX_SAFE_INTEGER})),raw=portablePayload(lines);
 assert.ok(raw);const plan=readShoppingPlan(raw,forty);assert.equal(plan.status,"ready");
 const standalone=carryCataloguePlan("/products",plan);assert.ok(standalone&&standalone.length<8192);
 const listingTree=ProductListing({catalogue:reader,planHint:raw,criteria:{query:"x".repeat(8000),brand:""},browse:readCatalogueBrowse({view:"list"})});
 const hidden=nodes(listingTree).find(n=>n.type==="input"&&n.props.name==="cartPlan");assert.equal(hidden.props.value,raw);
 const submitted="/products?"+new URLSearchParams({q:"x".repeat(8000),cartPlan:hidden.props.value,view:"list"});assert.ok(submitted.length>8192);
 const guard=readFileSync(new URL("../components/catalogue/CatalogueShoppingPlan.tsx",import.meta.url),"utf8");
 assert.match(guard,/8192/);assert.match(guard,/preventDefault/);
});
