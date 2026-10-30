import "server-only";
import { types } from "node:util";
import { mapFirstRealSkuMetadata } from "../../scripts/first-real-sku-evidence-preflight.mjs";
import { isPublicId, readOperationalProduct, type ErpOperationalSource } from "../erp/product-operational";

// Snapshot bounded plain data only. No getters, proxies, logs, clocks or I/O.
function snapshot(v: unknown, b = { nodes: 0, chars: 0 }, depth = 0): unknown {
  if (++b.nodes > 600 || depth > 6) throw Error();
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "string") { b.chars += v.length; if (v.length > 150 || b.chars > 16000) throw Error(); return v; }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (!v || typeof v !== "object" || types.isProxy(v)) throw Error();
  if (Array.isArray(v)) {
    if (v.length > 20 || Reflect.ownKeys(v).length !== v.length + 1) throw Error();
    return Array.from({ length: v.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || !("value" in d)) throw Error(); return snapshot(d.value, b, depth + 1); });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw Error();
  const out: Record<string, unknown> = Object.create(null), keys = Reflect.ownKeys(v);
  if (keys.length > 20) throw Error();
  for (const k of keys.sort()) {
    if (typeof k !== "string" || k.length > 60) throw Error();
    const d = Object.getOwnPropertyDescriptor(v, k); if (!d || !("value" in d)) throw Error();
    out[k] = snapshot(d.value, b, depth + 1);
  }
  return out;
}
function metadata(input: unknown) {
  const safe = snapshot(input) as Record<string, unknown>;
  let expected;
  if (safe.candidateStatus === "NO_CANDIDATE_SELECTED") expected = mapFirstRealSkuMetadata({ ownerSelected: false, hasCandidate: false, hasFile: false }, undefined);
  else if (safe.candidateStatus === "OWNER_SUPPLIED_IDENTITY") {
    const selection = { ownerSelected: true, hasCandidate: true, hasFile: safe.source === "LOCAL_PRIVATE_INTAKE" };
    let response;
    if (safe.intakeStatus === "STRUCTURAL_VALIDATION_ONLY") response = { ok: true, drafts: safe.draftCount, code: "drafts_valid", notice: "Draft only; NOT LP approved / NOT publication ready" };
    else if (safe.intakeStatus === "BLOCKED" && Array.isArray(safe.diagnosticCodes)) response = { ok: false, more_suppressed: safe.moreSuppressed, diagnostics: safe.diagnosticCodes.map(code => ({ code, locale: null, field: "$", draft_index: null })) };
    expected = mapFirstRealSkuMetadata(selection, response);
  }
  if (!expected || JSON.stringify(safe) !== JSON.stringify(snapshot(expected))) throw Error();
  return expected;
}
const limits = ["CROSS_SYSTEM_IDENTITY_NOT_VERIFIED", "ISSUER_SIGNATURE_NOT_VERIFIED", "REVISION_ATOMICITY_NOT_VERIFIED", "FRESHNESS_REPLAY_NOT_VERIFIED", "LEGAL_INCI_CLAIMS_NOT_EVALUATED", "EDITORIAL_SIGNOFF_NOT_EVALUATED", "MEDIA_RIGHTS_ACCESSIBILITY_NOT_EVALUATED", "CUSTOMER_PRICE_VAT_ELIGIBILITY_NOT_EVALUATED"] as const;

/** Offline diagnostic only: caller supplies a bounded synthetic test source.
 * Dependency behavior itself is trusted test code, not a sandbox for arbitrary JS.
 * No private intake invocation, override resolution, default provider or retries.
 */
