import assert from "node:assert/strict";
import test from "node:test";
import { verifyAdminIdentity } from "../lib/auth/admin-auth.ts";
import { checkCurrentAdminAuthorization, createPostgresAdminAuthorizationReader } from "../lib/auth/admin-authorization.ts";
import { now, subject, otherSubject, verifier, identity, principal } from "./helpers/admin-auth-fixtures.mjs";

const minted = async () => (await verifyAdminIdentity(verifier(), "token", now)).identity;

test("unknown/non-admin is forbidden; a structurally fake identity cannot trigger the lookup", async () => {
  assert.equal((await checkCurrentAdminAuthorization(await minted(), { async getPrincipal() { return null; } }, now)).code, "forbidden");
  let calls = 0;
  assert.equal((await checkCurrentAdminAuthorization(identity(), { async getPrincipal() { calls++; } }, now)).code, "session_invalid");
  assert.equal(calls, 0);
});

test("fresh record grants permission, then revoke defeats old valid identity/claims", async () => {
  let row = principal(); let calls = 0;
  const reader = { async getPrincipal(id) { calls++; assert.equal(id, subject); return row; } };
  const verified = await minted();
  assert.deepEqual(await checkCurrentAdminAuthorization(verified, reader, now), { ok: true });
  row = principal({ status: "REVOKED", revokedAt: new Date(now - 1).toISOString(), revokedBy: "owner:revocation" });
  assert.equal((await checkCurrentAdminAuthorization(verified, reader, now)).code, "admin_revoked");
  assert.equal(calls, 2);
});

test("disabled principal is forbidden and unavailable lookup has its own taxonomy", async () => {
  const verified = await minted();
  const disabled = principal({ status: "DISABLED", revokedAt: new Date(now - 1).toISOString(), revokedBy: "owner" });
  assert.equal((await checkCurrentAdminAuthorization(verified, { async getPrincipal() { return disabled; } }, now)).code, "forbidden");
  assert.equal((await checkCurrentAdminAuthorization(verified, { async getPrincipal() { throw new Error("private DB detail"); } }, now)).code, "authorization_unavailable");
});

test("previously minted identity cannot authorize after expiry", async () => {
  let calls = 0;
  const result = await checkCurrentAdminAuthorization(await minted(), { async getPrincipal() { calls++; return principal(); } }, now + 7200000);
  assert.equal(result.code, "session_expired"); assert.equal(calls, 0);
});

test("malformed current authority fails closed rather than granting from role-like fields", async () => {
  const verified = await minted();
  const invalid = [undefined, [], {}, principal({ authUserId: otherSubject }), principal({ permission: "admin" }),
    principal({ status: "unknown" }), principal({ grantedAt: "bad" }), principal({ grantedBy: " " }),
    principal({ revokedAt: new Date(now).toISOString() }), principal({ grantedAt: new Date(now + 10000).toISOString() }),
    principal({ status: "REVOKED", revokedAt: null, revokedBy: null })];
  for (const row of invalid) {
    assert.equal((await checkCurrentAdminAuthorization(verified, { async getPrincipal() { return row; } }, now)).code, "authorization_unavailable");
  }
});

test("Postgres authorization reader uses a fresh parameterized read and releases on error", async () => {
  let connects = 0; let releases = 0;
  const reader = createPostgresAdminAuthorizationReader({ async connect() {
    connects++;
    return { async query(sql, values) {
      assert.match(sql, /SELECT/); assert.match(sql, /admin_principals/); assert.deepEqual(values, [subject]);
      assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/);
      if (connects === 2) throw new Error("unavailable");
      return { rows: [principal()] };
    }, release() { releases++; } };
  } });
  assert.deepEqual(await reader.getPrincipal(subject), principal());
  await assert.rejects(reader.getPrincipal(subject));
  assert.deepEqual([connects, releases], [2, 2]);
  assert.deepEqual(Object.keys(reader), ["getPrincipal"]);
});
