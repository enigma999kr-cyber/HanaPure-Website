import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { generateOperatorPreviews, renderOperatorPreview as render, syntheticDecision, SYNTHETIC_ID as id } from "../scripts/first-sku-operator-offline-preview.mjs";
import { composeFirstSkuEvidenceChain as compose } from "../lib/storefront/first-sku-evidence-chain.ts";
import { projectFirstSkuPublicationTruth as project } from "../lib/storefront/first-sku-publication-truth.ts";
import { readEffectiveOperationalState } from "../lib/erp/effective-operational-state.ts";

const options = { locale: "en", selectedPublicId: id };
const raw = patch => ({ public_id: id, retail_price_huf: 1000, sellable_stock: 7, operational_ready: true, ...patch });
async function decision(patch = {}, { absent = false, missingLocale = false, manual = false, claims = {} } = {}) {
  const product = raw(patch), content = { name: "PRIVATE_SECRET", description: "PRIVATE_DRAFT", images: [], usage: null, caution: null };
  const editorial = { publicId: id, brand: "Round Lab", slug: "synthetic-only", state: absent ? "draft" : "published", translations: { en: missingLocale ? null : content, hu: content, ko: content } };
  const effective = await readEffectiveOperationalState(id, {
    erpSource: { async readProduct() { return product; } },
    overrideStore: { async getCurrent() { return { record: manual ? { publicId: id, mode: "FORCE_AVAILABLE", actorId: "PRIVATE_ACTOR", reason: "PRIVATE_REASON", createdAt: "2026-10-29T00:00:00Z", status: "ACTIVE" } : null, revision: manual ? "PRIVATE_REVISION" : null }; } },
  }, { now: "2026-10-29T01:00:00Z" });
  return compose(id, "en", project(id, editorial, "en", effective), 200, { version: "1", product, ...claims });
}
function safe(html) {
  assert.match(html, /SYNTHETIC \/ DEV REVIEW ONLY \/ NOT AUTHORIZED FOR SALES/);
  assert.match(html, /false/);
  assert.doesNotMatch(html, /PRIVATE_|<script|<svg|onerror=|https?:\/\/|localStorage|retail_price_huf|actorId|PRIVATE_ACTOR/);
}
function rejected(dto) {
  const html = render(dto, options); safe(html);
  assert.match(html, /Blocked: invalid or unsupported evidence/); assert.doesNotMatch(html, new RegExp(id));
}

