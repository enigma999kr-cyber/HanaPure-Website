import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { classifyDatabaseSnapshot, createDatabaseReadinessProbe, READINESS_SQL } from "../lib/staging/database-readiness.ts";
import { readStagingRuntimeConfiguration } from "../lib/staging/runtime.ts";
import { createStagingDependencyScope } from "../lib/staging/dependencies.ts";

const env = () => ({ HANAPURE_STAGING_ENABLED: "true", HANAPURE_ENVIRONMENT: "staging",
  NEXT_RUNTIME: "nodejs", HANAPURE_STAGING_DB_HOST: "pooler.fake.invalid", HANAPURE_STAGING_DB_PORT: "6543",
  HANAPURE_STAGING_DB_NAME: "hanapure_staging", HANAPURE_STAGING_DB_USER: "hanapure_runtime.fake",
  HANAPURE_STAGING_DB_PASSWORD: "FAKE_PASSWORD_ONLY", HANAPURE_STAGING_AUTH_URL: "https://auth.fake.invalid",
  HANAPURE_STAGING_AUTH_PUBLISHABLE_KEY: "sb_publishable_FAKE_ONLY" });

function snapshot() {
  const columns = [
    ["public_id:text:true", "revision:numeric:true", "record:jsonb:true", "created_at:timestamp(3) with time zone:true", "expires_at:timestamp(3) with time zone:false", "revoked_at:timestamp(3) with time zone:false"],
    ["public_id:text:true", "revision:numeric:true", "operation_id:text:true", "previous_revision:numeric:false", "occurred_at:timestamp(3) with time zone:true", "event:jsonb:true"],
    ["operation_id:text:true", "public_id:text:true", "revision:numeric:true", "semantic_payload:jsonb:true", "result:jsonb:true"],
    ["auth_user_id:uuid:true", "permission:text:true", "status:text:true", "granted_at:timestamp(3) with time zone:true", "granted_by:text:true", "revoked_at:timestamp(3) with time zone:false", "revoked_by:text:false"],
  ];
  const names = ["override_current", "override_audit", "override_receipts", "admin_principals"];
  const primary = ["public_id", "public_id, revision", "operation_id", "auth_user_id"];
  const fks = [
    ["current_has_audit", "FOREIGN KEY (public_id, revision) REFERENCES hanapure_private.override_audit(public_id, revision) DEFERRABLE INITIALLY DEFERRED"],
    ["audit_has_receipt", "FOREIGN KEY (operation_id) REFERENCES hanapure_private.override_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED"],
    ["receipt_has_audit", "FOREIGN KEY (operation_id, public_id, revision) REFERENCES hanapure_private.override_audit(operation_id, public_id, revision) DEFERRABLE INITIALLY DEFERRED"],
  ];
  const allowed = [["SELECT", "INSERT", "UPDATE"], ["SELECT", "INSERT"], ["SELECT", "INSERT"], ["SELECT"]];
  return { schema: { exists: true, usage: true, create: false, owner: false, publicAccess: false }, roleSafe: true,
    tables: names.map((name, i) => ({ name, kind: "r", rls: false, plainColumns: true, identityCollation: true, owner: false, publicAccess: false, grantOption: false,
      columns: columns[i],
      constraints: [{ type: "p", valid: true, definition: `PRIMARY KEY (${primary[i]})` },
        ...Array.from({ length: [6, 7, 7, 4][i] }, () => ({ type: "c", valid: true, definition: "CHECK (fixture)" })),
        ...(i === 1 ? ["operation_id", "operation_id, public_id, revision"].map((key) => ({ type: "u", valid: true, definition: `UNIQUE (${key})` })) : []),
        ...(i < 3 ? [{ type: "f", name: fks[i][0], definition: fks[i][1], valid: true }] : [])],
      triggers: i === 1 || i === 2 ? [{ name: `immutable_${name}`, type: 58, enabled: "O", function: "reject_history_mutation" }] : [],
      privileges: Object.fromEntries(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].map((p) => [p, allowed[i].includes(p)])),
      columnPrivileges: Object.fromEntries(["SELECT", "INSERT", "UPDATE", "REFERENCES"].map((p) => [p, allowed[i].includes(p)])) })),
    functions: [{ name: "reject_history_mutation", args: 0, result: "trigger", language: "plpgsql", securityDefiner: false,
      config: ["search_path=pg_catalog"], body: "BEGIN RAISE EXCEPTION 'override history is append-only' USING ERRCODE = '55000'; END",
      executable: false, publicAccess: false, owner: false }] };
}

