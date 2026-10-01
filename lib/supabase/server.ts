import "server-only";

import { createClient } from "@supabase/supabase-js";
import { securityFailure, isAuthSubject, type AdminIdentityVerifier, type AdminIdentityResult, type AdminSecurityFailure } from "../auth/admin-auth";

function authFailure(error: unknown): AdminSecurityFailure {
  if (error && typeof error === "object") {
    const value = error as { name?: string; status?: number; code?: string; message?: string };
    if ((value.name === "AuthInvalidJwtError" && value.message === "JWT has expired") || value.code === "jwt_expired") {
      return securityFailure("session_expired");
    }
    if (value.name === "AuthRetryableFetchError" || value.status === 429 || (value.status ?? 0) >= 500) {
      return securityFailure("auth_unavailable");
    }
    if (["AuthInvalidJwtError", "AuthSessionMissingError", "AuthApiError"].includes(value.name ?? "")) {
      return securityFailure("session_invalid");
    }
  }
  return securityFailure("auth_unavailable");
}

/**
 * Explicit access-token foundation: future trusted HTTP/cookie code extracts the
 * token, never a user/session/AAL object. No refresh token, cookie mutation, proxy,
 * persisted SDK session, service key or global user client is needed in this Unit.
 * The SDK verifies signed claims; getUser(token) also consults Auth on EVERY call.
 * A verified token's AAL is assurance at issue time, not proof of instant factor
 * removal invalidation. Real provider session/revocation behaviour needs staging.
 */
export function createSupabaseAdminIdentityVerifier(config: Readonly<{
  url: string;
  publishableKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}>): AdminIdentityVerifier {
  const url = new URL(config.url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) throw new Error("invalid_public_auth_configuration");
  const timeout = config.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw new Error("invalid_auth_timeout");
  const authUrl = `${url.origin}/auth/v1`;
  const publishableKey = config.publishableKey;
  const fetcher = config.fetch ?? fetch;
  return Object.freeze({
    async verify(accessToken: string): Promise<AdminIdentityResult> {
      // Request-local instance; all actual SDK Auth fetches are bounded/no-store.
      const client = createClient(url.origin, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetcher(input, { ...init, cache: "no-store", redirect: "error",
          signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }) },
      });
      try {
        const claimsResult = await client.auth.getClaims(accessToken, { allowExpired: false });
        if (claimsResult.error) return authFailure(claimsResult.error);
        const claims = claimsResult.data?.claims;
        if (!claims || claims.iss !== authUrl || claims.role !== "authenticated" ||
          !(claims.aud === "authenticated" || Array.isArray(claims.aud) && claims.aud.includes("authenticated")) ||
          !isAuthSubject(claims.sub) || !isAuthSubject(claims.session_id) ||
          !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
          claims.iat < 0 || claims.iat > Date.now() / 1000 || claims.exp <= claims.iat ||
          (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > Date.now() / 1000)) ||
          !["aal1", "aal2"].includes(claims.aal) || claims.is_anonymous === true) return securityFailure("session_invalid");
        if (claims.exp <= Date.now() / 1000) return securityFailure("session_expired");
        const userResult = await client.auth.getUser(accessToken);
        if (userResult.error) return authFailure(userResult.error);
        const user = userResult.data.user;
        if (!user || user.id.toLowerCase() !== claims.sub.toLowerCase() || user.is_anonymous === true ||
          (user.banned_until && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now()))) {
          return securityFailure("session_invalid");
        }
        return { ok: true, identity: Object.freeze({ subject: claims.sub.toLowerCase(), sessionId: claims.session_id.toLowerCase(),
          issuedAt: claims.iat, expiresAt: claims.exp, assurance: claims.aal === "aal2" ? "aal2" : "aal1" }) };
      } catch (error) { return authFailure(error); }
    },
  });
}
