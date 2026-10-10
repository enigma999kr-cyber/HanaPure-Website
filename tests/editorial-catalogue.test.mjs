import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { brandNames } from "../data/brands.ts";
import { createLocalCatalogueReader, validateEditorialCatalogue } from "../lib/catalog/editorial-catalogue.ts";
import { localCatalogue } from "../lib/catalog/local-catalogue.ts";
import { publishedCatalogueFixtures, publishedSlug, draftSlug } from "./browser/published-catalogue-fixtures.mjs";
import { fixtureEnvironment, createFixtureWorkspace, stopOwnedChild, waitForFixtureServer } from "./browser/published-catalogue-server.mjs";

const browserRepo = fileURLToPath(new URL("../", import.meta.url));
const safetyWorkspace = () => {
  const owner = randomUUID();
  return { owner, workspace: createFixtureWorkspace(join(browserRepo, ".next", `published-safety-${owner}`), owner) };
};
const quiet = ["ignore", "pipe", "pipe"];

test("fixture environment allowlist blocks prefixed, arbitrary, mixed-case secrets and execution hooks in a real child", () => {
  const env = fixtureEnvironment({ ...process.env,
    CUSTOM_BUSINESS_SECRET: "test-sentinel", AWS_SECRET_ACCESS_KEY: "test-sentinel",
    SUPABASE_SERVICE_ROLE_KEY: "test-sentinel", DATABASE_URL: "test-sentinel",
    NEXT_PUBLIC_TOKEN: "test-sentinel", NODE_OPTIONS: "test-sentinel",
    NODE_PATH: "test-sentinel", HTTP_PROXY: "test-sentinel", Gh_ToKeN: "test-sentinel",
  });
  const allowed = ["SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE",
    "NODE_ENV", "NEXT_TELEMETRY_DISABLED", "HANAPURE_PUBLIC_SITE_ORIGIN"];
  assert.ok(Object.keys(env).every(key => allowed.includes(key)));
  const child = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], { env, encoding: "utf8" });
  assert.equal(child.status, 0);
  const received = JSON.parse(child.stdout);
  assert.ok(!Object.values(received).includes("test-sentinel"));
  assert.equal(received.NODE_OPTIONS, undefined);
  assert.equal(received.HANAPURE_PUBLIC_SITE_ORIGIN, "");
});

test("termination rejects a reused/lookalike PID, wrong owner and changed process identity without killing the real child", async () => {
  const { owner, workspace } = safetyWorkspace();
  const child = workspace.spawn(["-e", "console.log('READY');setInterval(()=>{},1000)"], fixtureEnvironment(), quiet);
  try {
    await once(child.stdout, "data");
    let fakeKillCalls = 0;
    await assert.rejects(stopOwnedChild({ pid: child.pid, spawnfile: child.spawnfile,
      spawnargs: child.spawnargs, kill: () => { fakeKillCalls++; } }, owner), /identity\/ownership/);
    await assert.rejects(stopOwnedChild(child, "another-owner"), /identity\/ownership/);
    child.spawnargs.push("changed-identity");
    try { await assert.rejects(workspace.cleanup(), /identity\/ownership/); }
    finally { child.spawnargs.pop(); }
    const nativeKill = child.kill;
    child.kill = () => { fakeKillCalls++; };
    try { await assert.rejects(stopOwnedChild(child, owner), /identity\/ownership/); }
    finally { child.kill = nativeKill; }
    assert.equal(fakeKillCalls, 0);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    assert.ok(existsSync(workspace.root));
  } finally { await workspace.cleanup(); }
  assert.ok(!existsSync(workspace.root));
});

test("marker owner/hash mismatch refuses cleanup before touching an owned live child; existing directories cannot be adopted", async () => {
  const { workspace } = safetyWorkspace();
  const marker = join(workspace.root, ".test-only-owner");
  const original = readFileSync(marker, "utf8");
  const child = workspace.spawn(["-e", "console.log('READY');setInterval(()=>{},1000)"], fixtureEnvironment(), quiet);
  try {
    await once(child.stdout, "data");
    assert.throws(() => createFixtureWorkspace(workspace.root, randomUUID()), /EEXIST/);
    for (const patch of [{ owner: "wrong-owner" }, { catalogueHash: "wrong-hash" }]) {
      writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), ...patch }));
      await assert.rejects(workspace.cleanup(), /integrity unverified/);
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
      assert.ok(existsSync(workspace.root));
    }
  } finally { writeFileSync(marker, original); await workspace.cleanup(); }
  assert.ok(!existsSync(workspace.root));
});