const run = (code, environment = {}) => {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) if (key.startsWith("HANAPURE_") || ["VERCEL_ENV", "VERCEL_TARGET_ENV", "NEXT_RUNTIME"].includes(key)) delete clean[key];
  return spawnSync(process.execPath, ["--conditions=react-server", "--import", "./tests/server-only-loader.mjs", "--input-type=module", "--eval", code],
    { encoding: "utf8", windowsHide: true, timeout: 10000, env: { ...clean, ...environment } });
};
const protectedPath = "docs/HanaPure_Website_Secure_Connectivity_Readiness_Audit.md";
const protectedBefore = await stat(protectedPath);

test("runtime configuration is disabled by default and fails closed for non-staging/Edge/unsafe config", () => {
  assert.throws(() => readStagingRuntimeConfiguration({}), /staging_disabled/);
  for (const change of [{ HANAPURE_STAGING_ENABLED: "false" }, { HANAPURE_ENVIRONMENT: "production" }, { NEXT_RUNTIME: "edge" },
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: "preview" }, { VERCEL_TARGET_ENV: "preview" },
    { HANAPURE_STAGING_DB_PORT: "6543garbage" }, { HANAPURE_STAGING_DB_PASSWORD: "" },
    { HANAPURE_STAGING_AUTH_PUBLISHABLE_KEY: "sb_secret_FAKE_ONLY" }]) {
    assert.throws(() => readStagingRuntimeConfiguration({ ...env(), ...change }), (error) => {
      assert.doesNotMatch(error.message, /FAKE_PASSWORD|sb_secret|6543garbage/); return true;
    });
  }
  assert.equal(readStagingRuntimeConfiguration(env()).database.port, 6543);
  assert.equal(readStagingRuntimeConfiguration({ ...env(), VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" }).environment, "staging");
});

test("disabled/malformed readiness and smoke output only fixed statuses without connection or mutation", () => {
  for (const [environment, configuration] of [[{}, "disabled"], [{ ...env(), VERCEL_ENV: "production" }, "invalid"],
    [{ ...env(), HANAPURE_STAGING_DB_PASSWORD: "" }, "invalid"]]) {
    const result = run("await import('./scripts/staging-smoke.mjs')", environment);
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), { configuration, database: "not_checked", auth: "not_checked" });
    assert.doesNotMatch(result.stdout, /FAKE_PASSWORD|Error|stack|SELECT|token|\\Users/);
  }
});

test("structural schema/constraints/triggers/function mismatch cannot report ready", () => {
  assert.equal(classifyDatabaseSnapshot(snapshot()), "ready");
  for (const value of [undefined, {}, { schema: { exists: false }, tables: [], functions: [] }]) assert.equal(classifyDatabaseSnapshot(value), "schema_mismatch");
  const changes = [
    (s) => s.tables.pop(), (s) => s.tables.push(s.tables[0]), (s) => { s.tables[0].columns[1] = "revision:text:true"; },
    (s) => { s.tables[0].identityCollation = false; }, (s) => { s.tables[0].plainColumns = false; },
    (s) => { s.tables[0].rls = true; }, (s) => { s.tables[0].constraints[0].valid = false; },
    (s) => s.tables[0].constraints.pop(), (s) => { s.tables[0].constraints.at(-1).definition = "NOT DEFERRED"; },
    (s) => { s.tables[1].triggers[0].enabled = "D"; }, (s) => { s.tables[1].triggers[0].type = 9; },
    (s) => { s.functions[0].securityDefiner = true; }, (s) => { s.functions[0].body = "BEGIN RETURN NULL; END"; },
    (s) => { s.functions[0].config = ["search_path=public"]; },
  ];
  for (const change of changes) { const s = snapshot(); change(s); assert.equal(classifyDatabaseSnapshot(s), "schema_mismatch"); }
});

test("missing/excess/table-column/PUBLIC/grant-option/ownership/role privileges fail closed", () => {
  const changes = [
    (s) => { s.tables[0].privileges.SELECT = false; }, (s) => { s.tables[3].privileges.INSERT = true; },
    (s) => { s.tables[3].columnPrivileges.UPDATE = true; }, (s) => { s.tables[1].privileges.DELETE = true; },
    (s) => { s.tables[1].grantOption = true; }, (s) => { s.tables[0].publicAccess = true; },
    (s) => { s.tables[0].owner = true; }, (s) => { s.roleSafe = false; }, (s) => { s.schema.create = true; },
    (s) => { s.schema.publicAccess = true; }, (s) => { s.functions[0].executable = true; }, (s) => { s.functions[0].owner = true; },
  ];
  for (const change of changes) { const s = snapshot(); change(s); assert.equal(classifyDatabaseSnapshot(s), "permissions_mismatch"); }
});

