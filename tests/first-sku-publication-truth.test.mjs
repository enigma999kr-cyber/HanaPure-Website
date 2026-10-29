import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { projectFirstSkuPublicationTruth as project } from "../lib/storefront/first-sku-publication-truth.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { readEffectiveOperationalState } from "../lib/erp/effective-operational-state.ts";
import { OperationalSourceError } from "../lib/erp/product-operational.ts";
import { inspectStoredCart, reconcileCart } from "../lib/cart/cart-state.ts";

const id = "a1234567-1234-4321-8123-123456789abc";
const other = "b1234567-1234-4321-8123-123456789abc";
const now = "2026-10-29T10:00:00Z"; // Trusted TEST time, never read by projection.
const content = { name: "SYNTHETIC ONLY", description: "In-memory test, not a real SKU.", images: [], usage: null, caution: null };
const record = (patch = {}) => ({ publicId: id, brand: "Round Lab", slug: "synthetic-only", state: "published",
  translations: { en: content, hu: { ...content, name: "KIZÁRÓLAG TESZT" }, ko: { ...content, name: "합성 테스트 전용" } }, ...patch });
const published = createLocalCatalogueReader([record()]).findPublishedByPublicId(id);
const raw = (patch = {}) => ({ public_id: id, retail_price_huf: 1000, sellable_stock: 7, operational_ready: true, ...patch });
const override = (mode, patch = {}) => ({ publicId: id, mode, actorId: "PRIVATE_ACTOR", reason: "PRIVATE_REASON",
  createdAt: "2026-10-29T09:00:00Z", status: "ACTIVE", ...patch });