test("actual next start failure without a build closes its owned child and removes only its fixture", async () => {
  const { workspace } = safetyWorkspace();
  const next = join(browserRepo, "node_modules", "next", "dist", "bin", "next");
  try {
    const child = workspace.spawn([next, "start", "--hostname", "127.0.0.1", "--port", "0"], fixtureEnvironment(), quiet);
    await assert.rejects(workspace.wait(child), /Fixture child failed/);
    assert.ok(child.exitCode !== null);
  } finally { await workspace.cleanup(); }
  assert.ok(!existsSync(workspace.root));
});

test("readiness timeout cleans a still-live owned child; closed-server startup failure is distinguished", async () => {
  const { workspace } = safetyWorkspace();
  try {
    const child = workspace.spawn(["-e", "console.log('READY');setInterval(()=>{},1000)"], fixtureEnvironment(), quiet);
    await once(child.stdout, "data");
    await assert.rejects(waitForFixtureServer(child, "http://127.0.0.1:1", 50), /readiness timed out/);
    const failed = workspace.spawn(["-e", "process.exit(7)"], fixtureEnvironment(), quiet);
    await assert.rejects(workspace.wait(failed), /Fixture child failed/);
    await assert.rejects(waitForFixtureServer(failed, "http://127.0.0.1:1"), /failed before readiness/);
  } finally { await workspace.cleanup(); }
  assert.ok(!existsSync(workspace.root));
});

test("fixture workspace refuses repository-root and path traversal targets", () => {
  assert.throws(() => createFixtureWorkspace(browserRepo, randomUUID()), /Unsafe fixture/);
  assert.throws(() => createFixtureWorkspace(join(browserRepo, ".next", "..", "data"), randomUUID()), /Unsafe fixture/);
});

test("isolated browser fixtures satisfy the unchanged editorial authority, without operational fields", () => {
  const reader = createLocalCatalogueReader(publishedCatalogueFixtures);
  assert.equal(reader.listPublished().length, 2);
  assert.equal(reader.findPublishedBySlug(publishedSlug).publicId, publishedCatalogueFixtures[0].publicId);
  assert.equal(reader.findPublishedBySlug(draftSlug), null);
  for (const record of publishedCatalogueFixtures) {
    assert.deepEqual(Object.keys(record).sort(), ["brand", "publicId", "slug", "state", "translations"]);
  }
  assert.deepEqual(localCatalogue.listPublished(), []);
});

// Entirely fictional editorial fixtures; no sale, efficacy or availability claims.
const firstId = "12345678-abcd-1234-abcd-123456789abc";
const secondId = "22345678-abcd-1234-abcd-123456789abc";
const translation = () => ({ name: "Fictional test item", description: "Test fixture only.",
  images: [{ src: "/fixtures/fictional.webp", alt: "Fictional test image" }], usage: null, caution: null });
const product = (overrides = {}) => ({ publicId: firstId, brand: brandNames[0], slug: "fictional-test-item",
  state: "published", translations: { en: translation(), hu: null, ko: null }, ...overrides });
const code = (records) => validateEditorialCatalogue(records).code;

test("production catalogue is empty and cannot expose invented products", () => {
  assert.deepEqual(localCatalogue.listPublished(), []);
  assert.equal(localCatalogue.findPublishedBySlug("fictional-test-item"), null);
  assert.equal(localCatalogue.findPublishedByPublicId(firstId), null);
});

test("drafts are excluded from every public read even when their content is complete", () => {
  const draft = product({ publicId: secondId, slug: "fictional-draft", state: "draft" });
  const reader = createLocalCatalogueReader([product(), draft]);
  assert.deepEqual(reader.listPublished().map((record) => record.publicId), [firstId]);
  assert.equal(reader.findPublishedByPublicId(secondId), null);
  assert.equal(reader.findPublishedBySlug(draft.slug), null);
  assert.equal(reader.findPublishedBySlug("fictional-test-item").publicId, firstId);
  assert.equal(reader.findPublishedByPublicId(firstId).slug, "fictional-test-item");
});

test("missing translations stay explicit without fallback; all three locales preserve text", () => {
  const record = createLocalCatalogueReader([product()]).listPublished()[0];
  assert.equal(record.translations.hu, null);
  assert.equal(record.translations.ko, null);
  const all = product();
  all.translations.hu = { ...translation(), name: "Kitalált teszt" };
  all.translations.ko = { ...translation(), name: "가상 테스트" };
  all.translations.ko.usage = "테스트 문구";
  all.translations.ko.caution = "테스트 주의 문구";
  assert.deepEqual(createLocalCatalogueReader([all]).listPublished()[0].translations, all.translations);
});