test("actual generator writes three exclusive standalone temp HTML artifacts and manifest", async () => {
  const result = await generateOperatorPreviews("en");
  const root = await realpath(tmpdir()), child = await realpath(result.directory), rel = relative(root, child);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
  assert.deepEqual((await readdir(result.directory)).sort(), ["blocked-en.html", "manifest.json", "structure-en.html", "unavailable-en.html"]);
  assert.deepEqual(result.files.map(f => f.classification), ["INVALID_OR_UNKNOWN", "STRUCTURAL_OK", "UPSTREAM_UNAVAILABLE"]);
  for (const f of result.files) { const html = await readFile(f.path, "utf8"); safe(html); assert.match(html, new RegExp(f.classification)); assert.match(html, /<ol><li>/); }
  const manifest = JSON.parse(await readFile(result.directory + "/manifest.json", "utf8"));
  assert.equal(manifest.browser, "NOT_EVALUATED"); assert.equal(manifest.trustedForLiveUse, false);
});
test("EN HU KO copy, explicit English action fallback, heading order and print styles", async () => {
  for (const [locale, heading] of [["en", "First-SKU operator review"], ["hu", "Első SKU"], ["ko", "첫 SKU 운영자 검토"]]) {
    const html = render(await syntheticDecision("structure", locale), { ...options, locale });
    safe(html); assert.match(html, new RegExp(`<html lang="${locale}">`)); assert.match(html, new RegExp(heading));
    assert.equal((html.match(/<h1>/g) ?? []).length, 1); assert.match(html, /href="#blockers"/);
    assert.match(html, /id="blockers" tabindex="-1"/); assert.match(html, /@media print/); assert.match(html, /<p lang="en">/);
  }
  assert.throws(() => render({}, { locale: "fr" }), /UNSUPPORTED_PREVIEW_LOCALE/);
  await assert.rejects(generateOperatorPreviews(".."), /UNSUPPORTED_PREVIEW_LOCALE/);
});
test("known zero, false, unknown stock and manual intent remain blocked", async () => {
  for (const patch of [{ sellable_stock: 0 }, { operational_ready: false }, { sellable_stock: undefined }, { sellable_stock: -1 }, { sellable_stock: NaN }]) {
    const d = await decision(patch, { manual: true }), html = render(d, options); safe(html);
    assert.match(html, /MANUAL_INTENT_ONLY/);
    if (patch.sellable_stock === 0) assert.match(html, /Stock: 0/);
    if (patch.operational_ready === false) assert.match(html, /Operational readiness: false/);
    if (Object.hasOwn(patch, "sellable_stock") && (patch.sellable_stock === undefined || patch.sellable_stock < 0 || Number.isNaN(patch.sellable_stock))) assert.match(html, /Unknown \/ unavailable/);
  }
});
test("draft and locale gaps preserve private boundary; forged flags never authorize", async () => {
  const draft = render(await decision({}, { absent: true }), options); safe(draft); assert.match(draft, /PUBLICATION_MISSING/); assert.doesNotMatch(draft, new RegExp(id));
  assert.match(render(await decision({}, { missingLocale: true }), options), /LOCALE_MISSING/);
  const d = await decision({}, { claims: { issuer: "PRIVATE_ISSUER", signature: "PRIVATE_SIGNATURE", timestamp: "2999-01-01", trusted: true } });
  safe(render(d, options)); assert.equal(d.trustedForLiveUse, false);
});
test("real compose malformed versions identity mismatch and contract404 distinction", async () => {
  const unavailable = project(id, null, "en", null);
  for (const b of [null, [], {}, { version: "2" }, { version: "1", product: raw({ public_id: id.toUpperCase() }) }]) {
    const html = render(compose(id, "en", unavailable, 200, b), options); safe(html); assert.match(html, /INVALID_OR_UNKNOWN/);
  }
  const absent = compose(id, "en", unavailable, 404, { version: "1", public_id: id, error: { code: "product_not_found" } });
  const html = render(absent, options); safe(html); assert.match(html, /Contract shape only; not proof of real ERP absence/);
});
test("strict DTO whitelist rejects flags, unknown missing fields and identity mismatch", async () => {
  const d = await syntheticDecision("structure");
  for (const key of ["readyForLivePublication", "readyForCheckout", "trustedForLiveUse"]) rejected({ ...d, [key]: true });
  for (const key of Object.keys(d)) { const copy = structuredClone(d); delete copy[key]; if (key !== "publicId") rejected(copy); }
  for (const patch of [{ extra: "PRIVATE_SECRET" }, { classification: "APPROVED" }, { publicId: id.toUpperCase() }, { authenticity: "VERIFIED" }, { projectionFacts: { sellableStock: -1, operationalReady: true } }]) rejected({ ...d, ...patch });
});
test("hostile HTML attribute inputs and overlong/unknown/duplicate/out-of-order actions refused", async () => {
  const d = await syntheticDecision("structure");
  for (const blockers of [ [...d.blockers, d.blockers[0]], [{ code: "UNKNOWN", action: "PRIVATE_SECRET" }, ...d.blockers],
    [{ ...d.blockers[0], action: '<svg onload="PRIVATE_SECRET">' }, ...d.blockers.slice(1)],
    [{ code: "A".repeat(100000), action: "PRIVATE_SECRET" }], [...d.blockers].reverse(), Array(18).fill(d.blockers[0])]) rejected({ ...d, blockers });
  rejected({ ...d, publicId: '"><img onerror="PRIVATE_SECRET">' });
  rejected({ ...d, wireFacts: { sellableStock: 7, operationalReady: true, private: "PRIVATE_SECRET" } });
});
test("contradictory state and fact combinations cannot be displayed as valid", async () => {
  const d = await syntheticDecision("structure");
  for (const patch of [{ wire: "UNAVAILABLE" }, { wireFacts: null }, { publication: "MISSING" },
    { wireFacts: { sellableStock: 0, operationalReady: true } }, { classification: "UPSTREAM_UNAVAILABLE" }]) rejected({ ...d, ...patch });
});
test("descriptor getters and thrown traps fail closed; no mutation or real network", async t => {
  const d = await syntheticDecision("structure"), before = JSON.stringify(d);
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("network forbidden"));
  const accessor = { ...d }; Object.defineProperty(accessor, "classification", { get() { assert.fail("getter invoked"); } }); rejected(accessor);
  rejected(new Proxy({}, { ownKeys() { throw Error("PRIVATE_SECRET"); } }));
  safe(render(d, options)); assert.equal(JSON.stringify(d), before); assert.equal(fetch.mock.callCount(), 0);
});
test("no listener/public import, narrow generated writes, actual server-only guard", async () => {
  const source = await readFile(new URL("../scripts/first-sku-operator-offline-preview.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:https?|\bfetch\s*\(|createServer|\.listen\(|localStorage|data\/catalogue|\.save\(/);
  assert.match(source, /mkdtemp\(join\(tmpdir\(\)/); assert.match(source, /flag: "wx"/);
  const child = spawnSync(process.execPath, ["--import", new URL("./server-only-loader.mjs", import.meta.url).href, "--input-type=module", "--eval",
    `await import(${JSON.stringify(new URL("../scripts/first-sku-operator-offline-preview.mjs", import.meta.url).href)})`], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error); assert.notEqual(child.status, 0); assert.match(child.stderr, /cannot be imported from a Client Component module/);
  const callers = spawnSync("git", ["grep", "-l", "first-sku-operator-offline-preview", "--", "app", "components", "data"], { encoding: "utf8" });
  assert.ifError(callers.error); assert.equal(callers.status, 1); assert.equal(callers.stdout, "");
});
