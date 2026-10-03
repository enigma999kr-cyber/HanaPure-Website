import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertStagingNodeRuntime, STAGING_LIMITS, validateStagingConfiguration } from "../lib/staging/config.ts";
import { createStagingDependencyScope, getStagingDependencies } from "../lib/staging/dependencies.ts";
import { subject, otherSubject, principal, intent } from "./helpers/admin-auth-fixtures.mjs";

const config = () => ({ enabled: true, environment: "staging",
  database: { host: "pooler.staging.invalid", port: 6543, database: "hanapure_staging",
    user: "hanapure_runtime.fakeproject", password: "FAKE_TEST_PASSWORD_ONLY" },
  publicAuth: { url: "https://auth.staging.invalid", publishableKey: "sb_publishable_FAKE_TEST_ONLY" } });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function database(handler = async () => ({ rows: [] })) {
  const options = []; const queries = []; const releases = []; const listeners = new Map();
  let connects = 0; let ends = 0; let connectImpl; let endImpl;
  const client = { async query(sql, values) { queries.push({ sql, values }); return handler(sql, values); },
    release(destroy) { releases.push(destroy); } };
  const pool = { connect() { connects++; return connectImpl ? connectImpl() : Promise.resolve(client); },
    end() { ends++; return endImpl ? endImpl() : Promise.resolve(); },
    on(event, listener) { listeners.set(event, listener); return pool; } };
  return { client, queries, releases, listeners, options,
    createPool(value) { options.push(value); return pool; },
    setConnect(value) { connectImpl = value; }, setEnd(value) { endImpl = value; },
    get connects() { return connects; }, get ends() { return ends; } };
}

