import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, lstatSync, realpathSync, accessSync, constants } from "node:fs";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpGet } from "node:http";

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

export async function waitForFixtureServer(child, url, timeout = 30_000, validateResponse) {
  const record = children.get(child);
  if (!record) throw new Error("Unowned server readiness check");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (record.closed) throw new Error("Fixture server failed before readiness");
    let readyBody;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: "error" });
      const body = await response.arrayBuffer();
      if (response.ok && !record.closed) readyBody = body;
    } catch { /* Loopback readiness only; no business-request retries. */ }
    if (readyBody !== undefined) {
      // Validation failures must escape, never be swallowed as polling failures.
      validateResponse?.(Buffer.from(readyBody).toString("utf8"));
      return;
    }
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

const devReadinessError = (kind, attempts, last) =>
  new Error(`WEB23_DEV_READINESS ${kind} attempts=${attempts} last=${last}`);

/** Offline-testable DEV observer. Each sequential probe shares one 90s deadline. */
export async function observeWeb23DevReadiness({ request, childExited, now = () => performance.now(), pause = delay }) {
  if ([request, childExited, now, pause].some(fn => typeof fn !== "function")) throw new Error("Invalid DEV readiness observer");
  const started = now();
  if (!Number.isFinite(started)) throw new Error("Invalid DEV readiness clock");
  const deadline = started + 90_000;
  let attempts = 0, last = "NO_HTTP_RESPONSE";
  while (true) {
    if (childExited()) throw devReadinessError("SERVER_CHILD_EXIT", attempts, last);
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) throw devReadinessError("DEADLINE_EXCEEDED", attempts, last);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), remaining);
    let response, body, failed = false, phase = "FETCH";
    attempts++;
    try {
      response = await request({ signal: abort.signal, remaining });
      last = `HTTP_STATUS:${response.status}`;
      phase = "BODY";
      body = await response.text(); // Same deadline covers headers AND body.
    } catch (error) {
      failed = true;
      const code = error?.cause?.code ?? error?.code;
      const safeCode = ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH"].includes(code) ? `:${code}` : "";
      last = phase === "BODY" ? `BODY_ABORT_OR_TIMEOUT:HTTP_STATUS:${response.status}`
        : `CONNECTION/TRANSPORT${safeCode}:NO_HTTP_RESPONSE`;
    } finally { clearTimeout(timer); }
    if (childExited()) throw devReadinessError("SERVER_CHILD_EXIT", attempts, last);
    if (now() >= deadline || abort.signal.aborted) throw devReadinessError("DEADLINE_EXCEEDED", attempts, last);
    if (!failed) {
      last = `HTTP_STATUS:${response.status}`;
      if (response.status === 200) {
        try { assertWeb23DevPage(body); }
        catch { throw devReadinessError("FIXTURE_MISMATCH", attempts, last); }
        return { attempts, status: 200 };
      }
    }
    const wait = Math.min(100, Math.max(0, deadline - now()));
    if (wait > 0) await pause(wait);
  }
}

/** The runtime entry point has no caller URL, deadline, environment or probe override. */
export async function waitForWeb23DevFixture(child) {
  const record = children.get(child);
  if (!record || child.pid !== record.pid || child.spawnfile !== record.executable ||
    child.kill !== record.kill || JSON.stringify(child.spawnargs) !== JSON.stringify(record.args)) {
    throw new Error("Unowned DEV readiness check");
  }
  return observeWeb23DevReadiness({
    childExited: () => record.closed,
    request: ({ signal }) => fetch("http://127.0.0.1:3101/en/products/test-only-journey-01", { signal, redirect: "error" }),
  });
}

