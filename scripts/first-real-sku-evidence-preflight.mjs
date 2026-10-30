import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { isPublicId } from "../lib/erp/product-operational.ts";
import { runIntake } from "./private-draft-intake.mjs";

const successNotice = "Draft only; NOT LP approved / NOT publication ready";
const diagnosticCodes = ["local_development_required", "private_path_required", "input_too_large", "input_unavailable", "invalid_encoding", "invalid_json", "invalid_arguments", "invalid_record", "invalid_input_count", "invalid_type", "unexpected_property", "missing_required_property", "invalid_public_id", "duplicate_public_id", "invalid_brand", "invalid_slug", "duplicate_slug", "invalid_state", "invalid_image_source", "invalid_image_alt"];
const deployKeys = ["VERCEL", "VERCEL_ENV", "NETLIFY", "CF_PAGES", "DEPLOYMENT_ENV"];
const groups = [
  ["CANDIDATE_ERP_RECONCILIATION", "OWNER_ERP_EVIDENCE_OWNER", "SELECT_VARIANT_RECONCILE_CANONICAL_UUID", "REQUIRES_HUMAN_REVIEW"],
  ["MANUFACTURER_SUPPLIER_PROVENANCE", "OWNER_SUPPLIER", "REQUEST_EXACT_VARIANT_MANUFACTURER_SOURCE_DOCUMENTS", "NOT_SUPPLIED"],
  ["EDITORIAL_EN_HU_KO", "OWNER_KO_LP_EN_HU", "COLLECT_LOCALE_TEXT_AND_INDEPENDENT_EDITORIAL_REVIEW", "REQUIRES_HUMAN_REVIEW"],
  ["INCI_CLAIMS_REGULATORY", "OWNER_QUALIFIED_HUMAN_REVIEWERS", "REVIEW_INCI_CLAIMS_RP_CPSR_CPNP_APPLICABILITY", "NOT_EVALUATED"],
  ["MEDIA_ORIGIN_RIGHTS", "OWNER_LP_RIGHTS_OWNER", "REQUEST_MEDIA_PROVENANCE_LICENSE_ALT_ACCESSIBILITY_REVIEW", "NOT_EVALUATED"],
  ["PRICE_VAT_LOT_WAREHOUSE", "OWNER_ERP_OPERATIONS", "REQUEST_PRICE_VAT_SELLABLE_LOT_WAREHOUSE_EVIDENCE", "NOT_EVALUATED"],
  ["ERP_TRUST_FRESHNESS_REPLAY", "ERP_TRUST_EVIDENCE_OWNER_READ_ONLY", "REQUEST_SOURCE_PROVENANCE_CLOCK_REPLAY_ERROR_EVIDENCE", "NOT_EVALUATED"],
  ["PUBLICATION_SELLING_APPROVALS", "OWNER_SEPARATE_FUTURE_AUTHORITY", "OBTAIN_SEPARATE_EDITORIAL_PUBLICATION_CHECKOUT_FULFILLMENT_GO", "REQUIRES_HUMAN_REVIEW"],
];
function record(value) {
  return value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value, keys) {
  return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(value, k) ?? {}, "value"));
}
function arrayValues(value, maximum) {
  if (types.isProxy(value) || !Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error();
  return Array.from({ length: value.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !("value" in d)) throw Error(); return d.value;
  });
}
function environmentSnapshot(environment) {
  if (!environment || typeof environment !== "object" || types.isProxy(environment) || Array.isArray(environment)) throw Error();
  const safe = Object.create(null);
  for (const key of ["NODE_ENV", "HANAPURE_DRAFT_PREVIEW_LOCAL", "APP_ENV", ...deployKeys]) {
    const d = Object.getOwnPropertyDescriptor(environment, key);
    if ((key in environment) && (!d || !("value" in d))) throw Error();
    safe[key] = d?.value;
  }
  if (safe.NODE_ENV !== "development" || safe.HANAPURE_DRAFT_PREVIEW_LOCAL !== "1" ||
    (safe.APP_ENV !== undefined && safe.APP_ENV !== "local") || deployKeys.some(k => safe[k] !== undefined)) throw Error();
  return safe;
}
function base() {
  return { version: "1", candidateStatus: "NO_CANDIDATE_SELECTED", intakeStatus: "INPUT_NOT_EVALUATED", source: "NOT_SUPPLIED",
    identityReconciliation: "NOT_ERP_ATTESTED", draftIdentityMatch: "NOT_EVALUATED", moreSuppressed: false, diagnosticCodes: [],
    blockedReasons: [], releaseDecision: "BLOCKED",
    structuralInput: { status: "NOT_EVALUATED", actionCode: "SUPPLY_APPROVED_PRIVATE_DRAFT_VIA_EXISTING_INTAKE" },
    evidenceTasks: groups.map(([category, owner, actionCode, status]) => ({ category, owner, status, actionCode })),
    localeTasks: [
      { locale: "en", owner: "LP", status: "REQUIRES_HUMAN_REVIEW", actionCode: "REVIEW_EN_NAME_DESCRIPTION_USAGE_CAUTION_ACCURACY" },
      { locale: "hu", owner: "LP", status: "REQUIRES_HUMAN_REVIEW", actionCode: "REVIEW_HU_NAME_DESCRIPTION_USAGE_CAUTION_ACCURACY" },
      { locale: "ko", owner: "OWNER", status: "REQUIRES_HUMAN_REVIEW", actionCode: "REVIEW_KO_NAME_DESCRIPTION_USAGE_CAUTION_ACCURACY" },
    ],
    statusLegend: { NOT_SUPPLIED: "SOURCE_NOT_RECEIVED", NOT_EVALUATED: "NO_FACTUAL_EVALUATION", REQUIRES_HUMAN_REVIEW: "TASK_NOT_SIGNOFF", STRUCTURALLY_VALIDATED_LOCAL_ONLY: "STRUCTURE_ONLY_NO_CONTENT_OR_IDENTITY_ATTESTATION" },
    readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false };
}
function blocked(code) { const out = base(); out.intakeStatus = "BLOCKED"; out.blockedReasons = [code]; return out; }

