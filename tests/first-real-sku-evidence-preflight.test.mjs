import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mapFirstRealSkuMetadata as map, runFirstRealSkuPreflight as run } from "../scripts/first-real-sku-evidence-preflight.mjs";
import { runIntake } from "../scripts/private-draft-intake.mjs";
const env = { NODE_ENV: "development", HANAPURE_DRAFT_PREVIEW_LOCAL: "1", APP_ENV: "local" };
const id = "a1234567-1234-4321-8123-123456789abc", file = "C:\\PRIVATE_SECRET\\draft.json";
const selected = { ownerSelected: true, hasCandidate: true, hasFile: true };
const args = ["--owner-selected", "--candidate-id", id, "--file", file];
const success = (drafts = 1) => ({ ok: true, drafts, code: "drafts_valid", notice: "Draft only; NOT LP approved / NOT publication ready" });
const failure = code => ({ ok: false, diagnostics: [{ draft_index: null, locale: null, field: "$", code }], more_suppressed: false });
function safe(r) {
  for (const k of ["readyForLivePublication", "readyForCheckout", "trustedForLiveUse"]) assert.equal(r[k], false);
  assert.equal(r.releaseDecision, "BLOCKED"); assert.equal(r.identityReconciliation, "NOT_ERP_ATTESTED"); assert.equal(r.draftIdentityMatch, "NOT_EVALUATED");
  assert.equal(r.evidenceTasks.length, 8); assert.equal(new Set(r.evidenceTasks.map(t => t.category)).size, 8);
  assert.ok(r.evidenceTasks.every(t => t.status !== "STRUCTURALLY_VALIDATED_LOCAL_ONLY"));
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET|a1234567|draft\.json|Users|name|description|src|signedBy|supplierName/);
  return r;
}
test("no candidate or undeclared identity never invokes intake and keeps useful Owner/LP worklist", () => {
  for (const arguments_ of [[], ["--candidate-id", id], ["--file", file], ["--candidate-id", id, "--file", file]]) {
    const r = safe(run(arguments_, env, () => assert.fail("must not read without selected candidate")));
    assert.equal(r.candidateStatus, "NO_CANDIDATE_SELECTED"); assert.equal(r.intakeStatus, "INPUT_NOT_EVALUATED");
  }
});
test("operator-declared valid UUID without file is unverified identity, not ERP fact", () => {
  const r = safe(run(["--owner-selected", "--candidate-id", id], env, () => assert.fail("no file read")));
  assert.equal(r.candidateStatus, "OWNER_SUPPLIED_IDENTITY"); assert.equal(r.source, "NOT_SUPPLIED"); assert.ok(r.blockedReasons.includes("PRIVATE_INPUT_NOT_SUPPLIED"));
});
test("narrow test seam calls exactly existing validate contract once, structural only", () => {
  let calls = 0;
  const r = safe(run(args, env, (actual, environment) => {
    calls++; assert.deepEqual(actual, ["validate", "--file", file]); assert.equal(environment.NODE_ENV, "development"); assert.equal(environment.HANAPURE_DRAFT_PREVIEW_LOCAL, "1"); return success();
  }));
  assert.equal(calls, 1); assert.equal(r.intakeStatus, "STRUCTURAL_VALIDATION_ONLY"); assert.equal(r.structuralInput.status, "STRUCTURALLY_VALIDATED_LOCAL_ONLY"); assert.equal(r.draftCount, 1);
  assert.ok(r.blockedReasons.includes("IDENTITY_NOT_RECONCILED"));
});
test("multiple validated drafts remain ambiguous, no selected-file identity join", () => {
  const r = safe(map(selected, success(2))); assert.equal(r.draftCount, 2); assert.ok(r.blockedReasons.includes("AMBIGUOUS_MULTIPLE_DRAFTS"));
  assert.equal(r.evidenceTasks[0].status, "REQUIRES_HUMAN_REVIEW");
});
test("malformed/fake approval/extra or accessor return cannot be promoted", () => {
  const getter = { ...success() }; Object.defineProperty(getter, "drafts", { get() { assert.fail("getter invoked"); } });
  for (const value of [null, [], { ok: true }, success(0), success(51), success("1"), { ...success(), approved: true }, { ...success(), code: "READY_FOR_PUBLICATION" }, { ...success(), notice: "PRIVATE_SECRET" }, getter,
    new Proxy({}, { ownKeys() { assert.fail("proxy trap invoked"); } })]) {
    assert.equal(safe(map(selected, value)).intakeStatus, "BLOCKED");
  }
  assert.equal(safe(run(args, env, () => { throw Error("PRIVATE_SECRET"); })).intakeStatus, "BLOCKED");
});
test("allowlisted failure/ACL/reparse/encoding/size/unavailable metadata, no field echo", () => {
  for (const code of ["local_development_required", "private_path_required", "input_too_large", "input_unavailable", "invalid_encoding", "invalid_json", "invalid_record", "invalid_image_source"]) {
    const r = safe(map(selected, failure(code))); assert.equal(r.intakeStatus, "BLOCKED"); assert.deepEqual(r.diagnosticCodes, [code]);
  }
  const suppressed = failure("invalid_record"); suppressed.more_suppressed = true; assert.equal(safe(map(selected, suppressed)).moreSuppressed, true);
  for (const patch of [{ code: "PRIVATE_SECRET" }, { field: file }, { locale: "PRIVATE_SECRET" }]) { const f = failure("invalid_record"); Object.assign(f.diagnostics[0], patch); assert.equal(safe(map(selected, f)).intakeStatus, "BLOCKED"); assert.deepEqual(map(selected, f).diagnosticCodes, []); }
});
test("exact local environment required even when no candidate; inherited/deploy flags cannot bypass", () => {
  for (const e of [{}, { ...env, NODE_ENV: "production" }, { ...env, HANAPURE_DRAFT_PREVIEW_LOCAL: "0" }, { ...env, APP_ENV: "staging" },
    ...["VERCEL", "VERCEL_ENV", "NETLIFY", "CF_PAGES", "DEPLOYMENT_ENV"].map(k => ({ ...env, [k]: "" })), Object.assign(Object.create({ VERCEL: "1" }), env)]) {
    assert.deepEqual(safe(run([], e)).blockedReasons, ["LOCAL_DEVELOPMENT_REQUIRED"]);
  }
});
test("invalid/duplicate/oversized arguments refuse and never call an intake seam", () => {
  for (const a of [["--force"], ["--trusted"], ["--published"], ["--owner-selected"], ["--candidate-id", "PRIVATE_SECRET"], ["--candidate-id", id, "--candidate-id", id], ["--file", "X".repeat(1025)], ["--file", "\u0000"], ["--owner-selected", "--owner-selected"], [5], "PRIVATE_SECRET"]) {
    assert.deepEqual(safe(run(a, env, () => assert.fail("invalid input must not read"))).blockedReasons, ["INVALID_ARGUMENTS"]);
  }
});
test("all eight independent groups and locales are tasks only; stable immutable outputs", () => {
  const selection = { ...selected }, response = success(), before = JSON.stringify([selection, response]);
  const a = safe(map(selection, response)), b = safe(map(selection, response)); assert.deepEqual(a, b); assert.equal(JSON.stringify([selection, response]), before);
  assert.deepEqual(a.localeTasks.map(t => [t.locale, t.owner, t.status]), [["en", "LP", "REQUIRES_HUMAN_REVIEW"], ["hu", "LP", "REQUIRES_HUMAN_REVIEW"], ["ko", "OWNER", "REQUIRES_HUMAN_REVIEW"]]);
});
test("real existing intake refuses invalid environment/path; wrapper actually reaches guarded route", () => {
  assert.equal(runIntake(["validate", "--file", "relative.json"], {}).ok, false);
  const r = safe(run(["--owner-selected", "--candidate-id", id, "--file", "relative.json"], env));
  assert.equal(r.intakeStatus, "BLOCKED"); assert.deepEqual(r.diagnosticCodes, ["private_path_required"]);
});
test("real synthetic temporary fixture attempt inherits ACL boundary, never fakes structural PASS", t => {
  const root = fs.mkdtempSync(join(tmpdir(), "hanapure-web41-")), path = join(root, "synthetic.json");
  fs.writeFileSync(path, JSON.stringify({ publicId: id, brand: "Round Lab", slug: "synthetic-only", state: "draft", translations: { en: null, hu: null, ko: null } }), { flag: "wx", mode: 0o600 });
  const before = fs.readFileSync(path), r = safe(run(["--owner-selected", "--candidate-id", id, "--file", path], env));
  assert.deepEqual(fs.readFileSync(path), before);
  if (r.intakeStatus === "STRUCTURAL_VALIDATION_ONLY") assert.equal(r.draftCount, 1);
  else { assert.equal(r.intakeStatus, "BLOCKED"); assert.ok(r.diagnosticCodes.every(c => ["private_path_required", "input_unavailable"].includes(c))); }
  t.diagnostic("PHYSICAL_SYNTHETIC_ATTEMPT " + JSON.stringify({ intakeStatus: r.intakeStatus, diagnosticCodes: r.diagnosticCodes, privateContentUnchanged: true }));
});
test("real protected intake rejects synthetic malformed JSON, invalid UTF8 and oversized file", t => {
  const root = fs.mkdtempSync(join(tmpdir(), "hanapure-web41-"));
  for (const [name, bytes, expected] of [["json", Buffer.from("{"), "invalid_json"], ["utf8", Buffer.from([0xff]), "invalid_encoding"], ["large", Buffer.alloc(1000001, 65), "input_too_large"]]) {
    const path = join(root, name + ".json"); fs.writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    const r = safe(run(["--owner-selected", "--candidate-id", id, "--file", path], env));
    assert.equal(r.intakeStatus, "BLOCKED"); assert.deepEqual(r.diagnosticCodes, [expected]);
    t.diagnostic("PHYSICAL_SYNTHETIC_DENIAL " + JSON.stringify({ code: expected, observed: r.diagnosticCodes }));
  }
});
test("no new filesystem reader/writer/network; executable real CLI is not dependency injectable", t => {
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("network forbidden")); safe(run([], env)); assert.equal(fetch.mock.callCount(), 0);
  const target = new URL("../scripts/first-real-sku-evidence-preflight.mjs", import.meta.url), source = fs.readFileSync(target, "utf8");
  assert.doesNotMatch(source, /node:fs|readFile|openSync|writeFile|node:https?|\bfetch\s*\(|createServer|data\/catalogue/);
  assert.doesNotMatch(source, /\["(?:starter|compare|compare-csv)"/);
  assert.match(source, /intake\(\["validate", "--file", parsed.file\], safeEnvironment\)/);
  const r = spawnSync(process.execPath, ["--conditions=react-server", "--import", "./tests/server-only-loader.mjs", fileURLToPath(target)], { encoding: "utf8", env: { ...process.env, ...env, NODE_OPTIONS: "" } });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); safe(JSON.parse(r.stdout));
  assert.match(fs.readFileSync(new URL("../data/catalogue.ts", import.meta.url), "utf8"), /Object\.freeze\(\[\]\)/);
});
