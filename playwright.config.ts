import { defineConfig } from "@playwright/test";

// Production server, loopback only. Never reuse an unknown/stale running app.
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: ".next/browser-test-results",
  reporter: [["list"], ["json", { outputFile: ".next/browser-test-report.json" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [320, 375, 768, 1024, 1280].map(width => ({
    name: `chromium-${width}`,
    use: { viewport: { width, height: 900 } },
  })),
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/en",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { HANAPURE_PUBLIC_SITE_ORIGIN: "" },
  },
});
