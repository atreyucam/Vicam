import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  preserveOutput: "always",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec tsc -b && pnpm exec vite build && pnpm preview --port 4173",
    url: "http://127.0.0.1:4173/app",
    reuseExistingServer: true,
    timeout: 120000,
    env: { VITE_OFFLINE_ENABLED: process.env.VITE_OFFLINE_ENABLED ?? "true" },
  },
  projects: [
    { name: "mobile-360", use: { browserName: "chromium", viewport: { width: 360, height: 800 } } },
    { name: "mobile-390", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    {
      name: "tablet-768",
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop-1366",
      use: { browserName: "chromium", viewport: { width: 1366, height: 768 } },
    },
    {
      name: "desktop-1440",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
  ],
});
