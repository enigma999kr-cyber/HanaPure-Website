import "server-only";

import { verifyAdminIdentity, securityFailure, type AdminIdentityVerifier, type AdminSecurityFailure } from "./admin-auth";
import { checkCurrentAdminAuthorization, type AdminAuthorizationReader } from "./admin-authorization";
import { trustedAdminActor } from "./trusted-admin-actor";
import { mutateEmergencyOverride, type AtomicEmergencyOverrideStore, type AtomicOverrideResult } from "../erp/emergency-override-mutations";

/**
 * Internal server seam, NOT a Server Action/HTTP endpoint. Future HTTP wiring must
 * separately handle credential extraction, CSRF/origin checks and response privacy.
 * Only mutation intent is browser data; dependencies/clock are trusted server config.
 * Fresh authorization also precedes idempotent replay. No domain rules are duplicated.
 */
export function createAuthorizedEmergencyOverrideMutator(dependencies: Readonly<{
  verifier: AdminIdentityVerifier;
  authorization: AdminAuthorizationReader;
  store: AtomicEmergencyOverrideStore;
  clock?: () => number;
}>) {
  const clock = dependencies.clock ?? Date.now;
  return async (credential: unknown, intent: unknown): Promise<AtomicOverrideResult | AdminSecurityFailure> => {
    let now: number;
    try { now = clock(); } catch { return securityFailure("auth_unavailable"); }
    const verified = await verifyAdminIdentity(dependencies.verifier, credential, now);
    if (!verified.ok) return verified;
    try { now = clock(); } catch { return securityFailure("auth_unavailable"); }
    const permission = await checkCurrentAdminAuthorization(verified.identity, dependencies.authorization, now);
    if (!permission.ok) return permission;
    if (verified.identity.assurance !== "aal2") return securityFailure("mfa_required");
    // A slow verification/DB lookup must not carry an expired identity into writes.
    try { now = clock(); } catch { return securityFailure("auth_unavailable"); }
    if (!Number.isFinite(now)) return securityFailure("auth_unavailable");
    if (verified.identity.expiresAt <= now / 1000) return securityFailure("session_expired");
    return mutateEmergencyOverride(dependencies.store, intent, {
      actorId: trustedAdminActor(verified.identity), clock: () => new Date(now).toISOString(),
    });
  };
}
