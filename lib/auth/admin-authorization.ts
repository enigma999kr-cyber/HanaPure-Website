import "server-only";

import type { Pool, PoolClient } from "pg";
import { securityFailure, isAuthSubject, hasVerifiedIdentity, type VerifiedAdminIdentity, type AdminSecurityFailure } from "./admin-auth";

export const EMERGENCY_OVERRIDE_PERMISSION = "emergency_override:mutate";
/** SERVER read seam: raw persisted state must pass validation before permission is granted. */
export interface AdminAuthorizationReader {
  getPrincipal(authUserId: string): Promise<unknown>;
}
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const timestamp = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export async function checkCurrentAdminAuthorization(
  identity: VerifiedAdminIdentity,
  reader: AdminAuthorizationReader,
  now: number = Date.now(),
): Promise<Readonly<{ ok: true }> | AdminSecurityFailure> {
  if (!hasVerifiedIdentity(identity)) return securityFailure("session_invalid");
  if (!Number.isFinite(now)) return securityFailure("authorization_unavailable");
  if (identity.expiresAt <= now / 1000) return securityFailure("session_expired");
  try {
    // Intentionally no cache/JWT metadata/React cache: every mutation reads current authority.
    const value = await reader.getPrincipal(identity.subject);
    if (value === null) return securityFailure("forbidden");
    if (!value || typeof value !== "object" || Array.isArray(value)) return securityFailure("authorization_unavailable");
    const row = value as Record<string, unknown>;
    if (!Number.isFinite(now) || !isAuthSubject(row.authUserId) || row.authUserId.toLowerCase() !== identity.subject ||
      row.permission !== EMERGENCY_OVERRIDE_PERMISSION || !["ACTIVE", "REVOKED", "DISABLED"].includes(String(row.status)) ||
      !timestamp(row.grantedAt) || Date.parse(row.grantedAt) > now || !text(row.grantedBy)) {
      return securityFailure("authorization_unavailable");
    }
    if (row.status === "ACTIVE") {
      if (row.revokedAt !== null || row.revokedBy !== null) return securityFailure("authorization_unavailable");
      return { ok: true };
    }
    if (!timestamp(row.revokedAt) || Date.parse(row.revokedAt) < Date.parse(row.grantedAt) ||
      Date.parse(row.revokedAt) > now || !text(row.revokedBy)) return securityFailure("authorization_unavailable");
    return securityFailure(row.status === "REVOKED" ? "admin_revoked" : "forbidden");
  } catch { return securityFailure("authorization_unavailable"); }
}

/** Inject a trusted server pool with bounded checkout/read timeouts and runtime role. */
export function createPostgresAdminAuthorizationReader(pool: Pick<Pool, "connect">): AdminAuthorizationReader {
  return Object.freeze({
    async getPrincipal(authUserId: string): Promise<unknown> {
      if (!isAuthSubject(authUserId)) throw new Error("invalid_auth_subject");
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        const result = await client.query(`SELECT auth_user_id::text AS "authUserId", permission, status,
          to_char(granted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "grantedAt", granted_by AS "grantedBy",
          to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "revokedAt", revoked_by AS "revokedBy"
          FROM hanapure_private.admin_principals WHERE auth_user_id = $1::uuid`, [authUserId]);
        return result.rows[0] ?? null;
      } finally { client?.release(); }
    },
  });
}
