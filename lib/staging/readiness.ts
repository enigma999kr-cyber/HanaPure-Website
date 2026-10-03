import "server-only";

import { readStagingRuntimeConfiguration } from "./runtime";
import { getStagingDependencies } from "./dependencies";
import type { DatabaseReadiness } from "./database-readiness";

export type StagingReadiness = Readonly<{
  configuration: "disabled" | "invalid" | "ready";
  database: "not_checked" | DatabaseReadiness;
  auth: "not_checked" | "configured_not_verified";
}>;

/** Internal diagnostics only; no HTTP endpoint/Server Action, token or mutation input. */
export async function checkStagingReadiness(): Promise<StagingReadiness> {
  let configuration;
  try { configuration = readStagingRuntimeConfiguration(); }
  catch (error) {
    return Object.freeze({ configuration: error instanceof Error && error.message === "staging_disabled" ? "disabled" : "invalid",
      database: "not_checked", auth: "not_checked" });
  }
  try {
    const deps = getStagingDependencies(configuration);
    return Object.freeze({ configuration: "ready", database: await deps.probeDatabase(), auth: "configured_not_verified" });
  } catch {
    return Object.freeze({ configuration: "invalid", database: "not_checked", auth: "not_checked" });
  }
}
