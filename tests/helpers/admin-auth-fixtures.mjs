export const subject = "a1234567-1234-4321-8123-123456789abc";
export const otherSubject = "b1234567-1234-4321-8123-123456789abc";
export const now = Date.now();
export const identity = (changes = {}) => ({ subject, sessionId: otherSubject,
  issuedAt: Math.floor(now / 1000) - 60, expiresAt: Math.floor(now / 1000) + 3600, assurance: "aal2", ...changes });
export const verifier = (changes = {}) => ({ async verify() { return { ok: true, identity: identity(changes) }; } });
export const principal = (changes = {}) => ({ authUserId: subject, permission: "emergency_override:mutate",
  status: "ACTIVE", grantedAt: new Date(now - 600000).toISOString(), grantedBy: "migration-owner:fixture",
  revokedAt: null, revokedBy: null, ...changes });
export const intent = (changes = {}) => ({ publicId: otherSubject, operationId: "unit2f-operation",
  action: "CREATE", expectedRevision: null, mode: "SALES_PAUSED", reason: "incident", ...changes });
