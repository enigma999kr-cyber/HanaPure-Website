import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import ts from "typescript";
import { createLocalCatalogueReader, validateEditorialCatalogue } from "../lib/catalog/editorial-catalogue.ts";
import { readCatalogueCriteria, discoverCatalogue, catalogueQueryString } from "../lib/catalog/catalogue-discovery.ts";
import { catalogueResultPage, readCatalogueBrowse, catalogueBrowseHref } from "../lib/catalog/catalogue-browse.ts";
import { publishedComparison, comparisonHref } from "../lib/comparison/compare-selection.ts";
import { readShoppingPlan, shoppingPlanHref, shoppingPlanCartHref } from "../lib/catalog/catalogue-shopping-plan.ts";
import { readPortableLink, planPortableMerge, portablePayload } from "../lib/cart/cart-portable-handoff.ts";
import { cartDraftImpact } from "../lib/cart/cart-draft-impact.ts";
import { publishedCatalogueFixtures, journeyCatalogueProducts, paginatedCatalogueFixtures } from "./browser/published-catalogue-fixtures.mjs";
import { publishedTestSelection, publishedFixtureScenario, fixtureEnvironment, publishedRuntimePlan,
  web23DevEvidence, assertWeb23DevPage, waitForFixtureServer, observeWeb23DevReadiness,
  waitForWeb23DevFixture, observeTransportComparison, compareOwnedWeb23Transport,
  directTransportProbe, transportErrorFields } from "./browser/published-catalogue-server.mjs";

// Pure/domain + runner-selection proof only. This file never starts a fixture,
// opens a socket/browser, runs a build or writes browser storage.
const catalogue = createLocalCatalogueReader(paginatedCatalogueFixtures);
const params = { q: "TEST ONLY JOURNEY", brand: "Round Lab", sort: "name-asc", withLocaleInfo: "1", withLocaleImage: "1" };
const first = journeyCatalogueProducts[0], second = journeyCatalogueProducts[12];

test("WEB20 opt-in scenario leaves the five CLOSED base records and publication distribution intact", () => {
  assert.equal(publishedCatalogueFixtures.length, 5);
  const base = createLocalCatalogueReader(publishedCatalogueFixtures);
  assert.equal(base.listPublished().length, 4);
  assert.deepEqual(paginatedCatalogueFixtures.slice(0, 5), publishedCatalogueFixtures);
  assert.equal(base.findPublishedBySlug(first.slug), null);
  assert.equal(publishedCatalogueFixtures[2].translations.hu, null);
});

test("WEB20 paginated synthetic records satisfy the real authority without price/stock/readiness facts", () => {
  assert.equal(validateEditorialCatalogue(paginatedCatalogueFixtures).ok, true);
  assert.equal(catalogue.listPublished().length, 18);
  assert.equal(catalogue.findPublishedBySlug("test-only-journey-draft"), null);
  for (const record of journeyCatalogueProducts) {
    assert.deepEqual(Object.keys(record).sort(), ["brand", "publicId", "slug", "state", "translations"]);
    for (const locale of ["en", "hu", "ko"]) {
      assert.ok(record.translations[locale].name.startsWith("TEST ONLY JOURNEY"));
      assert.ok(record.translations[locale].images[0].alt.startsWith("TEST ONLY"));
    }
  }
});

for (const locale of ["en", "hu", "ko"]) test(`WEB20 ${locale} real discovery spans 12+2 and restores cross-page identities without draft leakage`, () => {
  const criteria = readCatalogueCriteria(params), query = catalogueQueryString(criteria);
  const discovered = discoverCatalogue(catalogue, locale, criteria);
  const pageOne = catalogueResultPage(discovered, locale, readCatalogueBrowse(params));
  const pageTwo = catalogueResultPage(discovered, locale, readCatalogueBrowse({ ...params, page: "2", pickFirst: first.publicId }));
  assert.equal(discovered.length, 14);
  assert.deepEqual(pageOne.items.map(product => product.publicId), journeyCatalogueProducts.slice(0, 12).map(product => product.publicId));
  assert.deepEqual(pageTwo.items.map(product => product.publicId), journeyCatalogueProducts.slice(12).map(product => product.publicId));
  const href = catalogueBrowseHref(`/${locale}/products`, query, readCatalogueBrowse({ ...params, page: "2", pickFirst: first.publicId }));
  const url = new URL(href, "http://localhost");
  assert.equal(url.searchParams.get("pickFirst"), first.publicId);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("withLocaleImage"), "1");
  const pair = publishedComparison(catalogue.listPublished(), { first: url.searchParams.get("pickFirst"), second: pageTwo.items[0].publicId });
  assert.deepEqual(pair.map(product => product.publicId), [first.publicId, second.publicId]);
  const detail = new URL(comparisonHref(`/${locale}/products/${first.slug}`, pair, query), "http://localhost");
  assert.equal(detail.searchParams.get("q"), params.q);
  assert.equal(detail.searchParams.get("brand"), params.brand);
  assert.equal(detail.searchParams.get("compareSecond"), second.publicId);
  assert.equal(catalogue.findPublishedBySlug(detail.pathname.split("/").at(-1)).publicId, first.publicId);
});

