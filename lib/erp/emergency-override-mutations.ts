import "server-only";

import { isPublicId } from "./product-operational";
import {
  isUtcTimestamp, validateOverride,
  type EmergencyOverride, type OverrideMode,
} from "./emergency-override";
import type { EmergencyOverrideReader, OverrideSnapshot } from "./emergency-override-store";

export type OverrideAction = "CREATE" | "REPLACE" | "REVOKE";
export type OverrideMutationFailure = Readonly<{
  ok: false;
  code: "validation_error" | "no_active_override" | "override_not_found" |
    "conflict" | "idempotency_conflict" | "store_unavailable" | "store_failure";
}>;

/** Internal trusted command. Actor/at are added by the server service below. */
export type AtomicOverrideCommand = Readonly<{
  publicId: string;
  operationId: string;
  action: OverrideAction;
  expectedRevision: string | null;
  actorId: string;
  reason: string;
  at: string;
  mode?: OverrideMode;
  expiresAt?: string;
}>;

export type OverrideAuditEvent = Readonly<{
  publicId: string;
  operationId: string;
  action: "created" | "replaced" | "revoked";
  previousRevision: string | null;
  revision: string;
  before: EmergencyOverride | null;
  after: EmergencyOverride;
  actorId: string;
  reason: string;
  at: string;
}>;
export type OverrideMutationSuccess = Readonly<{
  ok: true;
  revision: string;
  event: OverrideAuditEvent;
}>;
export type AtomicOverrideResult = OverrideMutationSuccess | OverrideMutationFailure;
export type OverrideOperationReceipt = Readonly<{
  semanticPayload: string;
  result: OverrideMutationSuccess;
}>;
export type OverrideMutationDecision =
  | Readonly<{ write: false; result: AtomicOverrideResult }>
  | Readonly<{
      write: true;
      result: OverrideMutationSuccess;
      snapshot: Readonly<{ record: EmergencyOverride; revision: string }>;
      receipt: OverrideOperationReceipt;
    }>;

/**
 * MUST serialize operations against the current product revision AND the store-
 * wide operationId namespace. Within ONE atomic transaction, load snapshot and
 * receipt, run decideOverrideMutation, and commit snapshot + immutable event +
 * receipt together (or none). Replay must return its original result before CAS.
 * Receipts/events must be retained; failed commands do not reserve operation IDs.
 * No caller-side read-then-write is safe. No legacy save/revoke bypass is exposed.
 * New stores use decimal revisions; migration from other opaque revisions needs
 * an explicit future plan. getCurrent remains compatible with Unit 2B/2C.
 * No production implementation, history endpoint, or persistence is provided.
 */
export interface AtomicEmergencyOverrideStore extends EmergencyOverrideReader {
  mutateAtomically(command: AtomicOverrideCommand): Promise<AtomicOverrideResult>;
}

const fail = (code: OverrideMutationFailure["code"]): OverrideMutationFailure => ({ ok: false, code });
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
/** Canonical positive safe integer encoded as text for existing read interfaces. */
export function isOverrideRevision(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}
const expected = (value: unknown): value is string | null => value === null || isOverrideRevision(value);

function validCommand(command: AtomicOverrideCommand): boolean {
  const allowed = ["publicId", "operationId", "action", "expectedRevision", "actorId", "reason", "at", "mode", "expiresAt"];
  if (!command || Object.keys(command).some((key) => !allowed.includes(key)) ||
    !isPublicId(command.publicId) || !text(command.operationId) ||
    !text(command.actorId) || typeof command.reason !== "string" || !isUtcTimestamp(command.at) ||
    !expected(command.expectedRevision)) return false;
  if (command.action === "REVOKE") return text(command.reason) &&
    command.expectedRevision !== null && command.mode === undefined && command.expiresAt === undefined;
  return (command.action === "CREATE" || command.action === "REPLACE") &&
    (command.action !== "REPLACE" || command.expectedRevision !== null) &&
    ["AUTO", "FORCE_AVAILABLE", "FORCE_OUT_OF_STOCK", "SALES_PAUSED"].includes(command.mode ?? "") &&
    (command.mode === "AUTO" || text(command.reason)) &&
    (command.expiresAt === undefined || isUtcTimestamp(command.expiresAt));
}

