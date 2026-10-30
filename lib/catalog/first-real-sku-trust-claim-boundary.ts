import "server-only";
import { types } from "node:util";
import { mapFirstRealSkuMetadata } from "../../scripts/first-real-sku-evidence-preflight.mjs";

type Data = null | string | number | boolean | Data[] | { [key: string]: Data };
type Classification = "ABSENT" | "MALFORMED" | "AMBIGUOUS" | "CONFLICTING" | "DECLARED_ONLY";
function copy(v: unknown, budget = { nodes: 0, chars: 0 }, depth = 0): Data {
  if (++budget.nodes > 800 || depth > 6) throw Error();
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "string") { budget.chars += v.length; if (v.length > 150 || budget.chars > 16000) throw Error(); return v; }
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  if (!v || typeof v !== "object" || types.isProxy(v)) throw Error();
  if (Array.isArray(v)) {
    if (v.length > 40 || Reflect.ownKeys(v).length !== v.length + 1) throw Error();
    return Array.from({ length: v.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || !("value" in d)) throw Error(); return copy(d.value, budget, depth + 1); });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw Error();
  const keys = Reflect.ownKeys(v);
  // Check symbol keys before sorting: never coerce attacker-controlled values.
  if (keys.length > 20 || keys.some(k => typeof k !== "string" || k.length > 60 || k === "__proto__")) throw Error();
  const out: { [key: string]: Data } = Object.create(null);
  for (const key of (keys as string[]).sort()) { const d = Object.getOwnPropertyDescriptor(v, key); if (!d || !("value" in d)) throw Error(); out[key] = copy(d.value, budget, depth + 1); }
  return out;
}
function object(v: Data): v is { [key: string]: Data } { return !!v && typeof v === "object" && !Array.isArray(v); }
const limits = ["CROSS_SYSTEM_IDENTITY_NOT_VERIFIED", "ISSUER_SIGNATURE_NOT_VERIFIED", "REVISION_ATOMICITY_NOT_VERIFIED", "FRESHNESS_REPLAY_NOT_VERIFIED", "LEGAL_INCI_CLAIMS_NOT_EVALUATED", "EDITORIAL_SIGNOFF_NOT_EVALUATED", "MEDIA_RIGHTS_ACCESSIBILITY_NOT_EVALUATED", "CUSTOMER_PRICE_VAT_ELIGIBILITY_NOT_EVALUATED"];
const known = [...limits, "NO_CANDIDATE_SELECTED", "INVALID_DECLARED_IDENTITY", "OPERATOR_DECLARATION_ONLY", "SOURCE_NOT_CONFIGURED", "READ_TIMEOUT", "IDENTITY_MISMATCH", "MALFORMED_RESPONSE", "READ_UNAVAILABLE", "NEGATIVE_BASE_HUF_SIGNAL_REQUIRES_REVIEW", "OPERATIONAL_NOT_READY", "ZERO_SELLABLE_STOCK", "POSITIVE_LOGICAL_SIGNAL_NOT_AUTHORIZATION", "PRIVATE_INTAKE_BLOCKED", "PRIVATE_DRAFT_NOT_PROVIDED", "PRIVATE_STRUCTURE_ONLY", "OWNER_SELECTION_REQUIRED", "INPUT_NOT_EVALUATED", "PRIVATE_INPUT_NOT_SUPPLIED", "IDENTITY_NOT_RECONCILED", "AMBIGUOUS_MULTIPLE_DRAFTS", "HUMAN_EVIDENCE_NOT_EVALUATED", "SEPARATE_PUBLICATION_AUTHORITY_REQUIRED", "PRIVATE_INTAKE_REJECTED", "INVALID_OR_UNAVAILABLE_INPUT"];
function prior(input: unknown) {
  const d = copy(input);
  const keys = ["version", "scope", "candidateStatus", "intakeStatus", "erpStatus", "identityReconciliation", "draftIdentityMatch", "blockedReasons", "worklist", "readyForLivePublication", "readyForCheckout", "trustedForLiveUse", "releaseDecision"];
  if (!object(d) || Object.keys(d).length !== keys.length || keys.some(k => !Object.hasOwn(d, k)) || d.version !== "1" || d.scope !== "OFFLINE_DIAGNOSTIC_ONLY" || d.releaseDecision !== "BLOCKED" || d.identityReconciliation !== "NOT_ERP_ATTESTED" || d.draftIdentityMatch !== "NOT_EVALUATED") throw Error();
  if ([d.readyForLivePublication, d.readyForCheckout, d.trustedForLiveUse].some(v => v !== false)) throw Error();
  if (!["NO_CANDIDATE_SELECTED", "OWNER_SUPPLIED_IDENTITY", "INVALID_METADATA"].includes(d.candidateStatus as string) || !["INPUT_NOT_EVALUATED", "BLOCKED", "STRUCTURAL_VALIDATION_ONLY"].includes(d.intakeStatus as string) || !["NOT_EVALUATED", "SOURCE_NOT_CONFIGURED", "READ_TIMEOUT", "IDENTITY_MISMATCH", "MALFORMED_RESPONSE", "READ_UNAVAILABLE", "LOGICAL_DISPLAY_SIGNAL_ONLY"].includes(d.erpStatus as string)) throw Error();
  const reasonValues = d.blockedReasons;
  if (!Array.isArray(reasonValues) || reasonValues.some(r => typeof r !== "string" || !known.includes(r)) || new Set(reasonValues).size !== reasonValues.length || limits.some(r => !reasonValues.includes(r))) throw Error();
  const reasons = reasonValues as string[], has = (code: string) => reasons.includes(code);
  if (["SOURCE_NOT_CONFIGURED", "READ_TIMEOUT", "IDENTITY_MISMATCH", "MALFORMED_RESPONSE", "READ_UNAVAILABLE"].some(c => has(c) && d.erpStatus !== c)) throw Error();
  if (has("NO_CANDIDATE_SELECTED") && d.candidateStatus !== "NO_CANDIDATE_SELECTED") throw Error();
  if (has("PRIVATE_STRUCTURE_ONLY") && d.intakeStatus !== "STRUCTURAL_VALIDATION_ONLY") throw Error();
  if (has("PRIVATE_DRAFT_NOT_PROVIDED") && d.intakeStatus !== "INPUT_NOT_EVALUATED") throw Error();
  if (has("PRIVATE_INTAKE_BLOCKED") && d.intakeStatus !== "BLOCKED") throw Error();
  if (d.candidateStatus === "NO_CANDIDATE_SELECTED" && (!has("NO_CANDIDATE_SELECTED") || d.erpStatus !== "NOT_EVALUATED" || d.intakeStatus !== "INPUT_NOT_EVALUATED" || !has("OWNER_SELECTION_REQUIRED") || !has("INPUT_NOT_EVALUATED") || has("OPERATOR_DECLARATION_ONLY"))) throw Error();
  if (d.candidateStatus === "INVALID_METADATA" && (!has("INVALID_OR_UNAVAILABLE_INPUT") || d.erpStatus !== "NOT_EVALUATED")) throw Error();
  if (d.candidateStatus === "OWNER_SUPPLIED_IDENTITY") {
    if (d.erpStatus !== "NOT_EVALUATED" && !has("OPERATOR_DECLARATION_ONLY")) throw Error();
    if (d.erpStatus === "NOT_EVALUATED" && !has("INVALID_DECLARED_IDENTITY") && !has("INVALID_OR_UNAVAILABLE_INPUT")) throw Error();
    if (d.erpStatus !== "LOGICAL_DISPLAY_SIGNAL_ONLY" && d.erpStatus !== "NOT_EVALUATED" && !has(d.erpStatus as string)) throw Error();
    if (!has("INVALID_OR_UNAVAILABLE_INPUT") && !has(d.intakeStatus === "STRUCTURAL_VALIDATION_ONLY" ? "PRIVATE_STRUCTURE_ONLY" : d.intakeStatus === "BLOCKED" ? "PRIVATE_INTAKE_BLOCKED" : "PRIVATE_DRAFT_NOT_PROVIDED")) throw Error();
  }
  if (has("POSITIVE_LOGICAL_SIGNAL_NOT_AUTHORIZATION") && (d.erpStatus !== "LOGICAL_DISPLAY_SIGNAL_ONLY" || has("OPERATIONAL_NOT_READY") || has("ZERO_SELLABLE_STOCK"))) throw Error();
  if (d.erpStatus === "LOGICAL_DISPLAY_SIGNAL_ONLY" && !["POSITIVE_LOGICAL_SIGNAL_NOT_AUTHORIZATION", "OPERATIONAL_NOT_READY", "ZERO_SELLABLE_STOCK"].some(has)) throw Error();
  if (d.intakeStatus === "STRUCTURAL_VALIDATION_ONLY" && !has("INVALID_OR_UNAVAILABLE_INPUT") && ["IDENTITY_NOT_RECONCILED", "HUMAN_EVIDENCE_NOT_EVALUATED", "SEPARATE_PUBLICATION_AUTHORITY_REQUIRED"].some(c => !has(c))) throw Error();
  if (["OPERATIONAL_NOT_READY", "ZERO_SELLABLE_STOCK", "NEGATIVE_BASE_HUF_SIGNAL_REQUIRES_REVIEW"].some(has) && d.erpStatus !== "LOGICAL_DISPLAY_SIGNAL_ONLY") throw Error();
  const canonical = mapFirstRealSkuMetadata({ ownerSelected: false, hasCandidate: false, hasFile: false }, undefined).evidenceTasks;
  if (JSON.stringify(d.worklist) !== JSON.stringify(copy(canonical))) throw Error();
  return { reasons, worklist: canonical, erpStatus: d.erpStatus as string };
}
function timestamp(v: Data): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) return false;
  const year = Number(v.slice(0, 4)), month = Number(v.slice(5, 7)), day = Number(v.slice(8, 10));
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60 && Number(v.slice(17, 19)) < 60;
}
// Local diagnostic schema only: not a provider, signing or freshness protocol.
function claim(input: unknown) {
  const d = copy(input);
  if (!object(d) || d.version !== "DECLARED_V1" || Object.keys(d).some(k => !["version", "issuer", "candidateId", "revision", "sequence", "observedAt", "expiresAt", "signature"].includes(k))) throw Error();
  return d;
}
function atom(d: { [key: string]: Data }, key: string): Classification {
  const v = d[key]; if (v === undefined) return "ABSENT";
  if (Array.isArray(v)) return v.length === 2 && v.every(x => typeof x === "string" && (key === "candidateId" ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ : /^[A-Za-z0-9._:-]{1,64}$/).test(x)) ? "AMBIGUOUS" : "MALFORMED";
  if (typeof v !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(v)) return "MALFORMED";
  if (key === "candidateId" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) return "MALFORMED";
  return "DECLARED_ONLY";
}
// Declared shape only, shared by claim/reference; no cryptographic assertion.
function signatureShape(d: { [key: string]: Data }): boolean {
  return d.signature === undefined || (typeof d.signature === "string" && d.signature.length <= 128);
}
export function evaluateFirstSkuTrustClaimBoundary(joinResult: unknown, input?: unknown, reference?: unknown) {
  let source;
  try { source = prior(joinResult); } catch { source = null; }
  const notes: string[] = [];
  let provenance: Classification = "ABSENT", identity: Classification = "ABSENT", revision: Classification = "ABSENT", time: Classification = "ABSENT";
  let referenceStatus = reference === undefined ? "ABSENT" : "NOT_EVALUATED", comparison = "NOT_COMPARED";
  if (input !== undefined && input !== null) {
    try {
      const d = claim(input); let r;
      if (reference !== undefined) { referenceStatus = "MALFORMED"; try { r = claim(reference); if (!signatureShape(r) || ["issuer", "candidateId", "revision"].some(k => ["MALFORMED", "AMBIGUOUS"].includes(atom(r!, k))) || (r.sequence !== undefined && (typeof r.sequence !== "number" || !Number.isSafeInteger(r.sequence))) || ["observedAt", "expiresAt"].some(k => r![k] !== undefined && !timestamp(r![k]))) throw Error(); referenceStatus = "DECLARED_ONLY"; } catch { r = undefined; } }
      provenance = atom(d, "issuer"); identity = atom(d, "candidateId"); revision = atom(d, "revision");
      if (!signatureShape(d)) provenance = "MALFORMED";
      if (d.sequence !== undefined) revision = typeof d.sequence === "number" && Number.isSafeInteger(d.sequence) ? revision === "ABSENT" ? "DECLARED_ONLY" : revision : "MALFORMED";
      const times = ["observedAt", "expiresAt"].filter(k => d[k] !== undefined);
      time = times.length ? times.every(k => timestamp(d[k])) ? times.length === 2 ? "DECLARED_ONLY" : "AMBIGUOUS" : "MALFORMED" : "ABSENT";
      if (time === "DECLARED_ONLY" && typeof d.observedAt === "string" && typeof d.expiresAt === "string" && d.observedAt > d.expiresAt) { time = "CONFLICTING"; notes.push("DECLARED_TIME_ORDER_INVERTED"); }
      if (r) {
        for (const k of ["issuer", "candidateId", "revision"]) if (atom(d, k) === "DECLARED_ONLY" && atom(r, k) === "DECLARED_ONLY" && d[k] !== r[k]) { if (k === "issuer") provenance = "CONFLICTING"; else if (k === "candidateId") identity = "CONFLICTING"; else revision = "CONFLICTING"; notes.push("DECLARED_" + k.toUpperCase() + "_DIFFERS"); }
        if (typeof d.sequence === "number" && typeof r.sequence === "number" && d.sequence < r.sequence) { revision = "CONFLICTING"; notes.push("SEQUENCE_LOWER_THAN_DECLARED_REFERENCE"); }
        if (time === "DECLARED_ONLY" && timestamp(r.observedAt)) {
          if (timestamp(d.expiresAt) && d.expiresAt < r.observedAt) notes.push("EXPIRY_BEFORE_DECLARED_REFERENCE");
          if (timestamp(d.observedAt) && d.observedAt > r.observedAt) notes.push("OBSERVATION_AFTER_DECLARED_REFERENCE");
        }
        if ([provenance, identity, revision, time].every(v => v === "DECLARED_ONLY") && JSON.stringify(d) === JSON.stringify(r)) comparison = "CLAIMED_MATCH_ONLY";
      }
    } catch { provenance = identity = revision = time = "MALFORMED"; notes.push("MALFORMED_DECLARATION"); }
  }
  return { version: "1", sourceInterpretation: source ? "STRUCTURALLY_RECOGNIZED_ONLY" : "UNRECOGNIZED_BLOCKED", logicalLayer: source?.erpStatus ?? "NOT_EVALUATED",
    declared: { provenance, identity, revision, time }, referenceStatus, comparison,
    trustLayers: { L1: "NOT_VERIFIED", L2: "NOT_VERIFIED", L3: "NOT_VERIFIED", L4: "NOT_VERIFIED" },
    blockedReasons: [...new Set([...(source?.reasons ?? ["UNRECOGNIZED_JOIN_RESULT"]), ...notes, "DECLARATIONS_NOT_AUTHENTICATION", "SEPARATE_HUMAN_AND_RELEASE_AUTHORITY_REQUIRED"])],
    worklist: source?.worklist ?? [], nextActionCodes: ["RECONCILE_OWNER_ERP_IDENTITY", "OBTAIN_INDEPENDENT_ISSUER_REVISION_CLOCK_EVIDENCE", "COMPLETE_HUMAN_LEGAL_EDITORIAL_MEDIA_COMMERCE_REVIEW"],
    releaseDecision: "BLOCKED", readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false } as const;
}
