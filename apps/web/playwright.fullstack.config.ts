import { defineConfig } from "@playwright/test";

const baseURL = process.env.VICAM_FULLSTACK_BASE_URL;
if (!baseURL)
  throw new Error(
    "VICAM_FULLSTACK_BASE_URL es obligatorio para la suite full-stack (por ejemplo https://staging.vicamproduce.com).",
  );

export default defineConfig({
  testDir: "./tests/fullstack",
  timeout: 120_000,
  outputDir: "./test-results/fullstack",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-fullstack" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "fullstack-360",
      use: { browserName: "chromium", viewport: { width: 360, height: 800 } },
    },
    {
      name: "fullstack-768",
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
    {
      name: "fullstack-1440",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
  ],
});
