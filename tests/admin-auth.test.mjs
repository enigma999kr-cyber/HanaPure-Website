import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import test from "node:test";
import { verifyAdminIdentity } from "../lib/auth/admin-auth.ts";
import { trustedAdminActor } from "../lib/auth/trusted-admin-actor.ts";
import { createSupabaseAdminIdentityVerifier } from "../lib/supabase/server.ts";
import { subject, otherSubject, now, identity, verifier } from "./helpers/admin-auth-fixtures.mjs";

/** Real SDK + real ES256 signatures, injected HTTP only; never remote Supabase. */
function provider(changes = {}) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kid = randomUUID(); const url = `https://${kid}.unit2f.invalid`;
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  const requests = [];
  const claims = { sub: subject, session_id: otherSubject, iat: Math.floor(Date.now() / 1000) - 30,
    exp: Math.floor(Date.now() / 1000) + 300, iss: `${url}/auth/v1`, aud: "authenticated",
    role: "authenticated", aal: "aal2", ...changes.claims };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "ES256", typ: "JWT", kid })}.${encode(claims)}`;
  const token = `${body}.${sign("sha256", Buffer.from(body), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  const fetcher = async (input, options) => {
    requests.push({ url: String(input), options });
    if (changes.throwFetch) throw new Error("test unavailable");
    if (String(input).endsWith("/.well-known/jwks.json")) {
      return Response.json({ keys: [jwk] });
    }
    assert.equal(String(input), `${url}/auth/v1/user`);
    assert.equal(new Headers(options.headers).get("authorization"), `Bearer ${changes.token ?? token}`);
    if (changes.userStatus) return Response.json({ error_code: changes.errorCode ?? "bad_jwt", message: "denied" }, { status: changes.userStatus });
    return Response.json({ id: subject, aud: "authenticated", role: "authenticated", is_anonymous: false,
      app_metadata: { emergency_override_admin: true }, user_metadata: { aal: "aal2" },
      created_at: "2026-09-30T00:00:00.000Z", ...changes.user });
  };
  return { token, requests, claims, url, config: { url, publishableKey: "sb_publishable_unit2f_fixture", fetch: fetcher } };
}

test("absent credentials are unauthenticated and raw session/cookie objects never invoke verifier", async () => {
  let calls = 0;
  const check = { async verify() { calls++; return { ok: true, identity: identity() }; } };
  for (const value of [null, undefined, ""]) assert.equal((await verifyAdminIdentity(check, value, now)).code, "unauthenticated");
  for (const value of [{ access_token: "fake", user: { id: subject }, aal: "aal2" }, [], 12, " ", "a b"]) {
    assert.equal((await verifyAdminIdentity(check, value, now)).code, "session_invalid");
  }
  assert.equal(calls, 0);
});

test("real SDK establishes signed identity and consults Auth with no-store on every request", async () => {
  const fixture = provider(); const check = createSupabaseAdminIdentityVerifier(fixture.config);
  for (let i = 0; i < 2; i++) {
    const result = await verifyAdminIdentity(check, fixture.token);
    assert.equal(result.ok, true); assert.equal(result.identity.subject, subject);
    assert.equal(result.identity.assurance, "aal2"); assert.equal(result.identity.sessionId, otherSubject);
    assert.equal(Object.hasOwn(result.identity, "role"), false);
    assert.equal(Object.isFrozen(result.identity), true);
  }
  assert.equal(fixture.requests.filter((r) => r.url.endsWith("/user")).length, 2);
  for (const r of fixture.requests) {
    assert.equal(r.options.cache, "no-store"); assert.equal(r.options.redirect, "error"); assert.ok(r.options.signal);
  }
});

test("forged signature and malformed JWT cannot establish an identity", async () => {
  const fixture = provider(); const check = createSupabaseAdminIdentityVerifier(fixture.config);
  const forged = fixture.token.split("."); forged[2] = Buffer.alloc(64, 1).toString("base64url");
  assert.equal((await verifyAdminIdentity(check, forged.join("."))).code, "session_invalid");
  assert.equal((await verifyAdminIdentity(check, "not-a-jwt")).code, "session_invalid");
  assert.equal(fixture.requests.filter((r) => r.url.endsWith("/user")).length, 0);
});

test("expired signed session is rejected without controlled refresh", async () => {
  const fixture = provider({ claims: { iat: Math.floor(Date.now() / 1000) - 100, exp: Math.floor(Date.now() / 1000) - 1 } });
  assert.equal((await verifyAdminIdentity(createSupabaseAdminIdentityVerifier(fixture.config), fixture.token)).code, "session_expired");
  assert.equal(fixture.requests.length, 0);
});

test("provider HTTP failure is distinct auth_unavailable; rejected user session is session_invalid", async () => {
  for (const [status, expected] of [[503, "auth_unavailable"], [429, "auth_unavailable"], [401, "session_invalid"]]) {
    const fixture = provider({ userStatus: status });
    assert.equal((await verifyAdminIdentity(createSupabaseAdminIdentityVerifier(fixture.config), fixture.token)).code, expected);
  }
  const fixture = provider({ userStatus: 401, errorCode: "session_not_found" });
  assert.equal((await verifyAdminIdentity(createSupabaseAdminIdentityVerifier(fixture.config), fixture.token)).code, "session_invalid");
  assert.equal((await verifyAdminIdentity({ async verify() { throw new Error("provider details"); } }, "token", now)).code, "auth_unavailable");
});

test("signed but wrong issuer/audience/session/assurance, anonymous or future claims fail closed", async () => {
  for (const claims of [{ iss: "https://other.invalid/auth/v1" }, { aud: "other" }, { session_id: "invalid" },
    { aal: "aal9" }, { aal: undefined }, { iat: Math.floor(Date.now() / 1000) + 100 },
    { nbf: Math.floor(Date.now() / 1000) + 100 }, { role: "service_role" }, { is_anonymous: true }]) {
    const fixture = provider({ claims });
    assert.equal((await verifyAdminIdentity(createSupabaseAdminIdentityVerifier(fixture.config), fixture.token)).code, "session_invalid");
  }
});

test("Auth current user must match verified subject and not be banned/anonymous", async () => {
  for (const user of [{ id: otherSubject }, { is_anonymous: true }, { banned_until: new Date(Date.now() + 60000).toISOString() }]) {
    const fixture = provider({ user });
    assert.equal((await verifyAdminIdentity(createSupabaseAdminIdentityVerifier(fixture.config), fixture.token)).code, "session_invalid");
  }
});

test("malformed injected verified identity fails closed, including missing AAL and stale expiry", async () => {
  for (const changes of [{ subject: "email@example.invalid" }, { sessionId: "fake" }, { assurance: "aal3" },
    { issuedAt: now / 1000 + 60 }, { expiresAt: "123" }, { expiresAt: Math.floor(now / 1000) - 1 }]) {
    const result = await verifyAdminIdentity(verifier(changes), "token", now);
    assert.equal(result.ok, false);
    assert.ok(["session_invalid", "session_expired"].includes(result.code));
  }
});

test("trusted actor requires a minted identity and stays stable across mutable metadata", async () => {
  assert.throws(() => trustedAdminActor(identity()), /unverified/);
  const first = await verifyAdminIdentity(verifier({ email: "old@example.invalid", role: "admin" }), "token", now);
  const second = await verifyAdminIdentity(verifier({ subject: subject.toUpperCase(), email: "new@example.invalid" }), "token", now);
  const other = await verifyAdminIdentity(verifier({ subject: otherSubject }), "token", now);
  assert.equal(trustedAdminActor(first.identity), `supabase-user:${subject}`);
  assert.equal(trustedAdminActor(first.identity), trustedAdminActor(second.identity));
  assert.notEqual(trustedAdminActor(first.identity), trustedAdminActor(other.identity));
});

test("configuration permits only public publishable keys and HTTPS server endpoints", () => {
  for (const config of [{ url: "http://example.invalid", publishableKey: "sb_publishable_test" },
    { url: "https://example.invalid", publishableKey: "sb_secret_test" },
    { url: "https://user:password@example.invalid", publishableKey: "sb_publishable_test" }]) {
    assert.throws(() => createSupabaseAdminIdentityVerifier(config), /configuration/);
  }
});

test("server configuration snapshots the validated public key instead of later mutable config", async () => {
  const fixture = provider(); const check = createSupabaseAdminIdentityVerifier(fixture.config);
  fixture.config.publishableKey = "sb_secret_should_never_be_used";
  assert.equal((await verifyAdminIdentity(check, fixture.token)).ok, true);
  for (const request of fixture.requests) {
    assert.equal(new Headers(request.options.headers).get("apikey"), "sb_publishable_unit2f_fixture");
  }
});
