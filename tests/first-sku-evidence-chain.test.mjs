import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { composeFirstSkuEvidenceChain as compose } from "../lib/storefront/first-sku-evidence-chain.ts";
import { projectFirstSkuPublicationTruth as project } from "../lib/storefront/first-sku-publication-truth.ts";
import { readEffectiveOperationalState } from "../lib/erp/effective-operational-state.ts";
import { OperationalSourceError } from "../lib/erp/product-operational.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";

const id = "a1234567-1234-4321-8123-123456789abc";
const other = "b1234567-1234-4321-8123-123456789abc";
const content = { name: "PRIVATE_EDITORIAL", description: "PRIVATE_DESCRIPTION", images: [], usage: null, caution: null };
const editorial = (patch = {}) => ({ publicId: id, brand: "Round Lab", slug: "synthetic-only", state: "published",
  translations: { en: content, hu: content, ko: content }, ...patch });
const published = createLocalCatalogueReader([editorial()]).findPublishedByPublicId(id);
const raw = (patch = {}) => ({ public_id: id, retail_price_huf: 1000, sellable_stock: 7, operational_ready: true, ...patch });
const body = (product = raw()) => ({ version: "1", product });
const manual = { publicId: id, mode: "FORCE_AVAILABLE", actorId: "PRIVATE_ACTOR", reason: "PRIVATE_REASON",
  createdAt: "2026-10-29T09:00:00Z", status: "ACTIVE" };
async function projection({ payload = raw(), error, override = null, storeFailure = false, item = published, locale = "en" } = {}) {
  let reads = 0;
  const effective = await readEffectiveOperationalState(id, {
    erpSource: { async readProduct() { reads++; if (error) throw error; return payload; } },
    overrideStore: { async getCurrent() { if (storeFailure) throw Error("PRIVATE_STORE"); return { record: override, revision: "PRIVATE_REVISION" }; },
      async save() { assert.fail("write forbidden"); }, async revoke() { assert.fail("write forbidden"); } },
  }, { now: "2026-10-29T10:00:00Z" });
  assert.equal(reads, 1);
  return project(id, item, locale, effective);
}
function verify(result) {
  for (const key of ["readyForLivePublication", "readyForCheckout", "trustedForLiveUse"]) assert.equal(result[key], false);
  for (const key of ["authenticity", "transportAttestation", "freshness"]) assert.equal(result[key], "UNVERIFIED");
  for (const key of ["expiry", "vatCheckout", "fulfillment"]) assert.equal(result[key], "NOT_EVALUATED");
  assert.equal(new Set(result.blockers.map(x => x.code)).size, result.blockers.length);
  assert.ok(result.blockers.every(x => typeof x.action === "string" && x.action.length > 10));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|retail_price_huf|basePriceHuf|actorId|signature|timestamp|ORDERABLE|CAN_CHECKOUT|PRODUCTION_READY|"PUBLISHED"/);
  return result;
}
const run = (p, b = body(), status = 200, selected = id, locale = "en") => verify(compose(selected, locale, p, status, b));
const codes = r => r.blockers.map(x => x.code);

