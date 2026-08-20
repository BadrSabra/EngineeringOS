import { defineConfig } from "@playwright/test";

/**
 * This suite is intentionally separate from Vitest. The release runner starts
 * the dashboard and API workflows and performs their health checks before
 * invoking Playwright.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.journey.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    launchOptions: {
      ...(process.env.DASHBOARD_E2E_EXECUTABLE_PATH
        ? { executablePath: process.env.DASHBOARD_E2E_EXECUTABLE_PATH }
        : {}),
      args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
    },
    baseURL:
      process.env.DASHBOARD_E2E_BASE_URL ?? "http://127.0.0.1:5173/dashboard/",
    outputDir:
      process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/dashboard-journey",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The managed release runner retains trace and screenshot artifacts. Do
    // not require Playwright's separately downloaded ffmpeg video helper.
    video: "off",
    ignoreHTTPSErrors: true,
  },
});
