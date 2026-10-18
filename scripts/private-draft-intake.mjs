import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { brandNames } from "../data/brands.ts";
import { isPublicId } from "../lib/erp/product-operational.ts";
import { validateEditorialCatalogue } from "../lib/catalog/editorial-catalogue.ts";

// Standalone local CLI, never imported by the storefront. No identities generated.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["en", "hu", "ko"];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maximumBytes = 1_000_000;
const maximumDiagnostics = 12;
class IntakeFailure extends Error {}
const fail = code => { throw new IntakeFailure(code); };
const within = (root, path) => {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
};
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

function localOnly(environment) {
  if (environment.NODE_ENV !== "development" || environment.HANAPURE_DRAFT_PREVIEW_LOCAL !== "1" ||
    (environment.APP_ENV !== undefined && environment.APP_ENV !== "local") ||
    ["VERCEL", "VERCEL_ENV", "NETLIFY", "CF_PAGES", "DEPLOYMENT_ENV"].some(key => environment[key] !== undefined)) fail("local_development_required");
}

// Local profile only; refuse web/shared/synchronized locations, including ancestors.
// ACL inspection is read-only. Inability to inspect fails closed, never repairs ACLs.
function privatePermissions(paths, ancestors = paths) {
  if (process.platform !== "win32") {
    if (paths.some(path => { const s = fs.lstatSync(path); return s.uid !== process.getuid() || (s.mode & 0o077) !== 0; })) fail("private_path_required");
    return;
  }
  const command = `$ErrorActionPreference='Stop'; try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $broad = @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-32-546','S-1-5-7','S-1-15-2-1','S-1-15-2-2')
    foreach ($p in $payload.ancestors) {
      $attributes = [IO.File]::GetAttributes($p)
      if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'denied' }
    }
    foreach ($p in $payload.permissions) {
      $attributes = [IO.File]::GetAttributes($p)
      $acl = if ($attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::GetAccessControl($p) } else { [IO.File]::GetAccessControl($p) }
      if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'denied' }
      $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
      if (!$rules.Count) { throw 'denied' }
      foreach ($rule in $rules) {
        if ($rule.AccessControlType -eq 'Allow' -and $broad -contains $rule.IdentityReference.Value) { throw 'denied' }
      }
    }
    [Console]::Write('PRIVATE')
  } catch { [Console]::Write('DENIED'); exit 1 }`;
  const check = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
    { input: JSON.stringify({ permissions: paths, ancestors }).replace(/[^\x00-\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`),
      encoding: "utf8", timeout: 10000, maxBuffer: 2048, windowsHide: true });
  if (check.status !== 0 || check.stdout !== "PRIVATE") fail("private_path_required");
}

function privatePath(input, extension = "json") {
  if (typeof input !== "string" || input.length > 1024 || !isAbsolute(input) ||
    /[\u0000-\u001f\u007f]/.test(input) || input.startsWith("\\\\") || input.startsWith("//")) fail("private_path_required");
  const path = resolve(input), parent = dirname(path), home = resolve(homedir());
  const parts = input.slice(parse(input).root.length).split(/[\\/]/);
  const forbidden = /^(?:public|www|wwwroot|htdocs|public_html|inetpub|shared|shares|onedrive(?:[ -].*)?|dropbox|google drive|googledrive|icloud(?:drive)?|box|desktop|downloads)$/i;
  const suffix = extension === "json" ? /\.json$/i : extension === "csv" ? /\.csv$/i : null;
  if (!within(home, path) || within(repo, path) || !suffix?.test(path) || parts.length > 64 ||
    parts.some(part => !part || part === "." || part === ".." || /[:<>"|?*]/.test(part) || /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || forbidden.test(part))) fail("private_path_required");
  const chain = [];
  let current = parse(parent).root;
  for (const part of parent.slice(current.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || relative(current, fs.realpathSync(current)) !== "") fail("private_path_required");
    if (fs.existsSync(resolve(current, ".git"))) fail("private_path_required");
    chain.push({ path: current, stat });
  }
  privatePermissions([parent], chain.map(entry => entry.path));
  return { path, parent, chain };
}

function unchangedParent(target) {
  for (const entry of target.chain) {
    const stat = fs.lstatSync(entry.path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameFile(stat, entry.stat) || relative(entry.path, fs.realpathSync(entry.path)) !== "") fail("private_path_required");
  }
}

// Diagnostics are only a bounded structural explanation. The existing validator
// must approve the resulting snapshot; this checker can never admit on its own.
export function diagnoseDraft(input) {
  const diagnostics = []; let moreSuppressed = false;
  const add = (index, locale, field, code) => {
    if (diagnostics.length === maximumDiagnostics) { moreSuppressed = true; return; }
    diagnostics.push({ draft_index: index, locale, field, code });
  };
  const rejected = () => ({ ok: false, diagnostics, more_suppressed: moreSuppressed });
  try {
    if (types.isProxy(input)) { add(null, null, "$", "invalid_record"); return rejected(); }
    const records = Array.isArray(input) ? input : [input];
    const count = records.length;
    if (count < 1 || count > 50) { add(null, null, "$", "invalid_input_count"); return rejected(); }
    const ids = new Set(), slugs = new Set(); let images = 0;
    const snapshot = [];
    function shape(value, keys, index, locale, path) {
      if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        add(index, locale, path, "invalid_type"); return false;
      }
      const actual = Reflect.ownKeys(value);
      if (actual.some(key => !keys.includes(key))) add(index, locale, path, "unexpected_property");
      let valid = true;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) { add(index, path === "$.translations" ? key : locale, `${path}.${key}`, "missing_required_property"); valid = false; }
        else if (!Object.hasOwn(descriptor, "value")) { add(index, locale, `${path}.${key}`, "invalid_type"); valid = false; }
      }
      return valid;
    }
    const string = (value, index, locale, field, nullable = false) => {
      if (nullable && value === null) return true;
      if (typeof value !== "string") { add(index, locale, field, "invalid_type"); return false; }
      if (value.length > maximumBytes) { add(index, locale, field, "input_too_large"); return false; }
      return true;
    };
    for (let index = 0; index < count && !moreSuppressed; index++) {
      const item = Object.getOwnPropertyDescriptor(records, String(index))?.value;
      if (!shape(item, ["publicId", "brand", "slug", "state", "translations"], index, null, "$")) continue;
      if (!isPublicId(item.publicId)) add(index, null, "$.publicId", "invalid_public_id");
      else if (ids.has(item.publicId.toLowerCase())) add(index, null, "$.publicId", "duplicate_public_id");
      else ids.add(item.publicId.toLowerCase());
      if (!brandNames.includes(item.brand)) add(index, null, "$.brand", "invalid_brand");
      if (!string(item.slug, index, null, "$.slug") || !slugPattern.test(item.slug)) add(index, null, "$.slug", "invalid_slug");
      else if (slugs.has(item.slug)) add(index, null, "$.slug", "duplicate_slug"); else slugs.add(item.slug);
      if (item.state !== "draft") add(index, null, "$.state", "invalid_state");
      if (!shape(item.translations, locales, index, null, "$.translations")) continue;
      const translations = {};
      for (const locale of locales) {
        const content = item.translations[locale], field = `$.translations.${locale}`;
        if (content === null) { translations[locale] = null; continue; }
        if (!shape(content, ["name", "description", "images", "usage", "caution"], index, locale, field)) continue;
        for (const key of ["name", "description", "usage", "caution"]) string(content[key], index, locale, `${field}.${key}`, key === "usage" || key === "caution");
        if (types.isProxy(content.images) || !Array.isArray(content.images)) { add(index, locale, `${field}.images`, "invalid_type"); continue; }
        const imageCount = content.images.length;
        images += imageCount;
        // Existing private preview limits, not a new editorial/publication schema.
        if (imageCount > 10 || images > 100) { add(index, locale, `${field}.images`, "input_too_large"); continue; }
        const translatedImages = [];
        for (let imageIndex = 0; imageIndex < imageCount && !moreSuppressed; imageIndex++) {
          const image = Object.getOwnPropertyDescriptor(content.images, String(imageIndex))?.value, imagePath = `${field}.images[${imageIndex}]`;
          if (!shape(image, ["src", "alt"], index, locale, imagePath)) continue;
          if (string(image.src, index, locale, `${imagePath}.src`)) {
            let valid = image.src.trim() !== "" && image.src === image.src.trim() && !/[\u0000-\u0020\\]/.test(image.src);
            if (!(image.src.startsWith("/") && !image.src.startsWith("//"))) {
              try { const url = new URL(image.src); valid &&= url.protocol === "https:" && !url.username && !url.password; } catch { valid = false; }
            }
            if (!valid) add(index, locale, `${imagePath}.src`, "invalid_image_source");
          }
          if (typeof image.alt !== "string") add(index, locale, `${imagePath}.alt`, "invalid_image_alt");
          else string(image.alt, index, locale, `${imagePath}.alt`);
          translatedImages.push({ src: image.src, alt: image.alt });
        }
        translations[locale] = { name: content.name, description: content.description, images: translatedImages, usage: content.usage, caution: content.caution };
      }
      snapshot.push({ publicId: item.publicId, brand: item.brand, slug: item.slug, state: item.state, translations });
    }
    if (diagnostics.length) return rejected();
    if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > maximumBytes) { add(null, null, "$", "input_too_large"); return rejected(); }
    const validated = validateEditorialCatalogue(snapshot);
    if (!validated.ok) { add(validated.index ?? null, null, "$", "invalid_record"); return rejected(); }
    return { ok: true, count: validated.records.length, records: validated.records };
  } catch { add(null, null, "$", "invalid_record"); return rejected(); }
}

function readPrivate(input, attestations = null) {
  let fd;
  try {
    const target = privatePath(input), stat = fs.lstatSync(target.path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) fail("private_path_required");
    privatePermissions([target.path], [...target.chain.map(entry => entry.path), target.path]);
    if (stat.size > maximumBytes) fail("input_too_large");
    fd = fs.openSync(target.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true }); unchangedParent(target);
    if (!sameFile(opened, stat) || !opened.isFile()) fail("input_unavailable");
    const bytes = Buffer.alloc(maximumBytes + 1); let size = 0, count;
    do { count = fs.readSync(fd, bytes, size, bytes.length - size, null); size += count; } while (count && size < bytes.length);
    if (size > maximumBytes) fail("input_too_large");
    const after = fs.fstatSync(fd, { bigint: true });
    if (BigInt(size) !== opened.size || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs) fail("input_unavailable");
    const data = bytes.subarray(0, size);
    if (data.includes(0) || data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail("invalid_encoding");
    let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { fail("invalid_encoding"); }
    let parsed; try { parsed = JSON.parse(text); } catch { fail("invalid_json"); }
    if (attestations) { attestations.push({ fd, target, stat: after, bytes: Buffer.from(data) }); fd = undefined; }
    return parsed;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function createPrivate(input, record) {
  return writePrivate(input, JSON.stringify(record, null, 2) + "\n");
}

function writePrivate(input, bytes, extension = "json", attest = () => {}) {
  const target = privatePath(input, extension); let fd, owned;
  try {
    unchangedParent(target); attest(); unchangedParent(target);
    fd = fs.openSync(target.path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    owned = fs.fstatSync(fd, { bigint: true }); unchangedParent(target);
    if (!sameFile(owned, fs.lstatSync(target.path, { bigint: true }))) fail("output_unavailable");
    privatePermissions([target.path], [...target.chain.map(entry => entry.path), target.path]);
    attest(); fs.writeFileSync(fd, bytes, "utf8"); fs.fsyncSync(fd); attest();
    unchangedParent(target);
    if (!sameFile(owned, fs.lstatSync(target.path, { bigint: true }))) fail("output_unavailable");
  } catch (error) {
    // Remove only our verified newly created inode; never delete an unverified path.
    if (fd !== undefined) { fs.closeSync(fd); fd = undefined; }
    if (owned) try { unchangedParent(target); const stat = fs.lstatSync(target.path, { bigint: true }); if (!stat.isSymbolicLink() && sameFile(owned, stat)) fs.unlinkSync(target.path); } catch { /* Fail closed if ownership cannot be proven. */ }
    if (error?.code === "EEXIST") fail("output_exists");
    if (error instanceof IntakeFailure) throw error;
    fail("output_unavailable");
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

const inventoryMarker = "LOCAL DRAFT CHANGE INVENTORY ONLY / NOT LP APPROVED / NOT PUBLICATION READY";
const maximumInventoryBytes = 32_768;
const textState = value => value === null ? "null" : value === "" ? "empty" : value.trim() === "" ? "whitespace_only" : "nonblank";

function fullInventory(before, after) {
  // Both sides are independently validated even when one fails; never emit a
  // partial inventory. Fixed before/after order and the existing diagnostic cap.
  const diagnostics = [];
  let suppressed = false;
  for (const [side, result] of [["before", before], ["after", after]]) if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      if (diagnostics.length < maximumDiagnostics) diagnostics.push({ side, ...diagnostic }); else suppressed = true;
    }
    suppressed ||= result.more_suppressed;
  }
  if (diagnostics.length) return { ok: false, diagnostics, more_suppressed: suppressed };
  const left = new Map(before.records.map(record => [record.publicId.toLowerCase(), record]));
  const right = new Map(after.records.map(record => [record.publicId.toLowerCase(), record]));
  const result = { ok: true, code: "draft_change_inventory", before_total: left.size, after_total: right.size,
    added: 0, removed: 0, unchanged: 0, changed: 0, field_changes_total: 0, entries_total: 0,
    image_comparison: "ordered_positions_not_image_identity", entries: [], more_suppressed: false, marker: inventoryMarker };
  const inventory = [];
  // Sort immutable UUID keys, not content, locale collation or input array index.
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(id), b = right.get(id);
    if (!a || !b) {
      const status = a ? "removed" : "added"; result[status]++;
      inventory.push({ publicId: (a ?? b).publicId, status }); continue;
    }
    const changes = [];
    const scalar = (field, previous, current) => {
      if (previous !== current) changes.push({ field, before: textState(previous), after: textState(current) });
    };
    scalar("brand", a.brand, b.brand); scalar("slug", a.slug, b.slug);
    for (const locale of locales) {
      const previous = a.translations[locale], current = b.translations[locale], field = `translations.${locale}`;
      if (previous === null || current === null) {
        if (previous !== current) changes.push({ field, before: previous === null ? "null" : "provided", after: current === null ? "null" : "provided" });
        continue;
      }
      scalar(`${field}.name`, previous.name, current.name); scalar(`${field}.description`, previous.description, current.description);
      const imageChanges = [];
      for (let ordinal = 0; ordinal < Math.max(previous.images.length, current.images.length); ordinal++) {
        const old = previous.images[ordinal], next = current.images[ordinal];
        const srcChanged = old?.src !== next?.src, altChanged = old?.alt !== next?.alt;
        if (srcChanged || altChanged) imageChanges.push({ field: `${field}.images[${ordinal}]`,
          before: old ? { src: textState(old.src), alt: textState(old.alt) } : "absent",
          after: next ? { src: textState(next.src), alt: textState(next.alt) } : "absent",
          src_changed: srcChanged, alt_changed: altChanged });
      }
      if (imageChanges.length) changes.push({ field: `${field}.images`, before: previous.images.length, after: current.images.length }, ...imageChanges);
      scalar(`${field}.usage`, previous.usage, current.usage); scalar(`${field}.caution`, previous.caution, current.caution);
    }
    if (!changes.length) { result.unchanged++; continue; }
    result.changed++; result.field_changes_total += changes.length;
    inventory.push({ publicId: a.publicId, status: "changed", field_changes_total: changes.length, changes });
  }
  result.entries_total = inventory.length;
  return { result, inventory };
}

function compareValidated(before, after) {
  const core = fullInventory(before, after);
  if (!core.result) return core;
  const { result, inventory } = core;
  // Counts above cover ALL records/fields. Only the display payload is limited.
  let fieldBudget = 128;
  for (const item of inventory) {
    if (result.entries.length >= 50) { result.more_suppressed = true; continue; }
    const entry = item.status === "changed" ? { ...item, changes: item.changes.slice(0, fieldBudget), more_suppressed: false } : item;
    const fits = () => Buffer.byteLength(JSON.stringify({ ...result, entries: [...result.entries, entry] }), "utf8") < maximumInventoryBytes;
    while (!fits() && entry.changes?.length) entry.changes.pop();
    if (!fits()) { result.more_suppressed = true; continue; }
    if (entry.changes) {
      entry.more_suppressed = entry.changes.length < item.changes.length;
      result.more_suppressed ||= entry.more_suppressed; fieldBudget -= entry.changes.length;
    }
    result.entries.push(entry);
  }
  // One byte reserved above covers false/true representation changes. Newline
  // written by the CLI is included in this final bound.
  if (Buffer.byteLength(JSON.stringify(result) + "\n", "utf8") > maximumInventoryBytes) fail("comparison_unavailable");
  return result;
}

export function compareSnapshots(before, after) {
  return compareValidated(diagnoseDraft(before), diagnoseDraft(after));
}

// Same established formula-prefix treatment as the private review CSVs. Kept
// local to this standalone CLI rather than importing an HTTP preview module.
export function changeCsvCell(value) {
  const text = String(value);
  const safe = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function serializeChangeCsv(rows) {
  if (!Array.isArray(rows) || rows.length > 5000) fail("csv_limit_exceeded");
  const columns = ["publicId", "change_type", "locale", "field", "before_state", "after_state", "src_changed", "alt_changed"];
  const lines = ["\uFEFF" + columns.map(changeCsvCell).join(",") + "\r\n"];
  let bytes = Buffer.byteLength(lines[0], "utf8");
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length || row.some(value =>
      typeof value !== "string" && typeof value !== "boolean" && !(Number.isSafeInteger(value) && value >= 0))) fail("invalid_csv_metadata");
    const line = row.map(changeCsvCell).join(",") + "\r\n";
    bytes += Buffer.byteLength(line, "utf8");
    if (bytes > 2_000_000) fail("csv_limit_exceeded");
    lines.push(line);
  }
  return Buffer.from(lines.join(""), "utf8");
}

function csvRows(inventory) {
  const state = value => typeof value === "object" ? ({ empty: "provided_alt_empty", whitespace_only: "provided_alt_whitespace_only", nonblank: "provided_alt_nonblank" })[value.alt] : value;
  return inventory.flatMap(item => item.status !== "changed" ? [[item.publicId.toLowerCase(), item.status, "", "product", "", "", "", ""]] :
    item.changes.map(change => [item.publicId.toLowerCase(), "changed", /^translations\.(en|hu|ko)(?:\.|$)/.exec(change.field)?.[1] ?? "", change.field,
      state(change.before), state(change.after), change.src_changed ?? "", change.alt_changed ?? ""]));
}

function attestInputs(attestations) {
  for (const proof of attestations) {
    try {
      const { fd, target, stat, bytes } = proof;
      const matches = current => current.isFile() && !current.isSymbolicLink() && sameFile(current, stat) &&
        current.size === stat.size && current.mtimeNs === stat.mtimeNs && current.ctimeNs === stat.ctimeNs;
      unchangedParent(target);
      if (!matches(fs.lstatSync(target.path, { bigint: true })) || !matches(fs.fstatSync(fd, { bigint: true }))) fail("input_changed");
      const current = Buffer.alloc(bytes.length + 1); let size = 0, count;
      do { count = fs.readSync(fd, current, size, current.length - size, size); size += count; } while (count && size < current.length);
      if (!current.subarray(0, size).equals(bytes) || !matches(fs.fstatSync(fd, { bigint: true })) || !matches(fs.lstatSync(target.path, { bigint: true }))) fail("input_changed");
      unchangedParent(target);
    } catch { fail("input_changed"); }
  }
}

function readPair(values, attestations = null) {
  return ["before", "after"].map(side => {
    try { return diagnoseDraft(readPrivate(values.get(`--${side}`), attestations)); }
    catch (error) { return { ok: false, diagnostics: [{ draft_index: null, locale: null, field: "$",
      code: error instanceof IntakeFailure ? error.message : "input_unavailable" }], more_suppressed: false }; }
  });
}

function exportChangeCsv(values) {
  const attestations = [];
  try {
    const core = fullInventory(...readPair(values, attestations));
    if (!core.result) return core;
    const rows = csvRows(core.inventory), bytes = serializeChangeCsv(rows);
    // Validation, exhaustive comparison, serialization and limits all precede
    // output creation. Keep readable input descriptors until the writer finishes.
    writePrivate(values.get("--output"), bytes, "csv", () => attestInputs(attestations));
    const result = core.result;
    return { ok: true, code: "csv_created", before_total: result.before_total, after_total: result.after_total,
      added: result.added, removed: result.removed, unchanged: result.unchanged, changed: result.changed,
      field_changes_total: result.field_changes_total, csv_data_rows: rows.length, csv_bytes: bytes.length, marker: inventoryMarker };
  } finally { for (const proof of attestations) fs.closeSync(proof.fd); }
}

export function runIntake(args, environment = process.env) {
  try {
    localOnly(environment);
    const [command, ...rest] = args;
    const names = command === "starter" ? ["--public-id", "--brand", "--slug", "--output"] :
      command === "validate" ? ["--file"] : command === "compare" ? ["--before", "--after"] :
        command === "compare-csv" ? ["--before", "--after", "--output"] : [];
    const values = new Map();
    if (!names.length || rest.length !== names.length * 2) fail("invalid_arguments");
    for (let index = 0; index < rest.length; index += 2) {
      if (!names.includes(rest[index]) || values.has(rest[index]) || typeof rest[index + 1] !== "string" || !rest[index + 1] || rest[index + 1].startsWith("--")) fail("invalid_arguments");
      values.set(rest[index], rest[index + 1]);
    }
    if (command === "compare-csv") return exportChangeCsv(values);
    if (command === "compare") {
      // Same physical file is allowed: independently read and validate twice.
      // This inventories the observed snapshots, not an atomic filesystem pair.
      return compareValidated(...readPair(values));
    }
    const input = command === "validate" ? readPrivate(values.get("--file")) : {
      publicId: values.get("--public-id"), brand: values.get("--brand"), slug: values.get("--slug"), state: "draft", translations: { en: null, hu: null, ko: null } };
    const result = diagnoseDraft(input);
    if (!result.ok) return result;
    if (command === "starter") createPrivate(values.get("--output"), result.records[0]);
    return { ok: true, drafts: result.count, code: command === "starter" ? "starter_created" : "drafts_valid", notice: "Draft only; NOT LP approved / NOT publication ready" };
  } catch (error) {
    return { ok: false, diagnostics: [{ draft_index: null, locale: null, field: "$", code: error instanceof IntakeFailure ? error.message : "input_unavailable" }], more_suppressed: false };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runIntake(process.argv.slice(2));
  console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1;
}
