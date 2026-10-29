import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateEditorialPacket } from "../scripts/first-sku-editorial-packet.mjs";
import { verifyEditorialPacketBytes as pure, verifyEditorialPacketDirectory as receive } from "../scripts/first-sku-editorial-packet-verify.mjs";
const hash = b => createHash("sha256").update(b).digest("hex");
function checked(r, pass) {
  assert.equal(r.decision, pass ? "INTEGRITY_OK_FOR_SYNTHETIC_REVIEW" : "BLOCKED");
  for (const key of ["readyForLivePublication", "readyForCheckout", "trustedForLiveUse"]) assert.equal(r[key], false);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET|<script|htmlBytes|AppData|Users|\.html|timestamp|signature/);
  return r;
}
function pair(pack, c = pack.sample, l = "en") { return [fs.readFileSync(join(pack.directory, `${c}-${l}.html`)), fs.readFileSync(join(pack.directory, `${c}-${l}.manifest.json`))]; }
function snapshot(directory) {
  return fs.readdirSync(directory).sort().map(name => { const p = join(directory, name), s = fs.statSync(p, { bigint: true }); return [name, hash(fs.readFileSync(p)), s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs]; });
}
test("authentic physical one/all/invalid all locales, correct blocked-source distinction", () => {
  for (const c of ["one", "all", "invalid"]) {
    const pack = generateEditorialPacket(c), before = snapshot(pack.directory), result = checked(receive(pack.directory, c), true);
    assert.equal(result.verifiedPairCount, 3); assert.deepEqual(snapshot(pack.directory), before);
    for (const l of ["en", "hu", "ko"]) {
      const r = checked(pure(...pair(pack, c, l), c, l), true);
      assert.equal(r.sourceStatus, c === "one" ? "DRAFT_INCOMPLETE" : c === "all" ? "READY_FOR_HUMAN_EDITORIAL_REVIEW" : "INVALID_INPUT");
      assert.equal(r.issueCount, c === "one" ? 2 : c === "invalid" ? 1 : 0);
    }
  }
});
test("real 18-file physical batch is distinct from 6-file reception, no partial PASS", () => {
  const directory = fs.mkdtempSync(join(tmpdir(), "hanapure-web39-"));
  for (const c of ["one", "all", "invalid"]) for (const f of generateEditorialPacket(c).files) fs.copyFileSync(f.path, join(directory, f.name), fs.constants.COPYFILE_EXCL);
  const before = snapshot(directory), result = checked(receive(directory), true);
  assert.equal(result.requestedPairCount, 9); assert.equal(result.verifiedPairCount, 9); assert.deepEqual(snapshot(directory), before);
  checked(receive(directory, "one"), false);
  fs.appendFileSync(join(directory, "one-en.html"), "X"); const failed = checked(receive(directory), false); assert.ok(failed.verifiedPairCount < 9);
});
test("single HTML byte and coordinated HTML+manifest matching-hash forgery BLOCK", () => {
  const p = generateEditorialPacket("all"), [h, m] = pair(p), changed = Buffer.from(h); changed[0] ^= 1;
  checked(pure(changed, m, "all", "en"), false);
  const claim = JSON.parse(m); claim.html.sha256 = hash(changed);
  const result = checked(pure(changed, Buffer.from(JSON.stringify(claim, null, 2) + "\n"), "all", "en"), false);
  assert.equal(result.reasonCode, "HTML_MISMATCH");
});
test("manifest-only tamper semantics, version, missing flags and forged fields BLOCK", () => {
  const p = generateEditorialPacket("one"), [h, m] = pair(p);
  for (const mutate of [d => d.html.sha256 = "0".repeat(64), d => d.version = "2", d => d.scope = "REAL", d => d.status = "APPROVED", d => delete d.readyForCheckout,
    d => d.readyForLivePublication = true, d => d.trustedForLiveUse = true, d => d.issuer = "PRIVATE_SECRET", d => d.issues[0].locale = "ko", d => d.issues.reverse(), d => d.html.name = "all-en.html"]) {
    const d = JSON.parse(m); mutate(d); checked(pure(h, Buffer.from(JSON.stringify(d, null, 2) + "\n"), "one", "en"), false);
  }
});
test("cross-case/locale swaps and canonical duplicate keys/whitespace rejected", () => {
  const a = generateEditorialPacket("one"), b = generateEditorialPacket("all"), [h, m] = pair(a);
  checked(pure(...pair(b), "one", "en"), false); checked(pure(...pair(a, "one", "hu"), "one", "en"), false);
  checked(pure(h, Buffer.from(m.toString().replace('{\n', '{\n  "version": "1",\n')), "one", "en"), false);
  checked(pure(h, Buffer.concat([m, Buffer.from(" ")]), "one", "en"), false);
});
test("invalid encoding JSON BOM NUL oversized bytes and malicious reflection fail safely", () => {
  const p = generateEditorialPacket("one"), [h, m] = pair(p);
  for (const bad of [Buffer.from([0xff]), Buffer.from([0]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), m]), Buffer.from("{"), Buffer.alloc(8193), Buffer.from('{"PRIVATE_SECRET":"<script>"}')]) checked(pure(h, bad, "one", "en"), false);
  checked(pure(Buffer.alloc(16385), m, "one", "en"), false);
  for (const bad of [null, [], "PRIVATE_SECRET", new Proxy({}, { get() { assert.fail("Proxy accessed"); } })]) checked(pure(bad, m, "one", "en"), false);
  checked(pure(h, m, "PRIVATE_SECRET", "en"), false);
});
test("physical missing/extra/misnamed/oversized files and retained-name pair swaps BLOCK", () => {
  for (const attack of [p => fs.unlinkSync(join(p.directory, "one-en.html")), p => fs.writeFileSync(join(p.directory, "extra.json"), "{}"),
    p => { fs.copyFileSync(join(p.directory, "one-en.html"), join(p.directory, "wrong-en.html")); fs.unlinkSync(join(p.directory, "one-en.html")); }, p => fs.writeFileSync(join(p.directory, "one-en.html"), Buffer.alloc(16385)),
    p => fs.copyFileSync(join(p.directory, "one-hu.html"), join(p.directory, "one-en.html"))]) {
    const p = generateEditorialPacket("one"); attack(p); checked(receive(p.directory, "one"), false);
  }
});
test("safe-root, traversal, repository, public/shared/device/ADS/network paths fail before reads", () => {
  for (const path of ["relative", "https://PRIVATE_SECRET", "\\\\server\\private", "C:\\con\\x", "C:\\private:stream", process.cwd(), join(tmpdir(), "public", "hanapure-web39-abcdef"),
    join(tmpdir(), "shared", "hanapure-web39-abcdef"), tmpdir() + "/../hanapure-web39-abcdef", join(tmpdir(), "arbitrary-directory")]) checked(receive(path, "one"), false);
});
test("ancestor symlink and file-type branches fail closed using honest read-only mocks", t => {
  const p = generateEditorialPacket("one"), original = fs.lstatSync;
  t.mock.method(fs, "lstatSync", (path, options) => {
    const s = original(path, options); if (String(path) === p.directory) return new Proxy(s, { get(target, key) { if (key === "isSymbolicLink") return () => true; const v = Reflect.get(target, key); return typeof v === "function" ? v.bind(target) : v; } }); return s;
  });
  assert.equal(checked(receive(p.directory, "one"), false).reasonCode, "UNSAFE_PATH");
});
test("changed identity after read is rejected via explicit fstat mock; physical open-file rename unverified", t => {
  const p = generateEditorialPacket("one"), originalRead = fs.readSync, originalStat = fs.fstatSync; let read = false;
  t.mock.method(fs, "readSync", (...args) => {
    const n = originalRead(...args); read = true; return n;
  });
  t.mock.method(fs, "fstatSync", (...args) => { const s = originalStat(...args); return read ? { ...s, ino: s.ino + 1n } : s; });
  assert.equal(checked(receive(p.directory, "one"), false).reasonCode, "FILE_UNSTABLE");
});
test("receiver performs no write/network operations, unchanged content+metadata and deterministic errors", t => {
  const p = generateEditorialPacket("one"), before = snapshot(p.directory);
  const open = fs.openSync;
  t.mock.method(fs, "openSync", (path, flags, ...rest) => { assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND), 0); return open(path, flags, ...rest); });
  for (const method of ["writeFileSync", "appendFileSync", "unlinkSync", "renameSync", "mkdirSync", "mkdtempSync", "chmodSync"]) t.mock.method(fs, method, () => assert.fail("receiver write forbidden"));
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("network forbidden"));
  checked(receive(p.directory, "one"), true); assert.equal(fetch.mock.callCount(), 0); assert.deepEqual(snapshot(p.directory), before);
  assert.deepEqual(receive("PRIVATE_SECRET"), receive("PRIVATE_SECRET"));
});
test("real receiver CLI exit and source guard; no generator invocation/public side effects", () => {
  const p = generateEditorialPacket("invalid"), script = new URL("../scripts/first-sku-editorial-packet-verify.mjs", import.meta.url), before = snapshot(p.directory);
  const r = spawnSync(process.execPath, ["--conditions=react-server", "--import", new URL("./server-only-loader.mjs", import.meta.url).href, fileURLToPath(script), "--case", "invalid", p.directory], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", NODE_ENV: "development" } });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); checked(JSON.parse(r.stdout), true); assert.deepEqual(snapshot(p.directory), before);
  const src = fs.readFileSync(script, "utf8"); assert.doesNotMatch(src, /generateEditorialPacket|writeFile|node:https?|node:child_process|\bfetch\s*\(|createServer|localStorage|data\/catalogue/);
  assert.match(fs.readFileSync(new URL("../data/catalogue.ts", import.meta.url), "utf8"), /Object\.freeze\(\[\]\)/);
});
