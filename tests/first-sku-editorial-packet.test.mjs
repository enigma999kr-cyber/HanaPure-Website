import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { generateEditorialPacket as generate, renderEditorialPacket as render, validateEditorialPacketDto as validate, verifyOwnedPacketDirectory as guard } from "../scripts/first-sku-editorial-packet.mjs";
import { reviewFirstSkuEditorialDraft as review } from "../lib/catalog/first-sku-editorial-review.ts";
import { syntheticEditorialTemplate as template } from "../scripts/first-sku-editorial-review.mjs";
const dto = mode => review(template(mode));
function safe(result) {
  assert.match(result.html, /SYNTHETIC \/ DEV EDITORIAL REVIEW ONLY \/ NOT AUTHORIZED FOR SALES/);
  for(const key of ["readyForLivePublication","readyForCheckout","trustedForLiveUse"]) { assert.equal(result.manifest[key],false); assert.match(result.html,new RegExp(key+"=false")); }
  assert.equal(result.manifest.browser,"NOT_EVALUATED");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|<script|<svg|onerror=|https?:\/\/|synthetic-review-only|Round Lab/);
  return result;
}
function rejected(d) { const r=safe(render(d)); assert.equal(r.manifest.status,"INVALID_INPUT"); assert.equal(r.manifest.rejected,true); return r; }

