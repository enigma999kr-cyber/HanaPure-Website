import fs from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename, isAbsolute, join, parse } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { types } from "node:util";
import { createHash } from "node:crypto";
import { reviewFirstSkuEditorialDraft } from "../lib/catalog/first-sku-editorial-review.ts";
import { syntheticEditorialTemplate } from "./first-sku-editorial-review.mjs";
import { renderEditorialPacket, validateEditorialPacketDto } from "./first-sku-editorial-packet.mjs";

const cases = ["one", "all", "invalid"], locales = ["en", "hu", "ko"];
const MAX_HTML = 16384, MAX_MANIFEST = 8192, MAX_TOTAL = 131072;
export const PACKET_EVIDENCE_ROOT = "C:/Users/Enigma/.codex/visualizations/2026/10/27/01a17d7b-916b-7d10-a7c0-7901c7dad447";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hints = { VERIFIED: "REVIEW_ONLY_NO_RELEASE_AUTHORITY", INVALID_REQUEST: "USE_EXPLICIT_SYNTHETIC_CASE_LOCALE", INVALID_BYTES: "RECEIVE_BOUNDED_UTF8_ORIGINALS", MANIFEST_MISMATCH: "RECEIVE_ORIGINAL_MANIFEST", HTML_HASH_MISMATCH: "RECEIVE_ORIGINAL_HTML_PAIR", HTML_MISMATCH: "RECEIVE_ACCEPTED_SOURCE_OUTPUT", REPRODUCTION_UNAVAILABLE: "REVIEW_LOCAL_SOURCE_DRIFT", UNSAFE_PATH: "USE_APPROVED_LOCAL_PACKET_DIRECTORY", INVENTORY_MISMATCH: "RECEIVE_EXACT_CASE_FILE_SET", FILE_UNSTABLE: "STOP_REPLACEMENT_AND_RECEIVE_AGAIN", READ_BLOCKED: "CHECK_READ_ONLY_LOCAL_AVAILABILITY" };
const digest = b => createHash("sha256").update(b).digest("hex");
const canonical = p => process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
const inside = (parent, child) => canonical(child) === canonical(parent) || canonical(child).startsWith(canonical(parent) + (process.platform === "win32" ? "\\" : "/"));
function result(reasonCode, extra = {}) {
  return { decision: reasonCode === "VERIFIED" ? "INTEGRITY_OK_FOR_SYNTHETIC_REVIEW" : "BLOCKED", scope: "SYNTHETIC_ONLY", reasonCode, remediation: hints[reasonCode], ...extra, readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false };
}
class GuardFailure extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new GuardFailure(code); };
function utf8(bytes, maximum) {
  if (types.isProxy(bytes) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maximum) fail("INVALID_BYTES");
  const copy = Buffer.from(bytes);
  if (copy.includes(0) || copy.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail("INVALID_BYTES");
  try { new TextDecoder("utf-8", { fatal: true }).decode(copy); } catch { fail("INVALID_BYTES"); }
  return copy;
}
/** Pure byte comparison. Expected output comes from accepted code, never self-claims.
 * No writer/generator call; integrity success is not issuer or editorial approval.
 */
export function verifyEditorialPacketBytes(htmlBytes, manifestBytes, sample, locale) {
  if (!cases.includes(sample) || !locales.includes(locale)) return result("INVALID_REQUEST");
  try {
    const html = utf8(htmlBytes, MAX_HTML), manifest = utf8(manifestBytes, MAX_MANIFEST);
    let received;
    try { received = JSON.parse(manifest.toString("utf8")); } catch { fail("INVALID_BYTES"); }
    if (!received || typeof received !== "object" || Array.isArray(received) ||
      !received.html || typeof received.html !== "object" || Array.isArray(received.html) ||
      received.html.name !== `${sample}-${locale}.html` || typeof received.html.sha256 !== "string") fail("MANIFEST_MISMATCH");
    if (digest(html) !== received.html.sha256) fail("HTML_HASH_MISMATCH");
    let rendered;
    try {
      const dto = reviewFirstSkuEditorialDraft(sample === "invalid" ? null : syntheticEditorialTemplate(sample));
      validateEditorialPacketDto(dto);
      rendered = renderEditorialPacket(dto, locale);
    } catch { fail("REPRODUCTION_UNAVAILABLE"); }
    const expectedHtml = Buffer.from(rendered.html, "utf8");
    if (!html.equals(expectedHtml)) fail("HTML_MISMATCH");
    const expectedManifest = { ...rendered.manifest, case: sample, html: { name: `${sample}-${locale}.html`, sha256: digest(expectedHtml) } };
    const expectedBytes = Buffer.from(JSON.stringify(expectedManifest, null, 2) + "\n", "utf8");
    // Full canonical raw bytes also reject duplicate keys, extra whitespace or fields.
    if (!manifest.equals(expectedBytes)) fail("MANIFEST_MISMATCH");
    return result("VERIFIED", { case: sample, locale, sourceStatus: expectedManifest.status, issueCount: expectedManifest.issueCount });
  } catch (error) { return result(error instanceof GuardFailure ? error.code : "REPRODUCTION_UNAVAILABLE", { case: sample, locale }); }
}
function safePath(path, batch) {
  if (typeof path !== "string" || path.length > 1024 || !isAbsolute(path) || /^[\\/]{2}|[\u0000-\u001f\u007f]/.test(path)) fail("UNSAFE_PATH");
  const pieces = path.slice(parse(path).root.length).split(/[\\/]/);
  const forbidden = /^(?:public|app|shared|shares|wwwroot|htdocs|onedrive(?:[ -].*)?|dropbox|google ?drive|icloud(?:drive)?|box)$/i;
  if (pieces.some(p => !p || p === "." || p === ".." || /[:<>"|?*]|[. ]$/.test(p) || forbidden.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail("UNSAFE_PATH");
  const absolute = resolve(path), parent = dirname(absolute), name = basename(absolute);
  if (inside(repo, absolute)) fail("UNSAFE_PATH");
  const temporary = canonical(parent) === canonical(tmpdir()) && /^hanapure-web39-[A-Za-z0-9]{6}$/.test(name);
  const evidence = batch && canonical(parent) === canonical(PACKET_EVIDENCE_ROOT) && /^WEB39-packet-[A-Za-z0-9]{6}$/.test(name);
  if (!temporary && !evidence) fail("UNSAFE_PATH");
  guardAncestors(absolute); return absolute;
}
function guardAncestors(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const s = fs.lstatSync(current, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || canonical(fs.realpathSync(current)) !== canonical(current)) fail("UNSAFE_PATH");
    if (process.platform !== "win32" && current === resolve(path) && s.uid !== BigInt(process.getuid())) fail("UNSAFE_PATH");
    if (dirname(current) === current) break;
  }
}
function stable(a, b) { return ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "nlink"].every(k => a[k] === b[k]); }
function regular(s) {
  return s.isFile() && !s.isSymbolicLink() && s.nlink === 1n &&
    (process.platform === "win32" || s.uid === BigInt(process.getuid()));
}
function inventory(directory, names) {
  guardAncestors(directory);
  const actual = fs.readdirSync(directory).sort();
  if (actual.length !== names.length || actual.some((name, i) => name !== names[i])) fail("INVENTORY_MISMATCH");
  return new Map(names.map(name => {
    const s = fs.lstatSync(join(directory, name), { bigint: true });
    if (!regular(s) || s.size <= 0n || s.size > BigInt(name.endsWith(".html") ? MAX_HTML : MAX_MANIFEST)) fail("READ_BLOCKED");
    return [name, s];
  }));
}
function readStable(directory, name, initial) {
  guardAncestors(directory);
  const path = join(directory, name), before = fs.lstatSync(path, { bigint: true });
  if (!regular(before) || !stable(initial, before)) fail("FILE_UNSTABLE");
  let fd;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!regular(opened) || !stable(before, opened)) fail("FILE_UNSTABLE");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0, got;
    while (length < bytes.length && (got = fs.readSync(fd, bytes, length, bytes.length - length, length)) > 0) length += got;
    const after = fs.fstatSync(fd, { bigint: true }), linked = fs.lstatSync(path, { bigint: true });
    guardAncestors(directory);
    if (length !== Number(opened.size) || !regular(linked) || !stable(opened, after) || !stable(opened, linked)) fail("FILE_UNSTABLE");
    return bytes.subarray(0, length);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
/** Nonrecursive physical receipt: read flags only, exact inventories and stable handles. */
export function verifyEditorialPacketDirectory(path, sample = "batch") {
  if (sample !== "batch" && !cases.includes(sample)) return result("INVALID_REQUEST");
  const selected = sample === "batch" ? cases : [sample], count = selected.length * 3;
  try {
    const directory = safePath(path, sample === "batch"), identity = fs.lstatSync(directory, { bigint: true });
    const names = selected.flatMap(c => locales.flatMap(l => [`${c}-${l}.html`, `${c}-${l}.manifest.json`])).sort();
    const original = inventory(directory, names);
    if ([...original.values()].reduce((n, s) => n + Number(s.size), 0) > MAX_TOTAL) fail("READ_BLOCKED");
    const results = [];
    for (const c of selected) for (const l of locales) {
      if (!stable(identity, fs.lstatSync(directory, { bigint: true }))) fail("FILE_UNSTABLE");
      const h = `${c}-${l}.html`, m = `${c}-${l}.manifest.json`;
      results.push(verifyEditorialPacketBytes(readStable(directory, h, original.get(h)), readStable(directory, m, original.get(m)), c, l));
    }
    const final = inventory(directory, names);
    if (!stable(identity, fs.lstatSync(directory, { bigint: true })) || names.some(n => !stable(original.get(n), final.get(n)))) fail("FILE_UNSTABLE");
    const failed = results.find(r => r.decision === "BLOCKED");
    return result(failed ? failed.reasonCode : "VERIFIED", { requestedCases: selected, requestedPairCount: count, verifiedPairCount: results.filter(r => r.decision !== "BLOCKED").length, results });
  } catch (error) { return result(error instanceof GuardFailure ? error.code : "READ_BLOCKED", { requestedCases: selected, requestedPairCount: count, verifiedPairCount: 0 }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let response;
  if (process.env.NODE_ENV === "production" || ["VERCEL", "NETLIFY", "CF_PAGES", "DEPLOYMENT_ENV"].some(k => process.env[k] !== undefined)) response = result("INVALID_REQUEST");
  else if (process.argv.length === 4 && process.argv[2] === "--batch") response = verifyEditorialPacketDirectory(process.argv[3]);
  else if (process.argv.length === 5 && process.argv[2] === "--case") response = verifyEditorialPacketDirectory(process.argv[4], process.argv[3]);
  else response = result("INVALID_REQUEST");
  console.log(JSON.stringify(response, null, 2));
  if (response.decision === "BLOCKED") process.exitCode = 1;
}
