import { defineConfig } from "@playwright/test";
if (!process.env.HANAPURE_PUBLISHED_TEST_RUN_ID) {
  throw new Error("Run node tests/browser/published-catalogue-server.mjs (owned runner required)");
}

// Separate production-built disposable app; ordinary empty-catalogue tests and
// production data never consume this fixture. No provider/ERP/remote service.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "published-catalogue.spec.ts",
  workers: 1, fullyParallel: false, retries: 0, maxFailures: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: ".next/published-browser-results",
  reporter: [["list"], ["json", { outputFile: ".next/published-browser-report.json" }]],
  use: {
    baseURL: "http://127.0.0.1:3101", browserName: "chromium",
    trace: "retain-on-failure", screenshot: "only-on-failure",
  },
  projects: [375, 1280].map(width => ({
    name: `published-chromium-${width}`,
    use: { viewport: { width, height: 900 } },
  })),
});
