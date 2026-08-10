import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/rollback",
  outputDir: "./test-results-rollback",
  preserveOutput: "always",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-rollback" }]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec tsc -b && pnpm exec vite build && pnpm preview --port 4174",
    env: { VITE_OFFLINE_ENABLED: "false" },
    reuseExistingServer: false,
    timeout: 120000,
    url: "http://127.0.0.1:4174/app",
  },
  projects: [
    { name: "online-only-360", use: { viewport: { width: 360, height: 800 } } },
    { name: "online-only-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
