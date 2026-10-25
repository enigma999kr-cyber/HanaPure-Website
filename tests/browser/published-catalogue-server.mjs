import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, lstatSync, realpathSync, accessSync, constants } from "node:fs";
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

// Resolve only an existing OS-profile installation, never a caller's browser
// override. This is a read-only check; no browser or child process is launched.
export function publishedBrowserRoot() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Unsupported browser installation platform");
  const environment = fixtureEnvironment();
  function ordinary(path, directory) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error("Non-ordinary browser installation path");
    }
    for (let ancestor = dirname(path); ; ancestor = dirname(ancestor)) {
      const parent = lstatSync(ancestor);
      if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error("Linked browser installation ancestor");
      if (dirname(ancestor) === ancestor) break;
    }
  }
  const candidates = [];
  if (environment.LOCALAPPDATA && isAbsolute(environment.LOCALAPPDATA)) candidates.push(join(environment.LOCALAPPDATA, "ms-playwright"));
  if (environment.USERPROFILE && isAbsolute(environment.USERPROFILE)) candidates.push(join(environment.USERPROFILE, "AppData", "Local", "ms-playwright"));
  const roots = new Map();
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    ordinary(candidate, true);
    // Windows app-package redirection may produce a different canonical root.
    const root = realpathSync.native(candidate);
    ordinary(root, true);
    if (realpathSync.native(root).toLowerCase() !== root.toLowerCase()) throw new Error("Unstable browser installation root");
    roots.set(root.toLowerCase(), root);
  }
  if (roots.size !== 1) throw new Error("Missing or ambiguous existing browser installation");
  const root = [...roots.values()][0];
  const metadata = JSON.parse(readFileSync(join(repo, "node_modules", "playwright-core", "browsers.json"), "utf8"));
  for (const [name, folder, executable] of [
    ["chromium", "chromium", ["chrome-win64", "chrome.exe"]],
    ["chromium-headless-shell", "chromium_headless_shell", ["chrome-headless-shell-win64", "chrome-headless-shell.exe"]],
  ]) {
    const matches = metadata.browsers.filter(browser => browser.name === name);
    if (matches.length !== 1) throw new Error("Ambiguous installed browser revision");
    const revision = matches[0].revisionOverrides?.win64 ?? matches[0].revision;
    if (typeof revision !== "string" || !/^\d+$/.test(revision)) throw new Error("Invalid installed browser revision");
    const file = join(root, `${folder}-${revision}`, ...executable);
    ordinary(file, false);
    const canonicalFile = realpathSync.native(file);
    const suffix = relative(root, canonicalFile);
    if (!suffix || suffix.startsWith("..") || isAbsolute(suffix) || canonicalFile.toLowerCase() !== file.toLowerCase()) {
      throw new Error("Browser executable escapes canonical installation");
    }
    accessSync(file, constants.R_OK);
  }
  return root;
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

export function publishedTestSelection(args) {
  const selectors = new Map([
    ["--cart-only", ["--grep", ": cart "]],
    ["--gallery-only", ["--grep", "media gallery"]],
    ["--footer-only", ["--grep", "Footer"]],
    ["--discovery-only", ["--grep", "discovery entry|image decode|normal listing/detail|published Brands"]],
    ["--same-brand-only", ["--grep", "same-brand discovery|media gallery|image decode"]],
    ["--quick-add-only", ["--grep", "quick add|: cart "]],
    ["--sort-only", ["--grep", "sort continuity|quick add|same-brand discovery|direct entry|published Brands"]],
    ["--journey-quality-only", ["--grep", "\\[web19\\]", "--project", "published-chromium-375"]],
    ["--integrated-journey-only", ["--grep", "\\[web20\\]", "--project", "published-chromium-375"]],
    ["--human-preview-only", []],
  ]);
  if (!Array.isArray(args) || args.length > 1 ||
    (args.length === 1 && !selectors.has(args[0]))) {
    throw new Error("STOP: provide no selector or exactly one recognized published-browser selector");
  }
  // The base all-tests run must not consume the opt-in paginated-only cases.
  return args.length ? [...selectors.get(args[0])] : ["--grep-invert", "\\[web20\\]"];
}

