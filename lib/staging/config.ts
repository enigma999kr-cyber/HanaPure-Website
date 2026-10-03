import "server-only";

/** Explicit server input only; no env lookup, provider defaults, or URL credentials. */
export type StagingConfiguration = Readonly<{
  enabled: true;
  environment: "staging";
  database: Readonly<{ host: string; port: number; database: string; user: string; password: string }>;
  publicAuth: Readonly<{ url: string; publishableKey: string }>;
}>;

export const STAGING_LIMITS = Object.freeze({
  connectionMs: 5000, queryMs: 20000, idleMs: 10000, shutdownMs: 5000, authFetchMs: 5000,
});

class ConfigurationError extends Error {
  readonly field: string;
  constructor(field: string) { super(`staging_configuration_invalid:${field}`); this.field = field; }
}
const invalid = (field: string): never => { throw new ConfigurationError(field); };
function fields(value: unknown, names: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(field);
  const record = value as Record<string, unknown>;
  // Reject extra settings such as connectionString/ssl that could bypass validated options.
  if (Reflect.ownKeys(record).some((key) => typeof key !== "string" || !names.includes(key)) ||
    names.some((key) => !Object.hasOwn(record, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(record, key)!, "value"))) {
    invalid(field);
  }
  return record;
}
const text = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);

/** Errors contain fixed field names only, never supplied values or underlying errors. */
export function validateStagingConfiguration(input: unknown): StagingConfiguration {
  try {
    const root = fields(input, ["enabled", "environment", "database", "publicAuth"], "root");
    if (root.enabled !== true) invalid("enabled");
    if (root.environment !== "staging") invalid("environment");
    const db = fields(root.database, ["host", "port", "database", "user", "password"], "database");
    if (!text(db.host) || db.host.length > 253 || !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/i.test(db.host) ||
      db.host.includes("..")) invalid("database.host");
    if (!Number.isSafeInteger(db.port) || Number(db.port) < 1 || Number(db.port) > 65535) invalid("database.port");
    if (!text(db.database) || !/^[a-z][a-z0-9_]{0,62}$/i.test(db.database)) invalid("database.name");
    // A named dedicated login is still subject to owner-managed grants in later staging.
    if (!text(db.user) || !/^[a-z][a-z0-9_.-]{0,127}$/i.test(db.user) ||
      /^(postgres|supabase_admin|service_role|admin|root)(\.|$)/i.test(db.user)) invalid("database.user");
    if (!text(db.password) || !db.password.trim()) invalid("database.password");
    const auth = fields(root.publicAuth, ["url", "publishableKey"], "publicAuth");
    if (!text(auth.url)) invalid("publicAuth.url");
    let url: URL;
    try { url = new URL(auth.url as string); } catch { return invalid("publicAuth.url"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      invalid("publicAuth.url");
    }
    if (!text(auth.publishableKey) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(auth.publishableKey)) {
      invalid("publicAuth.publishableKey");
    }
    return Object.freeze({ enabled: true, environment: "staging",
      database: Object.freeze({ host: db.host as string, port: db.port as number, database: db.database as string,
        user: db.user as string, password: db.password as string }),
      publicAuth: Object.freeze({ url: url.origin, publishableKey: auth.publishableKey as string }),
    });
  } catch (error) {
    // Also sanitize hostile getters/proxies and URL parser diagnostics.
    let field = "root";
    try { if (error instanceof ConfigurationError) field = error.field; } catch { /* Hostile thrown proxy. */ }
    return invalid(field);
  }
}

export function assertStagingNodeRuntime(version: string = process.versions.node): void {
  if (!/^24\.\d+\.\d+$/.test(version)) throw new Error("staging_runtime_requires_node_24");
}