test("actual one/all generation uses #38 and writes three HTML+manifest pairs each",()=>{
 for(const mode of ["one","all"]) {
  const pack=generate(mode);assert.equal(pack.files.length,6);
  for(const file of pack.files) {
   const bytes=fs.readFileSync(file.path);assert.equal(bytes.length,file.bytes);assert.equal(createHash("sha256").update(bytes).digest("hex"),file.sha256);
   if(file.name.endsWith(".html")) assert.match(bytes.toString(),/NOT AUTHORIZED FOR SALES/);
   else { const manifest=JSON.parse(bytes); assert.equal(manifest.status,dto(mode).status);assert.equal(manifest.issueCount,mode==="one"?2:0);assert.equal(manifest.browser,"NOT_EVALUATED"); }
  }
 }
});
test("EN HU KO semantic headings print/keyboard structure and human gates",()=>{
 for(const [locale,title] of [["en","Editorial review packet"],["hu","Szerkesztői ellenőrzési csomag"],["ko","편집 검토 패킷"]]) {
  const r=safe(render(dto("all"),locale));assert.match(r.html,new RegExp('<html lang="'+locale+'">'));assert.match(r.html,new RegExp(title));
  assert.equal((r.html.match(/<h1>/g)||[]).length,1);assert.match(r.html,/@media print/);assert.match(r.html,/href="#source-issues"/);assert.match(r.html,/id="source-issues" tabindex="-1"/);
  assert.ok(r.html.includes('lang="'+locale+'"'));assert.match(r.html,/HUMAN_REVIEW_REQUIRED/);assert.match(r.html,/CLAIMS_LEGAL_INCI/);
 }
 assert.throws(()=>render(dto("all"),"fr"),/UNSUPPORTED_PACKET_LOCALE/);
});
test("source provenance counted once, original HU KO locales do not become action language",()=>{
 const r=safe(render(dto("one"),"ko"));assert.equal(r.manifest.issueCount,2);
 assert.deepEqual(r.manifest.issues.map(i=>[i.field,i.locale]),[["$.translations.hu","hu"],["$.translations.ko","ko"]]);
 const list=r.html.match(/<ol id="issue-list">([\s\S]*?)<\/ol>/)[1];assert.equal((list.match(/<li>/g)||[]).length,2);
 assert.match(r.html,/source locale=hu/);assert.match(r.html,/source locale=ko/);
 assert.equal((r.html.match(/<code>HUMAN_REVIEW_REQUIRED<\/code>/g)||[]).length,1);
});
test("complete review DTO remains review-only; genuine invalid source DTO displayed blocked",()=>{
 const complete=safe(render(dto("all")));assert.equal(complete.manifest.status,"READY_FOR_HUMAN_EDITORIAL_REVIEW");
 const invalid=safe(render(review(null)));assert.equal(invalid.manifest.status,"INVALID_INPUT");assert.equal(invalid.manifest.rejected,false);
 const pack=generate("invalid");for(const f of pack.files.filter(f=>f.name.endsWith("json")))assert.equal(JSON.parse(fs.readFileSync(f.path)).status,"INVALID_INPUT");
});
test("exact schema/version/authority missing and forged positive claims fail closed",()=>{
 const d=dto("all");
 for(const key of Object.keys(d)) { const copy=structuredClone(d);delete copy[key];rejected(copy); }
 for(const patch of [{version:"2"},{scope:"REAL"},{approved:true},{timestamp:"PRIVATE_SECRET"},{selectedPublicId:"PRIVATE_SECRET"},{status:"APPROVED"},{notEvaluated:[]},{comparisonScope:"PASS"}])rejected({...d,...patch});
 for(const key of ["readyForLivePublication","readyForCheckout","trustedForLiveUse"])rejected({...d,[key]:true});
});
test("duplicate/conflicting issues and forged locale all-pass/status cannot bypass consistency",()=>{
 const d=dto("one");
 const dup=structuredClone(d);dup.issues.push({...dup.issues[0]});rejected(dup);
 const shuffled=structuredClone(d);const i=d.issues[0];shuffled.issues.push({locale:i.locale,field:i.field,code:i.code});rejected(shuffled);
 rejected({...d,status:"READY_FOR_HUMAN_EDITORIAL_REVIEW"});rejected({...d,locales:{en:"COMPLETE_FOR_REVIEW",hu:"COMPLETE_FOR_REVIEW",ko:"COMPLETE_FOR_REVIEW"}});
 const tasks=structuredClone(d);tasks.editorTasks.ko[0].locale="ko";rejected(tasks);
 const reordered=structuredClone(d);reordered.editorTasks.en.reverse();rejected(reordered);
});
test("raw markup attributes unsafe paths unknown action text and excess input never echoed",()=>{
 const d=dto("one");
 for(const patch of [{field:'\"><svg onerror=PRIVATE_SECRET>'},{field:"$.translations.hu.images[999999].alt"},{locale:"fr"},{code:"UNKNOWN"}]) {const bad=structuredClone(d);Object.assign(bad.issues[0],patch);rejected(bad);}
 const action=structuredClone(d);action.editorTasks.en[0].action="PRIVATE_SECRET";rejected(action);
 const huge=structuredClone(d);huge.editorTasks.en[0].action="X".repeat(100000);rejected(huge);
 const unicode=structuredClone(d);unicode.editorTasks.en[0].action="\ud800";rejected(unicode);
 for(const value of [null,[],"PRIVATE_SECRET",7])rejected(value);
});
test("descriptor/accessor/proxy safety, immutable deterministic output, no global fetch",t=>{
 const d=dto("one"),before=JSON.stringify(d),fetch=t.mock.method(globalThis,"fetch",()=>assert.fail("network prohibited"));
 assert.deepEqual(render(d,"hu"),render(d,"hu"));assert.equal(JSON.stringify(d),before);assert.equal(fetch.mock.callCount(),0);
 const accessor={...d};Object.defineProperty(accessor,"version",{get(){assert.fail("getter invoked");}});rejected(accessor);
 rejected(new Proxy({}, {ownKeys(){assert.fail("Proxy trap invoked");}}));
});
test("fresh owned directory only, exclusive writes and symlink/identity guards",t=>{
 const a=generate("one"),b=generate("one");assert.notEqual(a.directory,b.directory);
 assert.throws(()=>fs.writeFileSync(a.files[0].path,"overwrite",{flag:"wx"}),/EEXIST/);
 const identity=fs.lstatSync(a.directory);guard(tmpdir(),a.directory,identity);
 assert.throws(()=>guard(tmpdir(),a.directory,{dev:identity.dev,ino:-1}),/UNSAFE_PACKET_DIRECTORY/);
 const stat=fs.lstatSync;t.mock.method(fs,"lstatSync",path=>String(path)===a.directory?{isDirectory:()=>true,isSymbolicLink:()=>true}:stat(path));
 assert.throws(()=>guard(tmpdir(),a.directory,identity),/UNSAFE_PACKET_DIRECTORY/);
});
test("real runtime server-only boundary and no public route/network/private input reader",()=>{
 const cli=new URL("../scripts/first-sku-editorial-packet.mjs",import.meta.url);
 const child=spawnSync(process.execPath,["--import",new URL("./server-only-loader.mjs",import.meta.url).href,"--input-type=module","--eval",`await import(${JSON.stringify(cli.href)})`],{encoding:"utf8",env:{...process.env,NODE_OPTIONS:""}});
 assert.ifError(child.error);assert.notEqual(child.status,0);assert.match(child.stderr,/cannot be imported from a Client Component module/);
 const source=fs.readFileSync(cli,"utf8");assert.doesNotMatch(source,/node:https?|node:child_process|\bfetch\s*\(|createServer|\.listen\(|readFile|localStorage|data\/catalogue/);
 assert.match(source,/flag:"wx"/);assert.match(source,/mkdtempSync/);
 assert.match(fs.readFileSync(new URL("../data/catalogue.ts",import.meta.url),"utf8"),/Object\.freeze\(\[\]\)/);
 const callers=spawnSync("git",["grep","-l","first-sku-editorial-packet","--","app","components","data"],{encoding:"utf8"});assert.ifError(callers.error);assert.equal(callers.status,1);
});
