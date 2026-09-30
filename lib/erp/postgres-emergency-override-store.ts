import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  decideOverrideMutation, isOverrideRevision,
  type AtomicEmergencyOverrideStore, type AtomicOverrideCommand,
  type AtomicOverrideResult, type OverrideOperationReceipt,
} from "./emergency-override-mutations";
import { validateOverride } from "./emergency-override";
import type { OverrideSnapshot } from "./emergency-override-store";

const schema = "hanapure_private";
// Separate two-int namespaces prevent operation/product hash collisions from
// crossing lock classes. Within a class, collisions only serialize extra work.
const OPERATION_LOCK = 1213218817;
const PRODUCT_LOCK = 1213218818;
const lockKey = (value: string): number => createHash("sha256").update(value, "utf8").digest().readInt32BE(0);

function checkedSnapshot(row: Record<string, unknown> | undefined, publicId: string): OverrideSnapshot {
  if (!row) return { record: null, revision: null };
  const record = validateOverride(row.record);
  if (!isOverrideRevision(row.revision) || !record.ok || record.record.publicId !== publicId) {
    throw new Error("override_store_failure");
  }
  return { record: record.record, revision: row.revision };
}

function failure(error: unknown): AtomicOverrideResult {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  // Infrastructure errors never masquerade as business/revision conflicts.
  const unavailable = typeof code === "string" && (code.startsWith("08") ||
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P02", "57P03", "55P03", "57014"].includes(code));
  return { ok: false, code: unavailable ? "store_unavailable" : "store_failure" };
}

/**
 * Inject a trusted SERVER pool with bounded checkout/read timeouts and the
 * migration's runtime role. No env lookup, default pool, secret, or connection
 * URL is supplied here. The caller owns pool lifecycle/TLS/pooler selection.
 * One checked-out client executes the whole interactive transaction; unnamed
 * parameterized statements only. No session locks/state or automatic retries.
 * The only mutation method is mutateAtomically: no legacy save/revoke exports.
 */
export function createPostgresEmergencyOverrideStore(
  pool: Pick<Pool, "connect">,
): AtomicEmergencyOverrideStore {
  return Object.freeze({
    async getCurrent(publicId: string): Promise<OverrideSnapshot> {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        const read = await client.query(
          `SELECT record, trunc(revision)::text AS revision FROM ${schema}.override_current WHERE public_id = $1`,
          [publicId],
        );
        return checkedSnapshot(read.rows[0], publicId);
      } catch { throw new Error("override_store_failure"); }
      finally { client?.release(); }
    },

    async mutateAtomically(command: AtomicOverrideCommand): Promise<AtomicOverrideResult> {
      let client: PoolClient | undefined;
      let destroy = false;
      try {
        client = await pool.connect();
        // READ COMMITTED makes reads after a waited lock see the winner's commit.
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
          [OPERATION_LOCK, lockKey(command.operationId)]);
        const receiptRead = await client.query(
          `SELECT semantic_payload, result FROM ${schema}.override_receipts WHERE operation_id = $1`,
          [command.operationId],
        );
        const row = receiptRead.rows[0];
        if (row) {
          // Stored JSON array preserves Unit 2D's fixed semantic order/strings.
          // JSON object key ordering in the stored result has no replay authority.
          const receipt: OverrideOperationReceipt = {
            semanticPayload: JSON.stringify(row.semantic_payload), result: row.result,
          };
          const replay = decideOverrideMutation({ record: null, revision: null }, receipt, command);
          await client.query("COMMIT");
          return replay.result;
        }
        await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
          [PRODUCT_LOCK, lockKey(command.publicId)]);
        const read = await client.query(
          `SELECT record, trunc(revision)::text AS revision FROM ${schema}.override_current WHERE public_id = $1 FOR UPDATE`,
          [command.publicId],
        );
        const decision = decideOverrideMutation(checkedSnapshot(read.rows[0], command.publicId), null, command);
        if (decision.write) {
          const { record, revision } = decision.snapshot;
          await client.query(
            `INSERT INTO ${schema}.override_current (public_id, revision, record, created_at, expires_at, revoked_at)
             VALUES ($1, $2::numeric, $3::jsonb, $4::timestamptz, $5::timestamptz, $6::timestamptz)
             ON CONFLICT (public_id) DO UPDATE SET revision = EXCLUDED.revision, record = EXCLUDED.record,
               created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at`,
            [command.publicId, revision, JSON.stringify(record), record.createdAt,
              record.expiresAt ?? null, record.revocation?.at ?? null],
          );
          await client.query(
            `INSERT INTO ${schema}.override_audit (public_id, revision, operation_id, previous_revision, occurred_at, event)
             VALUES ($1, $2::numeric, $3, $4::numeric, $5::timestamptz, $6::jsonb)`,
            [command.publicId, revision, command.operationId, decision.result.event.previousRevision,
              decision.result.event.at, JSON.stringify(decision.result.event)],
          );
          await client.query(
            `INSERT INTO ${schema}.override_receipts (operation_id, public_id, revision, semantic_payload, result)
             VALUES ($1, $2, $3::numeric, $4::jsonb, $5::jsonb)`,
            [command.operationId, command.publicId, revision, decision.receipt.semanticPayload,
              JSON.stringify(decision.receipt.result)],
          );
        }
        await client.query("COMMIT");
        return decision.result;
      } catch (error) {
        if (client) {
          try { await client.query("ROLLBACK"); }
          catch { destroy = true; }
        }
        // A lost COMMIT response is uncertain: retry ONLY with the same operation
        // ID/payload to recover the durable receipt, never fabricate a success.
        return failure(error);
      } finally { client?.release(destroy); }
    },
  });
}
