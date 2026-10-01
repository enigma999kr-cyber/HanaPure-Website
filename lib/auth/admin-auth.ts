import "server-only";

export type AdminSecurityCode = "unauthenticated" | "session_invalid" | "session_expired" |
  "auth_unavailable" | "forbidden" | "admin_revoked" | "mfa_required" | "authorization_unavailable";
export type AdminSecurityFailure = Readonly<{ ok: false; code: AdminSecurityCode }>;

/** Provider-neutral identity; no user-editable metadata or role claims. Times are epoch seconds. */
export type VerifiedAdminIdentity = Readonly<{
  subject: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  assurance: "aal1" | "aal2";
}>;
export type AdminIdentityResult = Readonly<{ ok: true; identity: VerifiedAdminIdentity }> | AdminSecurityFailure;
/** Trusted SERVER dependency, never supplied through mutation intent. */
export interface AdminIdentityVerifier {
  verify(accessToken: string): Promise<AdminIdentityResult>;
}
export const securityFailure = (code: AdminSecurityCode): AdminSecurityFailure => Object.freeze({ ok: false, code });
export const isAuthSubject = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Only this server verification boundary mints identities accepted by the actor
// constructor. A structurally similar object from a session cookie is insufficient.
const verifiedIdentities = new WeakSet<object>();
export const hasVerifiedIdentity = (identity: VerifiedAdminIdentity): boolean => verifiedIdentities.has(identity);

export async function verifyAdminIdentity(
  verifier: AdminIdentityVerifier,
  credential: unknown,
  now: number = Date.now(),
): Promise<AdminIdentityResult> {
  if (credential === undefined || credential === null || credential === "") return securityFailure("unauthenticated");
  if (typeof credential !== "string" || !credential.trim() || credential.length > 16384 || /\s/.test(credential)) {
    return securityFailure("session_invalid");
  }
  try {
    const result = await verifier.verify(credential);
    if (result?.ok !== true) {
      return securityFailure(["unauthenticated", "session_invalid", "session_expired", "auth_unavailable"].includes(result?.code)
        ? result.code : "auth_unavailable");
    }
    const value = result.identity;
    if (!Number.isFinite(now) || !value || !isAuthSubject(value.subject) || !isAuthSubject(value.sessionId) ||
      !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
      value.issuedAt < 0 || value.issuedAt > now / 1000 || value.expiresAt <= value.issuedAt ||
      !["aal1", "aal2"].includes(value.assurance)) return securityFailure("session_invalid");
    if (value.expiresAt <= now / 1000) return securityFailure("session_expired");
    const identity = Object.freeze({ subject: value.subject.toLowerCase(), sessionId: value.sessionId.toLowerCase(),
      issuedAt: value.issuedAt, expiresAt: value.expiresAt, assurance: value.assurance });
    verifiedIdentities.add(identity);
    return Object.freeze({ ok: true, identity });
  } catch { return securityFailure("auth_unavailable"); }
}
