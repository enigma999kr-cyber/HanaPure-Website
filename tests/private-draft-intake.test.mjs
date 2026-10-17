import assert from "node:assert/strict";
import test from "node:test";
import fs, { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import childProcess, { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { diagnoseDraft, runIntake } from "../scripts/private-draft-intake.mjs";
import { validateEditorialCatalogue } from "../lib/catalog/editorial-catalogue.ts";
import { localCatalogue } from "../lib/catalog/local-catalogue.ts";
import { startDraftPreview } from "../scripts/editorial-draft-preview.mjs";
import { storefrontLabels } from "../lib/storefront/localization.ts";

const environment = { NODE_ENV: "development", HANAPURE_DRAFT_PREVIEW_LOCAL: "1" };
const marker = "TEST ONLY PRIVATE INTAKE";
const draft = index => ({ publicId: `${index.toString(16).padStart(8, "0")}-ABCD-1234-ABCD-123456789ABC`,
  brand: "Round Lab", slug: `test-only-private-intake-${index}`, state: "draft", translations: { en: null, hu: null, ko: null } });
function privateDirectory(t) {
  const root = mkdtempSync(join(tmpdir(), "hanapure-private-intake-"));
  t.after(() => rmSync(root, { recursive: true })); // Only this exact test-owned temp directory.
  return root;
}
function jsonFile(root, value, name = "input.json") {
  const path = join(root, name); writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); return path;
}
const starterArgs = (path, value = draft(0)) => ["starter", "--public-id", value.publicId, "--brand", value.brand, "--slug", value.slug, "--output", path];
const codes = result => result.diagnostics.map(item => item.code);
function cli(args, patch = {}) {
  return spawnSync(process.execPath, ["--conditions=react-server", "--import", "./tests/server-only-loader.mjs", "scripts/private-draft-intake.mjs", ...args],
    { env: { ...process.env, ...environment, ...patch }, encoding: "utf8", windowsHide: true, timeout: 20000 });
}

test("starter creates exact supplied draft schema exclusively, preserves ID case and opens unchanged in EN/HU/KO preview", async t => {
  const root = privateDirectory(t), output = join(root, "starter.json"), item = draft(0);
  const result = cli(starterArgs(output)); assert.equal(result.status, 0, result.stdout);
  const summary = JSON.parse(result.stdout); assert.equal(summary.code, "starter_created");
  assert.ok(!result.stdout.includes(output)); assert.ok(!result.stdout.includes(item.publicId));
  const bytes = readFileSync(output), created = JSON.parse(bytes); assert.deepEqual(created, item);
  assert.deepEqual(Object.keys(created), ["publicId", "brand", "slug", "state", "translations"]);
  assert.equal(validateEditorialCatalogue([created]).ok, true);
  const names = readdirSync(root); assert.equal(runIntake(starterArgs(output), environment).diagnostics[0].code, "output_exists");
  assert.deepEqual(readFileSync(output), bytes); assert.deepEqual(readdirSync(root), names);
  const preview = await startDraftPreview({ draft: created, environment }); t.after(preview.close);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
  for (const locale of ["en", "hu", "ko"]) {
    await page.goto(`${preview.url}/?locale=${locale}`);
    assert.ok(await page.getByText(storefrontLabels[locale].missing, { exact: true }).isVisible());
    assert.equal(await page.locator("img").count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(readFileSync(output), bytes);
  const lower = draft(1); lower.publicId = lower.publicId.toLowerCase();
  const second = join(root, "lowercase.json"); assert.equal(runIntake(starterArgs(second, lower), environment).ok, true);
  assert.equal(JSON.parse(readFileSync(second)).publicId, lower.publicId);
});

test("starter refuses malformed identity/brand/slug and missing/duplicate/unknown arguments without output", t => {
  const root = privateDirectory(t), output = join(root, "refused.json");
  for (const patch of [{ publicId: "NOT AN ERP ID" }, { brand: "round lab" }, { brand: marker }, { slug: "Bad Slug" }, { slug: "-bad" }, { slug: "bad--slug" }]) {
    const result = runIntake(starterArgs(output, { ...draft(0), ...patch }), environment); assert.equal(result.ok, false); assert.equal(existsSync(output), false);
  }
  const args = starterArgs(output);
  for (const invalid of [[], ["starter"], args.slice(0, -1), [...args, "--extra", marker],
    ["starter", "--brand", "Round Lab", "--brand", "Round Lab", "--slug", "test", "--output", output], ["validate", "--wrong", marker]]) {
    const result = cli(invalid); assert.equal(result.status, 1); assert.ok(codes(JSON.parse(result.stdout)).includes("invalid_arguments"));
    assert.ok(!result.stdout.includes(marker)); assert.ok(!result.stdout.includes(output));
  }
  assert.deepEqual(readdirSync(root), []);
});

test("exclusive creator race, Unicode private path, ACL-inspection refusal and parent replacement fail safely", async t => {
  const root = privateDirectory(t), folder = join(root, "비공개-árvíz"); mkdirSync(folder);
  const output = join(folder, "초안.json");
  const run = () => new Promise((accept, reject) => {
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "./tests/server-only-loader.mjs", "scripts/private-draft-intake.mjs", ...starterArgs(output)],
      { env: { ...process.env, ...environment }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; child.stdout.on("data", chunk => chunks.push(chunk)); child.stderr.resume(); child.on("error", reject);
    child.on("close", status => accept({ status, result: JSON.parse(Buffer.concat(chunks).toString()) }));
  });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map(item => item.status).sort(), [0, 1]);
  assert.equal(results.filter(item => item.result.ok).length, 1);
  assert.deepEqual(codes(results.find(item => !item.result.ok).result), ["output_exists"]);
  assert.deepEqual(JSON.parse(readFileSync(output)), draft(0));
  assert.equal(runIntake(["validate", "--file", output], environment).ok, true);
  if (process.platform === "win32") {
    const refused = t.mock.method(childProcess, "spawnSync", () => ({ status: 1, stdout: "DENIED" })); syncBuiltinESMExports();
    try { assert.deepEqual(codes(runIntake(starterArgs(join(root, "denied.json")), environment)), ["private_path_required"]); }
    finally { refused.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(existsSync(join(root, "denied.json")), false);
  }
  const original = fs.openSync; let created = false;
  const racePath = join(root, "race.json");
  const open = t.mock.method(fs, "openSync", (path, ...args) => {
    const fd = original(path, ...args); if (path === racePath) created = true; return fd;
  });
  const lstat = fs.lstatSync;
  const changed = t.mock.method(fs, "lstatSync", (path, ...args) => {
    const stat = lstat(path, ...args); if (created && path === root) stat.ino += 1n; return stat;
  }); syncBuiltinESMExports();
  try { assert.deepEqual(codes(runIntake(starterArgs(racePath), environment)), ["private_path_required"]); }
  finally { open.mock.restore(); changed.mock.restore(); syncBuiltinESMExports(); }
  // Unverifiable parent => no unsafe deletion; no content was written to the new file.
  assert.equal(readFileSync(racePath).length, 0);
});

test("object/array count boundaries pass shared validator without mutation; empty/51/published/duplicate input fails", t => {
  const root = privateDirectory(t);
  for (const value of [draft(0), [draft(0)], Array.from({ length: 50 }, (_, index) => draft(index))]) {
    const path = jsonFile(root, value), bytes = readFileSync(path);
    const direct = diagnoseDraft(value); assert.equal(direct.ok, true); assert.equal(Object.isFrozen(direct.records), true);
    assert.equal(validateEditorialCatalogue(Array.isArray(value) ? value : [value]).ok, true);
    assert.equal(runIntake(["validate", "--file", path], environment).ok, true); assert.deepEqual(readFileSync(path), bytes);
  }
  for (const input of [[], Array.from({ length: 51 }, (_, i) => draft(i))]) assert.deepEqual(codes(diagnoseDraft(input)), ["invalid_input_count"]);
  const items = [draft(0), draft(1)]; items[1].publicId = items[0].publicId.toLowerCase(); items[1].slug = items[0].slug;
  assert.deepEqual(codes(diagnoseDraft(items)), ["duplicate_public_id", "duplicate_slug"]);
  const published = draft(1); published.state = "published";
  assert.ok(codes(diagnoseDraft([draft(0), published])).includes("invalid_state"));
});

test("bounded diagnostics have safe canonical paths/locales, deterministic order, null compatibility and no private echo", () => {
  const secret = `${marker} 👿,\"\n<secret>https://private.invalid/image</secret>`;
  const item = draft(0); item.translations.en = { name: secret, description: secret, usage: secret, caution: secret,
    images: [{ src: `http://invalid.test/${secret}`, alt: 5 }] };
  delete item.translations.hu;
  let result = diagnoseDraft(item);
  assert.deepEqual(result.diagnostics, [{ draft_index: 0, locale: "hu", field: "$.translations.hu", code: "missing_required_property" }]);
  item.translations.hu = null; item.translations.ko = { [secret]: secret };
  result = diagnoseDraft(item);
  assert.deepEqual(result.diagnostics.slice(0, 2), [
    { draft_index: 0, locale: "en", field: "$.translations.en.images[0].src", code: "invalid_image_source" },
    { draft_index: 0, locale: "en", field: "$.translations.en.images[0].alt", code: "invalid_image_alt" }]);
  assert.ok(codes(result).includes("unexpected_property")); assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(result, diagnoseDraft(item));
  const extras = draft(0); extras[secret] = secret;
  assert.deepEqual(codes(diagnoseDraft(extras)), ["unexpected_property"]);
  const many = Array.from({ length: 50 }, () => ({})); result = diagnoseDraft(many);
  assert.equal(result.diagnostics.length, 12); assert.equal(result.more_suppressed, true);
  assert.deepEqual(result, diagnoseDraft(many));
  const long = draft(0); long.translations.en = { name: "x".repeat(1_000_001), description: "", images: [], usage: null, caution: null };
  assert.ok(codes(diagnoseDraft(long)).includes("input_too_large"));
  const cyclic = draft(0); cyclic.translations.en = cyclic; assert.equal(diagnoseDraft(cyclic).ok, false);
  const getter = draft(0); Object.defineProperty(getter, "publicId", { get() { throw new Error(secret); }, enumerable: true });
  assert.ok(!JSON.stringify(diagnoseDraft(getter)).includes(secret));
  const toJson = draft(0); toJson.toJSON = () => { throw new Error(secret); }; assert.ok(codes(diagnoseDraft(toJson)).includes("unexpected_property"));
  const proxy = new Proxy([], { get() { throw new Error(secret); } }); assert.deepEqual(codes(diagnoseDraft(proxy)), ["invalid_record"]);
  const accessorArray = []; Object.defineProperty(accessorArray, "0", { get() { throw new Error(secret); } });
  assert.deepEqual(codes(diagnoseDraft(accessorArray)), ["invalid_type"]);
  const original = JSON.stringify(item); diagnoseDraft(item); assert.equal(JSON.stringify(item), original);
});

test("source and field diagnostics match strict existing schema, including accessor/extra properties and preview limits", () => {
  for (const src of ["/local.png", "https://example.invalid/image.png", "HTTPS://example.invalid/image.png"]) {
    const item = draft(0); item.translations.hu = { name: "", description: "", images: [{ src, alt: "" }], usage: "", caution: null };
    assert.equal(diagnoseDraft(item).ok, true); assert.equal(validateEditorialCatalogue([item]).ok, true);
  }
  for (const src of ["", " ", "//external.invalid/image.png", "file:///private.png", "https://user:secret@example.invalid/x", "http://example.invalid/image", "/bad\\path", "/bad path"]) {
    const item = draft(0); item.translations.ko = { name: "", description: "", images: [{ src, alt: "" }], usage: null, caution: null };
    assert.ok(codes(diagnoseDraft(item)).includes("invalid_image_source")); assert.equal(validateEditorialCatalogue([item]).ok, false);
  }
  for (const patch of [{ translations: [] }, { translations: { en: null, hu: null } }, { translations: { en: null, hu: null, ko: null, secret: null } }, { publicId: 4 }, { slug: null }, { state: "AUTO" }]) assert.equal(diagnoseDraft({ ...draft(0), ...patch }).ok, false);
  const excess = draft(0); excess.translations.en = { name: "", description: "", images: Array(1_000_000), usage: null, caution: null };
  assert.ok(codes(diagnoseDraft(excess)).includes("input_too_large"));
  const huge = Array(1_000_000); assert.deepEqual(codes(diagnoseDraft(huge)), ["invalid_input_count"]);
});

test("private file policy refuses existing files/directories, missing parents, public/repo/reserved paths and junction escapes", t => {
  const root = privateDirectory(t), other = privateDirectory(t), existing = jsonFile(root, draft(0)), bytes = readFileSync(existing);
  mkdirSync(join(root, "directory.json")); mkdirSync(join(root, "public"));
  mkdirSync(join(root, "repository")); mkdirSync(join(root, "repository", ".git"));
  symlinkSync(other, join(root, "junction"), "junction");
  const paths = ["relative.json", resolve("data/never-created.json"), join(root, "missing", "new.json"), join(root, "public", "new.json"),
    join(root, "junction", "new.json"), join(root, "repository", "new.json"), join(root, "draft.txt"), join(root, "CON.json"), join(root, "draft.json:stream"), join(root, "directory.json")];
  for (const path of paths) assert.equal(runIntake(starterArgs(path), environment).ok, false, path);
  assert.equal(runIntake(starterArgs(existing), environment).ok, false); assert.deepEqual(readFileSync(existing), bytes);
  assert.equal(runIntake(["validate", "--file", join(root, "directory.json")], environment).ok, false);
  const input = jsonFile(other, draft(1)); assert.equal(runIntake(["validate", "--file", join(root, "junction", "input.json")], environment).ok, false);
  assert.equal(readFileSync(input, "utf8"), JSON.stringify(draft(1)));
  assert.deepEqual(readdirSync(other), ["input.json"]);
});

test("encoding, parse, raw byte budget and unreadable file failures are non-sensitive; validation never writes input", t => {
  const root = privateDirectory(t), path = join(root, "input.json");
  for (const [bytes, code] of [[Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "invalid_encoding"], [Buffer.from("{}", "utf16le"), "invalid_encoding"],
    [Buffer.from([0xc3, 0x28]), "invalid_encoding"], [Buffer.from([0x7b, 0, 0x7d]), "invalid_encoding"], [Buffer.from(`{${marker}`), "invalid_json"], [Buffer.alloc(1_000_001, 32), "input_too_large"]]) {
    writeFileSync(path, bytes, { mode: 0o600 }); const result = runIntake(["validate", "--file", path], environment);
    assert.deepEqual(codes(result), [code]); assert.deepEqual(readFileSync(path), bytes); assert.ok(!JSON.stringify(result).includes(root));
  }
  jsonFile(root, draft(0));
  const stub = t.mock.method(fs, "readSync", () => { throw Object.assign(new Error(`${marker} ${path}`), { code: "EACCES" }); }); syncBuiltinESMExports();
  try { const result = runIntake(["validate", "--file", path], environment); assert.deepEqual(codes(result), ["input_unavailable"]); assert.ok(!JSON.stringify(result).includes(marker)); }
  finally { stub.mock.restore(); syncBuiltinESMExports(); }
  const failWrite = t.mock.method(fs, "writeFileSync", () => { throw new Error(`${marker} ${path}`); }); syncBuiltinESMExports();
  const output = join(root, "partial.json");
  try { assert.deepEqual(codes(runIntake(starterArgs(output), environment)), ["output_unavailable"]); assert.equal(existsSync(output), false); }
  finally { failWrite.mock.restore(); syncBuiltinESMExports(); }
});

test("explicit local environment only; no listener or network during starter/validation and no argument/content logging", t => {
  const root = privateDirectory(t), path = jsonFile(root, draft(0));
  const patches = [{ NODE_ENV: "production" }, { NODE_ENV: "staging" }, { HANAPURE_DRAFT_PREVIEW_LOCAL: "0" }, { APP_ENV: "staging" }, { VERCEL: "1" }, { VERCEL_ENV: "preview" }, { NETLIFY: "1" }, { CF_PAGES: "1" }, { DEPLOYMENT_ENV: "local" }];
  for (const patch of patches) { const result = cli(["validate", "--file", path], patch); assert.equal(result.status, 1); assert.deepEqual(codes(JSON.parse(result.stdout)), ["local_development_required"]); assert.ok(!result.stdout.includes(root)); }
  let network = 0;
  const listen = t.mock.method(net.Server.prototype, "listen", () => { network++; throw new Error("Network forbidden"); });
  const connect = t.mock.method(net.Socket.prototype, "connect", () => { network++; throw new Error("Network forbidden"); });
  const fetch = t.mock.method(globalThis, "fetch", () => { network++; throw new Error("Network forbidden"); });
  try {
    assert.equal(runIntake(["validate", "--file", path], environment).ok, true);
    assert.equal(runIntake(starterArgs(join(root, "safe.json")), environment).ok, true); assert.equal(network, 0);
  } finally { listen.mock.restore(); connect.mock.restore(); fetch.mock.restore(); }
});

test("production catalogue and build graph remain empty and free of intake CLI/endpoints/test content", () => {
  assert.deepEqual(localCatalogue.listPublished(), []);
  const manifest = readFileSync(resolve(".next/server/app-paths-manifest.json"), "utf8");
  assert.ok(!/private-draft-intake|\/starter|\/validate/.test(manifest));
  const inspect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(?:js|json|html|rsc)$/.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        for (const term of [marker, "test-only-private-intake", "private-draft-intake", "starter_created"]) assert.ok(!text.includes(term), term);
      }
    }
  };
  inspect(resolve(".next/server")); inspect(resolve(".next/static"));
});
