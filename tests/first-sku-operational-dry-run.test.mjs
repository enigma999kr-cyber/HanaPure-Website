import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { dryRunFirstSkuOperationalEvidence as dryRun } from "../lib/storefront/first-sku-operational-dry-run.ts";
import { projectFirstSkuPublicationTruth as project } from "../lib/storefront/first-sku-publication-truth.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { createHttpsOperationalSource } from "../lib/erp/https-operational-source.ts";

const id = "a1234567-1234-4321-8123-123456789abc", other = "b1234567-1234-4321-8123-123456789abc";
const now = "2026-10-29T12:00:00Z";
const content = { name: "PRIVATE_TEST_EDITORIAL", description: "Synthetic only, never published.",
  images: [{ src: "/PRIVATE_TEST_MEDIA.svg", alt: "PRIVATE_TEST_ALT" }], usage: null, caution: null };
const editorial = (patch = {}) => ({ publicId: id, brand: "Round Lab", slug: "synthetic-only", state: "published",
  translations: { en: content, hu: { ...content, name: "PRIVATE_TEST_HU" }, ko: { ...content, name: "PRIVATE_TEST_KO" } }, ...patch });
const published = createLocalCatalogueReader([editorial()]).findPublishedByPublicId(id);
const raw = (patch = {}) => ({ public_id: id, retail_price_huf: 1000, sellable_stock: 7, operational_ready: true, ...patch });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const found = (product = raw()) => json({ version: "1", product });
const manual = (mode, patch = {}) => ({ publicId: id, mode, actorId: "PRIVATE_TEST_ACTOR", reason: "PRIVATE_TEST_REASON",
  createdAt: "2026-10-29T11:00:00Z", status: "ACTIVE", ...patch });