test("identity and slug duplicates, including UUID case variants and draft collisions, fail atomically", () => {
  assert.equal(code([product(), product({ slug: "another-slug", publicId: firstId.toUpperCase(), state: "draft" })]), "duplicate_public_id");
  assert.equal(code([product(), product({ publicId: secondId })]), "duplicate_slug");
  assert.throws(() => createLocalCatalogueReader([product(), product()]), /duplicate_public_id/);
  const original = product({ publicId: firstId.toUpperCase() });
  assert.equal(createLocalCatalogueReader([original]).listPublished()[0].publicId, original.publicId);
});

test("brand references reuse exact existing authority; invalid identity/state/slug/locale shapes fail", () => {
  for (const brand of brandNames) assert.equal(validateEditorialCatalogue([product({ brand })]).ok, true);
  assert.equal(code([product({ brand: "BePlain" })]), "invalid_brand");
  for (const patch of [{ publicId: "sku-1" }, { slug: "Bad Slug" }, { state: "approved" },
    { translations: { en: translation(), hu: null } },
    { translations: { en: translation(), hu: null, ko: null, fr: null } }]) {
    assert.equal(code([product(patch)]), "invalid_record");
  }
  assert.equal(code(null), "invalid_catalogue");
});

test("incomplete published content is rejected while incomplete drafts remain private", () => {
  const missing = product({ translations: { en: null, hu: null, ko: null } });
  assert.equal(code([missing]), "incomplete_published_content");
  assert.equal(createLocalCatalogueReader([{ ...missing, state: "draft" }]).listPublished().length, 0);
  for (const field of ["name", "description"]) {
    const record = product(); record.translations.en[field] = "  ";
    assert.equal(code([record]), "incomplete_published_content");
    assert.equal(validateEditorialCatalogue([{ ...record, state: "draft" }]).ok, true);
  }
  const partialLocale = product(); partialLocale.translations.hu = { ...translation(), name: "" };
  assert.equal(code([partialLocale]), "incomplete_published_content");
  const image = product(); image.translations.en.images[0].alt = " ";
  assert.equal(code([image]), "incomplete_published_content");
  // No invented mandatory image count or caution/launch-language policy.
  const textOnly = product(); textOnly.translations.en.images = [];
  assert.equal(validateEditorialCatalogue([textOnly]).ok, true);
});

test("image metadata and nullable usage/caution are validated without fetching assets", () => {
  for (const src of ["javascript:alert(1)", "//untrusted.invalid/image", "https://user:secret@example.invalid/a", "/\\example.invalid/a"]) {
    const record = product(); record.translations.en.images[0].src = src;
    assert.equal(code([record]), "invalid_record");
  }
  const record = product(); record.translations.en.usage = 42;
  assert.equal(code([record]), "invalid_record");
});

test("editorial contract rejects operational ownership at every content level", () => {
  for (const field of ["basePriceHuf", "sellableStock", "operationalReady", "retail_price_huf", "sellable_stock", "operational_ready", "price", "stock"]) {
    assert.equal(code([product({ [field]: 1 })]), "invalid_record");
    const record = product(); record.translations.en[field] = 1;
    assert.equal(code([record]), "invalid_record");
    const image = product(); image.translations.en.images[0][field] = 1;
    assert.equal(code([image]), "invalid_record");
  }
});

test("reader owns a frozen snapshot; later input mutation cannot publish or corrupt data", () => {
  const source = product(); const reader = createLocalCatalogueReader([source]);
  source.state = "draft"; source.translations.en.name = "Changed";
  source.translations.en.images[0].alt = "Changed";
  const record = reader.listPublished()[0];
  assert.equal(record.state, "published");
  assert.equal(record.translations.en.name, "Fictional test item");
  assert.equal(record.translations.en.images[0].alt, "Fictional test image");
  assert.throws(() => reader.listPublished().push(source), TypeError);
  assert.throws(() => { record.translations.en.images[0].alt = "Mutation"; }, TypeError);
});

test("accessors/inherited fields cannot smuggle operational data through validation", () => {
  const record = product(); Object.defineProperty(record, "state", { get() { throw new Error("secret"); } });
  assert.equal(code([record]), "invalid_record");
  const inherited = Object.assign(Object.create({ basePriceHuf: 1 }), product());
  assert.equal(code([inherited]), "invalid_record");
});

test("catalogue source and reader reject browser-side imports through the real server-only marker", () => {
  for (const file of ["lib/catalog/editorial-catalogue.ts", "lib/catalog/local-catalogue.ts", "data/catalogue.ts"]) {
    const result = spawnSync(process.execPath, ["--import", "./tests/server-only-loader.mjs", "--input-type=module", "--eval", `await import('./${file}')`],
      { encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot be imported from a Client Component/);
  }
});
