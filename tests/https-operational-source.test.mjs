import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createHttpsOperationalSource } from "../lib/erp/https-operational-source.ts";
import { readOperationalProduct, OperationalSourceError } from "../lib/erp/product-operational.ts";

// Internal Unit 2A contract fixtures only. Every request uses an injected fake;
// gateway.invalid is a reserved test hostname, never a production endpoint.
const id = "a1234567-1234-4321-8123-123456789abc";
const product = (overrides = {}) => ({
  public_id: id, retail_price_huf: 12990.5, sellable_stock: 0,
  operational_ready: false, ...overrides,
});
const found = (overrides = {}) => ({ version: "1", product: product(), ...overrides });
const absent = (code = "product_not_found") => ({ version: "1", public_id: id, error: { code } });
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8" },
});
const config = (overrides = {}) => ({
  gatewayOrigin: "https://gateway.invalid", timeoutMs: 1000,
  authHeaders: () => ({ "x-test-service-auth": "test-only" }), ...overrides,
});
function setup(response = () => json(found()), overrides = {}) {
  const calls = [];
  const source = createHttpsOperationalSource(config(overrides), {
    fetch: async (url, init) => { calls.push({ url, init }); return response(url, init); },
  });
  return { source, calls };
}
async function expectCode(source, code, options) {
  assert.deepEqual(await readOperationalProduct(id, source, options), { ok: false, error: { code } });
}

test("valid HTTPS read passes through price, real zero stock and false readiness", async () => {
  const { source, calls } = setup();
  assert.deepEqual(await readOperationalProduct(id, source), {
    ok: true, product: { publicId: id, basePriceHuf: 12990.5, sellableStock: 0, operationalReady: false },
  });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, `https://gateway.invalid/v1/products/${id}/operational`);
  assert.equal(init.method, "GET");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
  assert.equal(init.headers.get("x-test-service-auth"), "test-only");
  assert.equal(init.headers.get("accept"), "application/json");
  assert.equal(init.headers.get("cache-control"), "no-store");
});

test("supplied ERP readiness and stock ignore raw compliance/inventory/promotion fields", async () => {
  const { source } = setup(() => json(found({ product: product({
    sellable_stock: 4, operational_ready: true, retail_price_huf: 0,
    active: false, cpnp: "Non-compliant", warehouses: [{ stock: 999 }],
    vat_rate: 27, promotional_price: 1, sku: "different", slug: "other",
  }) })));
  assert.deepEqual(await readOperationalProduct(id, source), {
    ok: true, product: { publicId: id, basePriceHuf: 0, sellableStock: 4, operationalReady: true },
  });
});

test("exact response identity required, including case; no alternative join keys", async () => {
  for (const public_id of [id.toUpperCase(), "b1234567-1234-4321-8123-123456789abc", "sku-id"]) {
    await expectCode(setup(() => json(found({ product: product({ public_id, sku: id, slug: id }) }))).source,
      "contract_mismatch");
  }
});

test("required fields and strict types fail closed", async () => {
  for (const field of Object.keys(product())) {
    const missing = product(); delete missing[field];
    await expectCode(setup(() => json(found({ product: missing }))).source, "contract_mismatch");
  }
  for (const override of [
    { retail_price_huf: "12990" }, { retail_price_huf: null },
    { sellable_stock: -1 }, { sellable_stock: "0" },
    { operational_ready: "false" }, { operational_ready: 0 },
  ]) await expectCode(setup(() => json(found({ product: product(override) }))).source, "contract_mismatch");
});

test("envelope and version must match the explicit internal contract", async () => {
  for (const body of [product(), null, [], found({ version: "2" }), found({ version: undefined }),
    found({ error: { code: "product_not_found" } })]) {
    await expectCode(setup(() => json(body)).source, "contract_mismatch");
  }
});