let setups, globalFetch;
beforeEach(t => {
  setups = [];
  globalFetch = t.mock.method(globalThis, "fetch", () => { throw new Error("UNEXPECTED_REAL_FETCH"); });
});
afterEach(() => {
  assert.equal(globalFetch.mock.callCount(), 0, "real global fetch must never be used");
  for (const ctx of setups) {
    assert.equal(ctx.counts.writes, 0);
    assert.ok(ctx.counts.erp <= 1 && ctx.counts.override <= 1 && ctx.counts.fetch <= 1, "one operation per supplied context, no retries");
  }
});
function setup({ response = () => found(), override = null, noSource = false, storeFailure = false,
  auth = () => ({ "x-test-service-auth": "PRIVATE_TEST_AUTH" }), timeoutMs = 1000 } = {}) {
  const counts = { erp: 0, override: 0, fetch: 0, auth: 0, writes: 0 }, calls = [];
  const source = createHttpsOperationalSource({ gatewayOrigin: "https://gateway.invalid", timeoutMs,
    authHeaders: signal => { counts.auth++; return auth(signal); } }, {
    fetch: async (url, init) => { counts.fetch++; calls.push({ url, init }); return response(url, init); },
  });
  const dependencies = {
    erpSource: noSource ? undefined : { readProduct(publicId, options) {
      counts.erp++; assert.equal(publicId, id); return source.readProduct(publicId, options);
    } },
    overrideStore: {
      async getCurrent(publicId) {
        counts.override++; assert.equal(publicId, id);
        if (storeFailure) throw new Error("PRIVATE_TEST_STORE_CREDENTIAL");
        return { record: override, revision: override ? "PRIVATE_TEST_REVISION" : null };
      },
      async save() { counts.writes++; assert.fail("save prohibited"); },
      async revoke() { counts.writes++; assert.fail("revoke prohibited"); },
    },
  };
  const ctx = { dependencies, counts, calls,
    run: (locale = "en", item = published, options = {}) => dryRun(id, item, locale, dependencies, { now, ...options }) };
  setups.push(ctx); return ctx;
}
function limits(result) {
  assert.equal(result.checkoutAuthorization, "NOT_EVALUATED"); assert.equal(result.freshness, "NOT_EVALUATED");
  assert.ok(result.blockers.includes("CHECKOUT_NOT_EVALUATED")); assert.ok(result.blockers.includes("FRESHNESS_NOT_EVALUATED"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TEST|UNEXPECTED_REAL_FETCH|basePriceHuf|retail_price_huf|activeOverride|overrideError|authHeaders|rawError|ORDERABLE|CAN_CHECKOUT|LIVE_INTEGRATED|PRODUCTION_READY/);
}
function unavailable(result, evidence) {
  limits(result); assert.equal(result.state, "PUBLISHED_OPERATIONAL_UNAVAILABLE");
  assert.ok(result.blockers.includes("OPERATIONAL_EVIDENCE_UNAVAILABLE"));
  if (evidence) assert.equal(result.evidence, evidence);
}
function exactlyOnce(ctx, fetchCount = 1) {
  assert.equal(ctx.counts.erp, 1); assert.equal(ctx.counts.override, 1); assert.equal(ctx.counts.fetch, fetchCount);
}

test("P1 publication/identity/locale refusal precedes every operational, override and auth callback", async () => {
  const cases = [[id, null, "en"], [id, undefined, "en"], [id, editorial({ state: "draft" }), "en"],
    [id, editorial({ brand: "unknown" }), "en"], [id, editorial({ translations: {} }), "en"],
    [id, { ...editorial(), state: "unpublished" }, "en"], [other, published, "en"], ["../invalid", published, "en"],
    [id.toUpperCase(), published, "en"], [id, published, "fr"]];
  for (const [selected, item, locale] of cases) {
    const ctx = setup(); const result = await dryRun(selected, item, locale, ctx.dependencies, { now });
    assert.deepEqual(result, project(selected, item, locale, null)); limits(result);
    assert.equal(result.state, "UNPUBLISHED_OR_ABSENT");
    assert.deepEqual(Object.keys(result).sort(), ["state", "checkoutAuthorization", "freshness", "blockers"].sort());
    assert.deepEqual(ctx.counts, { erp: 0, override: 0, fetch: 0, auth: 0, writes: 0 });
  }
  const forbidden = new Proxy({}, { get() { assert.fail("private editorial must not inspect dependencies/options"); } });
  const result = await dryRun(id, editorial({ state: "draft" }), "en", forbidden, forbidden);
  assert.equal(result.state, "UNPUBLISHED_OR_ABSENT");
});

test("P2 complete EN HU KO publication performs one joined read and returns only signal diagnostics", async () => {
  for (const locale of ["en", "hu", "ko"]) {
    const ctx = setup(), result = await ctx.run(locale); limits(result); exactlyOnce(ctx);
    assert.equal(result.state, "PUBLISHED_OPERATIONAL_SIGNAL_ONLY"); assert.equal(result.publicId, id);
    assert.equal(result.locale, locale); assert.equal(result.selectedLocaleContent, "PRESENT");
    assert.equal(result.provenance, "ERP"); assert.deepEqual(result.erpFacts, { operationalReady: true, sellableStock: 7 });
  }
});

test("P3 selected locale missing remains MISSING with no fallback despite other translations", async () => {
  for (const locale of ["en", "hu", "ko"]) {
    const item = createLocalCatalogueReader([editorial({ translations: { ...editorial().translations, [locale]: null } })]).findPublishedByPublicId(id);
    const ctx = setup(), result = await ctx.run(locale, item); limits(result); exactlyOnce(ctx);
    assert.equal(result.selectedLocaleContent, "MISSING"); assert.ok(result.blockers.includes("SELECTED_LOCALE_MISSING"));
    assert.equal(result.state, "PUBLISHED_OPERATIONAL_SIGNAL_ONLY");
  }
});

test("P4 readiness false and genuine zero stock preserve distinct inherited classifications", async () => {
  for (const [payload, state] of [[raw({ operational_ready: false }), "PUBLISHED_NOT_READY"], [raw({ sellable_stock: 0 }), "PUBLISHED_OUT_OF_STOCK"]]) {
    const ctx = setup({ response: () => found(payload) }), result = await ctx.run(); limits(result); exactlyOnce(ctx);
    assert.equal(result.state, state); assert.equal(result.provenance, "ERP");
    assert.deepEqual(result.erpFacts, { operationalReady: payload.operational_ready, sellableStock: payload.sellable_stock });
  }
});

for (const [mode, state] of [["SALES_PAUSED", "PUBLISHED_SALES_PAUSED"], ["FORCE_OUT_OF_STOCK", "PUBLISHED_OUT_OF_STOCK"], ["FORCE_AVAILABLE", "PUBLISHED_OPERATIONAL_SIGNAL_ONLY"]]) {
  test(`P5 ${mode} preserves known contrary facts and unavailable ERP as manual intent only`, async () => {
    for (const payload of [raw(), raw({ sellable_stock: 0, operational_ready: false }), null]) {
      const ctx = setup({ override: manual(mode), response: () => { if (payload === null) throw Error("PRIVATE_TEST_NETWORK"); return found(payload); } });
      const result = await ctx.run(); limits(result); exactlyOnce(ctx);
      assert.equal(result.state, state); assert.equal(result.provenance, "MANUAL_OVERRIDE");
      assert.ok(result.blockers.includes("MANUAL_INTENT_ONLY"));
      assert.deepEqual(result.erpFacts, payload === null ? null : { operationalReady: payload.operational_ready, sellableStock: payload.sellable_stock });
    }
  });
}

test("P6 real internal HTTPS adapter -> reader -> resolver -> projector uses one injected no-store request", async () => {
  const ctx = setup(), result = await ctx.run(); limits(result); exactlyOnce(ctx);
  const [{ url, init }] = ctx.calls;
  assert.equal(url, `https://gateway.invalid/v1/products/${id}/operational`);
  assert.equal(init.method, "GET"); assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error"); assert.equal(init.headers.get("accept"), "application/json");
  assert.equal(init.headers.get("x-test-service-auth"), "PRIVATE_TEST_AUTH");
  assert.equal(result.evidence, "KNOWN");
});

test("P7 trusted JSON absence differs from generic404 and malformed contract/identity/fields", async () => {
  const trusted = setup({ response: () => json({ version: "1", public_id: id, error: { code: "product_not_found" } }, 404), override: manual("FORCE_AVAILABLE") });
  const absent = await trusted.run(); unavailable(absent, "PRODUCT_NOT_FOUND"); exactlyOnce(trusted);
  assert.equal(absent.effectiveAvailability, "PRODUCT_NOT_FOUND");
  const bad = [() => new Response("PRIVATE_TEST_404", { status: 404, headers: { "content-type": "text/html" } }),
    () => json({}, 404), () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => new Response("PRIVATE_TEST_HTML", { headers: { "content-type": "text/html" } }),
    () => json({ version: "2", product: raw() }), () => json({ version: "1", product: raw({ public_id: other }) }),
    () => found(raw({ public_id: id.toUpperCase() })), () => found(raw({ sellable_stock: "7" })),
    () => found(raw({ operational_ready: "true" })), () => found({ public_id: id })];
  for (const response of bad) { const ctx = setup({ response }); unavailable(await ctx.run(), "INVALID"); exactlyOnce(ctx); }
});

test("P8 timeout and in-flight/already-aborted cancellation never retry or invent business absence", async () => {
  const timed = setup({ timeoutMs: 20, response: () => new Promise(() => {}) });
  unavailable(await timed.run(), "UNAVAILABLE"); exactlyOnce(timed); assert.equal(timed.calls[0].init.signal.aborted, true);
  const started = Promise.withResolvers(), controller = new AbortController();
  const cancelled = setup({ response: () => { started.resolve(); return new Promise(() => {}); } });
  const pending = cancelled.run("en", published, { signal: controller.signal });
  await started.promise; controller.abort(); unavailable(await pending, "UNAVAILABLE"); exactlyOnce(cancelled);
  assert.equal(cancelled.calls[0].init.signal.aborted, true);
  const already = setup(); unavailable(await already.run("en", published, { signal: controller.signal }), "UNAVAILABLE");
  exactlyOnce(already, 0); assert.equal(already.counts.auth, 0);
});

test("P8 late auth after timeout cannot start a delayed request", async () => {
  let release;
  const ctx = setup({ timeoutMs: 20, auth: () => new Promise(resolve => { release = resolve; }) });
  unavailable(await ctx.run(), "UNAVAILABLE"); exactlyOnce(ctx, 0);
  release({ "x-test-service-auth": "PRIVATE_TEST_LATE" }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.counts.fetch, 0);
});

test("P9 override-store exceptions preserve operational failure without leaking metadata or writing", async () => {
  const ctx = setup({ storeFailure: true }), result = await ctx.run(); unavailable(result); exactlyOnce(ctx);
  assert.equal(result.effectiveAvailability, "OPERATIONAL_FAILURE"); assert.equal(result.provenance, "UNAVAILABLE");
  assert.deepEqual(result.erpFacts, { operationalReady: true, sellableStock: 7 });
});

test("P10 absent source auth/rate/network/upstream errors fail closed without hidden default reads", async () => {
  const missing = setup({ noSource: true }), result = await missing.run(); unavailable(result, "NO_SOURCE");
  assert.deepEqual(missing.counts, { erp: 0, override: 1, fetch: 0, auth: 0, writes: 0 });
  for (const status of [401, 403, 429, 500]) {
    const ctx = setup({ response: () => new Response(null, { status }) }); unavailable(await ctx.run(), "UNAVAILABLE"); exactlyOnce(ctx);
  }
  for (const code of ["temporarily_busy", "erp_read_unavailable"]) {
    const ctx = setup({ response: () => json({ version: "1", public_id: id, error: { code }, private: "PRIVATE_TEST_UPSTREAM" }, 503) });
    unavailable(await ctx.run(), "UNAVAILABLE"); exactlyOnce(ctx);
  }
  const network = setup({ response: () => { throw Error("PRIVATE_TEST_CONNECTION"); } }); unavailable(await network.run()); exactlyOnce(network);
  const auth = setup({ auth: () => { throw Error("PRIVATE_TEST_AUTH_ERROR"); } }); unavailable(await auth.run()); exactlyOnce(auth, 0);
});

test("P11 unexpected dependency/options exceptions return safe existing projection only", async () => {
  const dependencies = { get erpSource() { throw Error("PRIVATE_TEST_DEPENDENCY"); }, get overrideStore() { assert.fail("must not continue reading after synchronous failure"); } };
  unavailable(await dryRun(id, published, "en", dependencies, { now }));
  const ctx = setup(); const options = { get now() { throw Error("PRIVATE_TEST_OPTIONS"); } };
  unavailable(await dryRun(id, published, "en", ctx.dependencies, options)); exactlyOnce(ctx);
});

test("P11 immutable publication and safe schema preserved; no new I/O caller, cache or public data", async () => {
  const ctx = setup(), before = JSON.stringify(published); const result = await ctx.run(); limits(result); exactlyOnce(ctx);
  assert.equal(JSON.stringify(published), before);
  assert.deepEqual(Object.keys(result).sort(), ["state", "publicId", "locale", "selectedLocaleContent", "checkoutAuthorization", "freshness", "blockers", "effectiveAvailability", "provenance", "overrideDisposition", "evidence", "erpFacts"].sort());
  const catalogue = readFileSync(new URL("../data/catalogue.ts", import.meta.url));
  assert.equal(createHash("sha256").update(catalogue).digest("hex").toUpperCase(), "1458E7DC05B1C6CA2C8F4FCF130B2DC92F8BFE7C5F75A9BBDC6B35DAC1AF9264");
  assert.match(catalogue.toString(), /Object\.freeze\(\[\]\)/);
  const source = readFileSync(new URL("../lib/storefront/first-sku-operational-dry-run.ts", import.meta.url), "utf8");
  assert.ok(source.startsWith('import "server-only";'));
  assert.doesNotMatch(source, /node:|https?:|\bfetch\s*\(|process\.|Date\.|setTimeout|\.save\(|\.revoke\(|\.write\(/);
  const ast = ts.createSourceFile("join.ts", source, ts.ScriptTarget.Latest, true), calls = [];
  const visit = node => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast)); ts.forEachChild(node, visit); }; visit(ast);
  assert.equal(calls.filter(name => name === "readEffectiveOperationalState").length, 1);
  assert.equal(calls.filter(name => name === "projectFirstSkuPublicationTruth").length, 1);
});

test("P12 actual server-only loader rejects unguarded client-side import", () => {
  const child = spawnSync(process.execPath, ["--import", new URL("./server-only-loader.mjs", import.meta.url).href,
    "--input-type=module", "--eval", `await import(${JSON.stringify(new URL("../lib/storefront/first-sku-operational-dry-run.ts", import.meta.url).href)})`],
  { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error); assert.notEqual(child.status, 0);
  assert.match(child.stderr, /cannot be imported from a Client Component module/);
});
