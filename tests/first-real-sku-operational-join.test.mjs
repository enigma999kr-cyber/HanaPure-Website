import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { joinFirstRealSkuOperationalEvidence as join } from "../lib/catalog/first-real-sku-operational-join.ts";
import { mapFirstRealSkuMetadata as map } from "../scripts/first-real-sku-evidence-preflight.mjs";
import { OperationalSourceError } from "../lib/erp/product-operational.ts";
const id="a1234567-1234-4321-8123-123456789abc";
const m=(file=false)=>map({ownerSelected:true,hasCandidate:true,hasFile:file},file?{ok:true,drafts:1,code:"drafts_valid",notice:"Draft only; NOT LP approved / NOT publication ready"}:undefined);
const raw=(patch={})=>({public_id:id,retail_price_huf:1000,sellable_stock:7,operational_ready:true,...patch});
function safe(r){for(const key of ["readyForLivePublication","readyForCheckout","trustedForLiveUse"])assert.equal(r[key],false);assert.equal(r.releaseDecision,"BLOCKED");assert.equal(r.worklist.length,8);assert.equal(r.draftIdentityMatch,"NOT_EVALUATED");assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SECRET|a1234567|basePriceHuf|retail_price_huf|sellableStock|1000|signatureValue/);assert.ok(r.blockedReasons.includes("FRESHNESS_REPLAY_NOT_VERIFIED"));return r;}
async function call(payload,metadata=m(),lookup=id){let reads=0;const r=safe(await join(metadata,lookup,{async readProduct(){reads++;return payload;}}));assert.equal(reads,1);return r;}
test("no candidate avoids dependency and invalid UUID is never forwarded",async()=>{
 const missing=map({ownerSelected:false,hasCandidate:false,hasFile:false},undefined);
 const source={readProduct(){assert.fail("no read");}};assert.equal(safe(await join(missing,id,source)).candidateStatus,"NO_CANDIDATE_SELECTED");
 assert.ok(safe(await join(m(),"PRIVATE_SECRET",source)).blockedReasons.includes("INVALID_DECLARED_IDENTITY"));
});
test("declared and structural-only metadata retain trust boundaries and original eight tasks",async()=>{
 for(const file of [false,true]){const metadata=m(file),r=await call(raw(),metadata);assert.equal(r.intakeStatus,file?"STRUCTURAL_VALIDATION_ONLY":"INPUT_NOT_EVALUATED");assert.deepEqual(r.worklist,metadata.evidenceTasks);assert.equal(r.erpStatus,"LOGICAL_DISPLAY_SIGNAL_ONLY");assert.ok(r.blockedReasons.includes(file?"PRIVATE_STRUCTURE_ONLY":"PRIVATE_DRAFT_NOT_PROVIDED"));}
});
test("missing dependency and typed timeout vs safe unavailable; no retries",async()=>{
 assert.equal(safe(await join(m(),id)).erpStatus,"SOURCE_NOT_CONFIGURED");
 for(const [error,status] of [[new OperationalSourceError("timeout"),"READ_TIMEOUT"],[Error("PRIVATE_SECRET"),"READ_UNAVAILABLE"],[new OperationalSourceError("upstream_unavailable"),"READ_UNAVAILABLE"]]){let n=0;const r=safe(await join(m(),id,{async readProduct(){n++;throw error;}}));assert.equal(n,1);assert.equal(r.erpStatus,status);}
});
test("malformed required fields and nonfinite signals reject through existing reader",async()=>{
 for(const [key,values] of [["retail_price_huf",[undefined,"1",NaN,Infinity]],["sellable_stock",[undefined,"7",NaN,Infinity,-1]],["operational_ready",[undefined,"true",1]]])for(const value of values)assert.equal((await call(raw({[key]:value}))).erpStatus,"MALFORMED_RESPONSE");
 for(const value of [undefined,null,[],"PRIVATE_SECRET",{},raw({extra:"PRIVATE_SECRET"})])assert.equal((await call(value)).erpStatus,"MALFORMED_RESPONSE");
});
test("wrong UUID vs inherited case-insensitive match never grants authenticated identity",async()=>{
 assert.equal((await call(raw({public_id:"b1234567-1234-4321-8123-123456789abc"}))).erpStatus,"IDENTITY_MISMATCH");
 assert.equal((await call(raw({public_id:id.toUpperCase()}))).erpStatus,"LOGICAL_DISPLAY_SIGNAL_ONLY");
});
test("false, zero, positive and negative finite base signal remain diagnostic, no price policy replacement",async()=>{
 assert.ok((await call(raw({operational_ready:false}))).blockedReasons.includes("OPERATIONAL_NOT_READY"));assert.ok((await call(raw({sellable_stock:0}))).blockedReasons.includes("ZERO_SELLABLE_STOCK"));
 assert.ok((await call(raw())).blockedReasons.includes("POSITIVE_LOGICAL_SIGNAL_NOT_AUTHORIZATION"));assert.ok((await call(raw({retail_price_huf:-1}))).blockedReasons.includes("NEGATIVE_BASE_HUF_SIGNAL_REQUIRES_REVIEW"));
});
test("malformed metadata, authority claims, unknown fields and oversized text cause no reads",async()=>{
 for(const value of [null,[],"PRIVATE_SECRET",{...m(),readyForCheckout:true},{...m(),candidateStatus:"APPROVED"},{...m(),extra:"X".repeat(20000)}]){const r=safe(await join(value,id,{readProduct(){assert.fail("invalid metadata read");}}));assert.ok(r.blockedReasons.includes("INVALID_OR_UNAVAILABLE_INPUT"));}
});
test("getters/proxies never invoked and nested malicious payload sanitized",async()=>{
 const getter={...m()};Object.defineProperty(getter,"candidateStatus",{get(){assert.fail("getter");}});safe(await join(getter,id));
 safe(await join(new Proxy({}, {ownKeys(){assert.fail("proxy");}}),id));
 const p=raw();Object.defineProperty(p,"sellable_stock",{get(){assert.fail("payload getter");}});assert.equal((await call(p)).erpStatus,"MALFORMED_RESPONSE");
 assert.equal((await call(raw({sellable_stock:{secret:"PRIVATE_SECRET"}}))).erpStatus,"MALFORMED_RESPONSE");
});
test("frozen inputs deterministic/nonmutating and no global network",async t=>{
 const metadata=Object.freeze(m(true)),payload=Object.freeze(raw()),before=JSON.stringify(metadata),fetch=t.mock.method(globalThis,"fetch",()=>assert.fail("network"));
 assert.deepEqual(await call(payload,metadata),await call(payload,metadata));assert.equal(JSON.stringify(metadata),before);assert.equal(fetch.mock.callCount(),0);
});
test("server-only guard, empty catalogue, no new I/O/source route",()=>{
 const url=new URL("../lib/catalog/first-real-sku-operational-join.ts",import.meta.url),src=readFileSync(url,"utf8");assert.ok(src.startsWith('import "server-only";'));assert.doesNotMatch(src,/node:fs|\bfetch\s*\(|setTimeout|Date\.|process\.|createServer|runFirstRealSkuPreflight\(/);
 assert.match(readFileSync(new URL("../data/catalogue.ts",import.meta.url),"utf8"),/Object\.freeze\(\[\]\)/);
 const r=spawnSync(process.execPath,["--import","./tests/server-only-loader.mjs","--input-type=module","--eval",`await import(${JSON.stringify(url.href)})`],{encoding:"utf8",env:{...process.env,NODE_OPTIONS:""}});assert.ifError(r.error);assert.notEqual(r.status,0);assert.match(r.stderr,/cannot be imported from a Client Component module/);
});