/** Pure metadata mapper. Selection booleans and intake summaries are not attestations.
 * Never receives/reads file content, selected UUID or path; no source identity join.
 */
export function mapFirstRealSkuMetadata(selection, response) {
  const out = base();
  try {
    if (!exact(selection, ["ownerSelected", "hasCandidate", "hasFile"]) || Object.values(selection).some(v => typeof v !== "boolean")) throw Error();
    const selected = selection.ownerSelected && selection.hasCandidate;
    if (!selected) { out.blockedReasons = ["OWNER_SELECTION_REQUIRED", "INPUT_NOT_EVALUATED"]; return out; }
    out.candidateStatus = "OWNER_SUPPLIED_IDENTITY";
    if (!selection.hasFile) { out.blockedReasons = ["PRIVATE_INPUT_NOT_SUPPLIED", "IDENTITY_NOT_RECONCILED"]; return out; }
    out.source = "LOCAL_PRIVATE_INTAKE";
    if (!record(response)) throw Error();
    const ok = Object.getOwnPropertyDescriptor(response, "ok"); if (!ok || !("value" in ok)) throw Error();
    if (ok.value === true) {
      if (!exact(response, ["ok", "drafts", "code", "notice"]) || response.code !== "drafts_valid" || response.notice !== successNotice ||
        !Number.isSafeInteger(response.drafts) || response.drafts < 1 || response.drafts > 50) throw Error();
      out.draftCount = response.drafts;
      out.intakeStatus = "STRUCTURAL_VALIDATION_ONLY";
      out.structuralInput.status = "STRUCTURALLY_VALIDATED_LOCAL_ONLY";
      out.blockedReasons = [...(response.drafts > 1 ? ["AMBIGUOUS_MULTIPLE_DRAFTS"] : []), "IDENTITY_NOT_RECONCILED", "HUMAN_EVIDENCE_NOT_EVALUATED", "SEPARATE_PUBLICATION_AUTHORITY_REQUIRED"];
      return out;
    }
    if (ok.value !== false || !exact(response, ["ok", "diagnostics", "more_suppressed"]) || typeof response.more_suppressed !== "boolean") throw Error();
    const diagnostics = arrayValues(response.diagnostics, 12); if (!diagnostics.length) throw Error();
    for (const d of diagnostics) {
      if (!exact(d, ["draft_index", "locale", "field", "code"]) || !diagnosticCodes.includes(d.code) ||
        ![null, "en", "hu", "ko"].includes(d.locale) || !(d.draft_index === null || (Number.isInteger(d.draft_index) && d.draft_index >= 0 && d.draft_index < 50)) ||
        typeof d.field !== "string" || d.field.length > 120 || !/^\$(?:\.(?:publicId|brand|slug|state)|\.translations(?:\.(?:en|hu|ko)(?:\.(?:name|description|usage|caution|images)(?:\[(?:[0-9])\](?:\.(?:src|alt))?)?)?)?)?$/.test(d.field)) throw Error();
    }
    out.intakeStatus = "BLOCKED"; out.moreSuppressed = response.more_suppressed;
    out.diagnosticCodes = [...new Set(diagnostics.map(d => d.code))];
    out.blockedReasons = ["PRIVATE_INTAKE_REJECTED", "IDENTITY_NOT_RECONCILED"];
    return out;
  } catch { return blocked("MALFORMED_INTAKE_OR_SELECTION_METADATA"); }
}

