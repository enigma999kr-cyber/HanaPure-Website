import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve, relative } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { createPostgresEmergencyOverrideStore } from "../lib/erp/postgres-emergency-override-store.ts";
import { decideOverrideMutation, mutateEmergencyOverride } from "../lib/erp/emergency-override-mutations.ts";
import { readEffectiveOperationalState } from "../lib/erp/effective-operational-state.ts";

const { Pool, Client } = pg;
const at = "2026-09-30T10:00:00.123Z";
const later = "2026-09-30T11:00:00.456Z";
const expiry = "2026-09-30T12:00:00.789Z";
const context = (time = at) => ({ actorId: "local-test-operator", clock: () => time });
const request = (publicId = randomUUID(), changes = {}) => ({
  publicId, operationId: randomUUID(), action: "CREATE", expectedRevision: null,
  mode: "SALES_PAUSED", reason: "Local integration incident", expiresAt: expiry, ...changes,
});
const replace = (first, changes = {}) => request(first.publicId, {
  action: "REPLACE", expectedRevision: "1", mode: "FORCE_OUT_OF_STOCK", ...changes,
});
const mutate = (store, input, time = at) => mutateEmergencyOverride(store, input, context(time));

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

/** Test-only executor wrappers: no fault hooks are shipped in production. */
function faultPool(pool, point) {
  return { async connect() {
    const client = await pool.connect();
    return {
      async query(sql, values) {
        if (point === "before_commit" && sql === "COMMIT") throw new Error("test fault before commit");
        const result = await client.query(sql, values);
        if ((point === "after_state" && sql.includes("INSERT INTO hanapure_private.override_current")) ||
          (point === "after_audit" && sql.includes("INSERT INTO hanapure_private.override_audit"))) {
          throw new Error("test fault after write");
        }
        return result;
      },
      release: (destroy) => client.release(destroy),
    };
  } };
}

async function childReconnect(config, input) {
  // Credentials stay in this isolated test process's stdin, never shell arguments.
  const code = `
    import pg from 'pg';
    import { createPostgresEmergencyOverrideStore } from './lib/erp/postgres-emergency-override-store.ts';
    import { mutateEmergencyOverride } from './lib/erp/emergency-override-mutations.ts';
    let text = ''; for await (const chunk of process.stdin) text += chunk;
    const { config, input } = JSON.parse(text);
    const pool = new pg.Pool(config);
    try {
      const store = createPostgresEmergencyOverrideStore(pool);
      const replay = await mutateEmergencyOverride(store, input, {
        actorId: 'local-test-operator', clock: () => '2026-10-01T10:00:00.000Z',
      });
      const current = await store.getCurrent(input.publicId);
      const audit = await pool.query('SELECT count(*)::text AS n FROM hanapure_private.override_audit WHERE public_id=$1', [input.publicId]);
      const receipt = await pool.query('SELECT count(*)::text AS n FROM hanapure_private.override_receipts WHERE operation_id=$1', [input.operationId]);
      process.stdout.write(JSON.stringify({ replay, current, audit: audit.rows[0].n, receipt: receipt.rows[0].n }));
    } finally { await pool.end(); }
  `;
  const child = spawn(process.execPath, ["--conditions=react-server", "--import", "./tests/server-only-loader.mjs",
    "--input-type=module", "--eval", code], { cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ config, input }));
  const status = await new Promise((resolveExit, reject) => {
    child.once("error", reject); child.once("close", resolveExit);
  });
  assert.equal(status, 0, stderr);
  return JSON.parse(stdout);
}