/** Fixed semantic order. The generated server time is excluded so retries work. */
function semanticPayload(command: AtomicOverrideCommand): string {
  return JSON.stringify([
    command.publicId, command.operationId, command.action, command.expectedRevision,
    command.actorId, command.reason, command.mode ?? null, command.expiresAt ?? null,
  ]);
}

function active(record: EmergencyOverride | null, at: string): boolean {
  return record !== null && record.status === "ACTIVE" && record.mode !== "AUTO" &&
    (record.expiresAt === undefined || Date.parse(record.expiresAt) > Date.parse(at));
}

/** Pure transaction decision; the provider must apply write decisions atomically. */
export function decideOverrideMutation(
  snapshot: OverrideSnapshot,
  priorReceipt: OverrideOperationReceipt | null,
  command: AtomicOverrideCommand,
): OverrideMutationDecision {
  const reject = (code: OverrideMutationFailure["code"]): OverrideMutationDecision => ({ write: false, result: fail(code) });
  if (!validCommand(command)) return reject("validation_error");
  const payload = semanticPayload(command);
  if (priorReceipt !== null) {
    if (priorReceipt.semanticPayload !== payload) return reject("idempotency_conflict");
    const result = checkedResult(priorReceipt.result, command);
    return { write: false, result };
  }
  if (!snapshot || !expected(snapshot.revision)) return reject("store_failure");
  let before: EmergencyOverride | null = null;
  if (snapshot.record !== null) {
    const valid = validateOverride(snapshot.record);
    if (!valid.ok || valid.record.publicId !== command.publicId || snapshot.revision === null ||
      Date.parse(valid.record.createdAt) > Date.parse(command.at) ||
      (valid.record.revocation && Date.parse(valid.record.revocation.at) > Date.parse(command.at))) {
      return reject("store_failure");
    }
    before = valid.record;
  }
  if (snapshot.revision !== command.expectedRevision) return reject("conflict");
  if (command.action === "CREATE" && active(before, command.at)) return reject("conflict");
  if (command.action === "REPLACE" && before === null) return reject("override_not_found");
  if (command.action === "REVOKE" && !active(before, command.at)) return reject("no_active_override");
  const next = (snapshot.revision === null ? 0 : Number(snapshot.revision)) + 1;
  if (!Number.isSafeInteger(next)) return reject("store_failure");
  const revision = String(next);
  const valid = validateOverride(command.action === "REVOKE" ? {
    ...before!, status: "REVOKED", revocation: {
      actorId: command.actorId, reason: command.reason, at: command.at,
    },
  } : {
    publicId: command.publicId, mode: command.mode, reason: command.reason,
    actorId: command.actorId, createdAt: command.at, status: "ACTIVE",
    ...(command.expiresAt === undefined ? {} : { expiresAt: command.expiresAt }),
  });
  if (!valid.ok) return reject("validation_error");
  const event: OverrideAuditEvent = Object.freeze({
    publicId: command.publicId, operationId: command.operationId,
    action: command.action === "CREATE" ? "created" : command.action === "REPLACE" ? "replaced" : "revoked",
    previousRevision: snapshot.revision, revision, before, after: valid.record,
    actorId: command.actorId, reason: command.reason, at: command.at,
  });
  const result: OverrideMutationSuccess = Object.freeze({ ok: true, revision, event });
  return Object.freeze({
    write: true, result, snapshot: Object.freeze({ record: valid.record, revision }),
    receipt: Object.freeze({ semanticPayload: payload, result }),
  });
}