test("malformed JSON, invalid UTF-8, missing body and wrong content type fail safely", async () => {
  for (const response of [
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    () => new Response(null, { headers: { "content-type": "application/json" } }),
    () => new Response("<html>gateway error</html>", { headers: { "content-type": "text/html" } }),
  ]) await expectCode(setup(response).source, "malformed_response");
});

test("only contract-defined JSON 404 with the exact ID means product not found", async () => {
  await expectCode(setup(() => json(absent(), 404)).source, "product_not_found");
  for (const body of [{}, absent("route_not_found"), { ...absent(), public_id: "other" },
    { ...absent(), product: product() }]) {
    assert.notEqual((await readOperationalProduct(id, setup(() => json(body, 404)).source)).error.code,
      "product_not_found");
  }
  await expectCode(setup(() => new Response("<html>404</html>", {
    status: 404, headers: { "content-type": "text/html" },
  })).source, "malformed_response");
  await expectCode(setup(() => json(absent(), 200)).source, "contract_mismatch");
});

test("HTTP auth errors, rate limit, redirects and upstream failures never retry", async () => {
  for (const [status, code] of [[401, "authentication_error"], [403, "authentication_error"],
    [429, "rate_limited"], [302, "upstream_unavailable"], [500, "upstream_unavailable"],
    [502, "upstream_unavailable"], [204, "upstream_unavailable"]]) {
    const { source, calls } = setup(() => new Response(null, { status }));
    await expectCode(source, code);
    assert.equal(calls.length, 1);
  }
});

test("explicit 503 read errors preserve safe categories; no raw body escapes", async () => {
  for (const code of ["temporarily_busy", "erp_read_unavailable"]) {
    await expectCode(setup(() => json({ ...absent(code), private_detail: "sensitive" }, 503)).source, code);
  }
  await expectCode(setup(() => json(absent("gateway_offline"), 503)).source, "upstream_unavailable");
});

test("network failure is safe and makes exactly one attempt", async () => {
  const { source, calls } = setup(() => { throw new Error("credential/private network detail"); });
  await expectCode(source, "network_error");
  assert.equal(calls.length, 1);
});

test("missing/insecure/arbitrary URL or invalid deadline config prevents requests", async () => {
  let calls = 0;
  const fake = async () => { calls++; return json(found()); };
  await expectCode(createHttpsOperationalSource(undefined, { fetch: fake }), "configuration_error");
  for (const gatewayOrigin of ["", "invalid", "http://gateway.invalid", "https://user:secret@gateway.invalid",
    "https://gateway.invalid/other", "https://gateway.invalid/?target=x", "https://gateway.invalid/#x"]) {
    await expectCode(createHttpsOperationalSource(config({ gatewayOrigin }), { fetch: fake }), "configuration_error");
  }
  for (const override of [{ timeoutMs: 0 }, { timeoutMs: NaN }, { timeoutMs: 1.5 },
    { timeoutMs: 30001 }, { authHeaders: undefined }, { expectedContractVersion: "2" }]) {
    await expectCode(createHttpsOperationalSource(config(override), { fetch: fake }), "configuration_error");
  }
  assert.equal(calls, 0);
});

test("invalid lookup identity cannot forward a URL/path", async () => {
  const { source, calls } = setup();
  await assert.rejects(source.readProduct("../../anything"), { code: "contract_mismatch" });
  assert.equal(calls.length, 0);
});

test("auth failure/malformed/empty headers cannot send an unauthenticated request", async () => {
  for (const authHeaders of [() => { throw new Error("private key"); }, () => ({}),
    () => ({ "bad\nheader": "private" })]) {
    const { source, calls } = setup(undefined, { authHeaders });
    await expectCode(source, "authentication_error");
    assert.equal(calls.length, 0);
  }
  const { source, calls } = setup(undefined, { authHeaders: () => ({ host: "other.invalid" }) });
  await expectCode(source, "configuration_error");
  assert.equal(calls.length, 0);
});