// Values are enumerated, never copied from raw messages, headers or paths.
export function transportErrorFields(error) {
  const names = new Set(["Error", "TypeError", "AbortError", "TimeoutError", "AggregateError"]);
  const codes = new Set(["EACCES", "EPERM", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH",
    "ETIMEDOUT", "ABORT_ERR", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_ABORTED"]);
  const syscalls = new Set(["connect", "read", "write", "getaddrinfo"]);
  const fields = {};
  if (names.has(error?.name)) fields.name = error.name;
  if (codes.has(error?.code)) fields.code = error.code;
  if (syscalls.has(error?.syscall)) fields.syscall = error.syscall;
  if (names.has(error?.cause?.name)) fields.causeName = error.cause.name;
  if (codes.has(error?.cause?.code)) fields.causeCode = error.cause.code;
  if (syscalls.has(error?.cause?.syscall)) fields.causeSyscall = error.cause.syscall;
  const nested = [error?.cause?.cause, error?.errors?.[0], error?.cause?.errors?.[0]];
  const code = nested.find(item => codes.has(item?.code))?.code;
  if (code) fields.nestedCode = code;
  return fields;
}

/** Direct GET never follows Location; owned request/response are destroyed. */
export function directTransportProbe(get = httpGet) {
  return ({ signal }) => new Promise((resolve, reject) => {
    let request, response, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      response?.destroy();
      request?.destroy();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(Object.assign(new Error(), { name: "AbortError", code: "ABORT_ERR" }));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    try {
      request = get("http://127.0.0.1:3101/en/products/test-only-journey-01", { agent: false }, incoming => {
        response = incoming;
        finish(null, { status: incoming.statusCode,
          locationPresent: incoming.statusCode >= 300 && incoming.statusCode < 400 && typeof incoming.headers.location === "string" });
      });
      // Retain an error handler through destroy/close to absorb owned teardown errors.
      const onError = error => finish(error);
      request.on("error", onError);
      request.once("close", () => request.removeListener("error", onError));
      if (settled) request.destroy();
    } catch (error) { finish(error); }
  });
}

/** Offline adapters only in tests; production entry below fixes URL/ownership. */
export async function observeTransportComparison({ fetchProbe, httpProbe, childExited,
  now = () => performance.now(), pause = delay, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if ([fetchProbe, httpProbe, childExited, now, pause, setTimer, clearTimer].some(fn => typeof fn !== "function")) {
    throw new Error("Invalid transport observer");
  }
  const started = now();
  if (!Number.isFinite(started)) throw new Error("Invalid transport clock");
  const deadline = started + 30_000;
  const result = { owned: true, childClosed: false, elapsedMs: 0, fetchCalls: 0, httpCalls: 0,
    fetch: { outcome: "NOT_EXECUTED" }, http: { outcome: "NOT_EXECUTED" },
    comparison: "INCONCLUSIVE", limitation: "Sequential probes have different warm-up conditions; CLI/listener readiness is not proven." };
  // One stabilization pause, no HTTP polling. Included in the absolute ceiling.
  if (!childExited()) await pause(1500);
  for (const [key, probe] of [["fetch", fetchProbe], ["http", httpProbe]]) {
    if (childExited()) { result[key] = { outcome: "NOT_EXECUTED_CHILD_EXIT" }; continue; }
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) { result[key] = { outcome: "NOT_EXECUTED_BUDGET" }; continue; }
    const signalOwner = new AbortController();
    const budget = Math.min(12_000, remaining);
    let timer, drainTimer, timedOut = false, probeSettled = false;
    result[`${key}Calls`]++;
    try {
      const timeout = new Promise(resolve => { timer = setTimer(() => {
        timedOut = true; signalOwner.abort(); resolve({ outcome: "TIMEOUT" });
      }, budget); });
      const observed = Promise.resolve().then(() => probe({ signal: signalOwner.signal, remaining: budget })).then(value => {
        if (!Number.isInteger(value?.status) || value.status < 100 || value.status > 599) return { outcome: "INVALID_STATUS" };
        return { outcome: "HTTP_STATUS", status: value.status,
          ...(key === "http" ? { locationPresent: value.status >= 300 && value.status < 400 && value.locationPresent === true } : {}) };
      }, error => ({ outcome: key === "fetch" ? "FETCH_REJECTED" : "HTTP_REJECTED", ...transportErrorFields(error) }))
        .then(value => { probeSettled = true; return value; });
      result[key] = await Promise.race([observed, timeout]);
      if (timedOut && !probeSettled) {
        // Await abort settlement before the second probe, within the SAME ceiling.
        // If cancellation never settles, consume remaining budget and skip it.
        const drainBudget = Math.max(0, Math.floor(deadline - now()));
        if (drainBudget > 0) await Promise.race([observed, new Promise(resolve => {
          drainTimer = setTimer(resolve, drainBudget);
        })]);
      }
      if (timedOut || now() >= deadline) result[key] = { outcome: "TIMEOUT" };
    } finally { clearTimer(timer); clearTimer(drainTimer); signalOwner.abort(); }
  }
  result.childClosed = childExited();
  result.elapsedMs = Math.max(0, Math.floor(now() - started));
  if (!result.childClosed) {
    if (result.http.status >= 300 && result.http.status < 400 && result.fetch.outcome === "FETCH_REJECTED") {
      result.comparison = "REDIRECT_OBSERVED_FETCH_REJECTED_CAUSE_UNCONFIRMED";
    } else if (result.http.status === 200 && result.fetch.outcome === "FETCH_REJECTED") {
      result.comparison = "HTTP_200_FETCH_REJECTED_CAUSE_UNCONFIRMED";
    } else if (result.http.status === 200 && result.fetch.status === 200) result.comparison = "BOTH_HTTP_200_NOT_FIXTURE_OR_BROWSER_CERTIFICATION";
  }
  return result;
}

export async function compareOwnedWeb23Transport(child) {
  const record = children.get(child);
  if (!record || child.pid !== record.pid || child.spawnfile !== record.executable ||
    child.kill !== record.kill || JSON.stringify(child.spawnargs) !== JSON.stringify(record.args)) {
    throw new Error("Unowned transport comparison");
  }
  return observeTransportComparison({
    childExited: () => record.closed,
    fetchProbe: async ({ signal }) => {
      const response = await fetch("http://127.0.0.1:3101/en/products/test-only-journey-01", { signal, redirect: "error" });
      try { return { status: response.status }; } finally { await response.body?.cancel(); }
    },
    httpProbe: directTransportProbe(),
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
    ["--web23-cross-device-only", ["--grep", "\\[web23\\]", "--project", "published-chromium-375"]],
    ["--web23-dev-browser-only", ["--grep", "\\[web23\\]", "--project", "published-chromium-375"]],
    ["--web23-transport-diagnostic-only", []],
    ["--human-preview-only", []],
  ]);
  if (!Array.isArray(args) || args.length > 1 ||
    (args.length === 1 && !selectors.has(args[0]))) {
    throw new Error("STOP: provide no selector or exactly one recognized published-browser selector");
  }
  // The base all-tests run must not consume the opt-in paginated-only cases.
  return args.length ? [...selectors.get(args[0])] : ["--grep-invert", "\\[web(?:20|23)\\]"];
}

/** Explicit selector only; never accept fixture choice from an environment hook. */
export function publishedFixtureScenario(args) {
  publishedTestSelection(args); // Reject unknown/combined selectors before any side effect.
  return ["--integrated-journey-only", "--web23-cross-device-only", "--web23-dev-browser-only", "--web23-transport-diagnostic-only", "--human-preview-only"].includes(args[0]) ? "paginated" : "base";
}

/** Pure execution plan: only the explicit flag can select development mode. */
export function publishedRuntimePlan(args, input = process.env) {
  publishedTestSelection(args); // Reject before filesystem, socket or child work.
  const transportDiagnostic = args[0] === "--web23-transport-diagnostic-only";
  const development = args[0] === "--web23-dev-browser-only" || transportDiagnostic;
  const filtered = fixtureEnvironment(input);
  return {
    development,
    transportDiagnostic,
    environment: development ? { ...filtered, NODE_ENV: "development" } : filtered,
    buildArgs: development ? null : ["build", "--webpack"],
    serverArgs: [development ? "dev" : "start", ...(development ? ["--webpack"] : []), "--hostname", "127.0.0.1", "--port", "3101"],
    config: transportDiagnostic ? null : development ? "playwright.web23-dev.config.ts" : "playwright.published.config.ts",
  };
}

/** A UUID-only namespace cannot escape .next or overwrite past report folders. */
export function web23DevEvidence(owner) {
  const match = /^hanapure-published-catalogue-browser-v1:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(owner);
  if (!match) throw new Error("Invalid owned WEB23 development evidence identity");
  const root = join(".next", `web23-dev-not-production-${match[1]}`);
  return { root, results: join(root, "results"), report: join(root, "report.json") };
}

export function assertWeb23DevPage(html) {
  if (typeof html !== "string" || !/<h1\b[^>]*\bid="main-content"[^>]*>TEST ONLY JOURNEY en 01 — Long synthetic test name<\/h1>/.test(html)) {
    throw new Error("WEB23 development fixture mismatch: expected published TEST ONLY detail");
  }
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
  const runtime = publishedRuntimePlan(process.argv.slice(2));
  const humanPreview = process.argv[2] === "--human-preview-only";
  if (humanPreview && !process.stdin.isTTY) throw new Error("Human preview requires a foreground interactive terminal");
  const browserRoot = humanPreview || runtime.transportDiagnostic ? null : publishedBrowserRoot();
  await assertPortFree(); // Never adopt an unknown fixture-port server.
  const owner = `hanapure-published-catalogue-browser-v1:${randomUUID()}`;
  const workspace = createFixtureWorkspace(join(repo, ".next", "published-catalogue-app"), owner);
  const fixtureRoot = workspace.root;
  const environment = runtime.environment;
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
    // Exact tracked script leaves required by copied lib/catalog diagnostics.
    // Fixture-only copy: no execution of private-intake/preflight CLI and no real intake files.
    for (const file of [
      "scripts/first-real-sku-evidence-preflight.mjs",
      "scripts/private-draft-intake.mjs",
    ]) {
      workspace.verify();
      const source = join(repo, file);
      if (lstatSync(source).isSymbolicLink() || !lstatSync(source).isFile()) {
        throw new Error("Refusing non-regular fixture diagnostic dependency");
      }
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
    if (runtime.development) {
      const evidence = web23DevEvidence(owner);
      mkdirSync(join(repo, evidence.root)); // UUID path must be new; never adopt.
      writeFileSync(join(repo, evidence.root, "mode.json"), JSON.stringify({ owner, mode: "DEV-NOT-PRODUCTION" }), { flag: "wx" });
      console.log(`WEB23_DEV_NOT_PRODUCTION_EVIDENCE ${join(repo, evidence.root)}`);
    } else if (!await continueAfter(workspace.wait(workspace.spawn([next, ...runtime.buildArgs], environment, stdio)))) return;
    const server = workspace.spawn([next, ...runtime.serverArgs], environment, stdio);
    if (runtime.transportDiagnostic) {
      console.log(`WEB23_TRANSPORT_COMPARISON ${JSON.stringify(await compareOwnedWeb23Transport(server))}`);
      return; // Owned finally cleanup; never readiness polling or Playwright.
    }
    const readiness = runtime.development
      ? waitForWeb23DevFixture(server)
      : waitForFixtureServer(server, "http://127.0.0.1:3101/en/products");
    if (!await continueAfter(readiness)) return;
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
    await workspace.wait(workspace.spawn([playwright, "test", "--config", join(repo, runtime.config), ...selection],
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