async function effective({ payload = raw(), manual = null, error, noSource = false, storeFailure = false } = {}) {
  return readEffectiveOperationalState(id, {
    erpSource: noSource ? undefined : { async readProduct(selected) {
      assert.equal(selected, id);
      if (error) throw error;
      return payload;
    } },
    overrideStore: {
      async getCurrent(selected) {
        assert.equal(selected, id);
        if (storeFailure) throw new Error("PRIVATE_STORE_CREDENTIAL");
        return { record: manual, revision: manual ? "PRIVATE_REVISION" : null };
      },
      async save() { assert.fail("no write permitted"); },
      async revoke() { assert.fail("no write permitted"); },
    },
  }, { now });
}
function limits(result) {
  assert.equal(result.checkoutAuthorization, "NOT_EVALUATED");
  assert.equal(result.freshness, "NOT_EVALUATED");
  assert.ok(result.blockers.includes("CHECKOUT_NOT_EVALUATED"));
  assert.ok(result.blockers.includes("FRESHNESS_NOT_EVALUATED"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|SYNTHETIC ONLY|KIZÁRÓLAG|합성 테스트|basePriceHuf|retail_price_huf|activeOverride|overrideError|ORDERABLE|CAN_CHECKOUT|PAYMENT_READY|SAFE_TO_SHIP/);
}

test("S01 absent draft invalid and conflicting editorial never reveal ERP or private content", async () => {
  const operational = await effective();
  const draft = record({ state: "draft", translations: { en: { ...content, name: "PRIVATE_DRAFT" }, hu: null, ko: null } });
  assert.equal(createLocalCatalogueReader([draft]).findPublishedByPublicId(id), null);
  for (const [selected, editorial, locale] of [[id, null, "en"], [id, draft, "en"], [other, published, "en"],
    ["not-a-uuid", published, "en"], [id, record({ brand: "unconfigured" }), "en"], [id, published, "fr"]]) {
    const result = project(selected, editorial, locale, operational);
    limits(result); assert.equal(result.state, "UNPUBLISHED_OR_ABSENT");
    assert.deepEqual(Object.keys(result).sort(), ["state", "checkoutAuthorization", "freshness", "blockers"].sort());
  }
  let touched = false;
  project(id, draft, "en", { get publicId() { touched = true; throw Error("PRIVATE_CREDENTIAL"); } });
  assert.equal(touched, false);
});

test("S02 published EN HU KO with ready positive ERP is only a diagnostic signal", async () => {
  const operational = await effective();
  for (const locale of ["en", "hu", "ko"]) {
    const result = project(id, published, locale, operational); limits(result);
    assert.equal(result.state, "PUBLISHED_OPERATIONAL_SIGNAL_ONLY");
    assert.equal(result.selectedLocaleContent, "PRESENT"); assert.equal(result.locale, locale);
    assert.equal(result.provenance, "ERP"); assert.equal(result.evidence, "KNOWN");
    assert.deepEqual(result.erpFacts, { operationalReady: true, sellableStock: 7 });
  }
});

test("S03 every selected-locale gap remains missing without fallback or unpublishing", async () => {
  const operational = await effective();
  for (const locale of ["en", "hu", "ko"]) {
    const editorial = createLocalCatalogueReader([record({ translations: { ...record().translations, [locale]: null } })]).findPublishedByPublicId(id);
    const result = project(id, editorial, locale, operational); limits(result);
    assert.equal(result.state, "PUBLISHED_OPERATIONAL_SIGNAL_ONLY");
    assert.equal(result.selectedLocaleContent, "MISSING");
    assert.ok(result.blockers.includes("SELECTED_LOCALE_MISSING"));
    assert.equal(result.publicId, id);
  }
});

test("S04 absent missing-source provider exception malformed and wrong ERP identity fail closed", async () => {
  for (const operational of [null, await effective({ noSource: true }), await effective({ error: new Error("PRIVATE_AUTH_TOKEN") }),
    await effective({ payload: null }), await effective({ payload: raw({ operational_ready: "true" }) }),
    await effective({ payload: raw({ public_id: other }) })]) {
    for (const locale of ["en", "hu", "ko"]) {
      const result = project(id, published, locale, operational); limits(result);
      assert.equal(result.state, "PUBLISHED_OPERATIONAL_UNAVAILABLE"); assert.equal(result.erpFacts, null);
      assert.ok(result.blockers.includes("OPERATIONAL_EVIDENCE_UNAVAILABLE"));
    }
  }
  assert.equal(project(id, published, "en", await effective({ noSource: true })).evidence, "NO_SOURCE");
  assert.equal(project(id, published, "en", await effective({ payload: null })).evidence, "INVALID");
});

test("S05 canonical not-ready and real zero-stock remain distinct from unavailable", async () => {
  for (const [payload, state, blocker] of [[raw({ operational_ready: false }), "PUBLISHED_NOT_READY", "OPERATIONAL_NOT_READY"],
    [raw({ sellable_stock: 0 }), "PUBLISHED_OUT_OF_STOCK", "OPERATIONAL_OUT_OF_STOCK"]]) {
    const result = project(id, published, "en", await effective({ payload })); limits(result);
    assert.equal(result.state, state); assert.ok(result.blockers.includes(blocker));
    assert.equal(result.provenance, "ERP");
    assert.deepEqual(result.erpFacts, { operationalReady: payload.operational_ready, sellableStock: payload.sellable_stock });
  }
});

for (const [mode, state] of [["SALES_PAUSED", "PUBLISHED_SALES_PAUSED"], ["FORCE_OUT_OF_STOCK", "PUBLISHED_OUT_OF_STOCK"],
  ["FORCE_AVAILABLE", "PUBLISHED_OPERATIONAL_SIGNAL_ONLY"]]) {
  test(`S06 ${mode} preserves manual provenance and contrary canonical facts without checkout`, async () => {
    for (const payload of [raw(), raw({ sellable_stock: 0 }), raw({ operational_ready: false }), raw({ retail_price_huf: 0 })]) {
      const result = project(id, published, "en", await effective({ payload, manual: override(mode) })); limits(result);
      assert.equal(result.state, state); assert.equal(result.provenance, "MANUAL_OVERRIDE");
      assert.equal(result.overrideDisposition, "ACTIVE"); assert.ok(result.blockers.includes("MANUAL_INTENT_ONLY"));
      assert.deepEqual(result.erpFacts, { operationalReady: payload.operational_ready, sellableStock: payload.sellable_stock });
    }
  });
}

test("S07 FORCE_AVAILABLE during outage or no source retains intent and unknown facts only", async () => {
  for (const options of [{ error: new OperationalSourceError("timeout") }, { noSource: true }]) {
    const result = project(id, published, "en", await effective({ ...options, manual: override("FORCE_AVAILABLE") })); limits(result);
    assert.equal(result.state, "PUBLISHED_OPERATIONAL_SIGNAL_ONLY");
    assert.equal(result.provenance, "MANUAL_OVERRIDE"); assert.equal(result.erpFacts, null);
    assert.ok(result.blockers.includes("MANUAL_INTENT_ONLY")); assert.notEqual(result.evidence, "KNOWN");
  }
  const invalid = project(id, published, "en", await effective({ payload: raw({ public_id: other }), manual: override("FORCE_AVAILABLE") }));
  limits(invalid); assert.equal(invalid.state, "PUBLISHED_OPERATIONAL_UNAVAILABLE");
  assert.equal(invalid.effectiveAvailability, "AVAILABLE"); assert.equal(invalid.evidence, "INVALID");
});

test("S08 expired revoked AUTO override interpretation is inherited from existing resolver", async () => {
  for (const [manual, disposition] of [[override("SALES_PAUSED", { expiresAt: now }), "EXPIRED"],
    [override("FORCE_AVAILABLE", { status: "REVOKED", revocation: { actorId: "PRIVATE_REVOKER", reason: "PRIVATE_REASON", at: now } }), "REVOKED"],
    [override("AUTO"), "AUTO"]]) {
    for (const failure of [false, true]) {
      const result = project(id, published, "en", await effective({ manual, ...(failure ? { error: new OperationalSourceError("timeout") } : {}) }));
      limits(result); assert.equal(result.overrideDisposition, disposition);
      assert.equal(result.state, failure ? "PUBLISHED_OPERATIONAL_UNAVAILABLE" : "PUBLISHED_OPERATIONAL_SIGNAL_ONLY");
      assert.equal(result.provenance, failure ? "UNAVAILABLE" : "ERP");
    }
  }
});

test("S09 PRODUCT_NOT_FOUND cannot become existence through FORCE_AVAILABLE", async () => {
  for (const manual of [null, override("FORCE_AVAILABLE")]) {
    const result = project(id, published, "en", await effective({ manual, error: new OperationalSourceError("product_not_found") }));
    limits(result); assert.equal(result.state, "PUBLISHED_OPERATIONAL_UNAVAILABLE");
    assert.equal(result.effectiveAvailability, "PRODUCT_NOT_FOUND"); assert.equal(result.provenance, "ERP");
    assert.equal(result.evidence, "PRODUCT_NOT_FOUND"); assert.equal(result.erpFacts, null);
  }
});

test("S10 override-store failure does not erase known ERP facts or leak its credentials", async () => {
  const result = project(id, published, "en", await effective({ storeFailure: true })); limits(result);
  assert.equal(result.state, "PUBLISHED_OPERATIONAL_UNAVAILABLE");
  assert.equal(result.effectiveAvailability, "OPERATIONAL_FAILURE"); assert.equal(result.provenance, "UNAVAILABLE");
  assert.deepEqual(result.erpFacts, { operationalReady: true, sellableStock: 7 });
});

test("S11 malformed mismatched accessor and false-authorization effective snapshots fail closed", async () => {
  const healthy = await effective();
  for (const value of [{}, { ...healthy, publicId: other }, { ...healthy, checkoutAuthorization: "AUTHORIZED" },
    { ...healthy, availability: "ORDERABLE" }, { ...healthy, provenance: "unknown" },
    { ...healthy, provenance: "UNAVAILABLE" }, { ...healthy, sellableStock: "7" },
    { ...healthy, erp: { ok: true, product: { ...healthy.erp.product, publicId: other } } },
    { ...healthy, erp: { ok: false, error: { code: "PRIVATE_TOKEN" } } },
    { ...healthy, activeOverride: override("FORCE_AVAILABLE", { publicId: other }), provenance: "MANUAL_OVERRIDE", overrideDisposition: "ACTIVE" },
    { get publicId() { throw new Error("PRIVATE_GETTER"); } }]) {
    const result = project(id, published, "en", value); limits(result);
    assert.equal(result.state, "PUBLISHED_OPERATIONAL_UNAVAILABLE"); assert.equal(result.evidence, "INVALID");
    assert.equal(result.erpFacts, null);
  }
  const result = project(id, published, "en", { ...healthy, observedAt: "2000-01-01T00:00:00Z" });
  limits(result); assert.equal(result.freshness, "NOT_EVALUATED"); // No new SLA/clock interpretation invented.
});

test("S12 Cart selection preserves identity and quantity but never authorizes order reservation or payment", async () => {
  const selected = inspectStoredCart(JSON.stringify({ version: 1, lines: [{ publicId: id, quantity: 3 }] }));
  assert.equal(selected.invalid, false);
  for (const products of [[], [published]]) {
    const rows = reconcileCart(selected.lines, products);
    assert.deepEqual(rows[0].line, { publicId: id, quantity: 3 });
    assert.equal(rows[0].product, products[0] ?? null);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["line", "product"]);
    limits(project(id, rows[0].product, "en", await effective()));
  }
  assert.equal(inspectStoredCart(JSON.stringify({ version: 1, lines: [{ publicId: id, quantity: 3, sellableStock: 7 }] })).invalid, true);
});