test("WEB20 fixture selection is explicit while base all-tests excludes the opt-in cases", () => {
  assert.equal(publishedFixtureScenario([]), "base");
  assert.deepEqual(publishedTestSelection([]), ["--grep-invert", "\\[web(?:20|23)\\]"]);
  for (const selector of ["--gallery-only", "--journey-quality-only", "--cart-only", "--discovery-only"]) {
    assert.equal(publishedFixtureScenario([selector]), "base");
  }
  assert.equal(publishedFixtureScenario(["--integrated-journey-only"]), "paginated");
  assert.deepEqual(publishedTestSelection(["--integrated-journey-only"]), ["--grep", "\\[web20\\]", "--project", "published-chromium-375"]);
  assert.deepEqual(publishedTestSelection(["--gallery-only"]), ["--grep", "media gallery"]);
});

test("WEB20 unknown or combined scenario selectors fail before any fixture/browser execution", () => {
  for (const args of [["--unknown"], ["--integrated-journey-only", "--gallery-only"], ["--integrated-journey-only=base"]]) {
    assert.throws(() => publishedFixtureScenario(args), /STOP/);
  }
});

test("WEB23 opt-in selects only its marker and one installed project with paginated fixtures", () => {
  const selection = publishedTestSelection(["--web23-cross-device-only"]);
  assert.deepEqual(selection, ["--grep", "\\[web23\\]", "--project", "published-chromium-375"]);
  assert.equal(publishedFixtureScenario(["--web23-cross-device-only"]), "paginated");
  const included = new RegExp(selection[1]);
  assert.ok(included.test("[web23] search interaction"));
  assert.ok(!included.test("[web20] existing journey"));
  const excluded = new RegExp(publishedTestSelection([])[1]);
  for (const marker of ["[web20]", "[web23]"]) assert.ok(excluded.test(marker));
  assert.ok(!excluded.test("[web19]"));
  selection.push("caller-mutation");
  assert.equal(publishedTestSelection(["--web23-cross-device-only"]).length, 4);
});

test("WEB23 rejects combined, malformed or environment-only scenario authority", () => {
  for (const args of [["--web23-cross-device-only", "--human-preview-only"],
    ["--web23-cross-device-only", "--integrated-journey-only"], ["--web23-cross-device-only=base"]]) {
    assert.throws(() => publishedTestSelection(args), /STOP/);
    assert.throws(() => publishedFixtureScenario(args), /STOP/);
  }
  const env = fixtureEnvironment({ HANAPURE_PUBLISHED_SCENARIO: "web23", NODE_OPTIONS: "hook", API_SECRET: "secret" });
  assert.equal(env.HANAPURE_PUBLISHED_SCENARIO, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.API_SECRET, undefined);
  assert.equal(publishedFixtureScenario([]), "base");
});

