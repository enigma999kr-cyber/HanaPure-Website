import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { reviewFirstSkuEditorialDraft as review } from "../lib/catalog/first-sku-editorial-review.ts";
import { syntheticEditorialTemplate as template, runSyntheticEditorialReview as adapter } from "../scripts/first-sku-editorial-review.mjs";
function limits(r) {
  for (const key of ["readyForLivePublication", "readyForCheckout", "trustedForLiveUse"]) assert.equal(r[key], false);
  assert.equal(r.version, "1"); assert.equal(r.outsideSuppliedCollisionCheck, "NOT_EVALUATED");
  for (const code of ["LANGUAGE_CORRECTNESS", "CLAIMS_LEGAL_INCI", "PHOTO_RIGHTS", "SEO_SIGNOFF", "ACCESSIBILITY_MANUAL", "HUMAN_EDITORIAL_SIGNOFF", "ERP_AUTHENTICITY", "ERP_FRESHNESS", "STOCK", "PRICING_VAT", "COMMERCE_CHECKOUT"]) assert.ok(r.notEvaluated.includes(code));
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET|onerror|<script|rawBody|"images":|Round Lab|synthetic-review-only/);
  for (const locale of ["en", "hu", "ko"]) assert.ok(r.editorTasks[locale].some(t => t.code === "HUMAN_REVIEW_REQUIRED"));
  return r;
}
const run = input => limits(review(input));
function invalid(input) { const r = run(input); assert.equal(r.status, "INVALID_INPUT"); assert.equal(r.selectedPublicId, undefined); return r; }

