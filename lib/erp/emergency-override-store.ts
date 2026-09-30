import "server-only";

import { isPublicId } from "./product-operational";
import {
  isUtcTimestamp, validateOverride,
  type EmergencyOverride, type OverrideMutation, type OverrideReadResult,
} from "./emergency-override";

export type OverrideSnapshot = Readonly<{ record: unknown | null; revision: string | null }>;
export type OverrideWriteResult =
  | Readonly<{ ok: true; revision: string }>
  | Readonly<{ ok: false; code: "conflict" }>;

/** Read boundary shared by legacy stores and atomic Unit 2D stores. */
export interface EmergencyOverrideReader {
  getCurrent(publicId: string): Promise<OverrideSnapshot>;
}

/**
 * Provider-neutral SERVER persistence contract. No production implementation.
 * Revisions are opaque and must not be reused (including after revocation).
 * Writes must atomically compare expectedRevision and preserve mutation audit
 * metadata/history as the chosen provider permits. A future admin caller must
 * supply authenticated server actor identity; these functions do not authorize it.
 * This legacy Unit 2B write interface has no replay receipt/event transaction.
 * Future Unit 2D providers must use AtomicEmergencyOverrideStore for mutations;
 * do not expose these legacy writes as a bypass around that atomic contract.
 */
export interface EmergencyOverrideStore extends EmergencyOverrideReader {
  save(publicId: string, record: EmergencyOverride, expectedRevision: string | null): Promise<OverrideWriteResult>;
  /** Keep revocation metadata and prior record; do not delete audit provenance. */
  revoke(publicId: string, mutation: OverrideMutation, expectedRevision: string | null): Promise<OverrideWriteResult>;
}

export type OverrideCommandResult =
  | OverrideWriteResult
  | Readonly<{ ok: false; code: "invalid_override" | "invalid_mutation" | "override_store_failure" }>;

const validRevision = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.trim().length > 0);

export async function readCurrentOverride(
  store: EmergencyOverrideReader,
  publicId: string,
): Promise<OverrideReadResult> {
  if (!isPublicId(publicId)) return { ok: false, code: "invalid_override" };
  try {
    const snapshot = await store.getCurrent(publicId);
    if (!snapshot || !validRevision(snapshot.revision)) return { ok: false, code: "override_store_failure" };
    if (snapshot.record === null) return { ok: true, record: null, revision: snapshot.revision };
    const valid = validateOverride(snapshot.record);
    if (!valid.ok || valid.record.publicId !== publicId || snapshot.revision === null) {
      return { ok: false, code: "invalid_override" };
    }
    return { ok: true, record: valid.record, revision: snapshot.revision };
  } catch { return { ok: false, code: "override_store_failure" }; }
}

function checkedWrite(result: OverrideWriteResult): OverrideCommandResult {
  if (result?.ok === true && typeof result.revision === "string" && result.revision.trim()) {
    return { ok: true, revision: result.revision };
  }
  if (result?.ok === false && result.code === "conflict") return { ok: false, code: "conflict" };
  return { ok: false, code: "override_store_failure" };
}

/** Create/replace an active override, including an audited return-to-AUTO record. */
export async function saveEmergencyOverride(
  store: EmergencyOverrideStore,
  input: unknown,
  expectedRevision: string | null,
): Promise<OverrideCommandResult> {
  const valid = validateOverride(input);
  if (!valid.ok || valid.record.status !== "ACTIVE" || !validRevision(expectedRevision)) {
    return { ok: false, code: "invalid_override" };
  }
  try { return checkedWrite(await store.save(valid.record.publicId, valid.record, expectedRevision)); }
  catch { return { ok: false, code: "override_store_failure" }; }
}

export async function revokeEmergencyOverride(
  store: EmergencyOverrideStore,
  publicId: string,
  mutation: OverrideMutation,
  expectedRevision: string | null,
): Promise<OverrideCommandResult> {
  if (!isPublicId(publicId) || !validRevision(expectedRevision) || !mutation ||
    typeof mutation.actorId !== "string" || !mutation.actorId.trim() ||
    typeof mutation.reason !== "string" || !mutation.reason.trim() || !isUtcTimestamp(mutation.at)) {
    return { ok: false, code: "invalid_mutation" };
  }
  const current = await readCurrentOverride(store, publicId);
  if (!current.ok) return current;
  if (current.revision !== expectedRevision) return { ok: false, code: "conflict" };
  if (current.record && Date.parse(mutation.at) < Date.parse(current.record.createdAt)) {
    return { ok: false, code: "invalid_mutation" };
  }
  // Whitelist metadata rather than forwarding arbitrary input to storage.
  const audit = Object.freeze({ actorId: mutation.actorId, reason: mutation.reason, at: mutation.at });
  try { return checkedWrite(await store.revoke(publicId, audit, expectedRevision)); }
  catch { return { ok: false, code: "override_store_failure" }; }
}
