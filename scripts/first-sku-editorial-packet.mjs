import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { createHash } from "node:crypto";
import { reviewFirstSkuEditorialDraft, EDITORIAL_SYNTHETIC_ID } from "../lib/catalog/first-sku-editorial-review.ts";
import { syntheticEditorialTemplate } from "./first-sku-editorial-review.mjs";

// Presentation-only copy pin: exact accepted #38 actions, no editorial policy.
const trustedActions = Object.freeze({
  HUMAN_REVIEW_REQUIRED: ["Review this locale, optional usage/caution and all unevaluated approvals manually; field completeness grants no publication authority.", "Ellenőrizze kézzel ezt a nyelvi változatot, az opcionális használati és figyelmeztető szöveget, valamint minden nem értékelt jóváhagyást; a mezők teljessége nem engedélyez közzétételt.", "이 언어의 내용, 선택적인 사용법·주의 문구와 미평가 승인을 수동 검토하세요. 필드 완성은 게시 권한을 부여하지 않습니다."],
  INVALID_INPUT: ["Correct the bounded synthetic draft structure.", "Javítsa a korlátozott szintetikus piszkozat szerkezetét.", "제한된 합성 초안의 구조를 수정하세요."],
  IDENTITY: ["Use the selected synthetic placeholder identity.", "Használja a kiválasztott szintetikus helyőrző azonosítót.", "선택한 합성 자리표시자 식별자를 사용하세요."],
  DRAFT_REQUIRED: ["Keep the candidate in draft state.", "Tartsa a jelöltet piszkozat állapotban.", "후보를 초안 상태로 유지하세요."],
  STRUCTURE: ["Correct the existing catalogue contract violation.", "Javítsa a meglévő katalógusszerződés megsértését.", "기존 카탈로그 구조 위반을 수정하세요."],
  COLLISION: ["Resolve the duplicate identity or slug within supplied comparisons.", "Oldja fel a megadott összehasonlítások azonosító- vagy slugütközését.", "제공된 비교 자료 안의 식별자 또는 슬러그 충돌을 해결하세요."],
  UNSAFE_TEXT: ["Remove markup or unsafe control content; submit plain editorial text.", "Távolítsa el a jelölőkódot és a nem biztonságos vezérlőjeleket; adjon meg egyszerű szöveget.", "마크업과 안전하지 않은 제어 문자를 제거하고 일반 편집 텍스트를 입력하세요."],
  LOCALE_MISSING: ["Supply this locale explicitly; do not silently fall back.", "Adja meg ezt a nyelvi változatot; ne használjon csendes helyettesítést.", "이 언어의 내용을 명시적으로 제공하세요. 다른 언어로 조용히 대체하지 마세요."],
  NAME_MISSING: ["Supply a nonblank title for editorial review.", "Adjon meg nem üres címet a szerkesztői ellenőrzéshez.", "편집 검토를 위한 비어 있지 않은 제목을 입력하세요."],
  DESCRIPTION_MISSING: ["Supply a nonblank description for editorial review.", "Adjon meg nem üres leírást a szerkesztői ellenőrzéshez.", "편집 검토를 위한 비어 있지 않은 설명을 입력하세요."],
  ALT_MISSING: ["Describe the supplied image for manual accessibility review.", "Írja le a megadott képet a kézi akadálymentességi ellenőrzéshez.", "수동 접근성 검토를 위해 제공된 이미지의 대체 설명을 입력하세요."],
  POSSIBLE_LOCALE_REUSE: ["Review identical cross-locale text; language correctness is not machine verified.", "Ellenőrizze az azonos, több nyelvnél szereplő szöveget; a nyelvi helyességet a gép nem igazolta.", "언어 간 동일한 텍스트를 검토하세요. 언어 적합성은 자동 검증되지 않았습니다."],
});
const locales = ["en", "hu", "ko"];
const gates = ["REAL_PRODUCT_IDENTITY", "LANGUAGE_CORRECTNESS", "CONTENT_APPROVAL", "CLAIMS_LEGAL_INCI", "PHOTO_RIGHTS", "SEO_SIGNOFF", "ACCESSIBILITY_MANUAL", "HUMAN_EDITORIAL_SIGNOFF", "ERP_AUTHENTICITY", "ERP_FRESHNESS", "STOCK", "PRICING_VAT", "COMMERCE_CHECKOUT"];
const gateLabels = {
 en: ["Real product identity", "Translation quality", "Content accuracy/approval", "Claims, legal and INCI review", "Image licensing", "SEO signoff", "Manual accessibility review", "Human editorial signoff", "ERP source authenticity", "ERP evidence freshness", "Stock evidence", "Price and VAT", "Checkout/commerce authorization"],
 hu: ["Valós termékazonosság", "Fordítás minősége", "Tartalom pontossága/jóváhagyása", "Állítások, jogi és INCI-ellenőrzés", "Képlicenc", "SEO-jóváhagyás", "Kézi akadálymentességi ellenőrzés", "Emberi szerkesztői jóváhagyás", "ERP-forrás hitelessége", "ERP-bizonyíték frissessége", "Készletbizonyíték", "Ár és áfa", "Fizetési/kereskedelmi jogosultság"],
 ko: ["실제 상품 식별", "번역 품질", "내용 정확성·승인", "표현·법률·INCI 검토", "이미지 사용권", "SEO 승인", "수동 접근성 검토", "사람의 편집 승인", "ERP 출처 진위", "ERP 증거 최신성", "재고 증거", "가격·VAT", "체크아웃·상거래 권한"],
};
const labels = {
 en: { title:"Editorial review packet", summary:"Review summary", completeness:"Locale completeness", issues:"Source issues — shown once", tasks:"Localized action view", provenance:"Original issue locale", field:"Source field", pending:"NOT EVALUATED review gates", human:"Owner/human editorial review still required. Field completeness is not approval.", skip:"Skip to source issues", optional:"Usage / caution presence", collision:"Collision review scope", blocked:"Unsupported evidence was blocked; no source text is displayed." },
 hu: { title:"Szerkesztői ellenőrzési csomag", summary:"Ellenőrzési összefoglaló", completeness:"Nyelvi teljesség", issues:"Forráshibák — egyszer megjelenítve", tasks:"Honosított teendőnézet", provenance:"Az eredeti hiba nyelve", field:"Forrásmező", pending:"NEM ÉRTÉKELT ellenőrzési kapuk", human:"Tulajdonosi/emberi szerkesztői ellenőrzés továbbra is szükséges. A mezők teljessége nem jóváhagyás.", skip:"Ugrás a forráshibákhoz", optional:"Használati / figyelmeztető szöveg jelenléte", collision:"Ütközésvizsgálat hatóköre", blocked:"A nem támogatott bizonyíték blokkolva; a forrásszöveg nem jelenik meg." },
 ko: { title:"편집 검토 패킷", summary:"검토 요약", completeness:"언어별 완성도", issues:"원본 issue — 한 번만 표시", tasks:"표시 언어별 조치 보기", provenance:"원본 issue의 대상 언어", field:"원본 필드", pending:"미평가 검토 항목", human:"Owner/사람의 편집 검토가 여전히 필요합니다. 필드 완성은 승인이 아닙니다.", skip:"원본 issue로 이동", optional:"사용법 / 주의 문구 존재 여부", collision:"충돌 검토 범위", blocked:"지원하지 않는 증거를 차단했습니다. 원문 내용은 표시하지 않습니다." },
};
const escape = v => String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function exact(v, keys) {
 return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k));
}
function data(v, b={nodes:0,chars:0}, depth=0) {
 if(++b.nodes>6000 || depth>8) throw Error();
 if(v===null || typeof v==="boolean") return v;
 if(typeof v==="string") { b.chars+=v.length; if(v.length>800 || b.chars>64000 || /[\uD800-\uDFFF]/u.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g,""))) throw Error(); return v; }
 if(!v || typeof v!=="object" || types.isProxy(v)) throw Error();
 if(Array.isArray(v)) {
  if(v.length>65 || Reflect.ownKeys(v).length!==v.length+1) throw Error();
  return Array.from({length:v.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!("value" in d))throw Error();return data(d.value,b,depth+1);});
 }
 if(![Object.prototype,null].includes(Object.getPrototypeOf(v))) throw Error();
 const out=Object.create(null), keys=Reflect.ownKeys(v); if(keys.length>20)throw Error();
 for(const k of keys) { if(typeof k!=="string"||k.length>64||k==="__proto__")throw Error(); const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!("value" in d))throw Error();out[k]=data(d.value,b,depth+1); }
 return out;
}
function sourceIssue(i) {
 if(!exact(i,["code","field","locale"]) || !Object.hasOwn(trustedActions,i.code) || i.code==="HUMAN_REVIEW_REQUIRED")return false;
 if(i.locale===null) return (["INVALID_INPUT","STRUCTURE","COLLISION"].includes(i.code)&&i.field==="$") ||
  (i.code==="IDENTITY"&&i.field==="$.publicId") || (i.code==="DRAFT_REQUIRED"&&i.field==="$.state") ||
  (["UNSAFE_TEXT","STRUCTURE"].includes(i.code)&&i.field==="$.comparisons");
 if(!locales.includes(i.locale))return false;
 const base="$.translations."+i.locale, suffix=i.field.startsWith(base)?i.field.slice(base.length):"!";
 if(["LOCALE_MISSING","POSSIBLE_LOCALE_REUSE"].includes(i.code))return suffix==="";
 if(i.code==="NAME_MISSING")return suffix===".name";
 if(i.code==="DESCRIPTION_MISSING")return suffix===".description";
 if(i.code==="ALT_MISSING")return /^\.images\[[0-9]\]\.alt$/.test(suffix);
 if(i.code==="STRUCTURE")return suffix===".images";
 return i.code==="UNSAFE_TEXT" && (/^\.(?:name|description|usage|caution)$/.test(suffix)||/^\.images\[(?:[0-9]|1[0-9])\]$/.test(suffix));
}
export function validateEditorialPacketDto(input) {
 const d=data(input), keys=["version","scope","status","locales","optionalContent","issues","editorTasks","comparisonScope","outsideSuppliedCollisionCheck","notEvaluated","readyForLivePublication","readyForCheckout","trustedForLiveUse"];
 if(d && Object.hasOwn(d,"selectedPublicId"))keys.push("selectedPublicId");
 if(!exact(d,keys)||d.version!=="1"||d.scope!=="SYNTHETIC_ONLY"||!["INVALID_INPUT","DRAFT_INCOMPLETE","READY_FOR_HUMAN_EDITORIAL_REVIEW"].includes(d.status))throw Error("INVALID_REVIEW_DTO");
 for(const k of ["readyForLivePublication","readyForCheckout","trustedForLiveUse"])if(d[k]!==false)throw Error("INVALID_REVIEW_DTO");
 if(!same(d.notEvaluated,gates)||d.outsideSuppliedCollisionCheck!=="NOT_EVALUATED"||!["NOT_EVALUATED","LOCAL_SUPPLIED_ONLY"].includes(d.comparisonScope))throw Error("INVALID_REVIEW_DTO");
 if(!exact(d.locales,locales)||!exact(d.optionalContent,locales)||!exact(d.editorTasks,locales)||!Array.isArray(d.issues)||d.issues.length>64)throw Error("INVALID_REVIEW_DTO");
 if(d.issues.some(i=>!sourceIssue(i)) || new Set(d.issues.map(i=>[i.code,i.field,i.locale].join("|"))).size!==d.issues.length)throw Error("INVALID_REVIEW_DTO");
 if(d.status==="INVALID_INPUT") { if(Object.hasOwn(d,"selectedPublicId")||!d.issues.length)throw Error("INVALID_REVIEW_DTO"); }
 else if(d.selectedPublicId!==EDITORIAL_SYNTHETIC_ID)throw Error("INVALID_REVIEW_DTO");
 for(const [index,locale] of locales.entries()) {
  const state=d.locales[locale], optional=d.optionalContent[locale], tasks=d.editorTasks[locale];
  if(!["NOT_EVALUATED","MISSING","INCOMPLETE","COMPLETE_FOR_REVIEW"].includes(state)||!exact(optional,["usage","caution"])||!Object.values(optional).every(v=>["SUPPLIED","NOT_SUPPLIED","NOT_EVALUATED"].includes(v)))throw Error("INVALID_REVIEW_DTO");
  if(["MISSING","NOT_EVALUATED"].includes(state)&&Object.values(optional).some(v=>v!=="NOT_EVALUATED"))throw Error("INVALID_REVIEW_DTO");
  if(["INCOMPLETE","COMPLETE_FOR_REVIEW"].includes(state)&&Object.values(optional).includes("NOT_EVALUATED"))throw Error("INVALID_REVIEW_DTO");
  if(d.status==="INVALID_INPUT"&&state!=="NOT_EVALUATED")throw Error("INVALID_REVIEW_DTO");
  if(d.status!=="INVALID_INPUT") {
   const local=d.issues.filter(i=>i.locale===locale);
   if(state==="MISSING"&&!local.some(i=>i.code==="LOCALE_MISSING"))throw Error("INVALID_REVIEW_DTO");
   if(state==="INCOMPLETE"&&!local.length)throw Error("INVALID_REVIEW_DTO");
   if(state==="COMPLETE_FOR_REVIEW"&&local.length)throw Error("INVALID_REVIEW_DTO");
   if(state==="NOT_EVALUATED"||d.issues.some(i=>i.locale===null))throw Error("INVALID_REVIEW_DTO");
  }
  if(!Array.isArray(tasks)||tasks.length!==d.issues.length+1)throw Error("INVALID_REVIEW_DTO");
  for(let j=0;j<tasks.length;j++) {
   const task=tasks[j], issue=j<d.issues.length?d.issues[j]:{code:"HUMAN_REVIEW_REQUIRED",field:"$.translations."+locale,locale};
   if(!exact(task,["code","field","locale","action"])||task.code!==issue.code||task.field!==issue.field||task.locale!==issue.locale||task.action!==trustedActions[issue.code][index])throw Error("INVALID_REVIEW_DTO");
  }
 }
 if(d.status==="READY_FOR_HUMAN_EDITORIAL_REVIEW"&&(d.issues.length||Object.values(d.locales).some(v=>v!=="COMPLETE_FOR_REVIEW")))throw Error("INVALID_REVIEW_DTO");
 if(d.status==="DRAFT_INCOMPLETE"&&(!d.issues.length||Object.values(d.locales).every(v=>v==="COMPLETE_FOR_REVIEW")))throw Error("INVALID_REVIEW_DTO");
 return d;
}
export function renderEditorialPacket(input, locale="en") {
 if(!locales.includes(locale))throw Error("UNSUPPORTED_PACKET_LOCALE");
 let d, rejected=false;
 try { d=validateEditorialPacketDto(input); } catch { d=reviewFirstSkuEditorialDraft(null); rejected=true; }
 const l=labels[locale];
 const html=`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(l.title)}</title>
<style>body{font:17px/1.6 system-ui,sans-serif;color:#24211d;background:#faf8f3;margin:0}main{max-width:980px;margin:auto;padding:2rem}h1,h2{line-height:1.3}.banner{border:3px solid #40382d;background:#ece2d3;padding:1rem;font-weight:700}code{overflow-wrap:anywhere}li,dd{margin-bottom:1rem}dt{font-weight:700}a{color:#35270f}a:focus-visible{outline:3px solid #76551a}@media print{body{background:white;color:black}main{padding:0}.skip{display:none}.banner{border:3px solid black}li{break-inside:avoid}}</style></head>
<body><main><a class="skip" href="#source-issues">${escape(l.skip)}</a><h1>${escape(l.title)}</h1>
<p class="banner">SYNTHETIC / DEV EDITORIAL REVIEW ONLY / NOT AUTHORIZED FOR SALES</p>
<p>readyForLivePublication=false / readyForCheckout=false / trustedForLiveUse=false</p><p>${escape(l.human)}</p>
<h2>${escape(l.summary)}</h2><p data-status>${escape(d.status)}</p><p>version=${escape(d.version)} / SYNTHETIC_ONLY</p>${rejected?`<p>${escape(l.blocked)}</p>`:""}
<h2>${escape(l.completeness)}</h2><dl>${locales.map(lc=>`<dt>${lc}</dt><dd>${escape(d.locales[lc])}; ${escape(l.optional)}: usage=${escape(d.optionalContent[lc].usage)}, caution=${escape(d.optionalContent[lc].caution)}</dd>`).join("")}</dl>
<p>${escape(l.collision)}: ${escape(d.comparisonScope)} / outsideSuppliedCollisionCheck=NOT_EVALUATED</p>
<h2 id="source-issues" tabindex="-1">${escape(l.issues)}</h2><ol id="issue-list">${d.issues.map(i=>`<li><code>${escape(i.code)}</code> · ${escape(l.field)}: <code>${escape(i.field)}</code> · ${escape(l.provenance)}: ${escape(i.locale??"GLOBAL")}</li>`).join("")}</ol>
<h2>${escape(l.tasks)} — ${locale}</h2><p>${escape(l.provenance)} ≠ display language / megjelenítési nyelv / 표시 언어</p><ol id="action-list">${d.editorTasks[locale].map(t=>`<li><code>${escape(t.code)}</code> · <code>${escape(t.field)}</code> · source locale=${escape(t.locale??"GLOBAL")}<p lang="${locale}">${escape(t.action)}</p></li>`).join("")}</ol>
<h2>${escape(l.pending)}</h2><ul>${gates.map((g,i)=>`<li>${escape(gateLabels[locale][i])} — <code>${g}</code>: NOT_EVALUATED</li>`).join("")}</ul><footer>${escape(l.human)} — NOT AUTHORIZED FOR SALES</footer></main></body></html>`;
 const manifest={case:"review",banner:"SYNTHETIC / DEV EDITORIAL REVIEW ONLY / NOT AUTHORIZED FOR SALES",version:d.version,scope:d.scope,status:d.status,displayLocale:locale,locales:d.locales,issueCount:d.issues.length,issues:d.issues,comparisonScope:d.comparisonScope,outsideSuppliedCollisionCheck:d.outsideSuppliedCollisionCheck,notEvaluated:d.notEvaluated,browser:"NOT_EVALUATED",readyForLivePublication:false,readyForCheckout:false,trustedForLiveUse:false,rejected};
 return {html,manifest};
}
const canonical = p=>process.platform==="win32"?resolve(p).toLowerCase():resolve(p);
function noReparse(path) {
 let current=resolve(path);
 while(true) {
  const s=fs.lstatSync(current);
  if(!s.isDirectory()||s.isSymbolicLink()||canonical(fs.realpathSync(current))!==canonical(current))throw Error("UNSAFE_PACKET_DIRECTORY");
  const parent=dirname(current);if(parent===current)break;current=parent;
 }
}
export function verifyOwnedPacketDirectory(root,directory,identity) {
 noReparse(root);noReparse(directory);
 const s=fs.lstatSync(directory);
 if(canonical(dirname(directory))!==canonical(root)||!s.isDirectory()||s.dev!==identity.dev||s.ino!==identity.ino)throw Error("UNSAFE_PACKET_DIRECTORY");
}
export function generateEditorialPacket(sample) {
 if(!["one","all","invalid"].includes(sample))throw Error("UNSUPPORTED_PACKET_SAMPLE");
 // Only built-in synthetic #38 entrypoint; no file/JSON/private input adapter.
 const dto=reviewFirstSkuEditorialDraft(sample==="invalid"?null:syntheticEditorialTemplate(sample));
 const rendered=locales.map(locale=>({locale,...renderEditorialPacket(dto,locale)}));
 const root=tmpdir(); noReparse(root);
 const directory=fs.mkdtempSync(join(root,"hanapure-web39-")), identity=fs.lstatSync(directory);
 const files=[];
 for(const packet of rendered) {
  const name=sample+"-"+packet.locale+".html";
  const manifest={...packet.manifest,case:sample,html:{name,sha256:createHash("sha256").update(packet.html).digest("hex")}};
  for(const [basename,bytes] of [[name,packet.html],[sample+"-"+packet.locale+".manifest.json",JSON.stringify(manifest,null,2)+"\n"]]) {
   verifyOwnedPacketDirectory(root,directory,identity);
   const path=join(directory,basename);fs.writeFileSync(path,bytes,{encoding:"utf8",flag:"wx",mode:0o600});
   files.push({name:basename,path,bytes:Buffer.byteLength(bytes),sha256:createHash("sha256").update(bytes).digest("hex")});
  }
 }
 return {directory,sample,files,browser:"NOT_EVALUATED",readyForLivePublication:false,readyForCheckout:false,trustedForLiveUse:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {
  if(process.argv.length!==4||process.argv[2]!=="--sample"||process.env.NODE_ENV==="production"||["VERCEL","NETLIFY","CF_PAGES","DEPLOYMENT_ENV"].some(k=>process.env[k]!==undefined))throw Error();
  console.log(JSON.stringify(generateEditorialPacket(process.argv[3]),null,2));
 } catch { console.log(JSON.stringify({error:"PACKET_GENERATION_BLOCKED",readyForLivePublication:false,readyForCheckout:false,trustedForLiveUse:false}));process.exitCode=1; }
}
