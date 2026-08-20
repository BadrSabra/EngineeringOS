import { expect, test, type Page } from "@playwright/test";
import {
  parseClerkSignInTokenResponse,
  parseClerkUserLookupResponse,
  parseCreatedClerkUserResponse,
} from "../src/lib/clerk-handoff";

const DASHBOARD_PATH = "/dashboard/";
const TEST_USER = {
  firstName: "EngineeringOS",
  lastName: "Dashboard Smoke",
  email:
    process.env.DASHBOARD_E2E_EMAIL ??
    "engineeringos-dashboard-smoke@example.com",
};
const EXECUTION_ID = "e2e-controlled-execution";

const dashboardFixture = {
  projectCount: 1,
  activeTaskCount: 0,
  completedTaskCount: 2,
  failedTaskCount: 0,
  taskStatusBreakdown: { pending: 0, running: 0 },
  projectScores: [
    {
      projectId: "e2e-project",
      projectName: "Smoke Project",
      score: 92,
      trend: "stable",
    },
  ],
  recentEvents: [
    {
      id: "e2e-event",
      type: "SmokeCheck",
      severity: "success",
      message: "Dashboard API fixture ready",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  ],
  topRules: [],
};

const executionFixture = {
  id: EXECUTION_ID,
  projectId: "e2e-project",
  operationId: "e2e-operation",
  status: "completed",
  flightState: "COMPLETED",
  evidenceVerdict: "PROVEN",
  proofRequired: false,
  resumable: false,
  checkpointVersion: 1,
  checkpoint: {
    stage: "complete",
    detail: "Controlled browser fixture completed.",
  },
  objective: { objective: "Verify the dashboard browser journey" },
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

type ArabicAiFixture = {
  question: string;
  answer: string;
  source: string;
  sessionId: string;
  streamBody: string;
  message: Record<string, unknown>;
};

async function installApiFixtures(
  page: Page,
  overrides?: { arabicAi?: ArabicAiFixture },
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const arabicAi = overrides?.arabicAi;

    if (arabicAi && path.endsWith("/api/ai/chat/sessions"))
      return route.fulfill(jsonResponse([
        {
          id: arabicAi.sessionId,
          title: arabicAi.question,
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
      ]));
    if (arabicAi && path.endsWith("/api/ai/chat/stream"))
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache" },
        body: arabicAi.streamBody,
      });
    if (arabicAi && path.endsWith(`/api/ai/chat/${arabicAi.sessionId}/messages`))
      return route.fulfill(jsonResponse([
        {
          id: "e2e-arabic-user-message",
          sessionId: arabicAi.sessionId,
          role: "user",
          content: arabicAi.question,
          createdAt: "2026-01-01T00:01:00.000Z",
        },
        arabicAi.message,
      ]));

    if (path === "/api/dashboard")
      return route.fulfill(jsonResponse(dashboardFixture));
    if (path === "/api/projects") {
      return route.fulfill(
        jsonResponse([
          {
            id: "e2e-project",
            name: "Smoke Project",
            language: "TypeScript",
            framework: "React",
            status: "active",
            rootPath: "/controlled/smoke",
            qualityScore: 92,
          },
        ]),
      );
    }
    if (path === "/api/events")
      return route.fulfill(jsonResponse(dashboardFixture.recentEvents));
    if (path === `/api/ai/executions/${EXECUTION_ID}`)
      return route.fulfill(jsonResponse(executionFixture));
    if (path === "/api/ai/mission-control")
      return route.fulfill(
        jsonResponse({ updatedAt: "2026-01-01T00:01:00.000Z", executions: [] }),
      );

    // AI is deliberately not executed in this smoke journey. This response
    // verifies the user-visible unavailable/empty state without a provider.
    if (path.startsWith("/api/ai/"))
      return route.fulfill(
        jsonResponse({ error: "AI provider not configured" }, 428),
      );

    return route.continue();
  });
}