test("WEB23 dev execution plan is opt-in, loopback Webpack only, with no production build", () => {
  const input = { NODE_ENV: "development", NODE_OPTIONS: "hook", API_SECRET: "secret",
    HANAPURE_PUBLISHED_TEST_RUN_ID: "untrusted", HANAPURE_PUBLISHED_SCENARIO: "dev", PATH: "test-path" };
  const dev = publishedRuntimePlan(["--web23-dev-browser-only"], input);
  assert.equal(dev.development, true);
  assert.equal(dev.buildArgs, null);
  assert.deepEqual(dev.serverArgs, ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3101"]);
  assert.equal(dev.config, "playwright.web23-dev.config.ts");
  assert.deepEqual(dev.environment, { PATH: "test-path", NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", HANAPURE_PUBLIC_SITE_ORIGIN: "" });
  assert.equal(publishedFixtureScenario(["--web23-dev-browser-only"]), "paginated");
  assert.deepEqual(publishedTestSelection(["--web23-dev-browser-only"]), publishedTestSelection(["--web23-cross-device-only"]));
  for (const args of [[], ["--web23-cross-device-only"], ["--integrated-journey-only"], ["--human-preview-only"], ["--gallery-only"]]) {
    const existing = publishedRuntimePlan(args, input);
    assert.equal(existing.development, false);
    assert.equal(existing.environment.NODE_ENV, "production");
    assert.deepEqual(existing.buildArgs, ["build", "--webpack"]);
    assert.deepEqual(existing.serverArgs, ["start", "--hostname", "127.0.0.1", "--port", "3101"]);
    assert.equal(existing.config, "playwright.published.config.ts");
  }
});

test("WEB23 dev rejects ambiguous mode selection before side effects", () => {
  for (const args of [["--web23-dev-browser-only", "--web23-cross-device-only"],
    ["--web23-dev-browser-only", "--human-preview-only"], ["--web23-dev-browser-only=1"], ["--unknown"]]) {
    assert.throws(() => publishedRuntimePlan(args), /STOP/);
    assert.throws(() => publishedFixtureScenario(args), /STOP/);
  }
});

test("WEB23 dev evidence requires owned UUID and cannot overlap legacy or another run", () => {
  const prefix = "hanapure-published-catalogue-browser-v1:";
  const one = web23DevEvidence(prefix + "12345678-abcd-4234-abcd-123456789abc");
  const two = web23DevEvidence(prefix + "12345679-abcd-4234-abcd-123456789abc");
  assert.notEqual(one.root, two.root);
  assert.ok(one.root.includes("web23-dev-not-production-"));
  for (const value of [one.report, one.results]) {
    assert.ok(value.startsWith(one.root));
    assert.ok(!value.includes("published-browser-report") && !value.includes("published-browser-results"));
    assert.ok(!value.includes("published-catalogue-app"));
  }
  for (const owner of ["", prefix + "../escape", prefix + "C:\\escape", prefix + "12345678-abcd-4234-abcd-123456789abc/extra", "other:12345678-abcd-4234-abcd-123456789abc"]) {
    assert.throws(() => web23DevEvidence(owner), /Invalid owned/);
  }
});

test("WEB23 dev config loads as CommonJS without importing the ESM runner and retains owned evidence limits", () => {
  const source = readFileSync(new URL("../playwright.web23-dev.config.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  assert.doesNotMatch(code, /published-catalogue-server|\.mjs/);
  const load = env => {
    const exports = {};
    runInNewContext(code, { exports, process: { env }, require: specifier => {
      if (specifier === "node:path") return { join };
      // Config evaluation only; never load the Playwright runner or any suite.
      if (specifier === "@playwright/test") return { defineConfig: config => config };
      throw new Error("Unexpected config dependency");
    } });
    return exports.default;
  };
  const prefix = "hanapure-published-catalogue-browser-v1:";
  for (const id of ["12345678-abcd-4234-abcd-123456789abc", "12345679-abcd-4234-abcd-123456789abc"]) {
    const owner = prefix + id;
    const config = load({ NODE_ENV: "development", HANAPURE_PUBLISHED_TEST_RUN_ID: owner });
    const evidence = web23DevEvidence(owner);
    assert.equal(config.outputDir, evidence.results);
    assert.equal(config.reporter[1][1].outputFile, evidence.report);
    assert.equal(config.metadata.validationMode, "DEV-NOT-PRODUCTION");
    assert.equal(config.testMatch, "published-catalogue.spec.ts");
    assert.equal(config.grep.source, "\\[web23\\]");
    assert.equal(config.workers, 1); assert.equal(config.retries, 0); assert.equal(config.maxFailures, 1);
    assert.equal(config.timeout, 30000); assert.equal(config.expect.timeout, 8000);
    assert.equal(config.use.baseURL, "http://127.0.0.1:3101");
    assert.equal(config.use.trace, "retain-on-failure"); assert.equal(config.use.screenshot, "only-on-failure");
    assert.equal(config.projects.length, 1); assert.equal(config.projects[0].name, "published-chromium-375");
  }
  for (const owner of ["", prefix + "../escape", prefix + "12345678-abcd-1234-abcd-123456789abc",
    prefix + "12345678-abcd-4234-0bcd-123456789abc", prefix + "12345678-abcd-4234-abcd-123456789abc/extra"]) {
    assert.throws(() => load({ NODE_ENV: "development", HANAPURE_PUBLISHED_TEST_RUN_ID: owner }), /Invalid owned/);
  }
  assert.throws(() => load({ NODE_ENV: "production", HANAPURE_PUBLISHED_TEST_RUN_ID: prefix + "12345678-abcd-4234-abcd-123456789abc" }), /dev runner required/);
});

test("WEB23 dev warm page refuses empty, error or wrong fixture before Browser startup", async () => {
  const html = `<main><h1 id="main-content" tabindex="-1">${first.translations.en.name}</h1></main>`;
  assert.doesNotThrow(() => assertWeb23DevPage(html));
  for (const invalid of ["", "<h1>Internal Server Error</h1>", `<h1 id="main-content">${first.translations.hu.name}</h1>`,
    "<h1 id=\"main-content\">No published products</h1>", first.translations.en.name]) {
    assert.throws(() => assertWeb23DevPage(invalid), /fixture mismatch/);
  }
  // No sockets/children: an unowned object is rejected before even fetching.
  await assert.rejects(waitForFixtureServer({}, "http://127.0.0.1:3101/en/products/test-only-journey-01"), /Unowned/);
});

const devHeading = () => `<h1 id="main-content">${first.translations.en.name}</h1>`;

function transportHarness(fetchResult, httpResult) {
  let clock = 0, closed = false, active = 0, peak = 0;
  const timers = new Set(), calls = [], signals = [];
  const state = {
    calls, signals, timers, peak: () => peak,
    exit: () => { closed = true; },
    tick: amount => {
      clock += amount;
      for (const timer of [...timers]) if (timer.at <= clock) { timers.delete(timer); timer.fn(); }
    },
  };
  const adapter = (key, value) => async options => {
    calls.push({ key, remaining: options.remaining, pid: process.pid }); signals.push(options.signal);
    active++; peak = Math.max(peak, active);
    try { return await (typeof value === "function" ? value(options, state) : value); }
    finally { active--; }
  };
  state.options = {
    fetchProbe: adapter("fetch", fetchResult), httpProbe: adapter("http", httpResult),
    childExited: () => closed, now: () => clock, pause: async amount => state.tick(amount),
    setTimer: (fn, amount) => { const timer = { fn, at: clock + amount }; timers.add(timer); return timer; },
    clearTimer: timer => timers.delete(timer),
  };
  return state;
}

test("WEB23 transport explicit selector cannot select production, Browser or caller environment authority", () => {
  const flag = "--web23-transport-diagnostic-only";
  const plan = publishedRuntimePlan([flag], { NODE_OPTIONS: "private", HANAPURE_URL: "https://private.invalid" });
  assert.equal(plan.transportDiagnostic, true);
  assert.equal(plan.development, true);
  assert.equal(plan.buildArgs, null); assert.equal(plan.config, null);
  assert.deepEqual(plan.serverArgs, ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3101"]);
  assert.equal(plan.environment.NODE_OPTIONS, undefined);
  assert.equal(plan.environment.HANAPURE_URL, undefined);
  assert.deepEqual(publishedTestSelection([flag]), []);
  assert.equal(publishedFixtureScenario([flag]), "paginated");
  for (const other of ["--web23-dev-browser-only", "--web23-cross-device-only", "--human-preview-only"]) {
    assert.equal(publishedRuntimePlan([other]).transportDiagnostic, false);
    assert.throws(() => publishedRuntimePlan([flag, other]), /STOP/);
  }
  assert.throws(() => publishedRuntimePlan([flag + "=1"]), /STOP/);
  const source = readFileSync(new URL("./browser/published-catalogue-server.mjs", import.meta.url), "utf8");
  assert.match(source, /humanPreview \|\| runtime\.transportDiagnostic \? null : publishedBrowserRoot\(\)/);
  const branch = source.slice(source.indexOf("if (runtime.transportDiagnostic) {"), source.indexOf("const readiness = runtime.development"));
  assert.match(branch, /compareOwnedWeb23Transport\(server\)/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /workspace\.spawn|playwright|waitForWeb23DevFixture/);
});

test("WEB23 transport observes one sequential Fetch and HTTP in same parent, with no certification", async () => {
  const state = transportHarness({ status: 200 }, { status: 200, locationPresent: true, private: "SECRET" });
  const result = await observeTransportComparison(state.options);
  assert.equal(result.fetchCalls, 1); assert.equal(result.httpCalls, 1);
  assert.deepEqual(state.calls.map(call => call.key), ["fetch", "http"]);
  assert.ok(state.calls.every(call => call.pid === process.pid && call.remaining === 12000));
  assert.equal(state.peak(), 1); assert.equal(state.timers.size, 0);
  assert.ok(state.signals.every(signal => signal.aborted));
  assert.equal(result.elapsedMs, 1500);
  assert.equal(result.comparison, "BOTH_HTTP_200_NOT_FIXTURE_OR_BROWSER_CERTIFICATION");
  assert.equal(result.http.locationPresent, false);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("WEB23 transport redirect rejection preserves observed 3xx without proving Fetch cause", async () => {
  const state = transportHarness(() => { throw new TypeError("SECRET redirect URL and headers"); },
    { status: 307, locationPresent: true, location: "https://SECRET.invalid" });
  const result = await observeTransportComparison(state.options);
  assert.equal(result.fetch.outcome, "FETCH_REJECTED");
  assert.deepEqual(result.http, { outcome: "HTTP_STATUS", status: 307, locationPresent: true });
  assert.equal(result.comparison, "REDIRECT_OBSERVED_FETCH_REJECTED_CAUSE_UNCONFIRMED");
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("WEB23 transport HTTP 200 after Fetch rejection does not assert environment root cause", async () => {
  const state = transportHarness(() => { throw Object.assign(new TypeError("PRIVATE"), { cause: { code: "UND_ERR_SOCKET" } }); }, { status: 200 });
  const result = await observeTransportComparison(state.options);
  assert.equal(result.fetch.causeCode, "UND_ERR_SOCKET");
  assert.equal(result.comparison, "HTTP_200_FETCH_REJECTED_CAUSE_UNCONFIRMED");
  assert.match(result.limitation, /different warm-up/);
});

test("WEB23 transport refusal and access denial are retained but remain inconclusive without listener proof", async () => {
  for (const code of ["ECONNREFUSED", "EACCES", "EPERM"]) {
    const reject = () => { throw Object.assign(new Error("PRIVATE_PATH"), { code, syscall: "connect" }); };
    const state = transportHarness(reject, reject);
    const result = await observeTransportComparison(state.options);
    assert.equal(result.fetch.code, code); assert.equal(result.http.code, code);
    assert.equal(result.fetch.syscall, "connect");
    assert.equal(result.comparison, "INCONCLUSIVE");
    assert.equal(state.timers.size, 0);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_PATH"));
  }
});

test("WEB23 transport timeouts abort both owned adapters inside individual and total ceilings", async () => {
  const hanging = ({ signal, remaining }, state) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("PRIVATE"), { name: "AbortError" })), { once: true });
    queueMicrotask(() => state.tick(remaining));
  });
  const state = transportHarness(hanging, hanging);
  const result = await observeTransportComparison(state.options);
  assert.equal(result.fetch.outcome, "TIMEOUT"); assert.equal(result.http.outcome, "TIMEOUT");
  assert.equal(result.elapsedMs, 25500); assert.ok(result.elapsedMs <= 30000);
  assert.equal(state.peak(), 1); assert.equal(state.timers.size, 0);
  assert.ok(state.signals.every(signal => signal.aborted));
});

test("WEB23 transport child exit and consumed budget never invent second probe results", async () => {
  const closed = transportHarness({ status: 200 }, { status: 200 }); closed.exit();
  const before = await observeTransportComparison(closed.options);
  assert.equal(before.fetchCalls, 0); assert.equal(before.httpCalls, 0);
  assert.equal(before.childClosed, true);
  const during = transportHarness((_, state) => { state.exit(); return { status: 200 }; }, { status: 200 });
  const result = await observeTransportComparison(during.options);
  assert.equal(result.http.outcome, "NOT_EXECUTED_CHILD_EXIT");
  assert.equal(result.httpCalls, 0); assert.equal(result.comparison, "INCONCLUSIVE");
  const exhausted = transportHarness({ status: 200 }, { status: 200 });
  exhausted.options.pause = async () => exhausted.tick(30000);
  const noBudget = await observeTransportComparison(exhausted.options);
  assert.equal(noBudget.fetch.outcome, "NOT_EXECUTED_BUDGET");
  assert.equal(noBudget.http.outcome, "NOT_EXECUTED_BUDGET");
  assert.equal(noBudget.fetchCalls + noBudget.httpCalls, 0);
  const partial = transportHarness((_, state) => { state.tick(28500); return { status: 200 }; }, { status: 200 });
  const one = await observeTransportComparison(partial.options);
  assert.equal(one.httpCalls, 0); assert.equal(one.http.outcome, "NOT_EXECUTED_BUDGET");
  assert.equal(partial.timers.size, 0);
});

test("WEB23 transport unfinished abort consumes remaining deadline instead of overlapping HTTP", async () => {
  const state = transportHarness(({ remaining }, state) => {
    queueMicrotask(() => state.tick(remaining));
    return new Promise(() => {}); // Deliberately broken fake adapter ignores abort.
  }, { status: 200 });
  const schedule = state.options.setTimer;
  state.options.setTimer = (fn, amount) => {
    const timer = schedule(fn, amount);
    if (amount > 12000) queueMicrotask(() => state.tick(amount));
    return timer;
  };
  const result = await observeTransportComparison(state.options);
  assert.equal(result.elapsedMs, 30000);
  assert.equal(result.fetch.outcome, "TIMEOUT");
  assert.equal(result.http.outcome, "NOT_EXECUTED_BUDGET");
  assert.equal(result.httpCalls, 0); assert.equal(state.peak(), 1);
  assert.equal(state.timers.size, 0);
});

test("WEB23 transport non-200 and invalid statuses do not become successful comparisons", async () => {
  const status = transportHarness({ status: 404 }, { status: 503, locationPresent: true });
  const result = await observeTransportComparison(status.options);
  assert.equal(result.fetch.status, 404); assert.equal(result.http.status, 503);
  assert.equal(result.http.locationPresent, false); assert.equal(result.comparison, "INCONCLUSIVE");
  const invalid = transportHarness({ status: "PRIVATE" }, { status: 999 });
  const rejected = await observeTransportComparison(invalid.options);
  assert.equal(rejected.fetch.outcome, "INVALID_STATUS"); assert.equal(rejected.http.outcome, "INVALID_STATUS");
});

test("WEB23 transport error fields are enumerated and ownership rejects fake children before resources", async () => {
  assert.deepEqual(transportErrorFields({ name: "PRIVATE", code: "PRIVATE", syscall: "PRIVATE", message: "SECRET", stack: "SECRET",
    cause: { name: "Error", code: "PRIVATE", cause: { code: "EPERM" } } }), { causeName: "Error", nestedCode: "EPERM" });
  await assert.rejects(compareOwnedWeb23Transport({}), /Unowned transport/);
  await assert.rejects(compareOwnedWeb23Transport(null), /Unowned transport/);
  await assert.rejects(observeTransportComparison({}), /Invalid transport observer/);
  const state = transportHarness({ status: 200 }, { status: 200 });
  await assert.rejects(observeTransportComparison({ ...state.options, now: () => NaN }), /Invalid transport clock/);
});

test("WEB23 transport direct HTTP adapter uses literal GET, never follows redirect, destroys owned resources", async () => {
  let request, response, calls = 0, requestDestroyed = 0, responseDestroyed = 0;
  const probe = directTransportProbe((url, options, callback) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:3101/en/products/test-only-journey-01");
    assert.deepEqual(options, { agent: false });
    request = new EventEmitter();
    request.destroy = () => { requestDestroyed++; queueMicrotask(() => request.emit("close")); };
    response = { statusCode: 302, headers: { location: "https://PRIVATE.invalid", secret: "PRIVATE" }, destroy: () => { responseDestroyed++; } };
    queueMicrotask(() => callback(response));
    return request;
  });
  const controller = new AbortController();
  assert.deepEqual(await probe({ signal: controller.signal }), { status: 302, locationPresent: true });
  assert.equal(calls, 1); assert.equal(requestDestroyed, 1); assert.equal(responseDestroyed, 1);
  controller.abort(); assert.equal(requestDestroyed, 1);
  await Promise.resolve(); assert.equal(request.listenerCount("error"), 0);
});

test("WEB23 transport direct HTTP abort destroys owned request and rejects before any response", async () => {
  let destroyed = 0, called = 0;
  const probe = directTransportProbe(() => {
    called++; const request = new EventEmitter();
    request.destroy = () => { destroyed++; queueMicrotask(() => request.emit("close")); };
    return request;
  });
  const controller = new AbortController();
  const pending = probe({ signal: controller.signal }); controller.abort();
  await assert.rejects(pending, error => error.code === "ABORT_ERR");
  assert.equal(destroyed, 1); assert.equal(called, 1);
  await assert.rejects(probe({ signal: controller.signal }), error => error.code === "ABORT_ERR");
  assert.equal(called, 1);
});

test("WEB23 transport direct HTTP errors settle and remove owned listeners without redirects or retry", async () => {
  let request, destroyed = 0;
  const probe = directTransportProbe(() => {
    request = new EventEmitter();
    request.destroy = () => { destroyed++; queueMicrotask(() => request.emit("close")); };
    queueMicrotask(() => request.emit("error", Object.assign(new Error("PRIVATE"), { code: "EACCES" })));
    return request;
  });
  await assert.rejects(probe({ signal: new AbortController().signal }), error => error.code === "EACCES");
  assert.equal(destroyed, 1);
  await Promise.resolve(); assert.equal(request.listenerCount("error"), 0);
});
// In-memory monotonic clock and fake HTTP responses. No sockets/children/writes.
function devObserver(probe) {
  let clock = 0, exited = false, active = 0, peak = 0;
  const budgets = [], waits = [], signals = [];
  return {
    budgets, waits, signals, peak: () => peak,
    advance: amount => { clock += amount; }, exit: () => { exited = true; },
    options: {
      now: () => clock, childExited: () => exited,
      pause: async amount => { waits.push(amount); clock += amount; },
      request: async options => {
        active++; peak = Math.max(peak, active); budgets.push(options.remaining); signals.push(options.signal);
        try {
          const response = await probe(options, budgets.length);
          return { status: response.status, text: async () => {
            try { return await response.text(); } finally { active--; }
          } };
        } catch (error) { active--; throw error; }
      },
    },
  };
}

test("WEB23 dev readiness permits headers and body over 30s within the single 90s deadline", async () => {
  const state = devObserver(async ({ signal }) => {
    state.advance(35_000);
    assert.equal(signal.aborted, false);
    return { status: 200, text: async () => { state.advance(10_000); return devHeading(); } };
  });
  assert.deepEqual(await observeWeb23DevReadiness(state.options), { attempts: 1, status: 200 });
  assert.deepEqual(state.budgets, [90_000]);
  assert.deepEqual(state.waits, []);
  assert.equal(state.peak(), 1);
});

test("WEB23 dev readiness connection refusal retries only a sequential probe with decreasing budget", async () => {
  const state = devObserver(async (_, attempt) => {
    if (attempt === 1) { state.advance(10); throw Object.assign(new Error("private fake error"), { cause: { code: "ECONNREFUSED" } }); }
    state.advance(2_000);
    return { status: 200, text: async () => devHeading() };
  });
  assert.deepEqual(await observeWeb23DevReadiness(state.options), { attempts: 2, status: 200 });
  assert.deepEqual(state.budgets, [90_000, 89_890]);
  assert.deepEqual(state.waits, [100]);
  assert.equal(state.peak(), 1);
});

test("WEB23 dev readiness repeated connection failure stops at 90s with sanitized last reason", async () => {
  const state = devObserver(async () => {
    state.advance(30_000);
    throw Object.assign(new Error("SECRET_PRIVATE_PATH"), { code: "ECONNREFUSED" });
  });
  await assert.rejects(observeWeb23DevReadiness(state.options), error => {
    assert.match(error.message, /DEADLINE_EXCEEDED attempts=3 last=CONNECTION\/TRANSPORT:ECONNREFUSED:NO_HTTP_RESPONSE/);
    assert.ok(!error.message.includes("SECRET_PRIVATE_PATH")); return true;
  });
  assert.deepEqual(state.budgets, [90_000, 59_900, 29_800]);
  assert.equal(state.peak(), 1);
});

test("WEB23 dev readiness HTTP status and fatal 200 fixture mismatch are distinct", async () => {
  const status = devObserver(async () => {
    status.advance(90_000); return { status: 503, text: async () => "PRIVATE_HTML_NOT_LOGGED" };
  });
  await assert.rejects(observeWeb23DevReadiness(status.options), /DEADLINE_EXCEEDED attempts=1 last=HTTP_STATUS:503/);
  const mismatch = devObserver(async () => ({ status: 200, text: async () => "PRIVATE_WRONG_FIXTURE" }));
  await assert.rejects(observeWeb23DevReadiness(mismatch.options), /FIXTURE_MISMATCH attempts=1 last=HTTP_STATUS:200/);
  assert.equal(mismatch.budgets.length, 1);
  assert.deepEqual(mismatch.waits, []);
});

test("WEB23 dev readiness body abort records received status instead of no-response failure", async () => {
  const state = devObserver(async () => ({ status: 200, text: async () => {
    state.advance(90_000); throw new Error("PRIVATE_BODY_ERROR");
  } }));
  await assert.rejects(observeWeb23DevReadiness(state.options), /DEADLINE_EXCEEDED attempts=1 last=BODY_ABORT_OR_TIMEOUT:HTTP_STATUS:200/);
  assert.equal(state.budgets.length, 1);
});

test("WEB23 dev readiness child exit and invalid caller fail before further probes", async () => {
  const closed = devObserver(async () => { throw new Error("must not probe"); }); closed.exit();
  await assert.rejects(observeWeb23DevReadiness(closed.options), /SERVER_CHILD_EXIT attempts=0/);
  assert.deepEqual(closed.budgets, []);
  const exitsDuring = devObserver(async () => {
    exitsDuring.exit(); return { status: 200, text: async () => devHeading() };
  });
  await assert.rejects(observeWeb23DevReadiness(exitsDuring.options), /SERVER_CHILD_EXIT attempts=1/);
  await assert.rejects(waitForWeb23DevFixture({}), /Unowned DEV/);
  await assert.rejects(waitForWeb23DevFixture(null), /Unowned DEV/);
  await assert.rejects(observeWeb23DevReadiness({}), /Invalid DEV readiness observer/);
  await assert.rejects(observeWeb23DevReadiness({ ...closed.options, now: () => NaN }), /Invalid DEV readiness clock/);
});

test("WEB20 scenario cannot be selected by caller environment or weaken secret filtering", () => {
  const env = fixtureEnvironment({ HANAPURE_PUBLISHED_SCENARIO: "paginated", NODE_OPTIONS: "test-only-hook", API_SECRET: "test-only-secret", SYSTEMROOT: "C:\\Windows" });
  assert.equal(env.HANAPURE_PUBLISHED_SCENARIO, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.API_SECRET, undefined);
  assert.equal(env.SYSTEMROOT, "C:\\Windows");
});

for (const locale of ["en", "hu", "ko"]) test(`WEB20 ${locale} paginated selections compose Plan and read-only Cart impact before additive merge`, () => {
  const lines = [{ publicId: first.publicId, quantity: 3 }, { publicId: second.publicId, quantity: 1 }];
  const plan = readShoppingPlan(portablePayload(lines), catalogue.listPublished());
  const href = shoppingPlanHref(`/${locale}/products`, "?q=TEST+ONLY+JOURNEY&brand=Round+Lab", lines);
  assert.deepEqual(readShoppingPlan(new URL(href, "http://localhost").searchParams.get("cartPlan"), catalogue.listPublished()), plan);
  const incoming = readPortableLink(new URL(shoppingPlanCartHref(`/${locale}/cart`, plan, catalogue.listPublished()), "http://localhost").href);
  assert.equal(incoming.status, "ready");
  const current = [{ publicId: first.publicId, quantity: 2 }], before = JSON.stringify(current);
  const impact = cartDraftImpact(current, incoming.lines, catalogue.listPublished());
  assert.equal(impact.status, "ready");
  assert.equal(JSON.stringify(current), before);
  const merged = planPortableMerge(current, incoming.lines, catalogue.listPublished());
  assert.equal(merged.status, "ready");
  assert.deepEqual(merged.after, [{ publicId: first.publicId, quantity: 5 }, { publicId: second.publicId, quantity: 1 }]);
});

test("WEB20 unknown/draft Plan and comparison cannot enter the synthetic public chain", () => {
  const privateId = "81999999-abcd-1234-abcd-123456789abc";
  assert.equal(readShoppingPlan(portablePayload([{ publicId: privateId, quantity: 1 }]), catalogue.listPublished()).status, "invalid");
  assert.equal(publishedComparison(catalogue.listPublished(), { first: first.publicId, second: privateId }), null);
  assert.match(readFileSync(new URL("../data/catalogue.ts", import.meta.url), "utf8"), /Object\.freeze\(\[\]\)/);
});