test("probe is one unnamed read-only catalog SELECT, releases lease and never repairs/retries", async () => {
  const queries = []; let connects = 0; let releases = 0;
  const probe = createDatabaseReadinessProbe({ async connect() { connects++; return {
    async query(sql, values) { queries.push({ sql, values }); return { rows: [{ snapshot: snapshot() }] }; }, release() { releases++; } }; } });
  assert.equal(await probe(), "ready"); assert.equal(connects, 1); assert.equal(releases, 1); assert.equal(queries.length, 1);
  assert.equal(queries[0].sql, READINESS_SQL); assert.deepEqual(queries[0].values[0], "hanapure_private");
  assert.match(READINESS_SQL, /^WITH /);
  const executableSQL = READINESS_SQL.replace(/'(?:''|[^'])*'/g, "''");
  assert.doesNotMatch(executableSQL, /\b(INSERT INTO|UPDATE \w|DELETE FROM|CREATE ROLE|GRANT |REVOKE |ALTER |DROP |TRUNCATE |SET ROLE|SET SESSION)\b/i);
  const failed = createDatabaseReadinessProbe({ async connect() { connects++; throw new Error("FAKE_PASSWORD_ONLY stack path"); } });
  assert.equal(await failed(), "database_unavailable"); assert.equal(connects, 2);
});

test("probe inherits B1 query deadline, retires timed-out client and returns minimal unavailable status", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let connects = 0; const releases = [];
  const scope = createStagingDependencyScope({ createPool: () => ({ on() {}, end: async () => {},
    connect: async () => { connects++; return { query: () => new Promise(() => {}), release: (destroy) => releases.push(destroy) }; } }) });
  const result = scope.get(readStagingRuntimeConfiguration(env())).probeDatabase();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  t.mock.timers.tick(20001); assert.equal(await result, "database_unavailable");
  assert.equal(connects, 1); assert.deepEqual(releases, [true]); await scope.close();
});

test("real module runtime wiring reuses B1 singleton and construction-only Auth without session/network", () => {
  const fakeModule = `export class Pool { constructor(options) { globalThis.poolCount=(globalThis.poolCount||0)+1;
    if(options.max!==1||options.ssl.rejectUnauthorized!==true)throw Error('unsafe options'); }
    on() {} end() { return Promise.resolve(); } connect() { return Promise.resolve({
      query(sql) { globalThis.queryCount=(globalThis.queryCount||0)+1; if(!sql.startsWith('WITH '))throw Error('unexpected business SQL');
        return Promise.resolve({rows:[{snapshot:${JSON.stringify(snapshot())}}]}); }, release() {} }); } }`;
  const code = `import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,n){
    if(s==='pg')return {url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(fakeModule)}`)},shortCircuit:true};return n(s,c);}});
    globalThis.fetch=()=>{throw Error('unexpected Auth network');};
    const {getStagingRuntimeDependencies}=await import('./lib/staging/runtime.ts');
    const {checkStagingReadiness}=await import('./lib/staging/readiness.ts');
    const before=globalThis.poolCount||0; const first=getStagingRuntimeDependencies();
    const second=getStagingRuntimeDependencies(); const results=[await checkStagingReadiness(),await checkStagingReadiness()];
    console.log(JSON.stringify({before,pools:globalThis.poolCount,queries:globalThis.queryCount,same:first===second,results}));`;
  const result = run(code, env()); assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout); assert.equal(output.before, 0); assert.equal(output.pools, 1);
  assert.equal(output.queries, 2); assert.equal(output.same, true);
  assert.deepEqual(output.results, Array(2).fill({ configuration: "ready", database: "ready", auth: "configured_not_verified" }));
});

test("all B2 privileged modules reject client imports and no public route/mutation surface is introduced", async () => {
  for (const file of ["lib/staging/runtime.ts", "lib/staging/readiness.ts", "lib/staging/database-readiness.ts"]) {
    const source = await readFile(file, "utf8"); assert.match(source, /^import "server-only";/);
    assert.doesNotMatch(source, /['"]use (client|server)['"]|console\.|NEXT_PUBLIC_/);
    const result = spawnSync(process.execPath, ["--import", "./tests/server-only-loader.mjs", "--input-type=module", "--eval", `await import('./${file}')`],
      { encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /cannot be imported from a Client Component/);
  }
  const source = await readFile("lib/staging/readiness.ts", "utf8");
  assert.doesNotMatch(source, /mutateAtomically|\.mutate\(|\.verify\(|accessToken/);
});

test("protected audit file remains untracked/unstaged and metadata unchanged during B2 tests", async () => {
  const after = await stat(protectedPath); assert.equal(after.size, protectedBefore.size); assert.equal(after.mtimeMs, protectedBefore.mtimeMs);
  const state = spawnSync("git", ["status", "--short", "--", protectedPath], { encoding: "utf8", windowsHide: true });
  assert.equal(state.status, 0); assert.equal(state.stdout.trim(), `?? ${protectedPath}`);
});
