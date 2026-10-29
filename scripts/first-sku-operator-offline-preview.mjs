import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { composeFirstSkuEvidenceChain } from "../lib/storefront/first-sku-evidence-chain.ts";
import { projectFirstSkuPublicationTruth } from "../lib/storefront/first-sku-publication-truth.ts";
import { readEffectiveOperationalState } from "../lib/erp/effective-operational-state.ts";
import { OperationalSourceError } from "../lib/erp/product-operational.ts";

// Presentation copy mirrors the accepted #36 actions, never caller HTML.
const actions = Object.freeze({
  INVALID_SELECTION: "Select a canonical identity and supported locale on the server.",
  PUBLICATION_MISSING: "Obtain approved real editorial content; keep public catalogue empty until authorized.",
  PROJECTION_INVALID: "Supply a matching unmodified publication diagnostic.",
  IDENTITY_MISMATCH: "Reconcile exact selected identities before further evaluation.",
  LOCALE_MISSING: "Obtain approved content for the selected locale.",
  WIRE_INVALID: "Reconcile the internal version and payload contract offline.",
  CONTRACT_ABSENCE_ONLY: "Verify real source identity before interpreting absence.",
  UPSTREAM_UNAVAILABLE: "Obtain bounded source and override evidence under separate authority.",
  EVIDENCE_CONFLICT: "Reconcile independent snapshots; do not prefer favorable facts.",
  ZERO_STOCK: "Retain the supplied zero-stock fact; do not infer reservations.",
  NOT_READY: "Retain ERP readiness=false; do not replace ERP policy.",
  MANUAL_INTENT_ONLY: "Review manual provenance; intent cannot grant commerce authority.",
  OPERATIONAL_BLOCKER: "Resolve the existing publication projector's operational blocker.",
  AUTHENTICITY_UNVERIFIED: "Obtain independently verified issuer and source evidence.",
  TRANSPORT_UNVERIFIED: "Obtain authorized gateway peer, TLS and authentication evidence.",
  FRESHNESS_UNVERIFIED: "Establish an attested observation clock and expiry contract.",
  COMMERCE_NOT_EVALUATED: "Obtain separate real-SKU, price/VAT, checkout and fulfillment decisions.",
});
const labels = Object.freeze({
  en: { title: "First-SKU operator review", summary: "Diagnostic summary", facts: "Observed synthetic facts", unknown: "Unknown / unavailable",
    projection: "Publication diagnostic", wire: "Wire diagnostic", stock: "Stock", ready: "Operational readiness", actions: "Blockers and next actions",
    limits: "Unverified boundaries", fallback: "Action descriptions and machine evidence codes below use the original English wording. Future authority is described only where specified by the existing diagnostic.",
    denied: "Publication, checkout and trusted live use: false. Separate evidence and authorization remain required.", invalid: "Blocked: invalid or unsupported evidence.", skip: "Skip to blockers" },
  hu: { title: "Első SKU – üzemeltetői áttekintés", summary: "Diagnosztikai összefoglaló", facts: "Megfigyelt szintetikus adatok", unknown: "Ismeretlen / nem elérhető",
    projection: "Közzétételi diagnosztika", wire: "Adatszerkezeti diagnosztika", stock: "Készlet", ready: "Operatív készenlét", actions: "Blokkoló okok és következő lépések",
    limits: "Nem ellenőrzött határok", fallback: "Az alábbi teendők és gépi bizonyítékkódok az eredeti angol szöveget használják. A jövőbeli jogosultság csak a meglévő diagnosztika szerint szerepel.",
    denied: "Közzététel, fizetés és megbízható éles használat: false. Külön bizonyíték és engedély szükséges.", invalid: "Blokkolva: érvénytelen vagy nem támogatott bizonyíték.", skip: "Ugrás a blokkoló okokhoz" },
  ko: { title: "첫 SKU 운영자 검토", summary: "진단 요약", facts: "관찰된 합성 정보", unknown: "알 수 없음 / 확인 불가",
    projection: "게시 진단", wire: "데이터 구조 진단", stock: "재고", ready: "운영 준비 여부", actions: "차단 사유 및 다음 조치",
    limits: "검증되지 않은 경계", fallback: "아래 조치 설명과 기계 판독 증거 코드는 영어 원문을 사용합니다. 후속 권한은 기존 진단이 명시한 범위에서만 표시합니다.",
    denied: "게시·체크아웃·신뢰된 실운영 사용: false. 별도의 증거와 승인이 필요합니다.", invalid: "차단됨: 유효하지 않거나 지원하지 않는 증거입니다.", skip: "차단 사유로 이동" },
});
export const SYNTHETIC_ID = "a1234567-1234-4321-8123-123456789abc";
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// Bounded descriptor-only data copy. No getters/toJSON; Proxy traps remain executable JS.
function plain(value, budget = { count: 0 }, depth = 0) {
  if (++budget.count > 300 || depth > 5) throw Error();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string" && value.length <= 300) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") throw Error();
  if (Array.isArray(value)) {
    if (value.length > 17 || Reflect.ownKeys(value).length !== value.length + 1) throw Error();
    return Array.from({ length: value.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !("value" in d)) throw Error();
      return plain(d.value, budget, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error();
  const out = Object.create(null), keys = Reflect.ownKeys(value);
  if (keys.length > 20) throw Error();
  for (const key of keys) {
    if (typeof key !== "string" || key === "__proto__") throw Error();
    const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !("value" in d)) throw Error();
    out[key] = plain(d.value, budget, depth + 1);
  }
  return out;
}
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validFacts(value) {
  return value === null || (exact(value, ["sellableStock", "operationalReady"]) &&
    typeof value.operationalReady === "boolean" && typeof value.sellableStock === "number" &&
    Number.isFinite(value.sellableStock) && value.sellableStock >= 0);
}
function validate(input, selectedPublicId) {
  const d = plain(input);
  const keys = ["classification", "publication", "wire", "projectionFacts", "wireFacts", "authenticity", "transportAttestation", "freshness", "expiry", "vatCheckout", "fulfillment", "readyForLivePublication", "readyForCheckout", "trustedForLiveUse", "blockers"];
  if (Object.hasOwn(d, "publicId")) keys.push("publicId");
  if (!exact(d, keys) || !["STRUCTURAL_OK", "CONTRACT_ABSENCE_ONLY", "UPSTREAM_UNAVAILABLE", "INVALID_OR_UNKNOWN"].includes(d.classification) ||
    !["LOCAL_SYNTHETIC", "MISSING", "UNAVAILABLE"].includes(d.publication) || !["LOCAL_SYNTHETIC", "UNAVAILABLE"].includes(d.wire) ||
    !validFacts(d.projectionFacts) || !validFacts(d.wireFacts)) throw Error();
  for (const key of ["readyForLivePublication", "readyForCheckout", "trustedForLiveUse"]) if (d[key] !== false) throw Error();
  for (const key of ["authenticity", "transportAttestation", "freshness"]) if (d[key] !== "UNVERIFIED") throw Error();
  for (const key of ["expiry", "vatCheckout", "fulfillment"]) if (d[key] !== "NOT_EVALUATED") throw Error();
  if (Object.hasOwn(d, "publicId") && (!uuid(selectedPublicId) || d.publicId !== selectedPublicId || d.publication !== "LOCAL_SYNTHETIC" || d.classification === "INVALID_OR_UNKNOWN")) throw Error();
  if (!Array.isArray(d.blockers) || d.blockers.length < 4 || d.blockers.length > 17) throw Error();
  const order = Object.keys(actions), codes = d.blockers.map(b => {
    if (!exact(b, ["code", "action"]) || !Object.hasOwn(actions, b.code) || b.action !== actions[b.code]) throw Error();
    return b.code;
  });
  if (new Set(codes).size !== codes.length || codes.some((c, i) => i > 0 && order.indexOf(c) <= order.indexOf(codes[i - 1]))) throw Error();
  for (const c of ["AUTHENTICITY_UNVERIFIED", "TRANSPORT_UNVERIFIED", "FRESHNESS_UNVERIFIED", "COMMERCE_NOT_EVALUATED"]) if (!codes.includes(c)) throw Error();
  if (d.classification === "STRUCTURAL_OK" && (d.wire !== "LOCAL_SYNTHETIC" || d.wireFacts === null || codes.some(c => ["WIRE_INVALID", "IDENTITY_MISMATCH", "PROJECTION_INVALID", "EVIDENCE_CONFLICT"].includes(c)))) throw Error();
  if (d.classification === "CONTRACT_ABSENCE_ONLY" && (d.wire !== "LOCAL_SYNTHETIC" || d.wireFacts !== null || !codes.includes("CONTRACT_ABSENCE_ONLY"))) throw Error();
  if (d.classification === "UPSTREAM_UNAVAILABLE" && (d.wire !== "UNAVAILABLE" || d.wireFacts !== null || !codes.includes("UPSTREAM_UNAVAILABLE"))) throw Error();
  if (d.publication !== "LOCAL_SYNTHETIC" && d.projectionFacts !== null) throw Error();
  if (d.publication === "MISSING" && !codes.includes("PUBLICATION_MISSING")) throw Error();
  for (const f of [d.projectionFacts, d.wireFacts]) {
    if (f?.sellableStock === 0 && !codes.includes("ZERO_STOCK")) throw Error();
    if (f?.operationalReady === false && !codes.includes("NOT_READY")) throw Error();
  }
  if (d.projectionFacts && d.wireFacts && (d.projectionFacts.sellableStock !== d.wireFacts.sellableStock || d.projectionFacts.operationalReady !== d.wireFacts.operationalReady) &&
    (d.classification !== "INVALID_OR_UNKNOWN" || !codes.includes("EVIDENCE_CONFLICT"))) throw Error();
  return d;
}

export function renderOperatorPreview(input, { locale = "en", selectedPublicId } = {}) {
  if (!Object.hasOwn(labels, locale)) throw new Error("UNSUPPORTED_PREVIEW_LOCALE");
  const l = labels[locale]; let d;
  try { d = validate(input, selectedPublicId); } catch { d = null; }
  const fact = f => f === null ? escape(l.unknown) : `${escape(l.stock)}: ${escape(f.sellableStock)}; ${escape(l.ready)}: ${escape(f.operationalReady)}`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(l.title)}</title><style>body{font:17px/1.6 system-ui,sans-serif;background:#faf8f4;color:#23211e;margin:0}main{max-width:960px;margin:auto;padding:2rem}h1,h2{line-height:1.25}.banner{border:3px solid #40372b;padding:1rem;background:#eee4d5;font-weight:bold}section{margin:2rem 0}li{margin:1rem 0}code{overflow-wrap:anywhere}a{color:#30230f}a:focus-visible{outline:3px solid #775916}dt{font-weight:bold}dd{margin:0 0 1rem} @media print{body{background:white;color:black}main{padding:0;max-width:none}.skip{display:none}li{break-inside:avoid}.banner{border:3px solid black}}</style></head>
<body><main><a class="skip" href="#blockers">${escape(l.skip)}</a><h1>${escape(l.title)}</h1>
<p class="banner" role="note">SYNTHETIC / DEV REVIEW ONLY / NOT AUTHORIZED FOR SALES</p><p>${escape(l.denied)}</p>
<section aria-labelledby="summary"><h2 id="summary">${escape(l.summary)}</h2><p data-classification>${d ? escape(d.classification) : "INVALID_OR_UNKNOWN"}</p>
${d?.publicId ? `<p><code>${escape(d.publicId)}</code></p>` : ""}${!d ? `<p>${escape(l.invalid)}</p>` : ""}</section>
<section><h2>${escape(l.facts)}</h2><dl><dt>${escape(l.projection)}</dt><dd>${d ? escape(d.publication) : escape(l.unknown)} — ${d ? fact(d.projectionFacts) : escape(l.unknown)}</dd><dt>${escape(l.wire)}</dt><dd>${d ? escape(d.wire) : escape(l.unknown)} — ${d ? fact(d.wireFacts) : escape(l.unknown)}</dd></dl></section>
<section><h2>${escape(l.limits)}</h2><p>authenticity / transportAttestation / freshness: UNVERIFIED</p><p>expiry / vatCheckout / fulfillment: NOT_EVALUATED</p></section>
<section><h2 id="blockers" tabindex="-1">${escape(l.actions)}</h2><p>${escape(l.fallback)}</p><ol>${d ? d.blockers.map(b => `<li><code>${escape(b.code)}</code><p lang="en">${escape(actions[b.code])}</p>${b.code === "CONTRACT_ABSENCE_ONLY" ? '<p lang="en">Contract shape only; not proof of real ERP absence.</p>' : ""}</li>`).join("") : `<li>${escape(l.invalid)}</li>`}</ol></section>
<footer>${escape(l.denied)}</footer></main></body></html>`;
}

/** In-memory fixtures only; existing projection and composition own decisions. */
export async function syntheticDecision(scenario, locale = "en") {
  if (!Object.hasOwn(labels, locale) || !["blocked", "structure", "unavailable"].includes(scenario)) throw Error("INVALID_SYNTHETIC_SELECTION");
  const id = SYNTHETIC_ID;
  const product = { public_id: id, retail_price_huf: 1000, sellable_stock: 7, operational_ready: true };
  const content = { name: "SYNTHETIC PRIVATE", description: "In-memory only", images: [], usage: null, caution: null };
  const editorial = { publicId: id, brand: "Round Lab", slug: "synthetic-only", state: "published", translations: { en: content, hu: content, ko: content } };
  const effective = await readEffectiveOperationalState(id, {
    erpSource: { async readProduct() { if (scenario === "unavailable") throw new OperationalSourceError("upstream_unavailable"); return product; } },
    overrideStore: { async getCurrent() { return { record: null, revision: null }; } },
  }, { now: "2026-10-29T00:00:00Z" });
  const projection = projectFirstSkuPublicationTruth(id, scenario === "blocked" ? null : editorial, locale, effective);
  return composeFirstSkuEvidenceChain(id, locale, projection, scenario === "unavailable" ? 503 : 200,
    scenario === "blocked" ? null : scenario === "unavailable" ? { version: "1", error: { code: "temporarily_busy" }, public_id: id } : { version: "1", product });
}

export async function generateOperatorPreviews(locale = "en") {
  if (!Object.hasOwn(labels, locale)) throw Error("UNSUPPORTED_PREVIEW_LOCALE");
  const cases = [];
  for (const scenario of ["blocked", "structure", "unavailable"]) {
    const decision = await syntheticDecision(scenario, locale);
    cases.push({ scenario, classification: decision.classification, html: renderOperatorPreview(decision, { locale, selectedPublicId: SYNTHETIC_ID }) });
  }
  const directory = await mkdtemp(join(tmpdir(), "hanapure-web37-"));
  const files = [];
  for (const c of cases) {
    const path = join(directory, `${c.scenario}-${locale}.html`);
    await writeFile(path, c.html, { encoding: "utf8", flag: "wx", mode: 0o600 });
    files.push({ scenario: c.scenario, classification: c.classification, path });
  }
  const manifest = { scope: "LOCAL_SYNTHETIC", locale, readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false,
    browser: "NOT_EVALUATED", limitations: "Offline review only; no actual ERP, trust, freshness or commerce authority.", files };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { directory, ...manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1) throw Error("USE_ONE_LOCALE_ONLY");
  console.log(JSON.stringify(await generateOperatorPreviews(args[0] ?? "en"), null, 2));
}