/** Explicit selector only; never accept fixture choice from an environment hook. */
export function publishedFixtureScenario(args) {
  publishedTestSelection(args); // Reject unknown/combined selectors before any side effect.
  return ["--integrated-journey-only", "--human-preview-only"].includes(args[0]) ? "paginated" : "base";
}

/** Foreground input only. Requests cleanup; never acquires PID/kill authority. */
export function createHumanPreviewController(input = process.stdin, signals = process) {
  if (!input.isTTY) throw new Error("Human preview requires a foreground interactive terminal");
  let requestStop, reason = null, buffer = "";
  const stopped = new Promise(resolve => { requestStop = resolve; });
  const stop = value => { if (reason === null) { reason = value; requestStop(value); } };
  const interrupt = () => stop("SIGINT"), terminate = () => stop("SIGTERM");
  const end = () => stop("terminal input ended"), error = () => stop("terminal input failed");
  const data = chunk => {
    buffer += chunk.toString("utf8");
    if (buffer.length > 1024) { stop("terminal input exceeded limit"); return; }
    const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    if (lines.some(line => line.trim().toUpperCase() === "STOP")) stop("operator STOP");
  };
  signals.on("SIGINT", interrupt); signals.on("SIGTERM", terminate);
  input.on("data", data); input.on("end", end); input.on("error", error); input.resume();
  return {
    stopped,
    get reason() { return reason; },
    close() {
      signals.removeListener("SIGINT", interrupt); signals.removeListener("SIGTERM", terminate);
      input.removeListener("data", data); input.removeListener("end", end); input.removeListener("error", error); input.pause();
    },
  };
}

