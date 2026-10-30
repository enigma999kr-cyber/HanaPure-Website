import "server-only";
import { types } from "node:util";
import { diagnoseDraft } from "../../scripts/private-draft-intake.mjs";
import { isPublicId, normalizeOperationalProduct } from "../erp/product-operational";

type Data = null | string | number | boolean | Data[] | { [key: string]: Data };
type Outcome = "NO_DRAFT_OR_CANDIDATE" | "MULTIPLE_DRAFTS_AMBIGUOUS" | "DRAFT_STRUCTURE_INVALID" | "DECLARED_IDENTITY_MISMATCH" | "DECLARED_IDENTITY_MATCH_ONLY" | "ERP_LOGICAL_ID_UNAVAILABLE" | "INVALID_OR_UNTRUSTED_INPUT";
function snapshot(value: unknown, b = { nodes: 0, chars: 0 }, depth = 0): Data {
  if (++b.nodes > 1500 || depth > 8) throw Error();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { b.chars += value.length; if (value.length > 4000 || b.chars > 64000) throw Error(); return value; }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || types.isProxy(value)) throw Error();
  if (Array.isArray(value)) {
    if (value.length > 10 || Reflect.ownKeys(value).length !== value.length + 1) throw Error();
    return Array.from({ length: value.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !("value" in d)) throw Error(); return snapshot(d.value, b, depth + 1); });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 10 || keys.some(k => typeof k !== "string" || k.length > 60 || k === "__proto__")) throw Error();
  const out: { [key: string]: Data } = Object.create(null);
  for (const k of keys as string[]) { const d = Object.getOwnPropertyDescriptor(value, k); if (!d || !("value" in d)) throw Error(); out[k] = snapshot(d.value, b, depth + 1); }
  return out;
}
function object(v: Data): v is { [key: string]: Data } { return !!v && typeof v === "object" && !Array.isArray(v); }
function allowed(v: Data, keys: readonly string[]) { if (object(v) && Object.keys(v).some(k => !keys.includes(k))) throw Error(); }
function draftKeys(v: Data) {
  allowed(v, ["publicId", "brand", "slug", "state", "translations"]);
  if (!object(v)) return;
  const translations = v.translations;
  if (translations === undefined) return;
  allowed(translations, ["en", "hu", "ko"]);
  if (!object(translations)) return;
  for (const locale of ["en", "hu", "ko"]) {
    const c = translations[locale]; if (c === undefined) continue;
    allowed(c, ["name", "description", "images", "usage", "caution"]);
    if (object(c) && Array.isArray(c.images)) for (const image of c.images) allowed(image, ["src", "alt"]);
  }
}
function logicalId(v: Data): string | null {
  if (!object(v)) return null;
  const wire = ["public_id", "retail_price_huf", "sellable_stock", "operational_ready"];
  const normalized = ["publicId", "basePriceHuf", "sellableStock", "operationalReady"];
  const keys = Object.keys(v);
  const isWire = keys.length === 4 && keys.every(k => wire.includes(k));
  const isNormalized = keys.length === 4 && keys.every(k => normalized.includes(k));
  if (!isWire && !isNormalized) { allowed(v, [...wire, ...normalized]); return null; }
  const checked = normalizeOperationalProduct(isWire ? v : { public_id: v.publicId, retail_price_huf: v.basePriceHuf, sellable_stock: v.sellableStock, operational_ready: v.operationalReady });
  return checked.ok ? checked.product.publicId : null;
}
function result(status: Outcome, pairCodes: readonly string[] = []) {
  return { version: "1", status, pairCodes, identityReconciliation: "NOT_ERP_ATTESTED",
    trustLayers: { L1: "NOT_VERIFIED", L2: "NOT_VERIFIED", L3: "NOT_VERIFIED", L4: "NOT_VERIFIED" },
    nextActionCodes: ["OBTAIN_INDEPENDENT_OWNER_ERP_SOURCE_IDENTITY", "COMPLETE_HUMAN_EDITORIAL_LEGAL_MEDIA_COMMERCE_REVIEW"],
    releaseDecision: "BLOCKED", readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false } as const;
}
/** Synthetic in-memory declared equality only. No file/CLI/reader/provider calls.
 * ERP input is an exact four-field wire or normalized product, never a live source.
 * No supplied WEB41/42/43 result is accepted or mutated by this independent API.
 */
export function reconcileFirstSkuPrivateDraftIdentity(draft?: unknown, candidate?: unknown, erp?: unknown) {
  try {
    // Inspect all supplied values before use, even when another input is absent.
    const safeDraft = draft === undefined ? null : snapshot(draft);
    const safeCandidate = candidate === undefined ? null : snapshot(candidate);
    const safeErp = erp === undefined ? null : snapshot(erp);
    if (safeDraft !== null) for (const record of Array.isArray(safeDraft) ? safeDraft : [safeDraft]) draftKeys(record);
    allowed(safeErp, ["public_id", "retail_price_huf", "sellable_stock", "operational_ready", "publicId", "basePriceHuf", "sellableStock", "operationalReady"]);
    if (safeDraft === null || safeCandidate === null || (Array.isArray(safeDraft) && safeDraft.length === 0)) return result("NO_DRAFT_OR_CANDIDATE");
    if (!isPublicId(safeCandidate)) return result("INVALID_OR_UNTRUSTED_INPUT");
    const records = Array.isArray(safeDraft) ? safeDraft : [safeDraft];
    if (records.length !== 1) return result("MULTIPLE_DRAFTS_AMBIGUOUS");
    const checked = diagnoseDraft(records);
    if (!checked.ok || !("count" in checked) || !("records" in checked) || checked.count !== 1 || checked.records.length !== 1) return result("DRAFT_STRUCTURE_INVALID");
    const draftId = checked.records[0].publicId;
    if (!isPublicId(draftId)) return result("DRAFT_STRUCTURE_INVALID");
    const erpId = logicalId(safeErp), pairs: string[] = [];
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (!same(draftId, safeCandidate)) pairs.push("DRAFT_CANDIDATE_MISMATCH");
    if (erpId) {
      if (!same(draftId, erpId)) pairs.push("DRAFT_ERP_MISMATCH");
      if (!same(safeCandidate, erpId)) pairs.push("CANDIDATE_ERP_MISMATCH");
    }
    if (pairs.length) return result("DECLARED_IDENTITY_MISMATCH", pairs);
    return result(erpId ? "DECLARED_IDENTITY_MATCH_ONLY" : "ERP_LOGICAL_ID_UNAVAILABLE");
  } catch { return result("INVALID_OR_UNTRUSTED_INPUT"); }
}