test("Unit 2E real isolated PostgreSQL integration", { timeout: 180000 }, async (t) => {
  // A new localhost-only cluster per run. No env URL, remote DB, or existing data.
  const cacheRoot = resolve("node_modules/.cache");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(cacheRoot, { recursive: true });
  const clusterDir = await mkdtemp(join(cacheRoot, "hanapure-unit2e-"));
  const password = randomBytes(24).toString("hex");
  const port = await freePort();
  let cluster;
  const makeCluster = () => new EmbeddedPostgres({
    databaseDir: clusterDir, user: "postgres", password, port, authMethod: "scram-sha-256",
    persistent: true, createPostgresUser: false, initdbFlags: ["--encoding=UTF8"],
    postgresFlags: ["-h", "127.0.0.1"], onLog() {}, onError() {},
  });
  const ownerConfig = { host: "127.0.0.1", port, user: "postgres", password, database: "postgres",
    connectionTimeoutMillis: 5000, statement_timeout: 10000, max: 1 };
  const runtimeConfig = { ...ownerConfig, user: "unit2e_operator" };
  let owner;
  let started = false;
  const pools = new Set();
  const pool = (config = runtimeConfig) => { const value = new Pool(config); pools.add(value); return value; };
  const close = async (value) => { await value.end(); pools.delete(value); };
  const counts = async (publicId) => {
    const result = await owner.query(`SELECT
      (SELECT count(*)::text FROM hanapure_private.override_current WHERE public_id=$1) AS state,
      (SELECT count(*)::text FROM hanapure_private.override_audit WHERE public_id=$1) AS audit,
      (SELECT count(*)::text FROM hanapure_private.override_receipts WHERE public_id=$1) AS receipt`, [publicId]);
    return result.rows[0];
  };
  try {
    cluster = makeCluster();
    await cluster.initialise();
    await cluster.start(); started = true;
    owner = new Client(ownerConfig); await owner.connect();
    t.diagnostic((await owner.query("SELECT version() AS version")).rows[0].version);
    const migration = await readFile(new URL("../supabase/migrations/20260930120000_emergency_override_persistence.sql", import.meta.url), "utf8");
    await owner.query(migration);
    // Local ephemeral login roles only. Hex test password cannot inject SQL.
    await owner.query(`CREATE ROLE unit2e_operator LOGIN PASSWORD '${password}' IN ROLE hanapure_override_runtime`);
    await owner.query(`CREATE ROLE unit2e_unprivileged LOGIN PASSWORD '${password}'`);
    const runtimePool = pool();
    const store = createPostgresEmergencyOverrideStore(runtimePool);

    await t.test("create/replace/revoke persist exact state, audit and receipt metadata", async () => {
      const input = request();
      const created = await mutate(store, input);
      assert.equal(created.ok, true);
      assert.equal(created.revision, "1");
      const changed = await mutate(store, replace(input), later);
      assert.equal(changed.revision, "2");
      const revoked = await mutate(store, request(input.publicId, { action: "REVOKE", mode: undefined,
        expiresAt: undefined, expectedRevision: "2", reason: "resolved" }), later);
      assert.equal(revoked.revision, "3");
      const current = await store.getCurrent(input.publicId);
      assert.deepEqual(current, { record: revoked.event.after, revision: "3" });
      const audit = await runtimePool.query("SELECT event FROM hanapure_private.override_audit WHERE public_id=$1 ORDER BY revision", [input.publicId]);
      assert.deepEqual(audit.rows.map((row) => row.event), [created.event, changed.event, revoked.event]);
      assert.deepEqual(await counts(input.publicId), { state: "1", audit: "3", receipt: "3" });
      const times = await runtimePool.query("SELECT created_at, expires_at, revoked_at FROM hanapure_private.override_current WHERE public_id=$1", [input.publicId]);
      assert.equal(times.rows[0].created_at.toISOString(), later);
      assert.equal(times.rows[0].expires_at.toISOString(), expiry);
      assert.equal(times.rows[0].revoked_at.toISOString(), later);
    });

    await t.test("stale replace and stale revoke fail with no history writes", async () => {
      const input = request();
      await mutate(store, input);
      await mutate(store, replace(input));
      assert.equal((await mutate(store, replace(input))).code, "conflict");
      assert.equal((await mutate(store, request(input.publicId, {
        action: "REVOKE", mode: undefined, expiresAt: undefined, expectedRevision: "1",
      }))).code, "conflict");
      assert.equal((await store.getCurrent(input.publicId)).revision, "2");
      assert.deepEqual(await counts(input.publicId), { state: "1", audit: "2", receipt: "2" });
    });

    // Two independently checked-out physical connections for every race.
    async function race(first, second) {
      const left = pool(); const right = pool();
      try {
        const pids = await Promise.all([left.query("SELECT pg_backend_pid() AS pid"), right.query("SELECT pg_backend_pid() AS pid")]);
        assert.notEqual(pids[0].rows[0].pid, pids[1].rows[0].pid);
        return await Promise.all([mutate(createPostgresEmergencyOverrideStore(left), first),
          mutate(createPostgresEmergencyOverrideStore(right), second)]);
      } finally { await close(left); await close(right); }
    }

    await t.test("first concurrent CREATE of absent row permits exactly one winner", async () => {
      const input = request();
      const results = await race(input, request(input.publicId));
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(results.find((result) => !result.ok).code, "conflict");
      assert.equal((await store.getCurrent(input.publicId)).revision, "1");
      assert.deepEqual(await counts(input.publicId), { state: "1", audit: "1", receipt: "1" });
    });

    await t.test("same-revision competing writers permit exactly one winner", async () => {
      const input = request(); await mutate(store, input);
      const results = await race(replace(input), replace(input, { mode: "FORCE_AVAILABLE" }));
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(results.find((result) => !result.ok).code, "conflict");
      assert.equal((await store.getCurrent(input.publicId)).revision, "2");
      assert.deepEqual(await counts(input.publicId), { state: "1", audit: "2", receipt: "2" });
    });

    await t.test("same operation-ID and same payload race persists one mutation and replays result", async () => {
      const input = request();
      const results = await race(input, { ...input });
      assert.equal(results[0].ok, true); assert.deepEqual(results[0], results[1]);
      assert.deepEqual(await counts(input.publicId), { state: "1", audit: "1", receipt: "1" });
    });

    await t.test("same operation-ID with different payload races conflict deterministically", async () => {
      const input = request();
      const results = await race(input, { ...input, mode: "FORCE_AVAILABLE" });
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(results.find((result) => !result.ok).code, "idempotency_conflict");
      assert.deepEqual(await counts(input.publicId), { state: "1", audit: "1", receipt: "1" });
      // Namespace is store-wide, even across different product IDs.
      assert.equal((await mutate(store, { ...input, publicId: randomUUID() })).code, "idempotency_conflict");
    });

    for (const point of ["after_state", "after_audit", "before_commit"]) {
      await t.test(`rollback ${point} leaves no partial CREATE or REPLACE`, async () => {
        const input = request();
        const faulty = createPostgresEmergencyOverrideStore(faultPool(runtimePool, point));
        assert.equal((await mutate(faulty, input)).code, "store_failure");
        assert.deepEqual(await counts(input.publicId), { state: "0", audit: "0", receipt: "0" });
        const original = await mutate(store, input);
        assert.equal(original.revision, "1");
        assert.equal((await mutate(faulty, replace(input))).code, "store_failure");
        assert.deepEqual(await store.getCurrent(input.publicId), { record: original.event.after, revision: "1" });
        assert.deepEqual(await counts(input.publicId), { state: "1", audit: "1", receipt: "1" });
      });
    }

    await t.test("lost-response replay survives all pool disposal and a fresh Node process", async () => {
      const input = request();
      const isolatedPool = pool();
      const original = await mutate(createPostgresEmergencyOverrideStore(isolatedPool), input);
      assert.equal(original.ok, true);
      await close(isolatedPool);
      await close(runtimePool);
      // The child has no access to earlier store instances or receipt Maps.
      const recovered = await childReconnect(runtimeConfig, input);
      assert.deepEqual(recovered.replay, original);
      assert.deepEqual(recovered.current, { record: original.event.after, revision: "1" });
      assert.equal(recovered.audit, "1"); assert.equal(recovered.receipt, "1");
    });

    await t.test("DB stop/start and new connections retain state/audit/durable replay receipt", async () => {
      const value = pool();
      const input = request();
      const original = await mutate(createPostgresEmergencyOverrideStore(value), input);
      await close(value);
      await owner.end(); owner = undefined;
      await cluster.stop(); started = false;
      await cluster.start(); started = true;
      owner = new Client(ownerConfig); await owner.connect();
      const recovered = await childReconnect(runtimeConfig, input);
      assert.deepEqual(recovered.replay, original);
      assert.equal(recovered.current.revision, "1");
      assert.equal(recovered.audit, "1"); assert.equal(recovered.receipt, "1");
    });

    await t.test("runtime UPDATE/DELETE/TRUNCATE history denied; trigger also rejects owner mutation", async () => {
      const value = pool();
      const input = request(); await mutate(createPostgresEmergencyOverrideStore(value), input);
      for (const table of ["override_audit", "override_receipts"]) {
        for (const sql of [`UPDATE hanapure_private.${table} SET public_id=public_id`,
          `DELETE FROM hanapure_private.${table}`, `TRUNCATE hanapure_private.${table}`]) {
          await assert.rejects(value.query(sql), { code: "42501" });
          if (!sql.startsWith("TRUNCATE")) await assert.rejects(owner.query(sql), { code: "55000" });
        }
      }
      // Include all referencing tables so PostgreSQL reaches the TRUNCATE
      // history trigger rather than stopping first at its FK safety check.
      await assert.rejects(owner.query(`TRUNCATE hanapure_private.override_current,
        hanapure_private.override_audit, hanapure_private.override_receipts`), { code: "55000" });
      await close(value);
    });

    await t.test("unprivileged login has no schema access and no persistence mutation", async () => {
      const value = pool({ ...runtimeConfig, user: "unit2e_unprivileged" });
      await assert.rejects(value.query("SELECT * FROM hanapure_private.override_current"), { code: "42501" });
      const input = request();
      assert.equal((await mutate(createPostgresEmergencyOverrideStore(value), input)).code, "store_failure");
      assert.deepEqual(await counts(input.publicId), { state: "0", audit: "0", receipt: "0" });
      await close(value);
    });

    await t.test("deferred integrity rejects current state committed without audit/receipt", async () => {
      const value = pool(); const client = await value.connect();
      const input = request();
      const decision = decideOverrideMutation({ record: null, revision: null }, null, { ...input, actorId: context().actorId, at });
      try {
        await client.query("BEGIN");
        await client.query(`INSERT INTO hanapure_private.override_current
          (public_id, revision, record, created_at, expires_at) VALUES ($1,1,$2,$3,$4)`,
          [input.publicId, JSON.stringify(decision.snapshot.record), at, expiry]);
        await assert.rejects(client.query("COMMIT"), { code: "23503" });
        await client.query("ROLLBACK");
      } finally { client.release(); await close(value); }
      assert.deepEqual(await counts(input.publicId), { state: "0", audit: "0", receipt: "0" });
    });

    await t.test("exact near-limit numeric revision round-trip and domain overflow guard", async () => {
      const input = request();
      const seedCommand = { ...replace(input, { expectedRevision: "9007199254740989" }), actorId: context().actorId, at };
      const initial = { publicId: input.publicId, mode: "SALES_PAUSED", actorId: context().actorId,
        reason: input.reason, createdAt: at, status: "ACTIVE", expiresAt: expiry };
      const seed = decideOverrideMutation({ record: initial, revision: "9007199254740989" }, null, seedCommand);
      assert.equal(seed.write, true);
      // Seed a high-revision fixture using the existing domain authority.
      await owner.query("BEGIN");
      try {
        await owner.query(`INSERT INTO hanapure_private.override_current (public_id,revision,record,created_at,expires_at)
          VALUES ($1,$2,$3,$4,$5)`, [input.publicId, seed.snapshot.revision, JSON.stringify(seed.snapshot.record), at, expiry]);
        await owner.query(`INSERT INTO hanapure_private.override_audit (public_id,revision,operation_id,previous_revision,occurred_at,event)
          VALUES ($1,$2,$3,$4,$5,$6)`, [input.publicId, seed.snapshot.revision, seedCommand.operationId,
          seedCommand.expectedRevision, at, JSON.stringify(seed.result.event)]);
        await owner.query(`INSERT INTO hanapure_private.override_receipts (operation_id,public_id,revision,semantic_payload,result)
          VALUES ($1,$2,$3,$4,$5)`, [seedCommand.operationId, input.publicId, seed.snapshot.revision,
          seed.receipt.semanticPayload, JSON.stringify(seed.result)]);
        await owner.query("COMMIT");
      } catch (error) { await owner.query("ROLLBACK"); throw error; }
      const value = pool(); const localStore = createPostgresEmergencyOverrideStore(value);
      assert.equal((await localStore.getCurrent(input.publicId)).revision, "9007199254740990");
      const highRequest = replace(input, { expectedRevision: "9007199254740990" });
      const result = await mutate(localStore, highRequest);
      assert.equal(result.revision, "9007199254740991");
      assert.equal((await localStore.getCurrent(input.publicId)).revision, result.revision);
      assert.deepEqual(await mutate(localStore, highRequest, later), result);
      assert.equal((await mutate(localStore, replace(input, { expectedRevision: result.revision }))).code, "store_failure");
      const saved = await value.query("SELECT revision, result FROM hanapure_private.override_receipts WHERE operation_id=$1", [highRequest.operationId]);
      assert.equal(saved.rows[0].revision, "9007199254740991");
      assert.equal(saved.rows[0].result.revision, "9007199254740991");
      await close(value);
    });

    await t.test("mixed-case identity, Unicode copy and original UTC text survive JSONB replay", async () => {
      const value = pool(); const localStore = createPostgresEmergencyOverrideStore(value);
      const input = request(randomUUID().toUpperCase(), { reason: '한국어 / magyar / "incident" ☀' });
      const original = await mutate(localStore, input);
      assert.equal(original.ok, true);
      assert.equal((await localStore.getCurrent(input.publicId)).record.publicId, input.publicId);
      assert.equal((await localStore.getCurrent(input.publicId.toLowerCase())).record, null);
      const reordered = Object.fromEntries(Object.entries(input).reverse());
      assert.deepEqual(await mutate(localStore, reordered, later), original);
      const receipt = await value.query("SELECT semantic_payload, result FROM hanapure_private.override_receipts WHERE operation_id=$1", [input.operationId]);
      assert.equal(receipt.rows[0].semantic_payload[0], input.publicId);
      assert.deepEqual(receipt.rows[0].result, original);
      assert.equal(receipt.rows[0].result.event.after.createdAt, at);
      assert.equal(receipt.rows[0].result.event.after.expiresAt, expiry);
      await close(value);
    });

    await t.test("production store exports no legacy bypass and preserves Unit 2C ERP facts", async () => {
      const value = pool(); const localStore = createPostgresEmergencyOverrideStore(value);
      assert.deepEqual(Object.keys(localStore).sort(), ["getCurrent", "mutateAtomically"]);
      const input = request(undefined, { mode: "FORCE_AVAILABLE" });
      await mutate(localStore, input);
      const state = await readEffectiveOperationalState(input.publicId, {
        overrideStore: localStore, erpSource: { async readProduct() { return {
          public_id: input.publicId, retail_price_huf: 12990.5, sellable_stock: 0, operational_ready: false,
        }; } },
      }, { now: at });
      assert.equal(state.availability, "AVAILABLE");
      assert.equal(state.basePriceHuf, 12990.5); assert.equal(state.sellableStock, 0);
      assert.equal(state.operationalReady, false); assert.equal(state.checkoutAuthorization, "NOT_EVALUATED");
      await close(value);
    });
  } finally {
    await Promise.allSettled([...pools].map((value) => value.end()));
    await owner?.end();
    if (started) await cluster.stop();
    // Remove only this mkdtemp-created cluster after all processes stop.
    const suffix = relative(cacheRoot, clusterDir);
    assert.ok(suffix.startsWith("hanapure-unit2e-") && !suffix.includes("..") && !suffix.includes("/") && !suffix.includes("\\"));
    await rm(clusterDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
