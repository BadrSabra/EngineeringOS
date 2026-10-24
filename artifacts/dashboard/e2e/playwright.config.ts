import { defineConfig } from "@playwright/test";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const browserName = process.env.DASHBOARD_E2E_BROWSER ?? "chromium";
const localAuthFixtureRequested =
  process.env.ENGINEERINGOS_LOCAL_E2E_AUTH_FIXTURE === "1";
const localAuthFixture =
  localAuthFixtureRequested
  && process.env.NODE_ENV === "test"
  && process.env.RUN_CONTROLLED_RELEASE_VALIDATION === "1"
  && process.env.ENGINEERING_AGENT_LIFECYCLE_E2E === "1"
  && process.env.DASHBOARD_E2E_TEST_MODE === "fixture";
const lifecycleRunId = process.env.ENGINEERING_AGENT_LIFECYCLE_RUN_ID ?? "";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const configuredOutputDir =
  process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/dashboard-journey";

if (localAuthFixtureRequested && !localAuthFixture) {
  throw new Error(
    "Local lifecycle Playwright output requires the isolated NODE_ENV=test fixture runner.",
  );
}
if (localAuthFixture) {
  const expectedOutputDir = resolve(
    workspaceRoot,
    "test-results/engineering-agent-lifecycle",
    lifecycleRunId,
    "playwright",
  );
  if (
    !/^[a-f0-9-]{36}$/i.test(lifecycleRunId)
    || !isAbsolute(configuredOutputDir)
    || resolve(configuredOutputDir) !== expectedOutputDir
  ) {
    throw new Error(
      "Local lifecycle Playwright output must be an absolute path under the unique runId.",
    );
  }
}

if (browserName !== "chromium" && browserName !== "firefox") {
  throw new Error(
    `Unsupported DASHBOARD_E2E_BROWSER "${browserName}"; use chromium or firefox.`,
  );
}

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
    // Assertion/configuration failures are deterministic; retrying them hides
    // the real release signal. Infrastructure retries are handled by the
    // bounded release wrapper instead.
    retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    browserName,
    launchOptions: {
      ...(browserName === "chromium" && process.env.DASHBOARD_E2E_EXECUTABLE_PATH
        ? { executablePath: process.env.DASHBOARD_E2E_EXECUTABLE_PATH }
        : {}),
      ...(browserName === "chromium"
        ? { args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"] }
        : {}),
    },
    baseURL:
      process.env.DASHBOARD_E2E_BASE_URL ?? "http://127.0.0.1:5173/dashboard/",
    outputDir: configuredOutputDir,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The managed release runner retains trace and screenshot artifacts. Do
    // not require Playwright's separately downloaded ffmpeg video helper.
    video: "off",
    ignoreHTTPSErrors: true,
  },
});