async function installArabicAiFixture(page: Page, options?: { blocked?: boolean }) {
  const sessionId = "e2e-arabic-ai-session";
  const messageId = "e2e-arabic-ai-message";
  const source = "src/execution-tools.ts";
  const blocked = options?.blocked === true;
  const question = "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟";
  const answer =
    "عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.";
  const evidence = [{
    source,
    ...(blocked
      ? {
          excerpt: "provider timeout is handled here",
          supportsClaim: false,
          evidenceClass: "READ_CONFIRMED",
          citationStatus: "BLOCKED",
          citationReason: "MISSING_LITERAL_MATCH",
        }
      : {
          excerpt: 'return partialFromCollectedEvidence("provider timeout");',
          sourceSpan: { startLine: 42, endLine: 42 },
          supportsClaim: true,
          evidenceClass: "BEHAVIOR_PROVEN",
          citationStatus: "ACCEPTED",
          citationReason: "ACCEPTED_SOURCE_SPAN",
        }),
  }];
  const toolTrace = [
    { kind: "tool_call", tool: "read_file", args: { path: source }, cached: false, prefetched: true },
    { kind: "tool_result", tool: "read_file", source, cached: false, prefetched: true },
    {
      kind: "evidence_integrity",
      code: "EVIDENCE_INTEGRITY_OK",
      consistent: true,
      violations: [],
      evidenceFileCount: 1,
      acceptedEvidenceCount: 1,
      completedReadFiles: [source],
      acceptedEvidenceFiles: [source],
    },
  ];
  const taskResult = {
    kind: "BEHAVIOR_ANSWER_RESULT",
    answer: {
      answer,
      evidence,
      confidence: 1,
      sourceScope: [source],
      coverage: {
        requestedFields: ["timeout behavior"],
        answeredFields: ["timeout behavior"],
        missingFields: [],
        complete: true,
      },
    },
  };
  const message = {
    id: messageId,
    sessionId,
    role: "assistant",
    content: answer,
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    behaviorEvidence: evidence,
    taskResult,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({ type: "execution_started", executionId: "e2e-execution", status: "running", resumable: true }),
    sse({ type: "stage", stage: "building-context" }),
    sse({ type: "stage", stage: "calling-model" }),
    sse({ type: "tool_call", tool: "read_file", args: { path: source }, cached: false, prefetched: true }),
    sse({ type: "tool_result", tool: "read_file", source, cached: false, prefetched: true }),
    sse({
      type: "evidence_integrity",
      code: "EVIDENCE_INTEGRITY_OK",
      consistent: true,
      violations: [],
      evidenceFileCount: 1,
      acceptedEvidenceCount: 1,
      completedReadFiles: [source],
      acceptedEvidenceFiles: [source],
    }),
    sse({ type: "delta", delta: answer }),
    sse({
      type: "done",
      sessionId,
      message,
      sources: [source],
      toolTrace: JSON.stringify(toolTrace),
      behaviorEvidence: evidence,
      taskResult,
      pendingChanges: [],
    }),
  ].join("");

  return { question, answer, source, sessionId, streamBody, message };
}

