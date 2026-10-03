import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve, relative } from "node:path";
import test from "node:test";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { verifyAdminIdentity } from "../lib/auth/admin-auth.ts";
import { createPostgresAdminAuthorizationReader, checkCurrentAdminAuthorization } from "../lib/auth/admin-authorization.ts";
import { createAuthorizedEmergencyOverrideMutator } from "../lib/auth/authorized-emergency-override.ts";
import { createPostgresEmergencyOverrideStore } from "../lib/erp/postgres-emergency-override-store.ts";
import { now, subject, otherSubject, verifier, principal, intent } from "./helpers/admin-auth-fixtures.mjs";
import { createDatabaseReadinessProbe } from "../lib/staging/database-readiness.ts";

async function freePort() {
  const probe = createServer();
  await new Promise((done, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", done); });
  const port = probe.address().port;
  await new Promise((done, reject) => probe.close((error) => error ? reject(error) : done()));
  return port;
}

test("Unit 2F private authority / self-grant / Unit 2E seam on real PostgreSQL", { timeout: 180000 }, async (t) => {
  const cacheRoot = resolve("node_modules/.cache"); await mkdir(cacheRoot, { recursive: true });
  const clusterDir = await mkdtemp(join(cacheRoot, "hanapure-unit2f-"));
  const password = randomBytes(24).toString("hex"); const port = await freePort();
  const config = { host: "127.0.0.1", port, user: "postgres", password, database: "postgres",
    connectionTimeoutMillis: 5000, statement_timeout: 10000, max: 1 };
  let cluster; let owner; let runtime; let unprivileged; let started = false;
  try {
    cluster = new EmbeddedPostgres({ databaseDir: clusterDir, user: "postgres", password, port,
      authMethod: "scram-sha-256", persistent: true, createPostgresUser: false,
      initdbFlags: ["--encoding=UTF8"], postgresFlags: ["-h", "127.0.0.1"], onLog() {}, onError() {} });
    await cluster.initialise(); await cluster.start(); started = true;
    owner = new pg.Client(config); await owner.connect();
    t.diagnostic((await owner.query("SELECT version() AS version")).rows[0].version);
    await owner.query(await readFile("supabase/migrations/20260930120000_emergency_override_persistence.sql", "utf8"));
    await owner.query(await readFile("supabase/migrations/20261001120000_admin_authorization_foundation.sql", "utf8"));
    await owner.query(`CREATE ROLE unit2f_runtime LOGIN PASSWORD '${password}' IN ROLE hanapure_override_runtime`);
    await owner.query(`CREATE ROLE unit2f_unprivileged LOGIN PASSWORD '${password}'`);
    runtime = new pg.Pool({ ...config, user: "unit2f_runtime" });
    unprivileged = new pg.Pool({ ...config, user: "unit2f_unprivileged" });
    const reader = createPostgresAdminAuthorizationReader(runtime);
    const verified = (await verifyAdminIdentity(verifier(), "token", now)).identity;
    const grant = async (id = subject) => owner.query(`INSERT INTO hanapure_private.admin_principals
      (auth_user_id, permission, status, granted_at, granted_by) VALUES ($1,'emergency_override:mutate','ACTIVE',$2,$3)`,
      [id, principal().grantedAt, principal().grantedBy]);
    const revoke = async () => owner.query(`UPDATE hanapure_private.admin_principals SET status='REVOKED',
      revoked_at=$2, revoked_by='owner:fixture' WHERE auth_user_id=$1`, [subject, new Date(now - 1).toISOString()]);
    const counts = async () => (await owner.query(`SELECT
      (SELECT count(*)::text FROM hanapure_private.override_current) AS states,
      (SELECT count(*)::text FROM hanapure_private.override_audit) AS events,
      (SELECT count(*)::text FROM hanapure_private.override_receipts) AS receipts`)).rows[0];

    await t.test("Gate B2 catalog verifier passes restricted runtime and does not read/write business state", async () => {
      const before = await counts();
      assert.equal(await createDatabaseReadinessProbe(runtime)(), "ready");
      assert.equal(await createDatabaseReadinessProbe(ownerPool(owner))(), "permissions_mismatch");
      assert.equal(await createDatabaseReadinessProbe(unprivileged)(), "permissions_mismatch");
      assert.deepEqual(await counts(), before);
    });

    await t.test("Gate B2 rejects column grants and NOINHERIT membership capable of self-granting authority", async () => {
      const probe = createDatabaseReadinessProbe(runtime);
      await owner.query("GRANT UPDATE(status) ON hanapure_private.admin_principals TO unit2f_runtime");
      try { assert.equal(await probe(), "permissions_mismatch"); }
      finally { await owner.query("REVOKE UPDATE(status) ON hanapure_private.admin_principals FROM unit2f_runtime"); }
      await owner.query("CREATE ROLE unit2f_authority_writer NOLOGIN");
      await owner.query("GRANT INSERT ON hanapure_private.admin_principals TO unit2f_authority_writer");
      await owner.query("GRANT unit2f_authority_writer TO unit2f_runtime WITH INHERIT FALSE, SET TRUE");
      try { assert.equal(await probe(), "permissions_mismatch"); }
      finally { await owner.query("REVOKE unit2f_authority_writer FROM unit2f_runtime"); }
      assert.equal(await probe(), "ready");
    });

    await t.test("Gate B2 missing integrity trigger is schema mismatch and verifier does not repair", async () => {
      const probe = createDatabaseReadinessProbe(runtime);
      await owner.query("ALTER TABLE hanapure_private.override_audit DISABLE TRIGGER immutable_override_audit");
      try {
        assert.equal(await probe(), "schema_mismatch");
        assert.equal((await owner.query("SELECT tgenabled FROM pg_trigger WHERE tgname='immutable_override_audit'")).rows[0].tgenabled, "D");
      } finally { await owner.query("ALTER TABLE hanapure_private.override_audit ENABLE TRIGGER immutable_override_audit"); }
      assert.equal(await probe(), "ready");
    });

    await t.test("fresh lookup reflects owner grant and revoke without cached JWT permissions", async () => {
      assert.equal((await checkCurrentAdminAuthorization(verified, reader, now)).code, "forbidden");
      await grant();
      assert.deepEqual(await reader.getPrincipal(subject), principal());
      assert.deepEqual(await checkCurrentAdminAuthorization(verified, reader, now), { ok: true });
      await revoke();
      assert.equal((await checkCurrentAdminAuthorization(verified, reader, now)).code, "admin_revoked");
    });

    await t.test("ordinary runtime cannot INSERT, UPDATE, DELETE, TRUNCATE, own or self-grant authority", async () => {
      const attacks = [
        ["INSERT INTO hanapure_private.admin_principals (auth_user_id,permission,status,granted_at,granted_by) VALUES ($1,'emergency_override:mutate','ACTIVE',now(),'self')", [otherSubject]],
        ["UPDATE hanapure_private.admin_principals SET status='ACTIVE',revoked_at=NULL,revoked_by=NULL WHERE auth_user_id=$1", [subject]],
        ["DELETE FROM hanapure_private.admin_principals WHERE auth_user_id=$1", [subject]],
        ["TRUNCATE hanapure_private.admin_principals", undefined],
        ["ALTER TABLE hanapure_private.admin_principals OWNER TO unit2f_runtime", undefined],
      ];
      for (const [sql, params] of attacks) await assert.rejects(runtime.query(sql, params), { code: "42501" });
      // PostgreSQL may emit a warning/no-op rather than an error for a GRANT
      // without grant option. Verify the effective privilege remains denied.
      try { await runtime.query("GRANT INSERT ON hanapure_private.admin_principals TO hanapure_override_runtime"); }
      catch (error) { assert.equal(error.code, "42501"); }
      await assert.rejects(runtime.query("INSERT INTO hanapure_private.admin_principals (auth_user_id,permission,status,granted_at,granted_by) VALUES ($1,'emergency_override:mutate','ACTIVE',now(),'self')", [otherSubject]), { code: "42501" });
      await assert.rejects(runtime.query("ALTER ROLE unit2f_runtime SUPERUSER"), { code: "42501" });
      await assert.rejects(runtime.query("SET ROLE postgres"), { code: "42501" });
      assert.equal((await reader.getPrincipal(subject)).status, "REVOKED");
      assert.equal(await reader.getPrincipal(otherSubject), null);
      const privileges = await runtime.query(`SELECT has_table_privilege(current_user,'hanapure_private.admin_principals','SELECT') AS read,
        has_table_privilege(current_user,'hanapure_private.admin_principals','INSERT,UPDATE,DELETE,TRUNCATE') AS write`);
      assert.deepEqual(privileges.rows[0], { read: true, write: false });
    });

    await t.test("unauthenticated/non-admin/revoked/AAL1 failures reach real Unit 2E store zero times", async () => {
      let calls = 0;
      const rawStore = createPostgresEmergencyOverrideStore(runtime);
      const store = { getCurrent: rawStore.getCurrent, async mutateAtomically(command) { calls++; return rawStore.mutateAtomically(command); } };
      const run = (check = verifier(), lookup = reader) => createAuthorizedEmergencyOverrideMutator({ verifier: check,
        authorization: lookup, store, clock: () => now });
      assert.equal((await run()(undefined, intent())).code, "unauthenticated");
      assert.equal((await run()({ user: { id: subject }, aal: "aal2" }, intent())).code, "session_invalid");
      assert.equal((await run()("token", intent())).code, "admin_revoked");
      assert.equal((await run(verifier({ subject: otherSubject }))("token", intent())).code, "forbidden");
      await owner.query("UPDATE hanapure_private.admin_principals SET status='ACTIVE',revoked_at=NULL,revoked_by=NULL WHERE auth_user_id=$1", [subject]);
      assert.equal((await run(verifier({ assurance: "aal1" }))("token", intent())).code, "mfa_required");
      const noPermission = createPostgresAdminAuthorizationReader(unprivileged);
      assert.equal((await run(verifier(), noPermission)("token", intent())).code, "authorization_unavailable");
      assert.equal(calls, 0); assert.deepEqual(await counts(), { states: "0", events: "0", receipts: "0" });
    });

    await t.test("authorized flow persists trusted actor; revocation blocks same-operation replay", async () => {
      let calls = 0;
      const rawStore = createPostgresEmergencyOverrideStore(runtime);
      const store = { getCurrent: rawStore.getCurrent, async mutateAtomically(command) { calls++; return rawStore.mutateAtomically(command); } };
      const run = createAuthorizedEmergencyOverrideMutator({ verifier: verifier(), authorization: reader, store, clock: () => now });
      const input = intent({ operationId: randomUUID() });
      const result = await run("token", input);
      assert.equal(result.ok, true); assert.equal(calls, 1);
      assert.equal(result.event.actorId, `supabase-user:${subject}`);
      assert.equal(result.event.at, new Date(now).toISOString());
      assert.deepEqual(await counts(), { states: "1", events: "1", receipts: "1" });
      assert.deepEqual(await run("token", input), result); assert.equal(calls, 2);
      await revoke();
      assert.equal((await run("token", input)).code, "admin_revoked"); assert.equal(calls, 2);
      assert.deepEqual(await counts(), { states: "1", events: "1", receipts: "1" });
    });

    await t.test("DB integrity forbids invalid permission and contradictory revoke metadata", async () => {
      await assert.rejects(owner.query("UPDATE hanapure_private.admin_principals SET permission='super_admin' WHERE auth_user_id=$1", [subject]), { code: "23514" });
      await assert.rejects(owner.query("UPDATE hanapure_private.admin_principals SET revoked_at=NULL WHERE auth_user_id=$1", [subject]), { code: "23514" });
      assert.equal((await reader.getPrincipal(subject)).status, "REVOKED");
    });
  } finally {
    await Promise.allSettled([runtime?.end(), unprivileged?.end()]); await owner?.end();
    if (started) await cluster.stop();
    const suffix = relative(cacheRoot, clusterDir);
    assert.ok(suffix.startsWith("hanapure-unit2f-") && !suffix.includes("..") && !suffix.includes("/") && !suffix.includes("\\"));
    await rm(clusterDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

// The owner is supplied for a read-only negative verifier test; its connection is not owned by the probe.
function ownerPool(client) { return { async connect() { return { query: client.query.bind(client), release() {} }; } }; }