function parseArguments(args) {
  const values = arrayValues(args, 5), seen = new Set(); let candidate, file, ownerSelected = false;
  if (values.some(v => typeof v !== "string" || !v || v.length > 1024 || /[\u0000-\u001f\u007f]/.test(v))) throw Error();
  for (let i = 0; i < values.length; i++) {
    const flag = values[i]; if (seen.has(flag)) throw Error(); seen.add(flag);
    if (flag === "--owner-selected") { ownerSelected = true; continue; }
    if (!["--candidate-id", "--file"].includes(flag) || !values[i + 1] || values[i + 1].startsWith("--")) throw Error();
    if (flag === "--candidate-id") candidate = values[++i]; else file = values[++i];
  }
  if ((candidate !== undefined && !isPublicId(candidate)) || (ownerSelected && candidate === undefined)) throw Error();
  return { candidate, file, ownerSelected };
}
/** Test-only DI seam; real executable below never accepts an intake override.
 * Production calls exactly existing validate, never starter/compare/compare-csv.
 */
export function runFirstRealSkuPreflight(args, environment = process.env, intake = runIntake) {
  let safeEnvironment, parsed;
  try { safeEnvironment = environmentSnapshot(environment); } catch { return blocked("LOCAL_DEVELOPMENT_REQUIRED"); }
  try { parsed = parseArguments(args); } catch { return blocked("INVALID_ARGUMENTS"); }
  const selection = { ownerSelected: parsed.ownerSelected, hasCandidate: parsed.candidate !== undefined, hasFile: parsed.file !== undefined };
  if (!selection.ownerSelected || !selection.hasCandidate || !selection.hasFile) return mapFirstRealSkuMetadata(selection);
  let response;
  try { response = intake(["validate", "--file", parsed.file], safeEnvironment); }
  catch { return blocked("PRIVATE_INTAKE_UNAVAILABLE"); }
  return mapFirstRealSkuMetadata(selection, response);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runFirstRealSkuPreflight(process.argv.slice(2), process.env);
  console.log(JSON.stringify(result, null, 2));
  if (result.intakeStatus === "BLOCKED") process.exitCode = 1;
}