test("S13 projection is deterministic nonmutating and owns no external read or write capability", async () => {
  const operational = await effective();
  const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(operational); const before = JSON.stringify({ published, operational });
  const first = project(id, published, "en", operational);
  assert.deepEqual(project(id, published, "en", operational), first);
  assert.equal(JSON.stringify({ published, operational }), before); limits(first);
  const source = readFileSync(new URL("../lib/storefront/first-sku-publication-truth.ts", import.meta.url), "utf8");
  assert.ok(source.startsWith('import "server-only";'));
  assert.doesNotMatch(source, /\b(?:fetch|readEffectiveOperationalState|readOperationalProduct|process|Date|localStorage|sessionStorage)\s*[.(]|node:|https?:|new Map|setTimeout|async function/);
  const ast = ts.createSourceFile("gate.ts", source, ts.ScriptTarget.Latest, true);
  const calls = []; function visit(n) { if (ts.isCallExpression(n)) calls.push(n.expression.getText(ast)); ts.forEachChild(n, visit); } visit(ast);
  assert.ok(!calls.some(name => /(?:\.save|\.revoke|\.write|\.readProduct|\.getCurrent)$/.test(name)));
});

test("S14 actual server-only marker rejects importing this gate outside react-server conditions", () => {
  const child = spawnSync(process.execPath, ["--import", new URL("./server-only-loader.mjs", import.meta.url).href,
    "--input-type=module", "--eval", `await import(${JSON.stringify(new URL("../lib/storefront/first-sku-publication-truth.ts", import.meta.url).href)})`],
  { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error); assert.notEqual(child.status, 0);
  assert.match(child.stderr, /cannot be imported from a Client Component module/);
});
