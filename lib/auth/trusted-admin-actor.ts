import "server-only";

import { hasVerifiedIdentity, type VerifiedAdminIdentity } from "./admin-auth";

/** Stable immutable subject mapping; email/display name never participate. */
export function trustedAdminActor(identity: VerifiedAdminIdentity): string {
  if (!hasVerifiedIdentity(identity)) throw new Error("unverified_admin_identity");
  return `supabase-user:${identity.subject}`;
}