test("three complete locales invite HUMAN review only, optional fields and collisions remain unapproved", () => {
  const r = run(template()); assert.equal(r.status, "READY_FOR_HUMAN_EDITORIAL_REVIEW");
  for (const l of ["en", "hu", "ko"]) { assert.equal(r.locales[l], "COMPLETE_FOR_REVIEW"); assert.equal(r.optionalContent[l].usage, "NOT_SUPPLIED"); assert.equal(r.optionalContent[l].caution, "NOT_SUPPLIED"); }
  assert.equal(r.comparisonScope, "NOT_EVALUATED"); assert.notEqual(r.editorTasks.en[0].action, r.editorTasks.hu[0].action); assert.notEqual(r.editorTasks.hu[0].action, r.editorTasks.ko[0].action);
});
test("one-locale input produces concrete EN/HU/KO editor task lists with no fallback", () => {
  const r = run(template("one")); assert.equal(r.status, "DRAFT_INCOMPLETE");
  assert.equal(r.locales.en, "COMPLETE_FOR_REVIEW"); assert.equal(r.locales.hu, "MISSING"); assert.equal(r.locales.ko, "MISSING");
  assert.deepEqual(r.issues.map(i => i.code), ["LOCALE_MISSING", "LOCALE_MISSING"]);
  assert.match(r.editorTasks.ko[0].action, /언어/);
});
test("blank title description and supplied image alt get ordered field-specific issues", () => {
  const t = template(); t.draft.translations.en.name = " "; t.draft.translations.en.description = "\n"; t.draft.translations.en.images[0].alt = " ";
  const r = run(t); assert.equal(r.status, "DRAFT_INCOMPLETE");
  assert.deepEqual(r.issues.map(i => i.code), ["NAME_MISSING", "DESCRIPTION_MISSING", "ALT_MISSING"]); assert.equal(r.locales.en, "INCOMPLETE");
});
test("wrong locale key and suspected copy reuse never silently certify translation", () => {
  const t = template(); t.draft.translations.hu = structuredClone(t.draft.translations.en);
  const r = run(t); assert.equal(r.status, "DRAFT_INCOMPLETE"); assert.ok(r.issues.some(i => i.code === "POSSIBLE_LOCALE_REUSE"));
  const wrong = template(); wrong.draft.translations.fr = wrong.draft.translations.hu; delete wrong.draft.translations.hu; invalid(wrong);
});
test("strict selected identity, draft state, brand and slug use existing validator", () => {
  for (const patch of [{ publicId: "not-uuid" }, { publicId: "b1234567-1234-4321-8123-123456789abc" }, { state: "published" }, { brand: "Unknown" }, { slug: "../private" }, { slug: "Bad Slug" }]) {
    const t = template(); Object.assign(t.draft, patch); invalid(t);
  }
  const t = template(); t.selectedPublicId = t.selectedPublicId.toUpperCase(); invalid(t);
});
test("supplied comparisons detect duplicate UUID/slug; unknown outside set never PASS", () => {
  for (const sameIdentity of [true, false]) {
    const t = template(), other = structuredClone(t.draft);
    if (sameIdentity) other.slug = "other-synthetic"; else other.publicId = "b1234567-1234-4321-8123-123456789abc";
    t.comparisons = [other]; assert.ok(invalid(t).issues.some(i => i.code === "COLLISION"));
  }
  const t = template(), other = structuredClone(t.draft); other.publicId = "b1234567-1234-4321-8123-123456789abc"; other.slug = "other-synthetic";
  t.comparisons = [other]; assert.equal(run(t).comparisonScope, "LOCAL_SUPPLIED_ONLY");
});
test("malformed media, traversal and XSS/plain-text attacks fail without payload echo", () => {
  for (const src of ["javascript:PRIVATE_SECRET", "//external.invalid/x", "http://external.invalid/x", "/../private", "/%2e%2e/private", "<svg onload=PRIVATE_SECRET>"]) {
    const t = template(); t.draft.translations.en.images[0].src = src; invalid(t);
  }
  for (const key of ["name", "description", "usage", "caution"]) { const t = template(); t.draft.translations.en[key] = "<script>PRIVATE_SECRET</script>"; invalid(t); }
  const t = template(); t.draft.translations.en.images[0].alt = "<img onerror=PRIVATE_SECRET>"; invalid(t);
});
test("forged authority flags and extra fields never produce approval", () => {
  for (const key of ["approved", "readyForCheckout", "trusted", "timestamp", "signature", "issuer"]) {
    const t = template(); t.draft[key] = "PRIVATE_SECRET"; invalid(t);
  }
  const t = template(); t.scope = "REAL"; invalid(t);
  for (const value of [null, [], "PRIVATE_SECRET", 7, { scope: "SYNTHETIC_ONLY" }]) invalid(value);
});
test("bounded data, prototypes, accessors and proxies rejected without traps", () => {
  const big = template(); big.draft.translations.en.description = "X".repeat(4001); invalid(big);
  const getter = template(); Object.defineProperty(getter.draft, "slug", { get() { assert.fail("getter invoked"); } }); invalid(getter);
  invalid(new Proxy({}, { ownKeys() { assert.fail("Proxy trap invoked"); } }));
  const polluted = template(); Object.setPrototypeOf(polluted.draft, { inherited: "PRIVATE_SECRET" }); invalid(polluted);
  const many = template(); many.comparisons = Array(21).fill(many.draft); invalid(many);
});
test("immutable deterministic pure output; no hidden network and optional supply is not legal approval", t => {
  const input = template(); input.draft.translations.ko.usage = "합성 사용법"; input.draft.translations.en.name = "PRIVATE_SECRET";
  const before = JSON.stringify(input), fetch = t.mock.method(globalThis, "fetch", () => assert.fail("network forbidden"));
  const a = run(input), b = run(input); assert.deepEqual(a, b); assert.equal(JSON.stringify(input), before); assert.equal(fetch.mock.callCount(), 0);
  assert.equal(a.optionalContent.ko.usage, "SUPPLIED"); assert.equal(a.status, "READY_FOR_HUMAN_EDITORIAL_REVIEW");
});
test("actual adapter consumes explicit bounded synthetic stdin and sanitizes failures", async () => {
  const t = template(); const r = limits(await adapter(["--synthetic-stdin"], Readable.from([JSON.stringify(t)])));
  assert.equal(r.status, "READY_FOR_HUMAN_EDITORIAL_REVIEW");
  for (const bytes of [Buffer.from('{"PRIVATE_SECRET":'), Buffer.from([0xff]), Buffer.alloc(65537)]) {
    const bad = limits(await adapter(["--synthetic-stdin"], Readable.from([bytes]))); assert.equal(bad.status, "INVALID_INPUT");
  }
  assert.equal((await adapter(["--file", "C:/PRIVATE_SECRET.json"], null)).status, "INVALID_INPUT");
  assert.equal((await adapter(["--sample", "all"], null, { NODE_ENV: "production" })).status, "INVALID_INPUT");
});
test("real CLI child executes local template-to-review flow and genuine server-only rejection", () => {
  const cli = new URL("../scripts/first-sku-editorial-review.mjs", import.meta.url);
  const child = spawnSync(process.execPath, ["--conditions=react-server", "--import", new URL("./server-only-loader.mjs", import.meta.url).href, cli.pathname.replace(/^\/(.:\/)/,"$1"), "--synthetic-stdin"],
    { input: JSON.stringify(template()), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", NODE_ENV: "development" } });
  assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); limits(JSON.parse(child.stdout));
  const guard = spawnSync(process.execPath, ["--import", new URL("./server-only-loader.mjs", import.meta.url).href, "--input-type=module", "--eval", `await import(${JSON.stringify(cli.href)})`], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(guard.error); assert.notEqual(guard.status, 0); assert.match(guard.stderr, /cannot be imported from a Client Component module/);
});
test("no file adapter bypass, no public callers and EMPTY catalogue; no prior suite replay", () => {
  const source = readFileSync(new URL("../lib/catalog/first-sku-editorial-review.ts", import.meta.url), "utf8");
  const cli = readFileSync(new URL("../scripts/first-sku-editorial-review.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source + cli, /node:fs|node:https?|\bfetch\s*\(|createServer|\.listen\(|writeFile|readFile|localStorage|data\/catalogue/);
  assert.match(readFileSync(new URL("../data/catalogue.ts", import.meta.url), "utf8"), /Object\.freeze\(\[\]\)/);
  const callers = spawnSync("git", ["grep", "-l", "first-sku-editorial-review", "--", "app", "components", "data"], { encoding: "utf8" }); assert.ifError(callers.error); assert.equal(callers.status, 1);
});