test("deadline bounds an uncooperative fetch and aborts its signal; zero retries", async () => {
  let signal;
  const { source, calls } = setup((_, init) => {
    signal = init.signal; return new Promise(() => {});
  }, { timeoutMs: 20 });
  await expectCode(source, "timeout");
  assert.equal(signal.aborted, true);
  assert.equal(calls.length, 1);
});

test("deadline also bounds auth provider and body consumption", async () => {
  const pendingAuth = setup(undefined, { authHeaders: () => new Promise(() => {}), timeoutMs: 20 });
  await expectCode(pendingAuth.source, "timeout");
  assert.equal(pendingAuth.calls.length, 0);
  let bodyCancelled = false;
  const stalledBody = setup(() => new Response(new ReadableStream({
    start() {}, cancel() { bodyCancelled = true; },
  }), {
    headers: { "content-type": "application/json" },
  }), { timeoutMs: 20 });
  await expectCode(stalledBody.source, "timeout");
  assert.equal(stalledBody.calls.length, 1);
  assert.equal(stalledBody.calls[0].init.signal.aborted, true);
  assert.equal(bodyCancelled, true);
});

test("auth resolution after deadline cannot start a late request", async () => {
  let finishAuth;
  const { source, calls } = setup(undefined, {
    timeoutMs: 20, authHeaders: () => new Promise((resolve) => { finishAuth = resolve; }),
  });
  await expectCode(source, "timeout");
  finishAuth({ "x-test-service-auth": "test-only" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test("successive reads fetch live values without persistent cache", async () => {
  let stock = 0;
  const { source, calls } = setup(() => json(found({ product: product({ sellable_stock: stock++ }) })));
  assert.equal((await readOperationalProduct(id, source)).product.sellableStock, 0);
  assert.equal((await readOperationalProduct(id, source)).product.sellableStock, 1);
  assert.equal(calls.length, 2);
});

test("caller cancellation propagates; already cancelled calls make no requests", async () => {
  const controller = new AbortController();
  const { source, calls } = setup(() => new Promise(() => {}));
  const pending = readOperationalProduct(id, source, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await pending, { ok: false, error: { code: "cancelled" } });
  assert.equal(calls[0].init.signal.aborted, true);
  const fresh = setup();
  await expectCode(fresh.source, "cancelled", { signal: controller.signal });
  assert.equal(fresh.calls.length, 0);
});

test("response limit is enforced both from content-length and streamed bytes", async () => {
  for (const response of [
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } }),
    () => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }),
  ]) await expectCode(setup(response).source, "malformed_response");
});

test("body stream network failure remains transport error", async () => {
  await expectCode(setup(() => new Response(new ReadableStream({
    start(controller) { controller.error(new Error("private stream error")); },
  }), { headers: { "content-type": "application/json" } })).source, "network_error");
});

test("typed source errors survive the adapter while unexpected errors remain sanitized", async () => {
  await expectCode({ async readProduct() { throw new OperationalSourceError("source_internal_error"); } },
    "source_internal_error");
  await expectCode({ async readProduct() { throw new Error("secret"); } }, "source_unavailable");
});

test("config origin snapshot cannot be changed by caller after source creation", async () => {
  const settings = config(); const calls = [];
  const source = createHttpsOperationalSource(settings, {
    fetch: async (url) => { calls.push(url); return json(found()); },
  });
  settings.gatewayOrigin = "https://other.invalid";
  await readOperationalProduct(id, source);
  assert.equal(calls[0], `https://gateway.invalid/v1/products/${id}/operational`);
});

test("HTTPS source import is rejected outside the actual server-only boundary", () => {
  const loader = new URL("./server-only-loader.mjs", import.meta.url).href;
  const moduleUrl = new URL("../lib/erp/https-operational-source.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval",
    `await import(${JSON.stringify(moduleUrl)})`], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /cannot be imported from a Client Component module/);
});