test("real #32 + #35 composition: positive EN/HU/KO remains synthetic and blocked", async () => {
  for (const locale of ["en", "hu", "ko"]) {
    const result = run(await projection({ locale }), body(), 200, id, locale);
    assert.equal(result.classification, "STRUCTURAL_OK"); assert.equal(result.publicId, id);
    assert.equal(result.publication, "LOCAL_SYNTHETIC"); assert.equal(result.wire, "LOCAL_SYNTHETIC");
    assert.deepEqual(result.wireFacts, result.projectionFacts);
    assert.deepEqual(codes(result), ["AUTHENTICITY_UNVERIFIED", "TRANSPORT_UNVERIFIED", "FRESHNESS_UNVERIFIED", "COMMERCE_NOT_EVALUATED"]);
  }
});
test("zero and readiness=false retain facts, not a new availability algorithm", async () => {
  for (const patch of [{ sellable_stock: 0 }, { operational_ready: false }, { sellable_stock: 0, operational_ready: false }]) {
    const payload = raw(patch), result = run(await projection({ payload }), body(payload));
    assert.equal(result.classification, "STRUCTURAL_OK");
    assert.equal(codes(result).includes("ZERO_STOCK"), payload.sellable_stock === 0);
    assert.equal(codes(result).includes("NOT_READY"), !payload.operational_ready);
  }
});
test("wire version absent/wrong, malformed, NaN/negative/missing stock fail closed", async () => {
  const p = await projection();
  for (const b of [null, [], "PRIVATE_BODY", {}, { ...body(), version: "2" }, { ...body(), version: undefined },
    body(raw({ sellable_stock: NaN })), body(raw({ sellable_stock: -1 })), body(raw({ sellable_stock: undefined }))]) {
    const r = run(p, b); assert.equal(r.classification, "INVALID_OR_UNKNOWN"); assert.ok(codes(r).includes("WIRE_INVALID"));
  }
});
test("exact and case identity and locale bindings never silently join", async () => {
  const p = await projection();
  for (const public_id of [other, id.toUpperCase()]) {
    const r = run(p, body(raw({ public_id }))); assert.ok(codes(r).includes("IDENTITY_MISMATCH")); assert.equal(r.publicId, undefined);
  }
  for (const patch of [{ publicId: other }, { locale: "hu" }]) assert.ok(codes(run({ ...p, ...patch })).includes("IDENTITY_MISMATCH"));
  const invalid = run(p, body(), 200, "PRIVATE_INVALID", "fr");
  assert.deepEqual(codes(invalid).slice(0, 1), ["INVALID_SELECTION"]); assert.equal(invalid.publicId, undefined);
});
test("contract absence is only synthetic shape, generic404 and503 unavailable", async () => {
  const p = await projection({ error: new OperationalSourceError("product_not_found") });
  const absent = { version: "1", public_id: id, error: { code: "product_not_found" } };
  const r = run(p, absent, 404); assert.equal(r.classification, "CONTRACT_ABSENCE_ONLY");
  assert.ok(codes(r).includes("CONTRACT_ABSENCE_ONLY"));
  for (const [status, b] of [[404, { version: "1" }], [503, { version: "1", error: { code: "temporarily_busy" } }]]) {
    const result = run(p, b, status); assert.equal(result.classification, "UPSTREAM_UNAVAILABLE");
  }
});
test("read timeout, upstream and override failures do not become favorable evidence", async () => {
  for (const options of [{ error: new OperationalSourceError("timeout") }, { error: new OperationalSourceError("upstream_unavailable") }, { storeFailure: true }]) {
    const r = run(await projection(options), { version: "1" }, 503);
    assert.ok(codes(r).includes("UPSTREAM_UNAVAILABLE")); assert.notEqual(r.classification, "STRUCTURAL_OK");
  }
});
test("locale absent, draft, absent and private inputs never expose editorial details", async () => {
  const missing = await projection({ item: editorial({ translations: { en: null, hu: content, ko: content } }) });
  assert.ok(codes(run(missing)).includes("LOCALE_MISSING"));
  for (const item of [null, editorial({ state: "draft" }), editorial({ state: "unpublished" })]) {
    const result = run(await projection({ item })); assert.equal(result.publication, "MISSING");
    assert.equal(result.publicId, undefined); assert.ok(codes(result).includes("PUBLICATION_MISSING"));
  }
  assert.ok(codes(run({ private: "PRIVATE_DRAFT" })).includes("PROJECTION_INVALID"));
});
test("forged trust, signature, clocks and manual FORCE_AVAILABLE never grant authority", async () => {
  for (const payload of [raw(), raw({ sellable_stock: 0, operational_ready: false }), null]) {
    const p = await projection({ payload, override: manual });
    const r = run(p, { ...body(payload), trusted: true, issuer: "PRIVATE_ISSUER", signature: "PRIVATE_SIGNATURE", timestamp: "2999-01-01", freshness: true });
    assert.ok(codes(r).includes("MANUAL_INTENT_ONLY"));
  }
});
test("contradictory valid snapshots are blockers, stable deduplicated order", async () => {
  const p = await projection(), r = run(p, body(raw({ sellable_stock: 0, operational_ready: false })));
  assert.equal(r.classification, "INVALID_OR_UNKNOWN"); assert.ok(codes(r).includes("EVIDENCE_CONFLICT"));
  assert.equal(r.publicId, undefined); assert.deepEqual(r, run(p, body(raw({ sellable_stock: 0, operational_ready: false }))));
  const positive = run(await projection({ error: new OperationalSourceError("product_not_found") }), body());
  assert.ok(codes(positive).includes("EVIDENCE_CONFLICT"));
});
test("getters and unexpected inputs fail safely; no mutation, fetch or callbacks", async t => {
  const p = await projection(), before = JSON.stringify(p), b = body(), bBefore = JSON.stringify(b);
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("network forbidden"));
  run(p, b); assert.equal(fetch.mock.callCount(), 0); assert.equal(JSON.stringify(p), before); assert.equal(JSON.stringify(b), bBefore);
  const getter = { get state() { assert.fail("getter forbidden"); } }; run(getter);
  const throwing = new Proxy({}, { getPrototypeOf() { throw Error("PRIVATE_TRAP"); } });
  assert.equal(run(throwing).classification, "INVALID_OR_UNKNOWN");
  for (const pBad of [null, [], 7, { ...p, erpFacts: { sellableStock: NaN, operationalReady: true } }]) {
    assert.ok(codes(run(pBad)).includes("PROJECTION_INVALID"));
  }
});
test("server-only enforcement and source boundary; public catalogue stays empty", () => {
  const target = new URL("../lib/storefront/first-sku-evidence-chain.ts", import.meta.url);
  const source = readFileSync(target, "utf8"); assert.ok(source.startsWith('import "server-only";'));
  assert.doesNotMatch(source, /node:|\bfetch\s*\(|process\.|Date\.|setTimeout|\.save\(|\.revoke\(|\.write\(/);
  assert.match(readFileSync(new URL("../data/catalogue.ts", import.meta.url), "utf8"), /Object\.freeze\(\[\]\)/);
  const child = spawnSync(process.execPath, ["--import", new URL("./server-only-loader.mjs", import.meta.url).href,
    "--input-type=module", "--eval", `await import(${JSON.stringify(target.href)})`], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error); assert.notEqual(child.status, 0); assert.match(child.stderr, /cannot be imported from a Client Component module/);
  const callers = spawnSync("git", ["grep", "-l", "first-sku-evidence-chain", "--", "app", "components", "data"], { encoding: "utf8" });
  assert.ifError(callers.error); assert.equal(callers.status, 1); assert.equal(callers.stdout, "");
});
