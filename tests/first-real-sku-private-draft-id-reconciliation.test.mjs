import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { reconcileFirstSkuPrivateDraftIdentity as reconcile } from "../lib/catalog/first-real-sku-private-draft-id-reconciliation.ts";
const id="a1234567-1234-4321-8123-123456789abc",other="b1234567-1234-4321-8123-123456789abc";
const content=()=>({name:"PRIVATE_SECRET",description:"C:/PRIVATE_SECRET/private.json",images:[{src:"/PRIVATE_SECRET.svg",alt:"PRIVATE_SECRET"}],usage:null,caution:null});
const draft=(patch={})=>({publicId:id,brand:"Round Lab",slug:"private-secret",state:"draft",translations:{en:content(),hu:null,ko:null},...patch});
const wire=(public_id=id)=>({public_id,retail_price_huf:1000,sellable_stock:0,operational_ready:false});
function safe(r){assert.equal(r.releaseDecision,"BLOCKED");assert.equal(r.identityReconciliation,"NOT_ERP_ATTESTED");for(const k of ["readyForLivePublication","readyForCheckout","trustedForLiveUse"])assert.equal(r[k],false);for(const v of Object.values(r.trustLayers))assert.equal(v,"NOT_VERIFIED");assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SECRET|a1234567|b1234567|Round Lab|1000|publicId|public_id/);return r;}
const run=(...args)=>safe(reconcile(...args));
test("all seven outcomes are distinct and always BLOCKED",()=>{
 const cases=[[[],"NO_DRAFT_OR_CANDIDATE"],[[[draft(),draft()],id,wire()],"MULTIPLE_DRAFTS_AMBIGUOUS"],[[draft({state:"published"}),id,wire()],"DRAFT_STRUCTURE_INVALID"],[[draft(),other,wire()],"DECLARED_IDENTITY_MISMATCH"],[[draft(),id,wire()],"DECLARED_IDENTITY_MATCH_ONLY"],[[draft(),id],"ERP_LOGICAL_ID_UNAVAILABLE"],[[draft(),"bad",wire()],"INVALID_OR_UNTRUSTED_INPUT"]];
 for(const [args,status] of cases)assert.equal(run(...args).status,status);
 assert.equal(run([],id,wire()).status,"NO_DRAFT_OR_CANDIDATE");assert.equal(run(draft()).status,"NO_DRAFT_OR_CANDIDATE");
});
test("real diagnoseDraft validates a single record/one-element collection and both ERP shapes",()=>{
 assert.equal(run([draft()],id,wire()).status,"DECLARED_IDENTITY_MATCH_ONLY");
 assert.equal(run(draft(),id,{publicId:id,basePriceHuf:0,sellableStock:0,operationalReady:false}).status,"DECLARED_IDENTITY_MATCH_ONLY");
});
test("case-insensitive equality follows existing UUID contract without new authority",()=>{assert.equal(run(draft({publicId:id.toUpperCase()}),id,wire(id.toUpperCase())).status,"DECLARED_IDENTITY_MATCH_ONLY");});
test("pairwise mismatches reported with fixed codes only",()=>{
 const a=run(draft(),other,wire());assert.deepEqual(a.pairCodes,["DRAFT_CANDIDATE_MISMATCH","CANDIDATE_ERP_MISMATCH"]);
 const b=run(draft(),id,wire(other));assert.deepEqual(b.pairCodes,["DRAFT_ERP_MISMATCH","CANDIDATE_ERP_MISMATCH"]);
 const c=run(draft({publicId:other}),id,wire());assert.deepEqual(c.pairCodes,["DRAFT_CANDIDATE_MISMATCH","DRAFT_ERP_MISMATCH"]);
});
test("missing/invalid logical ERP remains unavailable, never all-three match",()=>{for(const value of [undefined,null,{},"bad",{publicId:id},wire("invalid"),{...wire(),sellable_stock:-1},{...wire(),operational_ready:"true"}])assert.equal(run(draft(),id,value).status,"ERP_LOGICAL_ID_UNAVAILABLE");});
test("structural draft faults remain separate from unsafe forged authority",()=>{
 for(const patch of [{publicId:"bad"},{brand:"Unknown"},{state:"published"},{translations:{}},{slug:"bad slug"}])assert.equal(run(draft(patch),id,wire()).status,"DRAFT_STRUCTURE_INVALID");
 for(const key of ["ownerSelected","approved","readyForCheckout","trusted"])assert.equal(run(draft({[key]:true}),id,wire()).status,"INVALID_OR_UNTRUSTED_INPUT");
 assert.equal(run(draft(),id,{...wire(),approved:true}).status,"INVALID_OR_UNTRUSTED_INPUT");
});
test("getter/proxy/symbol/sparse/function/cycle/deep/oversize input never executes",()=>{
 const getter=draft();Object.defineProperty(getter.translations.en,"name",{get(){assert.fail("getter invoked");}});
 const proxy=new Proxy({}, {ownKeys(){assert.fail("proxy invoked");},getPrototypeOf(){assert.fail("proxy invoked");}});
 const cycle=draft();cycle.translations.en.usage=cycle;
 const symbol=draft();symbol[Symbol("private")]=true;
 const deep=draft();deep.translations.en.usage={a:{b:{c:{d:{e:{f:{g:1}}}}}}};
 const big=draft();big.translations.en.description="X".repeat(4001);
 for(const value of [getter,proxy,cycle,symbol,deep,big,Array(1),Array(11).fill(draft()),draft({slug:()=>assert.fail("function")})])assert.equal(run(value,id,wire()).status,"INVALID_OR_UNTRUSTED_INPUT");
});
test("frozen input deterministic immutable and no ambient clock/network",t=>{
 const d=draft();Object.freeze(d.translations.en.images[0]);Object.freeze(d.translations.en.images);Object.freeze(d.translations.en);Object.freeze(d.translations);Object.freeze(d);const erp=Object.freeze(wire()),before=JSON.stringify([d,erp]);
 const f=t.mock.method(globalThis,"fetch",()=>assert.fail("network")),clock=t.mock.method(Date,"now",()=>assert.fail("clock"));assert.deepEqual(run(d,id,erp),run(d,id,erp));assert.equal(JSON.stringify([d,erp]),before);assert.equal(f.mock.callCount(),0);assert.equal(clock.mock.callCount(),0);
});
test("genuine server-only client rejection and no new reader/provider/publication",()=>{
 const target=new URL("../lib/catalog/first-real-sku-private-draft-id-reconciliation.ts",import.meta.url),s=readFileSync(target,"utf8");assert.ok(s.startsWith('import "server-only";'));assert.doesNotMatch(s,/node:fs|readFile|openSync|runIntake\(|fetch\s*\(|Date\.|setTimeout|console\.|process\./);assert.match(readFileSync(new URL("../data/catalogue.ts",import.meta.url),"utf8"),/Object\.freeze\(\[\]\)/);
 const r=spawnSync(process.execPath,["--import","./tests/server-only-loader.mjs","--input-type=module","--eval",`await import(${JSON.stringify(target.href)})`],{encoding:"utf8",env:{...process.env,NODE_OPTIONS:""}});assert.ifError(r.error);assert.notEqual(r.status,0);assert.match(r.stderr,/cannot be imported from a Client Component module/);
});
