import { defineConfig } from '@playwright/test';

/**
 * This suite is intentionally opt-in. It does not start a workflow or run as
 * part of Vitest; the dashboard and API workflows must already be available.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.journey.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.DASHBOARD_E2E_BASE_URL ?? 'http://127.0.0.1:5173/dashboard/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
});