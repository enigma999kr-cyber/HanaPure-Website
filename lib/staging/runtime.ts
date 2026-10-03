import "server-only";

import { assertStagingNodeRuntime, validateStagingConfiguration } from "./config";
import { getStagingDependencies } from "./dependencies";

type Environment = Readonly<Record<string, string | undefined>>;
export const STAGING_RUNTIME = "nodejs";

/** Single trusted SERVER environment boundary. No build-time evaluation or client input. */
export function readStagingRuntimeConfiguration(env: Environment = process.env) {
  assertStagingNodeRuntime();
  if (env.NEXT_RUNTIME !== undefined && env.NEXT_RUNTIME !== STAGING_RUNTIME) throw new Error("staging_node_runtime_required");
  if (env.HANAPURE_STAGING_ENABLED !== "true") throw new Error("staging_disabled");
  const vercel = env.VERCEL_ENV !== undefined || env.VERCEL_TARGET_ENV !== undefined;
  if (env.HANAPURE_ENVIRONMENT !== "staging" || vercel &&
    (env.VERCEL_ENV !== "preview" || env.VERCEL_TARGET_ENV !== "staging")) throw new Error("staging_environment_required");
  const port = env.HANAPURE_STAGING_DB_PORT;
  if (typeof port !== "string" || !/^[1-9]\d{0,4}$/.test(port)) throw new Error("staging_configuration_invalid:database.port");
  return validateStagingConfiguration({ enabled: true, environment: "staging",
    database: { host: env.HANAPURE_STAGING_DB_HOST, port: Number(port), database: env.HANAPURE_STAGING_DB_NAME,
      user: env.HANAPURE_STAGING_DB_USER, password: env.HANAPURE_STAGING_DB_PASSWORD },
    publicAuth: { url: env.HANAPURE_STAGING_AUTH_URL, publishableKey: env.HANAPURE_STAGING_AUTH_PUBLISHABLE_KEY } });
}

/** Next Node server callers reuse B1's module scope. No new pool/singleton/session. */
export const getStagingRuntimeDependencies = () => getStagingDependencies(readStagingRuntimeConfiguration());
