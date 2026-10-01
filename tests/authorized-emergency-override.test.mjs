import assert from "node:assert/strict";
import test from "node:test";
import { createAuthorizedEmergencyOverrideMutator } from "../lib/auth/authorized-emergency-override.ts";
import { decideOverrideMutation } from "../lib/erp/emergency-override-mutations.ts";
import { subject, now, identity, verifier, principal, intent } from "./helpers/admin-auth-fixtures.mjs";

function fixture(changes = {}) {
  const entries = new Map(); const receipts = new Map(); const events = []; let calls = 0;
  const store = { async getCurrent(id) { return entries.get(id) ?? { record: null, revision: null }; },
    async mutateAtomically(command) {
      calls++;
      const decision = decideOverrideMutation(await store.getCurrent(command.publicId), receipts.get(command.operationId) ?? null, command);
      if (decision.write) {
        entries.set(command.publicId, decision.snapshot); receipts.set(command.operationId, decision.receipt);
        events.push(decision.result.event);
      }
      return decision.result;
    } };
  const dependencies = { verifier: verifier(), authorization: { async getPrincipal() { return principal(); } },
    store, clock: () => now, ...changes };
  return { run: createAuthorizedEmergencyOverrideMutator(dependencies), entries, receipts, events, get calls() { return calls; } };
}

test("authorized AAL2 request uses the existing domain/store once and server actor/time", async () => {
  const f = fixture(); const result = await f.run("token", intent());
  assert.equal(result.ok, true); assert.equal(f.calls, 1);
  assert.equal(result.event.actorId, `supabase-user:${subject}`);
  assert.equal(result.event.at, new Date(now).toISOString());
  assert.deepEqual([f.entries.size, f.events.length, f.receipts.size], [1, 1, 1]);
});

test("every authentication/authorization/MFA denial makes zero writes/events/receipts", async () => {
  const failures = [
    [undefined, {}, "unauthenticated"],
    [{ user: identity(), aal: "aal2" }, {}, "session_invalid"],
    ["token", { verifier: { async verify() { return { ok: false, code: "session_invalid" }; } } }, "session_invalid"],
    ["token", { verifier: verifier({ expiresAt: Math.floor(now / 1000) - 1 }) }, "session_expired"],
    ["token", { verifier: { async verify() { throw new Error("provider"); } } }, "auth_unavailable"],
    ["token", { authorization: { async getPrincipal() { return null; } } }, "forbidden"],
    ["token", { authorization: { async getPrincipal() { return principal({ status: "REVOKED", revokedAt: new Date(now - 1).toISOString(), revokedBy: "owner" }); } } }, "admin_revoked"],
    ["token", { authorization: { async getPrincipal() { throw new Error("db"); } } }, "authorization_unavailable"],
    ["token", { verifier: verifier({ assurance: "aal1" }) }, "mfa_required"],
    ["token", { verifier: verifier({ assurance: "aal9" }) }, "session_invalid"],
  ];
  for (const [credential, changes, expected] of failures) {
    const f = fixture(changes);
    assert.equal((await f.run(credential, intent())).code, expected);
    assert.deepEqual([f.calls, f.entries.size, f.events.length, f.receipts.size], [0, 0, 0, 0], expected);
  }
});

test("browser actor/role/AAL/subject/time cannot reach the atomic store", async () => {
  for (const field of ["actorId", "actor", "authUserId", "subject", "role", "aal", "assurance", "at", "timestamp", "clock"]) {
    const f = fixture();
    assert.equal((await f.run("token", intent({ [field]: "spoof" }))).code, "validation_error");
    assert.equal(f.calls, 0); assert.equal(f.events.length, 0); assert.equal(f.receipts.size, 0);
  }
  const f = fixture({ verifier: verifier({ assurance: "aal1" }) });
  assert.equal((await f.run("token", intent({ aal: "aal2" }))).code, "mfa_required");
  assert.equal(f.calls, 0);
});

test("fresh authority precedes replay; revoked admin cannot recover receipt through privileged path", async () => {
  let row = principal(); let lookups = 0;
  const f = fixture({ authorization: { async getPrincipal() { lookups++; return row; } } });
  const result = await f.run("token", intent());
  assert.deepEqual(await f.run("token", intent()), result);
  assert.equal(f.calls, 2); assert.equal(f.events.length, 1);
  row = principal({ status: "REVOKED", revokedAt: new Date(now - 1).toISOString(), revokedBy: "owner" });
  assert.equal((await f.run("token", intent())).code, "admin_revoked");
  assert.equal(lookups, 3); assert.equal(f.calls, 2); assert.equal(f.events.length, 1);
});

test("a token expiring during authorization cannot reach persistence", async () => {
  let time = now;
  const f = fixture({ clock: () => time, authorization: { async getPrincipal() { time = now + 7200000; return principal(); } } });
  assert.equal((await f.run("token", intent())).code, "session_expired"); assert.equal(f.calls, 0);
});

test("existing domain conflict/idempotency/store failures are not rewritten into security errors", async () => {
  const f = fixture(); await f.run("token", intent());
  assert.equal((await f.run("token", intent({ operationId: "new" }))).code, "conflict");
  assert.equal((await f.run("token", intent({ reason: "different" }))).code, "idempotency_conflict");
  for (const code of ["store_unavailable", "store_failure"]) {
    const local = fixture({ store: { async mutateAtomically() { return { ok: false, code }; } } });
    assert.equal((await local.run("token", intent())).code, code);
  }
});