/** Validate and whitelist provider acknowledgements; no raw exceptions escape. */
function checkedResult(result: AtomicOverrideResult, command: AtomicOverrideCommand): AtomicOverrideResult {
  if (result?.ok === false) {
    const codes: readonly string[] = ["validation_error", "no_active_override", "override_not_found",
      "conflict", "idempotency_conflict", "store_unavailable", "store_failure"];
    return codes.includes(result.code) ? fail(result.code) : fail("store_failure");
  }
  if (result?.ok !== true || !isOverrideRevision(result.revision) || !result.event) return fail("store_failure");
  const event = result.event;
  const before = event.before === null ? null : validateOverride(event.before);
  const after = validateOverride(event.after);
  if (!after.ok || (before !== null && !before.ok) || !expected(event.previousRevision) ||
    result.revision !== event.revision ||
    Number(result.revision) !== (event.previousRevision === null ? 0 : Number(event.previousRevision)) + 1 ||
    event.previousRevision !== command.expectedRevision || event.publicId !== command.publicId ||
    event.operationId !== command.operationId || event.actorId !== command.actorId ||
    event.reason !== command.reason || !isUtcTimestamp(event.at) ||
    event.action !== (command.action === "CREATE" ? "created" : command.action === "REPLACE" ? "replaced" : "revoked") ||
    after.record.publicId !== command.publicId || (before?.ok && before.record.publicId !== command.publicId)) {
    return fail("store_failure");
  }
  const previous = before?.ok ? before.record : null;
  if ((previous !== null && (event.previousRevision === null || Date.parse(previous.createdAt) > Date.parse(event.at) ||
    (previous.revocation && Date.parse(previous.revocation.at) > Date.parse(event.at)))) ||
    (command.action === "CREATE" && active(previous, event.at)) ||
    (command.action === "REPLACE" && previous === null) ||
    (command.action === "REVOKE" && !active(previous, event.at))) return fail("store_failure");
  const expectedAfter = validateOverride(command.action === "REVOKE" ? {
    ...previous!, status: "REVOKED", revocation: { actorId: command.actorId, reason: command.reason, at: event.at },
  } : {
    publicId: command.publicId, mode: command.mode, actorId: command.actorId,
    reason: command.reason, createdAt: event.at, status: "ACTIVE",
    ...(command.expiresAt === undefined ? {} : { expiresAt: command.expiresAt }),
  });
  if (!expectedAfter.ok || JSON.stringify(expectedAfter.record) !== JSON.stringify(after.record)) return fail("store_failure");
  return Object.freeze({ ok: true, revision: result.revision, event: Object.freeze({
    publicId: event.publicId, operationId: event.operationId, action: event.action,
    previousRevision: event.previousRevision, revision: event.revision,
    before: previous, after: after.record, actorId: event.actorId, reason: event.reason, at: event.at,
  }) });
}

export type OverrideMutationContext = Readonly<{
  /** Trusted server actor; this foundation does not authenticate it. */
  actorId: string;
  clock?: () => string;
}>;

/** No ordinary read writes expiry events; expiry stays a Unit 2B read-time rule. */
export async function mutateEmergencyOverride(
  store: AtomicEmergencyOverrideStore,
  input: unknown,
  context: OverrideMutationContext,
): Promise<AtomicOverrideResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("validation_error");
  const data = input as Record<string, unknown>;
  const allowed = ["publicId", "operationId", "action", "expectedRevision", "reason", "mode", "expiresAt"];
  if (Object.keys(data).some((key) => !allowed.includes(key)) || !text(context?.actorId)) return fail("validation_error");
  let at: string;
  try { at = context.clock ? context.clock() : new Date().toISOString(); }
  catch { return fail("validation_error"); }
  const command = Object.freeze({
    publicId: data.publicId, operationId: data.operationId, action: data.action,
    expectedRevision: data.expectedRevision, reason: data.reason, actorId: context.actorId, at,
    ...(data.mode === undefined ? {} : { mode: data.mode }),
    ...(data.expiresAt === undefined ? {} : { expiresAt: data.expiresAt }),
  }) as AtomicOverrideCommand;
  if (!validCommand(command)) return fail("validation_error");
  try { return checkedResult(await store.mutateAtomically(command), command); }
  catch { return fail("store_failure"); }
}
