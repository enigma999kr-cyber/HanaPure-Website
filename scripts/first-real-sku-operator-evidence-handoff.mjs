import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { isPublicId } from "../lib/erp/product-operational.ts";
import { runIntake } from "./private-draft-intake.mjs";
import { mapFirstRealSkuMetadata } from "./first-real-sku-evidence-preflight.mjs";

const codes = ["NO_CANDIDATE", "PRIVATE_INPUT_BLOCKED", "MULTIPLE_DRAFTS_AMBIGUOUS", "DRAFT_STRUCTURE_INVALID", "ERP_LOGICAL_ID_NOT_ATTESTED", "DECLARED_IDENTITY_MISMATCH", "DECLARED_IDENTITY_MATCH_ONLY", "INVALID_OR_UNTRUSTED_INPUT"];
const pairs = ["DRAFT_CANDIDATE_MISMATCH", "DRAFT_ERP_MISMATCH", "CANDIDATE_ERP_MISMATCH"];
const envKeys = ["NODE_ENV", "HANAPURE_DRAFT_PREVIEW_LOCAL", "APP_ENV", "VERCEL", "VERCEL_ENV", "NETLIFY", "CF_PAGES", "DEPLOYMENT_ENV"];
function ownObject(v, keys) {
  if (!v || typeof v !== "object" || types.isProxy(v) || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw Error();
  if (Reflect.ownKeys(v).length !== keys.length) throw Error();
  const out = Object.create(null);
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(v, key); if (!d || !("value" in d)) throw Error(); out[key] = d.value; }
  return out;
}
function array(v, max) {
  if (types.isProxy(v) || !Array.isArray(v) || v.length > max || Reflect.ownKeys(v).length !== v.length + 1) throw Error();
  return Array.from({ length: v.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || !("value" in d)) throw Error(); return d.value; });
}
function diagnostic(code, subCode = null) {
  return { operation: "reconcile-id", ok: false, code, pairCodes: [], subCode, identityReconciliation: "NOT_ERP_ATTESTED", trustLayers: { L1: "NOT_VERIFIED", L2: "NOT_VERIFIED", L3: "NOT_VERIFIED", L4: "NOT_VERIFIED" }, releaseDecision: "BLOCKED", readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false };
}
/** Pure sanitized projection, never a source/owner attestation. */
export function mapOperatorEvidenceHandoff(input) {
  let localIdentityDiagnostic;
  try {
    const d = ownObject(input, ["operation", "ok", "code", "pairCodes", "subCode", "identityReconciliation", "trustLayers", "releaseDecision", "readyForLivePublication", "readyForCheckout", "trustedForLiveUse"]);
    if (typeof d.code !== "string" || !codes.includes(d.code) || d.operation !== "reconcile-id" || d.identityReconciliation !== "NOT_ERP_ATTESTED" || d.releaseDecision !== "BLOCKED" || [d.readyForLivePublication, d.readyForCheckout, d.trustedForLiveUse].some(v => v !== false)) throw Error();
    const trust = ownObject(d.trustLayers, ["L1", "L2", "L3", "L4"]); if (Object.values(trust).some(v => v !== "NOT_VERIFIED")) throw Error();
    const pairCodes = array(d.pairCodes, 3);
    if (pairCodes.some(p => typeof p !== "string" || !pairs.includes(p)) || new Set(pairCodes).size !== pairCodes.length || pairCodes.some((p, i) => i > 0 && pairs.indexOf(p) <= pairs.indexOf(pairCodes[i - 1]))) throw Error();
    const complete = ["DECLARED_IDENTITY_MATCH_ONLY", "DECLARED_IDENTITY_MISMATCH"].includes(d.code);
    if (d.ok !== complete || (d.code === "DECLARED_IDENTITY_MISMATCH" ? pairCodes.length < 2 : pairCodes.length !== 0)) throw Error();
    if (d.subCode !== null && !(d.code === "PRIVATE_INPUT_BLOCKED" && ["invalid_arguments", "local_development_required", "private_path_required", "input_too_large", "input_unavailable"].includes(d.subCode)) && !(d.code === "DRAFT_STRUCTURE_INVALID" && ["invalid_encoding", "invalid_json"].includes(d.subCode))) throw Error();
    localIdentityDiagnostic = { code: d.code, pairCodes, subCode: d.subCode, diagnosticCompleted: complete };
  } catch { localIdentityDiagnostic = { code: "INVALID_OR_UNTRUSTED_INPUT", pairCodes: [], subCode: null, diagnosticCompleted: false }; }
  const canonical = mapFirstRealSkuMetadata({ ownerSelected: false, hasCandidate: false, hasFile: false }, undefined);
  return { version: "1", scope: "LOCAL_OPERATOR_HANDOFF_ONLY", localIdentityDiagnostic,
    evidenceTasks: canonical.evidenceTasks, localeTasks: canonical.localeTasks,
    nextActionCodes: canonical.evidenceTasks.map(t => t.actionCode), identityReconciliation: "NOT_ERP_ATTESTED",
    trustLayers: { L1: "NOT_VERIFIED", L2: "NOT_VERIFIED", L3: "NOT_VERIFIED", L4: "NOT_VERIFIED" },
    releaseDecision: "BLOCKED", readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false };
}
function environmentSnapshot(environment) {
  if (!environment || typeof environment !== "object" || types.isProxy(environment) || Array.isArray(environment)) throw Error();
  let ancestor = Object.getPrototypeOf(environment), depth = 0;
  while (ancestor !== null) {
    if (types.isProxy(ancestor) || ++depth > 4 || envKeys.some(k => Object.getOwnPropertyDescriptor(ancestor, k))) throw Error();
    ancestor = Object.getPrototypeOf(ancestor);
  }
  const out = Object.create(null);
  for (const k of envKeys) { const d = Object.getOwnPropertyDescriptor(environment, k); if (d && !("value" in d)) throw Error(); out[k] = d?.value; }
  if (out.NODE_ENV !== "development" || out.HANAPURE_DRAFT_PREVIEW_LOCAL !== "1" || (out.APP_ENV !== undefined && out.APP_ENV !== "local") || envKeys.slice(3).some(k => out[k] !== undefined)) throw Error();
  return out;
}
/** DI is test-only; executable always uses real runIntake, no override switch. */
export function runOperatorEvidenceHandoff(args, environment = process.env, inspect = runIntake) {
  let local;
  try { local = environmentSnapshot(environment); } catch { return mapOperatorEvidenceHandoff(diagnostic("PRIVATE_INPUT_BLOCKED", "local_development_required")); }
  let values;
  try {
    if (types.isProxy(args) || !Array.isArray(args) || Object.isSealed(args)) throw Error();
    const input = array(args, 6); values = new Map();
    if (input.length % 2 || input.some(v => typeof v !== "string" || !v || v.length > 1024 || /[\u0000-\u001f\u007f]/.test(v))) throw Error();
    for (let i = 0; i < input.length; i += 2) {
      if (!["--file", "--candidate-id", "--erp-public-id"].includes(input[i]) || values.has(input[i]) || input[i + 1].startsWith("--")) throw Error();
      values.set(input[i], input[i + 1]);
    }
  } catch { return mapOperatorEvidenceHandoff(diagnostic("INVALID_OR_UNTRUSTED_INPUT")); }
  const candidate = values.get("--candidate-id"), erp = values.get("--erp-public-id");
  if (candidate === undefined) return mapOperatorEvidenceHandoff(diagnostic("NO_CANDIDATE"));
  if (!isPublicId(candidate) || candidate !== candidate.toLowerCase()) return mapOperatorEvidenceHandoff(diagnostic("INVALID_OR_UNTRUSTED_INPUT"));
  if (!values.has("--file")) return mapOperatorEvidenceHandoff(diagnostic("PRIVATE_INPUT_BLOCKED", "invalid_arguments"));
  if (!isPublicId(erp) || erp !== erp.toLowerCase()) return mapOperatorEvidenceHandoff(diagnostic("ERP_LOGICAL_ID_NOT_ATTESTED"));
  try { return mapOperatorEvidenceHandoff(inspect(["reconcile-id", "--file", values.get("--file"), "--candidate-id", candidate, "--erp-public-id", erp], local)); }
  catch { return mapOperatorEvidenceHandoff(diagnostic("PRIVATE_INPUT_BLOCKED", "input_unavailable")); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runOperatorEvidenceHandoff(process.argv.slice(2), process.env);
  console.log(JSON.stringify(result));
  if (!result.localIdentityDiagnostic.diagnosticCompleted) process.exitCode = 1;
}