export async function joinFirstRealSkuOperationalEvidence(input: unknown, declaredId: unknown, source?: ErpOperationalSource) {
  const reasons: string[] = [];
  let candidateStatus = "INVALID_METADATA", intakeStatus = "INPUT_NOT_EVALUATED", erpStatus = "NOT_EVALUATED";
  let worklist = mapFirstRealSkuMetadata({ ownerSelected: false, hasCandidate: false, hasFile: false }, undefined).evidenceTasks;
  try {
    const m = metadata(input); candidateStatus = m.candidateStatus; intakeStatus = m.intakeStatus; worklist = m.evidenceTasks;
    if (m.candidateStatus === "NO_CANDIDATE_SELECTED") reasons.push("NO_CANDIDATE_SELECTED");
    else if (!isPublicId(declaredId)) reasons.push("INVALID_DECLARED_IDENTITY");
    else {
      reasons.push("OPERATOR_DECLARATION_ONLY");
      // Pre-resolved metadata cannot attest this UUID matches the private draft.
      let injected: ErpOperationalSource | undefined;
      if (source !== undefined) {
        if (types.isProxy(source)) throw Error();
        const d = Object.getOwnPropertyDescriptor(source, "readProduct");
        if (!d || !("value" in d) || typeof d.value !== "function") throw Error();
        const read = d.value;
        injected = { async readProduct(id, options) {
          const raw = await read.call(source, id, options);
          if (!raw || typeof raw !== "object" || types.isProxy(raw) || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return null;
          const keys = ["public_id", "retail_price_huf", "sellable_stock", "operational_ready"];
          if (Reflect.ownKeys(raw).length !== keys.length) return null;
          const clean: Record<string, unknown> = Object.create(null);
          for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(raw, key);
            if (!descriptor || !("value" in descriptor)) return null;
            const value = descriptor.value;
            if (typeof value === "string" && value.length > 64) return null;
            if (!["string", "number", "boolean", "undefined"].includes(typeof value) && value !== null) return null;
            clean[key] = value;
          }
          return clean;
        } };
      }
      const result = await readOperationalProduct(declaredId, injected);
      if (!result.ok) {
        const code = result.error.code;
        erpStatus = code === "source_not_configured" ? "SOURCE_NOT_CONFIGURED" : code === "timeout" ? "READ_TIMEOUT" : code === "identity_mismatch" ? "IDENTITY_MISMATCH" : ["invalid_payload", "invalid_fields", "malformed_response", "contract_mismatch"].includes(code) ? "MALFORMED_RESPONSE" : "READ_UNAVAILABLE";
        reasons.push(erpStatus);
      } else {
        erpStatus = "LOGICAL_DISPLAY_SIGNAL_ONLY";
        if (result.product.basePriceHuf < 0) reasons.push("NEGATIVE_BASE_HUF_SIGNAL_REQUIRES_REVIEW");
        if (!result.product.operationalReady) reasons.push("OPERATIONAL_NOT_READY");
        if (result.product.sellableStock === 0) reasons.push("ZERO_SELLABLE_STOCK");
        if (result.product.operationalReady && result.product.sellableStock > 0) reasons.push("POSITIVE_LOGICAL_SIGNAL_NOT_AUTHORIZATION");
      }
    }
    if (intakeStatus !== "STRUCTURAL_VALIDATION_ONLY") reasons.push(intakeStatus === "BLOCKED" ? "PRIVATE_INTAKE_BLOCKED" : "PRIVATE_DRAFT_NOT_PROVIDED");
    else reasons.push("PRIVATE_STRUCTURE_ONLY");
    reasons.push(...m.blockedReasons);
  } catch { reasons.push("INVALID_OR_UNAVAILABLE_INPUT"); erpStatus = "NOT_EVALUATED"; }
  return { version: "1", scope: "OFFLINE_DIAGNOSTIC_ONLY", candidateStatus, intakeStatus, erpStatus,
    identityReconciliation: "NOT_ERP_ATTESTED", draftIdentityMatch: "NOT_EVALUATED",
    blockedReasons: [...new Set([...reasons, ...limits])], worklist,
    readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false, releaseDecision: "BLOCKED" } as const;
}
