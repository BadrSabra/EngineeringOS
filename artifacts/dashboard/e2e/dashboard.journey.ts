import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_PATH = '/dashboard/';
const TEST_USER = {
  firstName: 'EngineeringOS',
  lastName: 'Dashboard Smoke',
  email: process.env.DASHBOARD_E2E_EMAIL ?? 'engineeringos-dashboard-smoke@example.com',
};
const EXECUTION_ID = 'e2e-controlled-execution';

const dashboardFixture = {
  projectCount: 1,
  activeTaskCount: 0,
  completedTaskCount: 2,
  failedTaskCount: 0,
  taskStatusBreakdown: { pending: 0, running: 0 },
  projectScores: [{ projectId: 'e2e-project', projectName: 'Smoke Project', score: 92, trend: 'stable' }],
  recentEvents: [{ id: 'e2e-event', type: 'SmokeCheck', severity: 'success', message: 'Dashboard API fixture ready', timestamp: '2026-01-01T00:00:00.000Z' }],
  topRules: [],
};

const executionFixture = {
  id: EXECUTION_ID,
  projectId: 'e2e-project',
  operationId: 'e2e-operation',
  status: 'completed',
  flightState: 'COMPLETED',
  evidenceVerdict: 'PROVEN',
  proofRequired: false,
  resumable: false,
  checkpointVersion: 1,
  checkpoint: { stage: 'complete', detail: 'Controlled browser fixture completed.' },
  objective: { objective: 'Verify the dashboard browser journey' },
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:01:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function installApiFixtures(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/dashboard') return route.fulfill(jsonResponse(dashboardFixture));
    if (path === '/api/projects') {
      return route.fulfill(jsonResponse([{ id: 'e2e-project', name: 'Smoke Project', language: 'TypeScript', framework: 'React', status: 'active', rootPath: '/controlled/smoke', qualityScore: 92 }]));
    }
    if (path === '/api/events') return route.fulfill(jsonResponse(dashboardFixture.recentEvents));
    if (path === `/api/ai/executions/${EXECUTION_ID}`) return route.fulfill(jsonResponse(executionFixture));
    if (path === '/api/ai/mission-control') return route.fulfill(jsonResponse({ updatedAt: '2026-01-01T00:01:00.000Z', executions: [] }));

    // AI is deliberately not executed in this smoke journey. This response
    // verifies the user-visible unavailable/empty state without a provider.
    if (path.startsWith('/api/ai/')) return route.fulfill(jsonResponse({ error: 'AI provider not configured' }, 428));

    return route.continue();
  });
}

async function programmaticSignIn(page: Page) {
  await page.goto(DASHBOARD_PATH);
  await expect(page.getByRole('link', { name: 'Sign In', exact: true })).toBeVisible();

  const helper = globalThis.signInClerkUser ?? globalThis.__ENGINEERINGOS_SIGN_IN_CLERK_USER__;
  if (!helper) {
    throw new Error(
      'Clerk browser helper is unavailable. Run this journey in the Replit browser runner, which injects signInClerkUser.',
    );
  }
  const signInUrl = await helper({ ...TEST_USER, ttl: 900, basePath: DASHBOARD_PATH });
  await page.goto(signInUrl);
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll('/', '\\/')}$`));
}

async function openNavigation(page: Page, label: string, path: string) {
  await page.getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
}

test.describe('EngineeringOS dashboard browser journey', () => {
  test('signs in and traverses the authenticated operational shell', async ({ page }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);

    await expect(page.getByRole('heading', { name: 'System Overview' })).toBeVisible();
    await expect(page.getByText('SYSTEM ONLINE', { exact: true })).toBeVisible();
    await expect(page.getByText('Smoke Project', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Dashboard API fixture ready', { exact: true })).toBeVisible();

    await openNavigation(page, 'Projects', `${DASHBOARD_PATH}projects`);
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByText('Smoke Project', { exact: true })).toBeVisible();

    await openNavigation(page, 'Events', `${DASHBOARD_PATH}events`);
    await expect(page.getByRole('heading', { name: 'Event Stream' })).toBeVisible();
    await expect(page.getByText('Dashboard API fixture ready', { exact: true })).toBeVisible();

    await openNavigation(page, 'AI Assistant', `${DASHBOARD_PATH}ai`);
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.getByText(/AI provider not configured|No AI key configured|AI Assistant/i).first()).toBeVisible();

    await openNavigation(page, 'Mission Control', `${DASHBOARD_PATH}mission-control`);
    await expect(page.getByRole('heading', { name: 'No durable runs in the ledger' })).toBeVisible();

    await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll('/', '\\/')}flight-deck\\?executionId=`));
    await expect(page.getByRole('heading', { name: 'Audit / Chat run' })).toBeVisible();
    await expect(page.getByText('Controlled browser fixture completed.', { exact: true })).toBeVisible();
    await expect(page.getByText('PROVEN', { exact: true }).first()).toBeVisible();
  });

  test('renders a user-visible API failure state', async ({ page }) => {
    await page.route('**/api/dashboard', (route) =>
      route.fulfill(jsonResponse({ error: 'controlled dashboard outage' }, 503)),
    );
    await programmaticSignIn(page);
    await expect(page.getByRole('heading', { name: 'Failed to load dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry Connection' })).toBeVisible();
  });
});