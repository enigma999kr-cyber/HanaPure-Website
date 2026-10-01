import { registerHooks, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Run with Node 24+: node --conditions=react-server --import ./tests/server-only-loader.mjs --test ./tests/erp-product-operational.test.mjs
// Native Node tests use the same server-only marker bundled/aliased by Next.js.
// This test-only resolver does not alter production configuration or stub the guard.
const require = createRequire(import.meta.url);
const nextRoot = dirname(require.resolve("next/package.json"));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "server-only") {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        // Match TypeScript bundler resolution for local extensionless TS imports.
        if (error.code === "ERR_MODULE_NOT_FOUND" && (specifier.startsWith("./") || specifier.startsWith("../"))) {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw error;
      }
    }
    const marker = context.conditions.includes("react-server") ? "empty.js" : "index.js";
    return {
      url: pathToFileURL(join(nextRoot, "dist/compiled/server-only", marker)).href,
      shortCircuit: true,
    };
  },
});