/** Real SDK and signed JWT; every HTTP response is fake and request-local. */
function authProvider() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kid = randomUUID(); const url = `https://${kid}.gateb1.invalid`; const tokens = new Map(); const requests = [];
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = (user, aal = "aal2") => {
    const claims = { sub: user, session_id: randomUUID(), iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 600, iss: `${url}/auth/v1`, aud: "authenticated", role: "authenticated", aal };
    const payload = `${encode({ alg: "ES256", typ: "JWT", kid })}.${encode(claims)}`;
    const value = `${payload}.${sign("sha256", Buffer.from(payload), {
      key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
    tokens.set(value, user); return value;
  };
  const fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    if (String(input).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    assert.equal(String(input), `${url}/auth/v1/user`);
    const user = tokens.get(new Headers(options.headers).get("authorization").slice(7));
    assert.ok(user, "HTTP request must carry this request's token");
    return Response.json({ id: user, aud: "authenticated", role: "authenticated", is_anonymous: false,
      created_at: "2026-09-30T00:00:00.000Z" });
  };
  return { url, token, fetch, requests };
}

test("missing, disabled, malformed and unexpected config fails closed before pool construction", () => {
  const db = database(); const scope = createStagingDependencyScope({ createPool: db.createPool });
  const cases = [undefined, null, {}, [], { ...config(), enabled: false }, { ...config(), environment: "production" }];
  for (const [key, value] of [["host", "https://user:SECRET@invalid"], ["port", 0], ["port", "6543"],
    ["database", "a/b"], ["user", "postgres.fakeproject"], ["user", "supabase_admin"], ["password", " "]]) {
    const c = config(); c.database[key] = value; cases.push(c);
  }
  for (const value of ["http://auth.invalid", "https://user:SECRET@auth.invalid", "https://auth.invalid/path",
    "https://auth.invalid?password=SECRET", "not-a-url"]) {
    const c = config(); c.publicAuth.url = value; cases.push(c);
  }
  for (const value of ["sb_secret_FAKE_ONLY", "eyJ_FAKE_LEGACY", ""]) {
    const c = config(); c.publicAuth.publishableKey = value; cases.push(c);
  }
  const c = config(); c.database.ssl = false; cases.push(c);
  const extra = config(); extra.connectionString = "SECRET"; cases.push(extra);
  for (const value of cases) {
    assert.throws(() => scope.get(value), (error) => {
      assert.match(error.message, /^staging_configuration_invalid:[a-zA-Z.]+$/);
      assert.doesNotMatch(error.message, /SECRET|FAKE_TEST_PASSWORD|user:|sb_secret/); return true;
    });
  }
  assert.equal(db.options.length, 0); assert.equal(db.connects, 0);
});

test("accessors/hostile proxy diagnostics are sanitized; valid config is a frozen copy", () => {
  const accessor = config(); Object.defineProperty(accessor.database, "password", { get() { throw new Error("SECRET"); } });
  assert.throws(() => validateStagingConfiguration(accessor), /invalid:database$/);
  const hostile = new Proxy({}, { getPrototypeOf() { throw new Error("SECRET"); } });
  assert.throws(() => validateStagingConfiguration(hostile), /^Error: staging_configuration_invalid:root$/);
  const thrown = new Proxy({}, { getPrototypeOf() { throw new Error("SECRET"); } });
  assert.throws(() => validateStagingConfiguration(new Proxy({}, { getPrototypeOf() { throw thrown; } })), /invalid:root$/);
  const input = config(); const parsed = validateStagingConfiguration(input);
  input.database.password = "changed";
  assert.equal(parsed.database.password, "FAKE_TEST_PASSWORD_ONLY");
  for (const value of [parsed, parsed.database, parsed.publicAuth]) assert.equal(Object.isFrozen(value), true);
});

test("Node 24 is explicit in manifest/lock and enforced by seam", async () => {
  assertStagingNodeRuntime("24.18.0");
  for (const value of ["20.19.0", "22.18.0", "25.0.0", "24", "24.0.0-preview"]) {
    assert.throws(() => assertStagingNodeRuntime(value), /requires_node_24/);
  }
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(pkg.engines.node, "24.x"); assert.deepEqual(lock.packages[""].engines, pkg.engines);
});

test("lazy scope reuses one pool; exact conservative limits/TLS are enforced without option bypass", async () => {
  const db = database(); const scope = createStagingDependencyScope({ createPool: db.createPool });
  assert.equal(db.options.length, 0);
  const deps = scope.get(config()); assert.equal(db.connects, 0);
  assert.equal(scope.get(config()), deps); assert.equal(db.options.length, 1);
  const opts = db.options[0]; assert.equal(opts.max, 1); assert.deepEqual(opts.ssl, { rejectUnauthorized: true });
  assert.equal(opts.connectionTimeoutMillis, 5000); assert.equal(opts.query_timeout, 20000);
  assert.equal(opts.idleTimeoutMillis, 10000); assert.equal(opts.allowExitOnIdle, true);
  assert.equal(Object.hasOwn(opts, "connectionString"), false); assert.equal(Object.hasOwn(opts, "statement_timeout"), false);
  assert.equal(Object.hasOwn(deps, "pool"), false); assert.equal(Object.hasOwn(deps, "configuration"), false);
  db.listeners.get("error")(new Error("FAKE_PRIVATE_DIAGNOSTIC"));
  const changed = config(); changed.database.password = "FAKE_ROTATED";
  assert.throws(() => scope.get(changed), /changed_restart_required/);
  assert.throws(() => scope.get({ ...config(), enabled: false }), /invalid:enabled/);
  await scope.close(); assert.equal(db.ends, 1);
});

test("unchanged Unit 2E and 2F constructors use the same constructed bounded pool", async () => {
  const db = database(); const scope = createStagingDependencyScope({ createPool: db.createPool });
  const deps = scope.get(config());
  assert.deepEqual(await deps.store.getCurrent(otherSubject), { record: null, revision: null });
  assert.equal(await deps.authorization.getPrincipal(subject), null);
  assert.equal(db.connects, 2); assert.equal(db.options.length, 1);
  assert.match(db.queries[0].sql, /override_current/); assert.match(db.queries[1].sql, /admin_principals/);
  assert.deepEqual(db.releases, [false, false]); await scope.close();
});

test("authorized mutations preserve fresh authority/AAL2/trusted actor and request-local SDK sessions", async () => {
  const provider = authProvider(); let revoked = false;
  const db = database(async (sql, values) => ({ rows: sql.includes("admin_principals") ? [principal({
    authUserId: values[0], ...(revoked ? { status: "REVOKED", revokedAt: new Date(Date.now() - 1000).toISOString(),
      revokedBy: "fixture:owner" } : {}) })] : [] }));
  const scope = createStagingDependencyScope({ createPool: db.createPool, authFetch: provider.fetch });
  const c = config(); c.publicAuth.url = provider.url; const deps = scope.get(c);
  assert.equal((await deps.mutate(null, intent())).code, "unauthenticated"); assert.equal(db.connects, 0);
  assert.equal((await deps.mutate("not-a-jwt", intent())).code, "session_invalid"); assert.equal(db.connects, 0);
  assert.equal((await deps.mutate(provider.token(subject, "aal1"), intent())).code, "mfa_required");
  assert.equal(db.queries.some((q) => q.sql.startsWith("BEGIN")), false);
  const firstToken = provider.token(subject); const secondToken = provider.token(otherSubject);
  for (const [user, token] of [[subject, firstToken], [otherSubject, secondToken], [subject, firstToken]]) {
    const result = await deps.mutate(token, intent({ operationId: randomUUID() }));
    assert.equal(result.ok, true); assert.equal(result.event.actorId, `supabase-user:${user}`);
  }
  revoked = true; const before = db.queries.filter((q) => q.sql.startsWith("BEGIN")).length;
  assert.equal((await deps.mutate(firstToken, intent())).code, "admin_revoked");
  assert.equal(db.queries.filter((q) => q.sql.startsWith("BEGIN")).length, before);
  assert.equal(db.queries.filter((q) => q.sql.includes("admin_principals")).length, 5);
  for (const request of provider.requests) {
    assert.equal(request.options.cache, "no-store"); assert.equal(request.options.redirect, "error"); assert.ok(request.options.signal);
    assert.equal(new Headers(request.options.headers).get("apikey"), c.publicAuth.publishableKey);
  }
  const userRequests = provider.requests.filter((r) => r.url.endsWith("/user")); assert.equal(userRequests.length, 5);
  assert.equal(new Headers(userRequests[2].options.headers).get("authorization"), `Bearer ${secondToken}`);
  assert.equal(new Headers(userRequests[3].options.headers).get("authorization"), `Bearer ${firstToken}`);
  assert.equal(db.options.length, 1); await scope.close();
});

test("checkout deadline releases late clients and makes no automatic retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred(); const db = database(); db.setConnect(() => pending.promise);
  const scope = createStagingDependencyScope({ createPool: db.createPool }); const deps = scope.get(config());
  const read = assert.rejects(deps.store.getCurrent(otherSubject), /override_store_failure/);
  t.mock.timers.tick(STAGING_LIMITS.connectionMs + 1); await read;
  assert.equal(db.connects, 1); assert.equal(db.queries.length, 0);
  pending.resolve(db.client); await flush(); assert.deepEqual(db.releases, [true]); await scope.close();
});

test("connection failure is sanitized and preserves Unit 2E taxonomy without retry", async () => {
  const db = database(); db.setConnect(() => Promise.reject(Object.assign(new Error("FAKE_SECRET"), { code: "ECONNREFUSED" })));
  const scope = createStagingDependencyScope({ createPool: db.createPool }); const deps = scope.get(config());
  assert.deepEqual(await deps.store.mutateAtomically({}), { ok: false, code: "store_unavailable" });
  assert.equal(db.connects, 1); await scope.close();
});

test("query deadline destroys checked-out client; completion cannot release twice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const pending = deferred();
  const db = database(() => pending.promise); const scope = createStagingDependencyScope({ createPool: db.createPool });
  const deps = scope.get(config()); const read = assert.rejects(deps.authorization.getPrincipal(subject),
    (error) => error.message === "staging_database_query_failed" && error.code === "ETIMEDOUT");
  await flush(); assert.equal(db.queries.length, 1);
  t.mock.timers.tick(STAGING_LIMITS.queryMs + 1); await read;
  assert.deepEqual(db.releases, [true]); assert.equal(db.connects, 1);
  pending.resolve({ rows: [] }); await flush(); await scope.close(); assert.deepEqual(db.releases, [true]);
});

test("pg's earlier read timeout also retires the client; ordinary SQL errors retain rollback", async () => {
  const db = database(async () => { throw new Error("Query read timeout"); });
  const scope = createStagingDependencyScope({ createPool: db.createPool });
  await assert.rejects(scope.get(config()).authorization.getPrincipal(subject),
    (error) => error.message === "staging_database_timeout" && error.code === "ETIMEDOUT");
  assert.deepEqual(db.releases, [true]); await scope.close();
  const ordinary = database(async (sql) => {
    if (sql.includes("override_receipts")) throw Object.assign(new Error("fake constraint"), { code: "23514" });
    return { rows: [] };
  });
  const next = createStagingDependencyScope({ createPool: ordinary.createPool });
  assert.deepEqual(await next.get(config()).store.mutateAtomically({ operationId: "fake" }), { ok: false, code: "store_failure" });
  assert.equal(ordinary.queries.at(-1).sql, "ROLLBACK"); assert.deepEqual(ordinary.releases, [false]);
  assert.equal(ordinary.connects, 1); await next.close();
});

test("query/construction diagnostics omit raw database secrets without changing SQL error codes", async () => {
  const construction = createStagingDependencyScope({ createPool() { throw new Error("FAKE_TEST_PASSWORD_ONLY"); } });
  assert.throws(() => construction.get(config()), /^Error: staging_pool_construction_failed$/);
  const db = database(async () => { throw Object.assign(new Error("FAKE_TEST_PASSWORD_ONLY"), { code: "23514" }); });
  const scope = createStagingDependencyScope({ createPool: db.createPool });
  await assert.rejects(scope.get(config()).authorization.getPrincipal(subject),
    (error) => error.message === "staging_database_query_failed" && error.code === "23514");
  assert.deepEqual(db.releases, [false]); await scope.close();
});

test("close is bounded/idempotent, destroys active leases and prevents reuse", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const query = deferred(); const db = database(() => query.promise); db.setEnd(() => new Promise(() => {}));
  const scope = createStagingDependencyScope({ createPool: db.createPool }); const deps = scope.get(config());
  const read = assert.rejects(deps.store.getCurrent(otherSubject), /override_store_failure/); await flush();
  const closing = scope.close(); const failed = assert.rejects(closing, /staging_pool_shutdown_failed/);
  assert.equal(scope.close(), closing); assert.deepEqual(db.releases, [true]);
  t.mock.timers.tick(STAGING_LIMITS.shutdownMs + 1); await failed; assert.equal(db.ends, 1);
  assert.throws(() => scope.get(config()), /dependencies_closed/);
  query.resolve({ rows: [] }); await read;
  // The completed read has no secret/config output and cannot return its retired client twice.
  assert.deepEqual(db.releases, [true]);
});

test("close before checkout completion retires that client without leaking or reopening", async () => {
  const pending = deferred(); const db = database(); db.setConnect(() => pending.promise);
  const scope = createStagingDependencyScope({ createPool: db.createPool }); const deps = scope.get(config());
  const read = assert.rejects(deps.store.getCurrent(otherSubject), /override_store_failure/);
  await scope.close(); pending.resolve(db.client); await read;
  assert.deepEqual(db.releases, [true]); assert.equal(db.queries.length, 0);
});

test("module-scope entry point fails closed; privileged modules reject browser imports", async () => {
  assert.throws(() => getStagingDependencies(undefined), /staging_configuration_invalid/);
  const source = await readFile("lib/staging/dependencies.ts", "utf8");
  assert.match(source, /const stagingScope = createStagingDependencyScope\(\)/);
  assert.match(source, /stagingScope\.get\(configuration\)/);
  for (const path of ["lib/staging/config.ts", "lib/staging/dependencies.ts"]) {
    const code = await readFile(path, "utf8"); assert.match(code, /^import "server-only";/);
    assert.doesNotMatch(code, /NEXT_PUBLIC_|use client|use server|process\.env|console\./);
    const result = spawnSync(process.execPath, ["--import", "./tests/server-only-loader.mjs", "--input-type=module",
      "--eval", `await import('./${path}')`], { encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /cannot be imported from a Client Component/);
  }
});