async function runJourney() {
  // Validate before port binding, workspace creation, build or child execution.
  const selection = publishedTestSelection(process.argv.slice(2));
  const scenario = publishedFixtureScenario(process.argv.slice(2));
  const humanPreview = process.argv[2] === "--human-preview-only";
  if (humanPreview && !process.stdin.isTTY) throw new Error("Human preview requires a foreground interactive terminal");
  const browserRoot = humanPreview ? null : publishedBrowserRoot();
  await assertPortFree(); // Never adopt an unknown fixture-port server.
  const owner = `hanapure-published-catalogue-browser-v1:${randomUUID()}`;
  const workspace = createFixtureWorkspace(join(repo, ".next", "published-catalogue-app"), owner);
  const fixtureRoot = workspace.root;
  const environment = fixtureEnvironment();
  let controller;
  try {
    controller = humanPreview ? createHumanPreviewController() : null;
    const continueAfter = async task => {
      const proceed = controller ? await Promise.race([
        task.then(() => true), controller.stopped.then(() => false),
      ]) : await task.then(() => true);
      if (!proceed) {
        console.log(`HUMAN_PREVIEW_STOP_REQUESTED ${controller.reason}`);
        if (controller.reason.startsWith("terminal input")) throw new Error(`Human preview stopped: ${controller.reason}`);
      }
      return proceed;
    };
    const { publishedCatalogueFixtures, paginatedCatalogueFixtures } = await import("./published-catalogue-fixtures.mjs");
    const fixtures = scenario === "paginated" ? paginatedCatalogueFixtures : publishedCatalogueFixtures;
    const files = execFileSync("git", ["ls-files", "-z", "--", "app", "components", "data", "lib", "public",
      "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"],
    { cwd: repo, encoding: "utf8", env: environment }).split("\0").filter(Boolean);
    for (const file of files) {
      const target = join(fixtureRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repo, file), target);
    }
    // Explicitly approved untracked leaf only; do not widen the tracked copy list.
    workspace.verify();
    const imageFile = "components/catalogue/ProductImage.tsx";
    const imageSource = join(repo, imageFile);
    if (lstatSync(imageSource).isSymbolicLink() || !lstatSync(imageSource).isFile()) {
      throw new Error("Refusing non-regular ProductImage source");
    }
    copyFileSync(imageSource, join(fixtureRoot, imageFile));
    workspace.verify();
    const galleryFile = "components/catalogue/ProductMediaGallery.tsx";
    const gallerySource = join(repo, galleryFile);
    if (lstatSync(gallerySource).isSymbolicLink() || !lstatSync(gallerySource).isFile()) {
      throw new Error("Refusing non-regular ProductMediaGallery source");
    }
    copyFileSync(gallerySource, join(fixtureRoot, galleryFile));
    workspace.verify();
    const footerFile = "components/layout/Footer.tsx";
    const footerSource = join(repo, footerFile);
    if (lstatSync(footerSource).isSymbolicLink() || !lstatSync(footerSource).isFile()) {
      throw new Error("Refusing non-regular Footer source");
    }
    copyFileSync(footerSource, join(fixtureRoot, footerFile));
    workspace.verify();
    const quickAddFile = "components/cart/QuickAdd.tsx";
    const quickAddSource = join(repo, quickAddFile);
    if (lstatSync(quickAddSource).isSymbolicLink() || !lstatSync(quickAddSource).isFile()) throw new Error("Refusing non-regular QuickAdd source");
    copyFileSync(quickAddSource, join(fixtureRoot, quickAddFile));
    // This milestone's explicit new leaves only; retain ownership/path checks.
    for (const file of ["components/cart/AddToCart.tsx", "components/cart/CartContent.tsx", "components/cart/ShoppingCart.tsx",
      "lib/cart/cart-state.ts", "lib/cart/browser-cart.ts", "lib/cart/labels.ts", "app/cart/page.tsx", "app/[locale]/cart/page.tsx"]) {
      workspace.verify();
      const source = join(repo, file);
      if (lstatSync(source).isSymbolicLink() || !lstatSync(source).isFile()) throw new Error("Refusing non-regular cart source");
      const target = join(fixtureRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    workspace.verify();
    // Only the disposable copy receives test content; real source stays empty.
    writeFileSync(join(fixtureRoot, "data", "catalogue.ts"),
      'import "server-only";\nimport type { EditorialProduct } from "../lib/catalog/editorial-catalogue";\n' +
      `export const editorialProducts: readonly EditorialProduct[] = ${JSON.stringify(fixtures)};\n`);
    const next = join(repo, "node_modules", "next", "dist", "bin", "next");
    const stdio = humanPreview ? ["ignore", "inherit", "inherit"] : "inherit";
    if (!await continueAfter(workspace.wait(workspace.spawn([next, "build", "--webpack"], environment, stdio)))) return;
    const server = workspace.spawn([next, "start", "--hostname", "127.0.0.1", "--port", "3101"], environment, stdio);
    if (!await continueAfter(waitForFixtureServer(server, "http://127.0.0.1:3101/en/products"))) return;
    if (humanPreview) {
      console.log("HUMAN_PREVIEW_READY http://127.0.0.1:3101/en/products?q=TEST+ONLY+JOURNEY&brand=Round+Lab&sort=name-asc");
      console.log("TEST ONLY foreground preview. STOP + Enter or Ctrl+C requests owned cleanup. No automated tests run.");
      const reason = await Promise.race([controller.stopped, children.get(server).completion.then(result => {
        throw new Error(`Human preview server exited unexpectedly: ${result.code ?? result.signal ?? result.error?.message}`);
      })]);
      console.log(`HUMAN_PREVIEW_STOP_REQUESTED ${reason}`);
      if (reason.startsWith("terminal input")) throw new Error(`Human preview stopped: ${reason}`);
      return;
    }
    const playwright = join(repo, "node_modules", "@playwright", "test", "cli.js");
    await workspace.wait(workspace.spawn([playwright, "test", "--config", join(repo, "playwright.published.config.ts"), ...selection],
      { ...environment, HANAPURE_PUBLISHED_TEST_RUN_ID: owner, PLAYWRIGHT_BROWSERS_PATH: browserRoot }));
  } finally {
    controller?.close();
    // Covers build/start/readiness/test errors. Only this living controller holds
    // the native child handles; orphan/PID recovery is deliberately refused.
    await workspace.cleanup();
    if (humanPreview) console.log("HUMAN_PREVIEW_CLEANUP_COMPLETE");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runJourney().catch(error => { console.error(error); process.exitCode = 1; });
}
