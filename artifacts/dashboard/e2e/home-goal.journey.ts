import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { LOCAL_E2E_AUTH_STORAGE_KEY } from "./fixtures/local-e2e-auth";

const DASHBOARD_PATH = "/dashboard/";
const GOAL_DRAFT_KEY = "engineeringos:goal-drafts:v2";
const localFixtureEnabled = process.env.DASHBOARD_E2E_PROTECTED_VISUAL === "1";
const blockedBrowserEgressHosts = new Set<string>();
const apiRequests: string[] = [];

type ProjectFixture = {
  id: string;
  name: string;
  status: string;
  ownerId: string;
};

function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
}

async function fulfillJson(
  route: Route,
  status: number,
  body: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installGoalApiFixtures(
  page: Page,
  projects: ProjectFixture[],
): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/dashboard(?=\/|$)/, "");
    const method = route.request().method().toUpperCase();
    apiRequests.push(`${method} ${path}`);

    if (method === "GET" && path === "/api/projects") {
      await fulfillJson(route, 200, projects);
      return;
    }
    if (method === "GET" && path === "/api/dashboard") {
      await fulfillJson(route, 503, { error: "isolated dashboard failure" });
      return;
    }
    if (method === "GET" && path === "/api/dashboard/work-summary") {
      await fulfillJson(route, 503, { error: "isolated summary failure" });
      return;
    }
    if (method === "GET" && path === "/api/ai/chat/sessions") {
      await fulfillJson(route, 200, []);
      return;
    }
    if (method === "GET" && path.endsWith("/messages")) {
      await fulfillJson(route, 200, []);
      return;
    }
    if (method === "GET" && path === "/api/ai/executions/history") {
      await fulfillJson(route, 200, []);
      return;
    }
    if (method === "GET" && path === "/api/ai/delivery/recoverable") {
      await fulfillJson(route, 200, []);
      return;
    }
    if (method === "GET" && path === "/api/ai/operator-alerts") {
      await fulfillJson(route, 200, { alerts: [] });
      return;
    }
    await fulfillJson(route, 200, {});
  });
}

test.beforeEach(async ({ page }) => {
  blockedBrowserEgressHosts.clear();
  apiRequests.length = 0;
  if (!localFixtureEnabled) return;

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      await route.continue();
      return;
    }
    if (isLoopback(url.hostname)) {
      await route.continue();
      return;
    }
    blockedBrowserEgressHosts.add(url.hostname.toLowerCase());
    await route.abort("blockedbyclient");
  });
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, "signed-in");
  }, LOCAL_E2E_AUTH_STORAGE_KEY);
});

test.afterEach(async () => {
  if (!localFixtureEnabled) return;
  const auditPath = process.env.DASHBOARD_E2E_BROWSER_EGRESS_AUDIT_PATH;
  if (!auditPath) {
    throw new Error("The isolated browser egress audit path is required.");
  }
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(
    auditPath,
    `${JSON.stringify({
      guard: "playwright-loopback-only",
      externalNetworkAllowed: false,
      blockedHosts: [...blockedBrowserEgressHosts].sort(),
      blockedRequestCount: blockedBrowserEgressHosts.size,
    }, null, 2)}\n`,
    "utf8",
  );
});

test("UXW-01 goal handoff works on mobile when dashboard analytics fail", async ({
  page,
}) => {
  test.skip(
    !localFixtureEnabled,
    "This journey requires the isolated local-auth browser fixture.",
  );
  await page.setViewportSize({ width: 402, height: 874 });
  await installGoalApiFixtures(page, [{
    id: "uxw-project-1",
    name: "بوابة العملاء",
    language: "TypeScript",
    framework: "React",
    status: "active",
    rootPath: "/controlled/uxw",
    qualityScore: 92,
    ownerId: "test-user",
  }]);
  await page.goto(DASHBOARD_PATH, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  await expect(page.getByTestId("status-dashboard-summary-loading")).toHaveCount(0);
  await expect(page.getByText("تعذر تحميل ملخص العمل")).toBeVisible();

  const goalSection = page.getByTestId("section-home-goal");
  const goalInput = page.getByTestId("input-home-goal");
  await expect(goalInput).toBeVisible();
  await expect(goalSection).toHaveAttribute("dir", "rtl");
  await expect(goalInput).toHaveAttribute("dir", "auto");
  await goalInput.fill("أريد مراجعة مشكلة تسجيل الدخول");
  await goalInput.focus();
  await page.keyboard.press("Tab");

  const startButton = page.getByTestId("button-start-goal");
  await expect(startButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("panel-goal-destination")).toBeVisible();

  const projectSelector = page.getByTestId("select-goal-project");
  await projectSelector.selectOption("uxw-project-1");
  await projectSelector.focus();
  await page.keyboard.press("Tab");
  const continueButton = page.getByTestId("button-route-goal-project");
  await expect(continueButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/ai\?projectId=uxw-project-1&goalDraftId=/);
  const drafts = await page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  }, GOAL_DRAFT_KEY) as Array<Record<string, unknown>>;
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({
    text: "أريد مراجعة مشكلة تسجيل الدخول",
    projectId: "uxw-project-1",
    sendAttemptedAt: null,
  });
  expect(apiRequests.filter((request) => !request.startsWith("GET "))).toEqual([]);

  const bounds = await goalSection.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(402);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("UXW-01 new-project handoff preserves the goal without starting work", async ({
  page,
}) => {
  test.skip(
    !localFixtureEnabled,
    "This journey requires the isolated local-auth browser fixture.",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await installGoalApiFixtures(page, []);
  await page.goto(DASHBOARD_PATH, { waitUntil: "domcontentloaded" });

  const goalInput = page.getByTestId("input-home-goal");
  await expect(goalInput).toBeVisible();
  await expect(page.getByText("تعذر تحميل ملخص العمل")).toBeVisible();
  await goalInput.fill("أريد إنشاء تطبيق لمتابعة العملاء");
  await page.getByTestId("button-start-goal").click();
  await expect(page.getByTestId("panel-goal-destination")).toBeVisible();
  await page.getByTestId("button-route-goal-project").click();

  await expect(page).toHaveURL(/\/dashboard\/projects\?create=1&goalDraftId=/);
  await expect(page.getByTestId("input-project-name")).toBeVisible();
  await expect(page.getByTestId("input-project-description")).toHaveValue(
    "أريد إنشاء تطبيق لمتابعة العملاء",
  );
  expect(apiRequests.filter((request) => !request.startsWith("GET "))).toEqual([]);
});
