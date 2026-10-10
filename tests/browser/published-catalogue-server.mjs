import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, lstatSync } from "node:fs";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceCatalogue = join(repo, "data", "catalogue.ts");
const digest = () => createHash("sha256").update(readFileSync(sourceCatalogue)).digest("hex");
// Only actual children created here acquire native-handle authority. Persisted
// PID, marker contents or a lookalike object cannot grant that authority.
const children = new WeakMap();

export function fixtureEnvironment(input = process.env) {
  const allowed = new Set(["SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE"]);
  const env = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key.toUpperCase()) && typeof value === "string") env[key.toUpperCase()] = value;
  }
  return { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", HANAPURE_PUBLIC_SITE_ORIGIN: "" };
}

export async function stopOwnedChild(child, owner) {
  const record = children.get(child);
  if (!record || record.owner !== owner || child.pid !== record.pid ||
    child.spawnfile !== record.executable || child.kill !== record.kill ||
    JSON.stringify(child.spawnargs) !== JSON.stringify(record.args)) {
    throw new Error("Refusing process termination: child identity/ownership unverified");
  }
  // Uses the retained native child handle on Windows, never process.kill/taskkill.
  if (!record.closed && child.exitCode === null && child.signalCode === null && !record.kill.call(child)) {
    throw new Error("Owned child termination failed; preserve fixture and STOP");
  }
  let timer;
  try {
    await Promise.race([record.completion, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Owned child did not close; preserve fixture and STOP")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

export function createFixtureWorkspace(root, owner) {
  const base = join(repo, ".next");
  const path = resolve(root);
  const suffix = relative(base, path);
  if (!owner || !suffix || suffix.startsWith("..") || isAbsolute(suffix) ||
    !/^published-(?:catalogue-app|safety-[a-z0-9-]+)$/.test(suffix)) throw new Error("Unsafe fixture path/owner");
  mkdirSync(base, { recursive: true });
  mkdirSync(path); // Existing directory is never adopted, overwritten or removed.
  const marker = join(path, ".test-only-owner");
  const before = digest();
  writeFileSync(marker, JSON.stringify({ owner, catalogueHash: before }));
  const owned = new Set();
  function verify() {
    if (lstatSync(path).isSymbolicLink() || lstatSync(marker).isSymbolicLink()) throw new Error("Fixture ownership path replaced");
    const state = JSON.parse(readFileSync(marker, "utf8"));
    if (state.owner !== owner || state.catalogueHash !== before || digest() !== before) {
      throw new Error("Fixture ownership/catalogue integrity unverified; preserve and STOP");
    }
  }
  return {
    root: path,
    spawn(args, env, stdio = "inherit") {
      verify();
      const child = spawn(process.execPath, args, { cwd: path, env, stdio, windowsHide: true });
      const record = { owner, pid: child.pid, executable: child.spawnfile, args: [...child.spawnargs], kill: child.kill, closed: false, error: null };
      record.completion = new Promise(done => {
        child.once("error", error => { record.error = error; });
        child.once("close", (code, signal) => { record.closed = true; done({ code, signal, error: record.error }); });
      });
      children.set(child, record);
      owned.add(child);
      return child;
    },
    async wait(child) {
      if (!owned.has(child)) throw new Error("Unowned child wait");
      const result = await children.get(child).completion;
      if (result.error || result.code !== 0) throw new Error(`Fixture child failed: ${result.error?.message ?? result.code ?? result.signal}`);
    },
    verify,
    async cleanup() {
      verify(); // Verify before termination as well as before removal.
      for (const child of owned) await stopOwnedChild(child, owner);
      verify();
      await rm(path, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
    },
  };
}

export async function waitForFixtureServer(child, url, timeout = 30_000) {
  const record = children.get(child);
  if (!record) throw new Error("Unowned server readiness check");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (record.closed) throw new Error("Fixture server failed before readiness");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: "error" });
      await response.arrayBuffer();
      if (response.ok && !record.closed) return;
    } catch { /* Loopback readiness only; no business-request retries. */ }
    await delay(100);
  }
  throw new Error("Fixture server readiness timed out");
}

async function assertPortFree() {
  const { createServer } = await import("node:net");
  await new Promise((done, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(3101, "127.0.0.1", () => server.close(done));
  });
}

async function runJourney() {
  await assertPortFree(); // Never adopt an unknown fixture-port server.
  const owner = `hanapure-published-catalogue-browser-v1:${randomUUID()}`;
  const workspace = createFixtureWorkspace(join(repo, ".next", "published-catalogue-app"), owner);
  const fixtureRoot = workspace.root;
  const environment = fixtureEnvironment();
  try {
    const { publishedCatalogueFixtures } = await import("./published-catalogue-fixtures.mjs");
    const files = execFileSync("git", ["ls-files", "-z", "--", "app", "components", "data", "lib", "public",
      "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"],
    { cwd: repo, encoding: "utf8", env: environment }).split("\0").filter(Boolean);
    for (const file of files) {
      const target = join(fixtureRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repo, file), target);
    }
    // Only the disposable copy receives test content; real source stays empty.
    writeFileSync(join(fixtureRoot, "data", "catalogue.ts"),
      'import "server-only";\nimport type { EditorialProduct } from "../lib/catalog/editorial-catalogue";\n' +
      `export const editorialProducts: readonly EditorialProduct[] = ${JSON.stringify(publishedCatalogueFixtures)};\n`);
    const chunks = join(repo, ".next", "static", "chunks");
    const css = readdirSync(chunks).filter(file => file.endsWith(".css"))
      .map(file => readFileSync(join(chunks, file), "utf8")).join("\n");
    const fontCSS = {};
    for (const family of ["Geist", "Geist Mono"]) {
      const faces = [...css.matchAll(/@font-face\{[^}]+\}/g)].map(match => match[0])
        .filter(face => face.includes(`font-family:${family};`));
      if (!faces.length) throw new Error("Build the real app first to supply offline font assets");
      fontCSS[family] = faces.join("\n").replace(/url\(\.\.\/media\/([^)]*)\)/g, (_, name) => {
        const absolute = join(repo, ".next", "static", "media", name);
        if (!existsSync(absolute)) throw new Error("Missing built font asset");
        return `url(${absolute.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")})`;
      });
    }
    const fontResponses = join(fixtureRoot, "offline-font-responses.cjs");
    writeFileSync(fontResponses, `const css = ${JSON.stringify(fontCSS)};\nmodule.exports = new Proxy({}, {get: (_, url) => css[String(url).includes("Geist+Mono") ? "Geist Mono" : "Geist"]});\n`);
    environment.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = fontResponses; // Controlled local path, never inherited.
    const next = join(repo, "node_modules", "next", "dist", "bin", "next");
    await workspace.wait(workspace.spawn([next, "build", "--webpack"], environment));
    const server = workspace.spawn([next, "start", "--hostname", "127.0.0.1", "--port", "3101"], environment);
    await waitForFixtureServer(server, "http://127.0.0.1:3101/en/products");
    const playwright = join(repo, "node_modules", "@playwright", "test", "cli.js");
    await workspace.wait(workspace.spawn([playwright, "test", "--config", join(repo, "playwright.published.config.ts")],
      { ...environment, HANAPURE_PUBLISHED_TEST_RUN_ID: owner }));
  } finally {
    // Covers build/start/readiness/test errors. Only this living controller holds
    // the native child handles; orphan/PID recovery is deliberately refused.
    await workspace.cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runJourney().catch(error => { console.error(error); process.exitCode = 1; });
}
