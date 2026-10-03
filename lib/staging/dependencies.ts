import "server-only";

import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { createPostgresEmergencyOverrideStore } from "../erp/postgres-emergency-override-store";
import { createPostgresAdminAuthorizationReader } from "../auth/admin-authorization";
import { createAuthorizedEmergencyOverrideMutator } from "../auth/authorized-emergency-override";
import { createSupabaseAdminIdentityVerifier } from "../supabase/server";
import { assertStagingNodeRuntime, STAGING_LIMITS, validateStagingConfiguration } from "./config";
import { createDatabaseReadinessProbe } from "./database-readiness";

type ServerPool = Pick<Pool, "connect" | "end" | "on">;
type TrustedDependencies = Readonly<{
  createPool?: (options: PoolConfig) => ServerPool;
  authFetch?: typeof fetch;
}>;
const timeoutError = () => Object.assign(new Error("staging_database_timeout"), { code: "ETIMEDOUT" });
function databaseError(message: string, error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return Object.assign(new Error(message),
    typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? { code } : {});
}

/** No cancellation fiction: a timed-out checked-out client is destroyed, never reused. */
function bounded<T>(work: Promise<T>, milliseconds: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { onTimeout(); reject(timeoutError()); }, milliseconds);
    work.then((value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Trusted server/test construction seam. One scope per module, not per request. */
export function createStagingDependencyScope(trusted: TrustedDependencies = {}) {
  let cached: ReturnType<typeof construct> | undefined;
  let fingerprint: string | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const createPool = trusted.createPool ?? ((options: PoolConfig) => new Pool(options));

  function construct(config: ReturnType<typeof validateStagingConfiguration>) {
    let pool: ServerPool;
    try {
      pool = createPool({ ...config.database, max: 1,
        ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: STAGING_LIMITS.connectionMs,
        idleTimeoutMillis: STAGING_LIMITS.idleMs,
        query_timeout: STAGING_LIMITS.queryMs,
        allowExitOnIdle: true,
      });
    } catch { throw new Error("staging_pool_construction_failed"); }
    // Idle-client failures must not crash the process or log connection details.
    pool.on("error", () => {});
    const leases = new Set<(destroy?: boolean) => void>();
    const boundedPool = {
      async connect(): Promise<PoolClient> {
        if (closed) throw new Error("staging_dependencies_closed");
        let abandoned = false;
        const pending = pool.connect();
        // A checkout resolving after its deadline/shutdown must return no leaked lease.
        void pending.then((client) => { if (abandoned || closed) client.release(true); }, () => {});
        let client: PoolClient;
        try { client = await bounded(pending, STAGING_LIMITS.connectionMs, () => { abandoned = true; }); }
        catch (error) { throw databaseError("staging_database_connection_failed", error); }
        if (closed) throw new Error("staging_dependencies_closed");
        let released = false;
        const release = (destroy = false) => {
          if (released) return;
          released = true; leases.delete(release); client.release(destroy);
        };
        leases.add(release);
        // Existing Unit 2E/2F consume only promise-based query(sql, values) and release.
        // No statement name or session-level SET is introduced by this adapter.
        return {
          async query(sql: string, values?: unknown[]) {
            if (released) throw timeoutError();
            try {
              const result = await bounded(client.query(sql, values), STAGING_LIMITS.queryMs, () => release(true));
              if (released) throw timeoutError();
              return result;
            } catch (error) {
              // pg's own read timeout can win our timer. Retire the client in either case.
              if (error instanceof Error && error.message === "Query read timeout") {
                release(true); throw timeoutError();
              }
              // Preserve SQLSTATE/infrastructure taxonomy, not driver diagnostics or SQL detail.
              throw databaseError("staging_database_query_failed", error);
            }
          }, release,
        } as unknown as PoolClient;
      },
    };
    const store = createPostgresEmergencyOverrideStore(boundedPool);
    const authorization = createPostgresAdminAuthorizationReader(boundedPool);
    const verifier = createSupabaseAdminIdentityVerifier({ ...config.publicAuth,
      fetch: trusted.authFetch, timeoutMs: STAGING_LIMITS.authFetchMs });
    const publicSeams = Object.freeze({ store, authorization, verifier,
      probeDatabase: createDatabaseReadinessProbe(boundedPool),
      mutate: createAuthorizedEmergencyOverrideMutator({ store, authorization, verifier }) });
    return { publicSeams, async close() {
      for (const release of leases) release(true);
      try { await bounded(pool.end(), STAGING_LIMITS.shutdownMs, () => {}); }
      catch { throw new Error("staging_pool_shutdown_failed"); }
    } };
  }

  return Object.freeze({
    get(input: unknown) {
      assertStagingNodeRuntime();
      const config = validateStagingConfiguration(input);
      if (closed) throw new Error("staging_dependencies_closed");
      const nextFingerprint = createHash("sha256").update(JSON.stringify(config)).digest("hex");
      if (fingerprint && fingerprint !== nextFingerprint) throw new Error("staging_configuration_changed_restart_required");
      if (!cached) { cached = construct(config); fingerprint = nextFingerprint; }
      return cached.publicSeams;
    },
    close(): Promise<void> {
      closed = true;
      closing ??= cached ? cached.close() : Promise.resolve();
      return closing;
    },
  });
}

// Importing the module creates no pool, client, credential or network connection.
const stagingScope = createStagingDependencyScope();
export const getStagingDependencies = (configuration: unknown) => stagingScope.get(configuration);
export const closeStagingDependencies = () => stagingScope.close();
