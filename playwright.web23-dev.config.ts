import { defineConfig } from "@playwright/test";
import { join } from "node:path";

// Only the owned dev runner supplies this environment after filtering caller input.
if (process.env.NODE_ENV !== "development") throw new Error("WEB23 dev runner required");
// Keep config loading independent of the ESM runner in CommonJS projects.
const owner = /^hanapure-published-catalogue-browser-v1:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(process.env.HANAPURE_PUBLISHED_TEST_RUN_ID ?? "");
if (!owner) throw new Error("Invalid owned WEB23 development evidence identity");
const root = join(".next", `web23-dev-not-production-${owner[1]}`);
const evidence = { results: join(root, "results"), report: join(root, "report.json") };

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "published-catalogue.spec.ts",
  grep: /\[web23\]/,
  workers: 1, fullyParallel: false, retries: 0, maxFailures: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  metadata: { validationMode: "DEV-NOT-PRODUCTION" },
  outputDir: evidence.results,
  reporter: [["list"], ["json", { outputFile: evidence.report }]],
  use: {
    baseURL: "http://127.0.0.1:3101", browserName: "chromium",
    trace: "retain-on-failure", screenshot: "only-on-failure",
  },
  projects: [{ name: "published-chromium-375", use: { viewport: { width: 375, height: 900 } } }],
});
