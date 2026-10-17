import assert from "node:assert/strict";
import test from "node:test";
import fs, { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, linkSync, symlinkSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import childProcess, { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { diagnoseDraft, runIntake, compareSnapshots } from "../scripts/private-draft-intake.mjs";
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

const content = locale => ({ name: `${marker} ${locale} name`, description: `${marker} ${locale} description`,
  images: [{ src: `https://example.invalid/${locale}/one.png`, alt: `${marker} ${locale} ALT` }], usage: null, caution: "" });
const translatedDraft = index => ({ ...draft(index), translations: Object.fromEntries(["en", "hu", "ko"].map(locale => [locale, content(locale)])) });
const compareArgs = (before, after) => ["compare", "--before", before, "--after", after];

test("comparison aligns only UUIDs: wrappers, array reorder, case variants, same-file and hardlink semantics", t => {
  const root = privateDirectory(t), before = jsonFile(root, draft(0), "before.json"), after = jsonFile(root, [draft(0)], "after.json");
  for (const result of [compareSnapshots(draft(0), [draft(0)]), runIntake(compareArgs(before, after), environment), runIntake(compareArgs(before, before), environment)]) {
    assert.equal(result.ok, true); assert.equal(result.unchanged, 1); assert.equal(result.changed, 0); assert.deepEqual(result.entries, []);
  }
  const alias = join(root, "alias.json"); linkSync(before, alias);
  assert.equal(runIntake(compareArgs(before, alias), environment).unchanged, 1);
  const items = Array.from({ length: 50 }, (_, i) => draft(i)); const reversed = structuredClone(items).reverse();
  for (const item of reversed) item.publicId = item.publicId.toLowerCase();
  const result = compareSnapshots(items, reversed);
  assert.deepEqual([result.before_total, result.after_total, result.added, result.removed, result.changed, result.unchanged], [50, 50, 0, 0, 0, 50]);
  const beforeBytes = readFileSync(before), afterBytes = readFileSync(after);
  const actual = cli(compareArgs(before, after)); assert.equal(actual.status, 0); assert.deepEqual(JSON.parse(actual.stdout), compareSnapshots(draft(0), [draft(0)]));
  for (const forbidden of [root, marker, before, after]) assert.ok(!(actual.stdout + actual.stderr).includes(forbidden));
  assert.deepEqual(readFileSync(before), beforeBytes); assert.deepEqual(readFileSync(after), afterBytes);
});

test("comparison distinguishes changed brand/slug from removed+added UUID and preserves deterministic identity ordering", () => {
  const before = [draft(2), draft(0), draft(1)], after = [draft(3), { ...draft(1), brand: "beplain", slug: "test-only-changed-slug" }, draft(0)];
  const result = compareSnapshots(before, after);
  assert.deepEqual([result.added, result.removed, result.unchanged, result.changed], [1, 1, 1, 1]);
  assert.deepEqual(result.entries.map(item => item.status), ["changed", "removed", "added"]);
  assert.deepEqual(result.entries[0].changes, [
    { field: "brand", before: "nonblank", after: "nonblank" }, { field: "slug", before: "nonblank", after: "nonblank" }]);
  assert.equal(Object.hasOwn(result.entries[1], "changes"), false); assert.equal(Object.hasOwn(result.entries[2], "changes"), false);
  assert.equal(JSON.stringify(result), JSON.stringify(compareSnapshots([...before].reverse(), [...after].reverse())));
  assert.ok(!JSON.stringify(result).includes("beplain")); assert.ok(!JSON.stringify(result).includes("test-only-changed-slug"));
  const identityChange = compareSnapshots(draft(0), { ...draft(0), publicId: draft(1).publicId });
  assert.deepEqual([identityChange.added, identityChange.removed, identityChange.changed], [1, 1, 0]);
});

test("comparison is metadata-only: literal edits within states, translation presence and ordered duplicate image positions", () => {
  const before = translatedDraft(0), after = structuredClone(before);
  after.brand = "Anua"; after.slug = "test-only-edited";
  after.translations.en.name += "."; after.translations.en.description += " ";
  after.translations.en.usage = ""; after.translations.en.caution = " \t";
  after.translations.hu = null;
  after.translations.ko.images[0].src = "https://example.invalid/changed.png";
  after.translations.ko.images[0].alt = "";
  const result = compareSnapshots(before, after), changes = result.entries[0].changes;
  assert.equal(result.changed, 1); assert.equal(result.field_changes_total, 9);
  assert.deepEqual(changes.map(item => item.field), ["brand", "slug", "translations.en.name", "translations.en.description", "translations.en.usage", "translations.en.caution", "translations.hu", "translations.ko.images", "translations.ko.images[0]"]);
  assert.deepEqual(changes.find(item => item.field === "translations.en.usage"), { field: "translations.en.usage", before: "null", after: "empty" });
  assert.deepEqual(changes.find(item => item.field === "translations.en.caution"), { field: "translations.en.caution", before: "empty", after: "whitespace_only" });
  assert.deepEqual(changes.find(item => item.field === "translations.hu"), { field: "translations.hu", before: "provided", after: "null" });
  assert.equal(changes.at(-1).src_changed, true); assert.equal(changes.at(-1).alt_changed, true);
  for (const text of [marker, "example.invalid", "Anua", "test-only-edited"]) assert.ok(!JSON.stringify(result).includes(text));
  for (const locale of ["en", "hu", "ko"]) for (const key of ["name", "description", "usage", "caution"]) {
    const a = translatedDraft(0), b = structuredClone(a); a.translations[locale][key] = " "; b.translations[locale][key] = "\t";
    const change = compareSnapshots(a, b).entries[0].changes[0];
    assert.deepEqual(change, { field: `translations.${locale}.${key}`, before: "whitespace_only", after: "whitespace_only" });
  }
  const a = translatedDraft(0), b = structuredClone(a), first = a.translations.en.images[0], second = { src: "/two.png", alt: "" };
  a.translations.en.images = [first, second, first]; b.translations.en.images = [second, first, first];
  const ordered = compareSnapshots(a, b);
  assert.equal(ordered.image_comparison, "ordered_positions_not_image_identity");
  assert.deepEqual(ordered.entries[0].changes.map(item => item.field), ["translations.en.images", "translations.en.images[0]", "translations.en.images[1]"]);
  b.translations.en.images = [first];
  const removedSlots = compareSnapshots(a, b).entries[0].changes;
  assert.equal(removedSlots[0].before, 3); assert.equal(removedSlots[0].after, 1); assert.equal(removedSlots.at(-1).after, "absent");
  assert.equal(compareSnapshots(b, a).entries[0].changes.at(-1).before, "absent");
  const missing = draft(0); assert.deepEqual(compareSnapshots(missing, translatedDraft(0)).entries[0].changes.map(item => item.before), ["null", "null", "null"]);
});

test("inventory bounds truncate display only: accurate complete counters, stable fields and <=32768 stdout bytes", t => {
  const before = Array.from({ length: 50 }, (_, i) => translatedDraft(i));
  const after = structuredClone(before);
  for (const item of after) for (const locale of ["en", "hu", "ko"]) {
    item.translations[locale].name += "!"; item.translations[locale].description += "!";
    item.translations[locale].usage = ""; item.translations[locale].caution = null;
    item.translations[locale].images = []; // 150 initial images would exceed the preview budget; adjusted below.
  }
  for (const item of before) for (const locale of ["en", "hu", "ko"]) item.translations[locale].images = [];
  const result = compareSnapshots(before, after);
  assert.equal(result.changed, 50); assert.equal(result.field_changes_total, 50 * 3 * 4);
  assert.equal(result.entries_total, 50); assert.equal(result.entries.length, 50); assert.equal(result.more_suppressed, true);
  assert.equal(result.entries.reduce((count, entry) => count + entry.changes.length, 0), 128);
  assert.equal(result.entries.reduce((count, entry) => count + entry.field_changes_total, 0), 600);
  assert.ok(Buffer.byteLength(JSON.stringify(result) + "\n") <= 32768);
  assert.equal(JSON.stringify(result), JSON.stringify(compareSnapshots(before, after)));
  const root = privateDirectory(t), oldFile = jsonFile(root, before, "before.json"), newFile = jsonFile(root, after, "after.json");
  const actual = cli(compareArgs(oldFile, newFile)); assert.equal(actual.status, 0); assert.deepEqual(JSON.parse(actual.stdout), result);
  assert.ok(Buffer.byteLength(actual.stdout) <= 32768);
  const added = Array.from({ length: 50 }, (_, i) => draft(i + 50));
  const allDifferent = compareSnapshots(before, added);
  assert.deepEqual([allDifferent.added, allDifferent.removed, allDifferent.entries_total, allDifferent.entries.length], [50, 50, 100, 50]);
  assert.equal(allDifferent.more_suppressed, true); assert.equal(allDifferent.field_changes_total, 0);
  assert.equal(compareSnapshots(draft(0), draft(0)).more_suppressed, false);
  // Worst-case ordered image metadata still respects the byte and field budgets.
  for (let i = 0; i < 4; i++) for (const [locale, count] of [["en", 10], ["hu", 10], ["ko", 5]])
    after[i].translations[locale].images = Array(count).fill({ src: "/not-probed.png", alt: " \t" });
  const imageHeavy = compareSnapshots(before, after);
  assert.equal(imageHeavy.changed, 50); assert.equal(imageHeavy.field_changes_total, 712);
  assert.ok(Buffer.byteLength(JSON.stringify(imageHeavy) + "\n") <= 32768); assert.equal(imageHeavy.more_suppressed, true);
});

test("both snapshots reject independently before inventory: safe side markers, all schema/encoding/budget failures", t => {
  const malformed = [[], Array.from({ length: 51 }, (_, i) => draft(i)), [{ ...draft(0), state: "published" }],
    [{ ...draft(0), brand: marker }], [{ ...draft(0), slug: "Bad slug" }], [{ ...draft(0), translations: { en: null, hu: null } }],
    [draft(0), draft(0)], [draft(0), { ...draft(1), slug: draft(0).slug }], [{ ...translatedDraft(0), extra: marker }]];
  const badSource = translatedDraft(0); badSource.translations.en.images[0] = { src: "http://secret.invalid", alt: 1 }; malformed.push(badSource);
  const badType = translatedDraft(0); badType.translations.hu.usage = 1; malformed.push(badType);
  const tooMany = translatedDraft(0); tooMany.translations.en.images = Array(11).fill({ src: "/secret.png", alt: marker }); malformed.push(tooMany);
  const totalImages = Array.from({ length: 4 }, (_, i) => translatedDraft(i));
  for (const item of totalImages) for (const value of Object.values(item.translations)) value.images = Array(10).fill({ src: "/secret.png", alt: marker }); malformed.push(totalImages);
  const large = translatedDraft(0); large.translations.ko.description = "x".repeat(1_000_001); malformed.push(large);
  const serialized = translatedDraft(0); serialized.translations.en.description = "x".repeat(600_000); serialized.translations.hu.description = "x".repeat(600_000); malformed.push(serialized);
  const both = compareSnapshots({}, {}); assert.deepEqual(both.diagnostics.map(item => item.side), Array(5).fill("before").concat(Array(5).fill("after")));
  for (const value of malformed) for (const side of ["before", "after"]) {
    const result = compareSnapshots(side === "before" ? value : draft(0), side === "after" ? value : draft(0));
    assert.equal(result.ok, false); assert.ok(result.diagnostics.every(item => item.side === side));
    assert.equal(Object.hasOwn(result, "entries"), false); assert.equal(Object.hasOwn(result, "before_total"), false); assert.ok(!JSON.stringify(result).includes(marker));
  }
  const root = privateDirectory(t), valid = jsonFile(root, draft(0)), invalid = join(root, "invalid.json");
  for (const [bytes, code] of [[Buffer.from([0xef, 0xbb, 0xbf, 123, 125]), "invalid_encoding"], [Buffer.from("{}", "utf16le"), "invalid_encoding"], [Buffer.from([0xc3, 0x28]), "invalid_encoding"],
    [Buffer.from([123, 0, 125]), "invalid_encoding"], [Buffer.from(`{${marker}`), "invalid_json"], [Buffer.alloc(1_000_001, 32), "input_too_large"]]) {
    writeFileSync(invalid, bytes, { mode: 0o600 }); const result = runIntake(compareArgs(invalid, valid), environment);
    assert.deepEqual(codes(result), [code]); assert.equal(result.diagnostics[0].side, "before"); assert.equal(Object.hasOwn(result, "entries"), false);
    assert.deepEqual(readFileSync(invalid), bytes);
  }
  const suppressed = compareSnapshots(Array(50).fill({}), Array(50).fill({})); assert.equal(suppressed.diagnostics.length, 12); assert.equal(suppressed.more_suppressed, true);
  writeFileSync(invalid, JSON.stringify(draft(0)).padEnd(1_000_000, " "), { mode: 0o600 });
  assert.equal(runIntake(compareArgs(invalid, valid), environment).unchanged, 1);
  writeFileSync(invalid, `{${marker}`, { mode: 0o600 });
  const failed = cli(compareArgs(invalid, valid)); assert.equal(failed.status, 1);
  for (const forbidden of [root, marker, invalid]) assert.ok(!(failed.stdout + failed.stderr).includes(forbidden));
});

test("compare CLI rejects ambiguous args and unsafe files on either side; privacy/identity/reading failures never echo paths", t => {
  const root = privateDirectory(t), other = privateDirectory(t), good = jsonFile(root, draft(0)), before = readFileSync(good);
  mkdirSync(join(root, "public")); mkdirSync(join(root, "other-repo")); mkdirSync(join(root, "other-repo", ".git"));
  symlinkSync(other, join(root, "junction"), "junction"); jsonFile(other, draft(1));
  const paths = ["relative.json", resolve("data/nonexistent.json"), join(root, "public", "input.json"), join(root, "other-repo", "input.json"), join(root, "junction", "input.json"),
    join(root, "Desktop", "input.json"), join(root, "Downloads", "input.json"), join(root, "OneDrive", "input.json"), join(root, "shared", "input.json"), "\\\\server\\share\\input.json", "\\\\?\\C:\\private.json", join(root, "missing.json")];
  for (const path of paths) for (const side of ["before", "after"]) {
    const result = runIntake(compareArgs(side === "before" ? path : good, side === "after" ? path : good), environment);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.every(item => item.side === side)); assert.ok(!JSON.stringify(result).includes(path));
  }
  for (const args of [["compare"], ["compare", "--before", good], ["compare", "--before", good, "--before", good], [...compareArgs(good, good), "extra"], ["compare", "--file", good, "--after", good]]) {
    const result = cli(args); assert.equal(result.status, 1); assert.deepEqual(codes(JSON.parse(result.stdout)), ["invalid_arguments"]); assert.ok(!(result.stdout + result.stderr).includes(root));
  }
  const original = fs.fstatSync; let calls = 0;
  const changed = t.mock.method(fs, "fstatSync", (...args) => { const stat = original(...args); if (++calls === 2) stat.mtimeNs += 1n; return stat; }); syncBuiltinESMExports();
  try { const result = runIntake(compareArgs(good, good), environment); assert.deepEqual(codes(result), ["input_unavailable"]); assert.equal(result.diagnostics[0].side, "before"); assert.equal(calls, 4); }
  finally { changed.mock.restore(); syncBuiltinESMExports(); }
  let identities = 0;
  const identity = t.mock.method(fs, "fstatSync", (...args) => { const stat = original(...args); if (++identities === 1) stat.ino += 1n; return stat; }); syncBuiltinESMExports();
  try { const result = runIntake(compareArgs(good, good), environment); assert.deepEqual(codes(result), ["input_unavailable"]); assert.equal(result.diagnostics[0].side, "before"); }
  finally { identity.mock.restore(); syncBuiltinESMExports(); }
  if (process.platform === "win32") {
    const acl = t.mock.method(childProcess, "spawnSync", () => ({ status: 1, stdout: "DENIED" })); syncBuiltinESMExports();
    try { const result = runIntake(compareArgs(good, good), environment); assert.deepEqual(codes(result), ["private_path_required", "private_path_required"]); assert.deepEqual(result.diagnostics.map(item => item.side), ["before", "after"]); }
    finally { acl.mock.restore(); syncBuiltinESMExports(); }
  }
  assert.deepEqual(readFileSync(good), before);
});

test("compare performs no writes/media probes/network and preserves both files; local-only failures have no inventory", t => {
  const root = privateDirectory(t), a = jsonFile(root, translatedDraft(0), "before.json"), b = jsonFile(root, translatedDraft(0), "after.json");
  const bytesA = readFileSync(a), bytesB = readFileSync(b), names = readdirSync(root), patches = [];
  let forbidden = 0; const deny = () => { forbidden++; throw new Error(`${marker} forbidden`); };
  const originalOpen = fs.openSync;
  patches.push(t.mock.method(fs, "openSync", (path, flags, ...args) => {
    assert.ok(path === a || path === b, "Only selected JSON files may be opened"); assert.equal(flags & (fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_RDWR), 0);
    return originalOpen(path, flags, ...args);
  }));
  for (const method of ["writeFileSync", "writeSync", "unlinkSync", "mkdirSync", "renameSync"]) patches.push(t.mock.method(fs, method, deny));
  patches.push(t.mock.method(net.Server.prototype, "listen", deny), t.mock.method(net.Socket.prototype, "connect", deny), t.mock.method(globalThis, "fetch", deny)); syncBuiltinESMExports();
  try { assert.equal(runIntake(compareArgs(a, b), environment).unchanged, 1); assert.equal(forbidden, 0); }
  finally { for (const patch of patches) patch.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(readFileSync(a), bytesA); assert.deepEqual(readFileSync(b), bytesB); assert.deepEqual(readdirSync(root), names);
  for (const patch of [{ NODE_ENV: "production" }, { NODE_ENV: "staging" }, { HANAPURE_DRAFT_PREVIEW_LOCAL: "0" }, { APP_ENV: "staging" }, { VERCEL: "1" }, { DEPLOYMENT_ENV: "local" }]) {
    const result = cli(compareArgs(a, b), patch); assert.equal(result.status, 1); assert.deepEqual(codes(JSON.parse(result.stdout)), ["local_development_required"]);
    assert.equal(Object.hasOwn(JSON.parse(result.stdout), "entries"), false);
  }
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
        for (const term of [marker, "test-only-private-intake", "private-draft-intake", "starter_created", "LOCAL DRAFT CHANGE INVENTORY ONLY"]) assert.ok(!text.includes(term), term);
      }
    }
  };
  inspect(resolve(".next/server")); inspect(resolve(".next/static"));
});