async function createReleaseSignInUrl(page: Page) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "CLERK_SECRET_KEY is required for the release-only programmatic Clerk handoff.",
    );
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
  const userResponse = await page.request.get(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TEST_USER.email)}`,
    { headers },
  );
  let userId = parseClerkUserLookupResponse(await userResponse.json());

  if (!userId) {
    const createdResponse = await page.request.post(
      "https://api.clerk.com/v1/users",
      {
        headers,
        data: {
          email_address: [TEST_USER.email],
          first_name: TEST_USER.firstName,
          last_name: TEST_USER.lastName,
          skip_password_checks: true,
          skip_password_requirement: true,
        },
      },
    );
    userId = parseCreatedClerkUserResponse(await createdResponse.json());
  }

  if (!userId) {
    throw new Error(
      "The isolated Clerk release user could not be provisioned.",
    );
  }

  const tokenResponse = await page.request.post(
    "https://api.clerk.com/v1/sign_in_tokens",
    { headers, data: { user_id: userId } },
  );
  const token = parseClerkSignInTokenResponse(await tokenResponse.json());

  return `${new URL(DASHBOARD_PATH, page.url()).toString()}sign-in?__clerk_ticket=${encodeURIComponent(token)}`;
}

async function programmaticSignIn(page: Page) {
  await page.goto(DASHBOARD_PATH);
  await expect(
    page.getByRole("link", { name: "Sign In", exact: true }),
  ).toBeVisible();

  const helper =
    globalThis.signInClerkUser ??
    globalThis.__ENGINEERINGOS_SIGN_IN_CLERK_USER__;
  if (!helper) {
    if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
      throw new Error(
        "Clerk browser helper is unavailable. Run this journey in the Replit browser runner, which injects signInClerkUser.",
      );
    }
    await page.goto(await createReleaseSignInUrl(page));
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
    );
    return;
  }
  const signInUrl = await helper({
    ...TEST_USER,
    ttl: 900,
    basePath: DASHBOARD_PATH,
  });
  await page.goto(signInUrl);
  await expect(page).toHaveURL(
    new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  );
}

async function openNavigation(page: Page, label: string, path: string) {
  await page.getByRole("link", { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
}

test.describe("EngineeringOS dashboard browser journey", () => {
  test("signs in and traverses the authenticated operational shell", async ({
    page,
  }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);

    await expect(
      page.getByRole("heading", { name: "System Overview" }),
    ).toBeVisible();
    await expect(
      page.getByText("SYSTEM ONLINE", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Smoke Project", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Dashboard API fixture ready", { exact: true }),
    ).toBeVisible();

    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(
      page.getByText("Smoke Project", { exact: true }),
    ).toBeVisible();

    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await expect(
      page.getByRole("heading", { name: "Event Stream" }),
    ).toBeVisible();
    await expect(
      page.getByText("Dashboard API fixture ready", { exact: true }),
    ).toBeVisible();

    await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(
      page
        .getByText(
          /AI provider not configured|No AI key configured|AI Assistant/i,
        )
        .first(),
    ).toBeVisible();

    await openNavigation(
      page,
      "Mission Control",
      `${DASHBOARD_PATH}mission-control`,
    );
    await expect(
      page.getByRole("heading", { name: "No durable runs in the ledger" }),
    ).toBeVisible();

    await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
    await expect(page).toHaveURL(
      new RegExp(
        `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
      ),
    );
    await expect(
      page.getByRole("heading", { name: "Audit / Chat run" }),
    ).toBeVisible();
    await expect(
      page.getByText("Controlled browser fixture completed.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("PROVEN", { exact: true }).first(),
    ).toBeVisible();
  });

  test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
    page,
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    await composer.fill(fixture.question);
    const sendButton = composer.locator("xpath=..").getByRole("button");
    await expect(sendButton).toBeEnabled();
    const streamResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/ai/chat/stream"),
    );
    await sendButton.click();
    const streamResponse = await streamResponsePromise;
    expect(streamResponse.status()).toBe(200);

    await expect(page.getByText(fixture.question, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(fixture.answer, { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Agent activity", { exact: false })).toBeVisible();
    await page.locator("summary").filter({ hasText: "Agent activity" }).click();
    await expect(page.getByText("Reading source", { exact: false })).toBeVisible();
    await expect(page.getByText(fixture.source, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/Behavior evidence · 1 excerpt/i).last()).toBeVisible();
    await expect(
      page.getByText('return partialFromCollectedEvidence("provider timeout");', { exact: true }).last(),
    ).toBeVisible();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/e2e-arabic-ai-session|e2e-execution|\/home\/runner|recovery diagnostics|rawPrompt|systemPrompt/i);
    expect(visibleText).not.toContain("تعذر عرض الاستجابة");
    expect(visibleText).toContain("تقريرًا جزئيًا");
  });

  test("keeps accepted citation explanations and line ranges after chat reload", async ({
    page,
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(`${fixture.source}:42`, { exact: false }).last()).toBeVisible();
    await expect(page.getByText("Accepted: source span verified.", { exact: true }).last()).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: fixture.question }).click();

    await expect(page.getByText(fixture.answer, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(`${fixture.source}:42`, { exact: false }).last()).toBeVisible();
    await expect(page.getByText("Accepted: source span verified.", { exact: true }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
  });

  test("keeps only the safe blocked citation reason after chat reload", async ({
    page,
  }) => {
    const fixture = await installArabicAiFixture(page, { blocked: true });
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText("Blocked: no matching source text was found.", { exact: true }).last()).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: fixture.question }).click();

    await expect(page.getByText("Blocked: no matching source text was found.", { exact: true }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
    expect(visibleText).not.toContain("Accepted: source span verified.");
  });

  test("keeps the AI session drawer overlaid on a phone viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    const beforeOpen = await composer.boundingBox();
    expect(beforeOpen?.width).toBeGreaterThan(250);

    await page.getByRole("button", { name: "Open sessions" }).click();
    await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
    const drawer = page.getByText("Sessions", { exact: true }).locator("..").locator("..");
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox?.width).toBeLessThanOrEqual(390);
    const duringOpen = await composer.boundingBox();
    expect(duringOpen?.width).toBeGreaterThan(250);

    await page.getByRole("button", { name: "Close sidebar" }).click();
    await expect(page.getByRole("button", { name: "Open sessions" })).toBeVisible();
  });

  test("renders a user-visible API failure state", async ({ page }) => {
    await page.route("**/api/dashboard", (route) =>
      route.fulfill(
        jsonResponse({ error: "controlled dashboard outage" }, 503),
      ),
    );
    await programmaticSignIn(page);
    await expect(
      page.getByRole("heading", { name: "Failed to load dashboard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry Connection" }),
    ).toBeVisible();
  });
});
