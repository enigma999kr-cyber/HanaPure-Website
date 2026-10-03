// Operator-only Node harness. Never import this entry point from a Next route/component.
import { checkStagingReadiness } from "../lib/staging/readiness.ts";
import { closeStagingDependencies } from "../lib/staging/dependencies.ts";

let result;
try { result = await checkStagingReadiness(); }
catch { result = { configuration: "invalid", database: "not_checked", auth: "not_checked" }; }
try { await closeStagingDependencies(); }
catch { result = { ...result, database: "database_unavailable" }; }
console.log(JSON.stringify(result));
process.exitCode = result.configuration === "ready" && result.database === "ready" ? 0 : 1;
