import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
const DEFAULT_LIVE_TIMEOUT_MS = 120_000;
const LIVE_TEST_TIMEOUT_MARGIN_MS = 5_000;
const HOSTILE_ORIGIN = "https://attacker.example";
const DEFAULT_LIVE_PROMPT =
  "Perform a bounded forensic audit of this disposable project using read-only tools. " +
  "Produce at least one accepted evidence item and one validation checkpoint, and do not " +
  "report COMPLETED unless both are present. Report only verified evidence.";

function liveTimeoutMs(): number {
  const configured = Number(process.env.DASHBOARD_E2E_LIVE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_LIVE_TIMEOUT_MS;
}

function approvedDashboardOrigins(): string[] {
  const origins = (process.env.DASHBOARD_E2E_APPROVED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error(
      "DASHBOARD_E2E_APPROVED_ORIGINS must contain every approved dashboard origin.",
    );
  }
  return origins.map((origin) => {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        `Dashboard journey origin must be a bare origin: ${origin}`,
      );
    }
    return parsed.origin;
  });
}

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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}

type ArabicAiFixture = {
  question: string;
  answer: string;
  source: string;
  sessionId: string;
  executionId?: string;
  projectId?: string;
  streamBody: string;
  message: Record<string, unknown>;
};

async function installApiFixtures(
  page: Page,
  overrides?: {
    arabicAi?: ArabicAiFixture;
    alternateAi?: ArabicAiFixture;
    disconnectAi?: ArabicAiFixture;
    resumeFailure?: {
      fixture: ArabicAiFixture;
      execution: Record<string, unknown>;
    };
    interruptedResume?: {
      fixture: ArabicAiFixture;
      execution: Record<string, unknown>;
      recoveredToken: string;
      resumedStreamBody: string;
    };
    projects?: Array<Record<string, unknown>>;
  },
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/dashboard(?=\/|$)/, "");
    const arabicAi = overrides?.arabicAi;
    const alternateAi = overrides?.alternateAi;
    const disconnectAi = overrides?.disconnectAi;
    const aiFixtures = [arabicAi, alternateAi, disconnectAi].filter(
      (fixture): fixture is ArabicAiFixture => Boolean(fixture),
    );

    if (aiFixtures.length > 0 && path.endsWith("/api/ai/chat/sessions")) {
      const projectId = url.searchParams.get("projectId");
      const projectSessions = aiFixtures.filter(
        (fixture) => !fixture.projectId || fixture.projectId === projectId,
      );
      return route.fulfill(
        jsonResponse(
          projectSessions.map((fixture) => ({
            id: fixture.sessionId,
            title: fixture.question,
            updatedAt: "2026-01-01T00:02:00.000Z",
          })),
        ),
      );
    }
    if (overrides?.resumeFailure && path.endsWith("/api/ai/chat/stream")) {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      if (
        requestBody.executionId === overrides.resumeFailure.fixture.executionId
      ) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache" },
          body: overrides.resumeFailure.fixture.streamBody,
        });
      }
    }
    if (overrides?.interruptedResume && path.endsWith("/api/ai/chat/stream")) {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      const { fixture, resumedStreamBody } = overrides.interruptedResume;
      if (requestBody.executionId === fixture.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache" },
          body: resumedStreamBody,
        });
      }
      if (!requestBody.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache" },
          // Deliberately stop after the durable execution identity. This is
          // the browser-side equivalent of a transport interruption.
          body: fixture.streamBody,
        });
      }
    }
    const streamFixture = disconnectAi ?? arabicAi;
    if (streamFixture && path.endsWith("/api/ai/chat/stream"))
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache" },
        body: streamFixture.streamBody,
      });
    const messageFixture = aiFixtures.find((fixture) =>
      path.endsWith(`/api/ai/chat/${fixture.sessionId}/messages`),
    );
    if (messageFixture)
      return route.fulfill(
        jsonResponse([
          {
            id: `${messageFixture.sessionId}-user-message`,
            sessionId: messageFixture.sessionId,
            role: "user",
            content: messageFixture.question,
            createdAt: "2026-01-01T00:01:00.000Z",
          },
          messageFixture.message,
        ]),
      );

    if (path === "/api/dashboard")
      return route.fulfill(jsonResponse(dashboardFixture));
    if (path === "/api/projects") {
      return route.fulfill(
        jsonResponse(
          overrides?.projects ?? [
            {
              id: "e2e-project",
              name: "Smoke Project",
              language: "TypeScript",
              framework: "React",
              status: "active",
              rootPath: "/controlled/smoke",
              qualityScore: 92,
            },
          ],
        ),
      );
    }
    if (path === "/api/events")
      return route.fulfill(jsonResponse(dashboardFixture.recentEvents));
    if (
      overrides?.resumeFailure &&
      path ===
        `/api/ai/executions/${overrides.resumeFailure.fixture.executionId}`
    ) {
      return route.fulfill(jsonResponse(overrides.resumeFailure.execution));
    }
    if (
      overrides?.interruptedResume &&
      path ===
        `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}`
    ) {
      return route.fulfill(jsonResponse(overrides.interruptedResume.execution));
    }
    if (
      overrides?.interruptedResume &&
      path ===
        `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}/resume-capability`
    ) {
      return route.fulfill(
        jsonResponse({
          executionId: overrides.interruptedResume.fixture.executionId,
          resumeToken: overrides.interruptedResume.recoveredToken,
        }),
      );
    }
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

async function installArabicAiFixture(
  page: Page,
  options?: {
    blocked?: boolean;
    sessionId?: string;
    question?: string;
    projectId?: string;
  },
) {
  const sessionId = options?.sessionId ?? "e2e-arabic-ai-session";
  const messageId = "e2e-arabic-ai-message";
  const source = "src/execution-tools.ts";
  const blocked = options?.blocked === true;
  const question =
    options?.question ??
    "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟";
  const answer =
    "عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.";
  const evidence = [
    {
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
    },
  ];
  const toolTrace = [
    {
      kind: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
      prefetched: true,
    },
    {
      kind: "tool_result",
      tool: "read_file",
      source,
      cached: false,
      prefetched: true,
    },
    {
      kind: "evidence_integrity",
      code: "EVIDENCE_INTEGRITY_OK",
      consistent: true,
      violations: [],
      evidenceFileCount: 1,
      acceptedEvidenceCount: 1,
      completedReadFiles: [source],
      acceptedEvidenceFiles: [source],
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredEdges: ["client->server", "server->database"],
      provenEdges: ["client->server"],
      completionGateResult: "PARTIALLY_PROVEN",
      finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER",
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
    content: `${answer}\n\n## 6) Final Judgment\nNOT PROVEN`,
    operationMode: "FORENSIC_AUDIT",
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    behaviorEvidence: evidence,
    taskResult,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId: "e2e-execution",
      status: "running",
      resumable: true,
    }),
    sse({ type: "stage", stage: "building-context" }),
    sse({ type: "stage", stage: "calling-model" }),
    sse({
      type: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
      prefetched: true,
    }),
    sse({
      type: "tool_result",
      tool: "read_file",
      source,
      cached: false,
      prefetched: true,
    }),
    sse({
      type: "evidence_integrity",
      code: "EVIDENCE_INTEGRITY_OK",
      consistent: true,
      violations: [],
      evidenceFileCount: 1,
      acceptedEvidenceCount: 1,
      completedReadFiles: [source],
      acceptedEvidenceFiles: [source],
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredEdges: ["client->server", "server->database"],
      provenEdges: ["client->server"],
      completionGateResult: "PARTIALLY_PROVEN",
      finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER",
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

  return {
    question,
    answer,
    source,
    sessionId,
    projectId: options?.projectId,
    streamBody,
    message,
  };
}

function installToolFailureFixture(): ArabicAiFixture {
  const sessionId = "e2e-tool-failure-session";
  const messageId = "e2e-tool-failure-message";
  const source = "src/missing-release-fixture.ts";
  const question = "Which source file is available for the release check?";
  const answer =
    "ANALYSIS_INCOMPLETE: The required source read did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_EXECUTION_FAILED";
  const toolTrace = [
    {
      kind: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
    },
    {
      kind: "tool_result",
      tool: "read_file",
      source,
      resultKind: "failed",
      diagnosticCode,
      resultSummary: "The required source read did not complete.",
    },
    {
      kind: "done",
      stopReason: "tool_failure",
      iterations: 1,
      maxIterations: 8,
      toolCalls: 1,
      prefetchToolCalls: 0,
      loopToolCalls: 1,
      synthesisStarted: false,
      diagnosticCodes: [diagnosticCode],
    },
  ];
  const message = {
    id: messageId,
    sessionId,
    role: "assistant",
    content: answer,
    toolTrace: JSON.stringify(toolTrace),
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId: "e2e-tool-failure-execution",
      status: "running",
      resumable: true,
    }),
    sse({
      type: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
    }),
    sse({
      type: "tool_result",
      tool: "read_file",
      source,
      resultKind: "failed",
      diagnosticCode,
      resultSummary: "The required source read did not complete.",
    }),
    sse({ type: "delta", delta: answer }),
    sse({
      type: "done",
      sessionId,
      message,
      toolTrace: JSON.stringify(toolTrace),
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source,
    sessionId,
    streamBody,
    message,
  };
}

function installDisconnectedAiFixture(): ArabicAiFixture {
  const sessionId = "e2e-disconnected-ai-session";
  const executionId = "e2e-disconnected-ai-execution";
  const question =
    "What happens when the model disconnects after starting an answer?";
  const answer =
    "The model started an answer, but the provider disconnected before completion.";
  const diagnosticCode = "EXECUTION_PROVIDER_FAILURE";
  const toolTrace = [
    {
      kind: "done",
      stopReason: "provider_timeout",
      iterations: 1,
      maxIterations: 8,
      toolCalls: 0,
      prefetchToolCalls: 0,
      loopToolCalls: 0,
      synthesisStarted: false,
      diagnosticCodes: [diagnosticCode],
      diagnosticDetails: [
        "The provider disconnected after visible response text.",
      ],
    },
  ];
  const message = {
    id: "e2e-disconnected-ai-message",
    sessionId,
    role: "assistant",
    content: answer,
    toolTrace: JSON.stringify(toolTrace),
    outcome: "FAILED",
    errorCode: diagnosticCode,
    errorMessage: "The provider disconnected before completion.",
    executionId,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
    }),
    sse({ type: "stage", stage: "calling-model" }),
    sse({ type: "delta", delta: answer }),
    // The real route emits this after a provider disconnect so the client
    // drops the transient bubble before rendering the persisted result.
    sse({ type: "stream_reset" }),
    sse({
      type: "done",
      sessionId,
      executionId,
      message,
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source: "provider",
    sessionId,
    executionId,
    streamBody,
    message,
  };
}

function installResumedAnalysisFailureFixture() {
  const sessionId = "e2e-resumed-analysis-failure-session";
  const executionId = "e2e-resumed-analysis-failure-execution";
  const resumeToken = "e2e-resumed-analysis-failure-token-opaque";
  const question = "Verify the analysis evidence after reconnect.";
  const answer =
    "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_UNAVAILABLE";
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
      resumeToken,
    }),
    sse({
      type: "error",
      executionId,
      code: diagnosticCode,
      message: "The required analysis did not complete.",
    }),
  ].join("");
  const fixture: ArabicAiFixture = {
    question,
    answer,
    source: "src/missing-analysis-tool.ts",
    sessionId,
    executionId,
    streamBody,
    message: {
      id: "e2e-resumed-analysis-failure-message",
      sessionId,
      role: "assistant",
      content: answer,
      outcome: "FAILED",
      executionId,
      errorCode: diagnosticCode,
      errorMessage: "The required analysis did not complete.",
      createdAt: "2026-01-01T00:02:00.000Z",
    },
  };

  return {
    fixture,
    execution: {
      id: executionId,
      projectId: "e2e-project",
      operationId: "e2e-resumed-analysis-failure-operation",
      sessionId,
      status: "failed",
      flightState: "FAILED",
      evidenceVerdict: "INCOMPLETE",
      proofRequired: true,
      resumable: true,
      checkpointVersion: 1,
      checkpoint: {
        stage: "tool-execution",
        detail: "The required analysis tool was unavailable.",
      },
      objective: { objective: question },
      error: "The required analysis did not complete.",
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    },
  };
}

function installInterruptedResumeFixture() {
  const sessionId = "e2e-interrupted-resume-session";
  const executionId = "e2e-interrupted-resume-execution";
  const initialToken = "e2e-interrupted-initial-token";
  const recoveredToken = "e2e-interrupted-recovered-token";
  const question = "Continue the interrupted release execution.";
  const partialAnswer = "The release execution started before the browser disconnected.";
  const answer = "The original release execution resumed after capability recovery.";
  const message = {
    id: "e2e-interrupted-resume-message",
    sessionId,
    role: "assistant",
    content: answer,
    executionId,
    outcome: "COMPLETED",
    createdAt: "2026-01-01T00:03:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const fixture: ArabicAiFixture = {
    question,
    answer,
    source: "release-resume",
    sessionId,
    executionId,
    streamBody: [
      sse({ type: "session_started", sessionId }),
      sse({
        type: "execution_started",
        executionId,
        status: "running",
        resumable: true,
        resumeToken: initialToken,
      }),
      sse({ type: "stage", stage: "calling-model" }),
      sse({ type: "delta", delta: partialAnswer }),
    ].join(""),
    message,
  };
  return {
    fixture,
    initialToken,
    recoveredToken,
    resumedStreamBody: [
      sse({ type: "session_started", sessionId }),
      sse({
        type: "execution_started",
        executionId,
        status: "running",
        resumable: true,
        resumeToken: recoveredToken,
      }),
      sse({ type: "stage", stage: "resuming-checkpoint" }),
      sse({ type: "delta", delta: answer }),
      sse({ type: "done", sessionId, executionId, message, pendingChanges: [] }),
    ].join(""),
    execution: {
      id: executionId,
      projectId: "e2e-project",
      operationId: "e2e-interrupted-resume-operation",
      sessionId,
      status: "paused",
      flightState: "PAUSED",
      resumable: true,
      checkpointVersion: 1,
      checkpoint: {
        stage: "calling-model",
        detail: "The browser transport disconnected after the execution started.",
      },
      objective: { objective: question },
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    },
  };
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

function apiUrl(page: Page, path: string): string {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  return new URL(path, apiBaseUrl ? apiBaseUrl : page.url()).toString();
}

async function liveRequest(
  page: Page,
  path: string,
  options?: { method?: string; body?: unknown; timeout?: number },
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url, method, body, timeout }) => {
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout ? AbortSignal.timeout(timeout) : undefined,
      });
      return { status: response.status, body: await response.text() };
    },
    {
      url: apiUrl(page, path),
      method: options?.method ?? "GET",
      body: options?.body,
      timeout: options?.timeout,
    },
  );
}

async function expectOriginCanUseApi(page: Page, origin: string) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error(
      "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
    );
  }
  const healthUrl = new URL("/api/healthz", apiBaseUrl).toString();
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const commonHeaders = { Origin: origin };

  const getResponse = await page.request.get(healthUrl, {
    headers: commonHeaders,
  });
  expect(getResponse.status(), `${origin} credentialed GET status`).toBe(200);
  expect(getResponse.headers()["access-control-allow-origin"]).toBe(origin);
  expect(getResponse.headers()["access-control-allow-credentials"]).toBe(
    "true",
  );

  const preflightResponse = await page.request.fetch(mutationUrl, {
    method: "OPTIONS",
    headers: {
      ...commonHeaders,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  expect(
    preflightResponse.status(),
    `${origin} mutation preflight status`,
  ).toBe(204);
  expect(preflightResponse.headers()["access-control-allow-origin"]).toBe(
    origin,
  );
  const mutationResponse = await page.request.post(mutationUrl, {
    headers: { ...commonHeaders, "Content-Type": "application/json" },
    data: { message: "origin contract" },
  });
  expect(
    mutationResponse.status(),
    `${origin} state-changing request must pass origin protection`,
  ).not.toBe(403);
  expect(mutationResponse.headers()["access-control-allow-origin"]).toBe(
    origin,
  );
  expect(mutationResponse.headers()["access-control-allow-credentials"]).toBe(
    "true",
  );
}

async function expectHostileOriginRejected(page: Page) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl)
    throw new Error(
      "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
    );
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const response = await page.request.post(mutationUrl, {
    headers: {
      Origin: HOSTILE_ORIGIN,
      "Content-Type": "application/json",
    },
    data: { message: "hostile origin contract" },
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  expect(
    response.headers()["access-control-allow-credentials"],
  ).toBeUndefined();
}

function parseSse(body: string): Array<Record<string, unknown>> {
  return body.split(/\n\n+/).flatMap((chunk) => {
    const data = chunk
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    if (!data) return [];
    try {
      const value = JSON.parse(data) as unknown;
      return value && typeof value === "object"
        ? [value as Record<string, unknown>]
        : [];
    } catch {
      return [];
    }
  });
}

async function liveJson(
  page: Page,
  path: string,
): Promise<Record<string, any>> {
  const response = await liveRequest(page, path);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Live correlation request failed: ${path} (${response.status})`,
    );
  }
  return JSON.parse(response.body) as Record<string, any>;
}

async function liveArray(
  page: Page,
  path: string,
): Promise<Array<Record<string, any>>> {
  const response = await liveRequest(page, path);
  if (response.status === 404) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Live correlation request failed: ${path} (${response.status})`,
    );
  }
  const value = JSON.parse(response.body);
  return Array.isArray(value) ? value : [];
}

async function liveOptionalRecord(
  page: Page,
  path: string,
): Promise<Record<string, any> | undefined> {
  const response = await liveRequest(page, path);
  if (response.status === 404) return undefined;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Live correlation request failed: ${path} (${response.status})`,
    );
  }
  const value = JSON.parse(response.body);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

test.describe("EngineeringOS dashboard browser journey", () => {
  test("exports one redacted live-provider mission correlation report", async ({
    page,
  }) => {
    // The Playwright deadline must leave room for the provider-bound request
    // and polling loop to consume their complete configured budget.
    test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
    test.skip(
      process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1",
      "Live-provider release journey is opt-in.",
    );
    const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
    if (!projectId)
      throw new Error(
        "DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.",
      );

    await programmaticSignIn(page);
    const streamResponse = await liveRequest(page, "/api/ai/chat/stream", {
      method: "POST",
      timeout: liveTimeoutMs(),
      body: {
        projectId,
        message: process.env.DASHBOARD_E2E_LIVE_PROMPT ?? DEFAULT_LIVE_PROMPT,
        idempotencyKey: `dashboard-live-${Date.now()}`,
      },
    });
    if (streamResponse.status < 200 || streamResponse.status >= 300) {
      throw new Error(
        `Live-provider mission failed to start (${streamResponse.status}).`,
      );
    }
    const sseEvents = parseSse(streamResponse.body);
    const started = sseEvents.find(
      (event) => event.type === "execution_started",
    );
    const executionId =
      typeof started?.executionId === "string"
        ? started.executionId
        : undefined;
    if (!executionId)
      throw new Error("Live-provider stream did not emit execution_started.");

    let execution: Record<string, any> = {};
    const deadline = Date.now() + liveTimeoutMs();
    while (Date.now() < deadline) {
      execution = await liveJson(page, `/api/ai/executions/${executionId}`);
      if (
        ["completed", "failed", "cancelled"].includes(String(execution.status))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (
      !["completed", "failed", "cancelled"].includes(String(execution.status))
    ) {
      throw new Error(
        "Live-provider mission did not reach a terminal state within its bound.",
      );
    }

    const sessionId = String(execution.sessionId);
    const messages = await liveArray(
      page,
      `/api/ai/chat/${sessionId}/messages`,
    );
    const events = await liveArray(
      page,
      `/api/events?projectId=${encodeURIComponent(projectId)}&correlationId=${encodeURIComponent(String(execution.operationId ?? ""))}`,
    );
    const proposal = await liveOptionalRecord(
      page,
      `/api/ai/chat/${sessionId}/pending-proposal`,
    );
    const gitLog = await liveJson(page, `/api/projects/${projectId}/git/log`);
    const missionControl = await liveJson(page, "/api/ai/mission-control");
    const dashboardState = await liveJson(page, "/api/dashboard");
    const checkpoint =
      execution.checkpoint && typeof execution.checkpoint === "object"
        ? (execution.checkpoint as Record<string, any>)
        : {};
    const recentSteps = Array.isArray(checkpoint.recentSteps)
      ? checkpoint.recentSteps
      : [];
    const validation = recentSteps.filter(
      (step) => step?.kind === "validation",
    );
    const evidenceCount = recentSteps.reduce(
      (count, step) => count + (Number(step?.acceptedEvidenceCount) || 0),
      0,
    );
    const terminalState = String(
      execution.flightState ?? execution.status,
    ).toUpperCase();
    const successStates = new Set([
      "COMPLETED",
      "READY_FOR_REVIEW",
      "APPLIED",
      "COMMITTED",
      "PUSHED",
    ]);
    if (
      successStates.has(terminalState) &&
      (evidenceCount < 1 || validation.length < 1)
    ) {
      throw new Error(
        `Live-provider mission reported ${terminalState} without accepted evidence and validation ` +
          `(evidence=${evidenceCount}, validation=${validation.length}).`,
      );
    }
    const capture = {
      projectId,
      sessionId,
      operationId: execution.operationId,
      workspaceRevision:
        gitLog.commits?.[0]?.shortHash ??
        gitLog.commits?.[0]?.hash?.slice(0, 12),
      terminalState,
      execution: {
        id: execution.id,
        projectId: execution.projectId,
        sessionId: execution.sessionId,
        operationId: execution.operationId,
        status: execution.status,
        flightState: execution.flightState,
      },
      messages: messages.map(
        ({
          id,
          sessionId: messageSession,
          role,
          executionId: messageExecution,
          outcome,
        }) => ({
          id,
          sessionId: messageSession,
          role,
          executionId: messageExecution,
          outcome,
        }),
      ),
      sseEvents: sseEvents.map(
        ({
          type,
          executionId: eventExecution,
          sessionId: eventSession,
          outcome,
          code,
        }) => ({
          type,
          executionId: eventExecution,
          sessionId: eventSession,
          outcome,
          code,
        }),
      ),
      checkpoints: [
        {
          sequence: checkpoint.sequence,
          stage: checkpoint.stage,
          updatedAt: checkpoint.updatedAt,
        },
      ],
      evidenceCount,
      proposals: proposal
        ? [
            {
              id: proposal.id,
              revision: proposal.revision,
              status: proposal.status,
            },
          ]
        : [],
      validation: validation.map((step) => ({
        status: step.validation?.status ?? step.status,
        profile: step.validation?.profile ?? step.validationProfile,
      })),
      events: events.map(({ type, severity, correlationId }) => ({
        type,
        severity,
        correlationId,
      })),
      dashboard: missionControl,
      dashboardState: {
        projectCount: dashboardState.projectCount,
        activeTaskCount: dashboardState.activeTaskCount,
      },
    };
    const outputPath =
      process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
      "test-results/dashboard-journey/live-mission-correlation.json";
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(capture, null, 2)}\n`,
      "utf8",
    );
  });

  test("signs in and traverses the authenticated operational shell", async ({
    page,
  }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);
    for (const origin of approvedDashboardOrigins()) {
      await expectOriginCanUseApi(page, origin);
    }
    await expectHostileOriginRejected(page);

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

    await expect(
      page.getByText(fixture.question, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Agent activity", { exact: false }),
    ).toBeVisible();
    await page.locator("summary").filter({ hasText: "Agent activity" }).click();
    await expect(
      page.getByText("Reading source", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.source, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText(/Behavior evidence · 1 excerpt/i).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText('return partialFromCollectedEvidence("provider timeout");', {
          exact: true,
        })
        .last(),
    ).toBeVisible();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });

  test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(
      "src/missing-release-fixture.ts",
    );
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page
      .locator("summary")
      .filter({ hasText: "Persisted execution proof" })
      .last()
      .click();
    await expect(
      page
        .getByText("required tool failed — operation blocked", { exact: true })
        .last(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
    );
  });

  test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
    page,
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(
      "src/missing-release-fixture.ts",
    );
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page
      .locator("summary")
      .filter({ hasText: "Persisted execution proof" })
      .last()
      .click();
    await expect(
      page
        .getByText("required tool failed — operation blocked", { exact: true })
        .last(),
    ).toBeVisible();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
    );
  });

  test("keeps safe citation state when switching projects", async ({
    page,
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
      projects: [
        {
          id: "e2e-project-one",
          name: "Citation Project One",
          language: "TypeScript",
          framework: "React",
          status: "active",
          rootPath: "/controlled/project-one",
          qualityScore: 92,
        },
        {
          id: "e2e-project-two",
          name: "Citation Project Two",
          language: "TypeScript",
          framework: "React",
          status: "active",
          rootPath: "/controlled/project-two",
          qualityScore: 88,
        },
      ],
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await expect(
      page.getByText(accepted.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText(`${accepted.source}:42`, { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Accepted: source span verified.", { exact: true }).last(),
    ).toBeVisible();

    await page.getByRole("combobox").selectOption("e2e-project-two");
    await expect(
      page.getByRole("button", { name: blocked.question, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await expect(
      page
        .getByText("Blocked: no matching source text was found.", {
          exact: true,
        })
        .last(),
    ).toBeVisible();
    await expect(
      page.getByText(`${blocked.source}:42`, { exact: false }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Accepted: source span verified.", { exact: true }),
    ).toHaveCount(0);

    await page.getByRole("combobox").selectOption("e2e-project-one");
    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await expect(
      page.getByText(`${accepted.source}:42`, { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Accepted: source span verified.", { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Blocked: no matching source text was found.", {
        exact: true,
      }),
    ).toHaveCount(0);

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
    );
  });

  test("keeps safe citation state across repeated navigation", async ({
    page,
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const assertAcceptedCitation = async () => {
      await expect(
        page.getByText(accepted.answer, { exact: true }).last(),
      ).toBeVisible();
      await expect(
        page.getByText(`${accepted.source}:42`, { exact: false }).last(),
      ).toBeVisible();
      await expect(
        page
          .getByText("Accepted: source span verified.", { exact: true })
          .last(),
      ).toBeVisible();
      await expect(
        page.getByText("Blocked: no matching source text was found.", {
          exact: true,
        }),
      ).toHaveCount(0);
    };
    const assertBlockedCitation = async () => {
      await expect(
        page
          .getByText("Blocked: no matching source text was found.", {
            exact: true,
          })
          .last(),
      ).toBeVisible();
      await expect(
        page.getByText(`${blocked.source}:42`, { exact: false }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Accepted: source span verified.", { exact: true }),
      ).toHaveCount(0);
    };
    const assertNoInternalCitationDetails = async () => {
      const visibleText = await page.locator("body").innerText();
      expect(visibleText).not.toMatch(
        /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
      );
    };

    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await assertAcceptedCitation();

    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await assertAcceptedCitation();
    await assertNoInternalCitationDetails();

    await page.goForward();
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
    );
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await assertAcceptedCitation();

    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await assertBlockedCitation();

    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();

    await page.goForward();
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
    );
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();
  });

  test("keeps only the safe blocked citation reason after chat reload", async ({
    page,
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(
      "src/missing-release-fixture.ts",
    );
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page
      .locator("summary")
      .filter({ hasText: "Persisted execution proof" })
      .last()
      .click();
    await expect(
      page
        .getByText("required tool failed — operation blocked", { exact: true })
        .last(),
    ).toBeVisible();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });

  test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(
      "src/missing-release-fixture.ts",
    );
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page
      .locator("summary")
      .filter({ hasText: "Persisted execution proof" })
      .last()
      .click();
    await expect(
      page
        .getByText("required tool failed — operation blocked", { exact: true })
        .last(),
    ).toBeVisible();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
    );

    await page.reload();
    await page
      .getByRole("button", { name: fixture.question, exact: true })
      .click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(
      "src/missing-release-fixture.ts",
    );
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page
      .locator("summary")
      .filter({ hasText: "Persisted execution proof" })
      .last()
      .click();
    await expect(
      page
        .getByText("required tool failed — operation blocked", { exact: true })
        .last(),
    ).toBeVisible();

    const reloadedText = await page.locator("body").innerText();
    await expectNoHorizontalOverflow(page);
    expect(reloadedText).not.toMatch(
      /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
    );
  });

  test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
    page,
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    const answer = page.getByText(fixture.answer, { exact: true });
    await expect(answer).toHaveCount(1);
    await expect(answer).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
    await expect(
      page.getByText("provider failure", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("stopped: provider timeout", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("The provider disconnected after visible response text.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.reload();
    await page
      .getByRole("button", { name: fixture.question, exact: true })
      .click();

    await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
      1,
    );
    await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
    await expect(
      page.getByText("provider failure", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("stopped: provider timeout", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("The provider disconnected after visible response text.", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("resumes a failed analysis and keeps the execution incomplete", async ({
    page,
  }) => {
    const { fixture, execution } = installResumedAnalysisFailureFixture();
    await installApiFixtures(page, {
      arabicAi: fixture,
      resumeFailure: { fixture, execution },
    });
    await programmaticSignIn(page);

    await page.evaluate(
      ({ sessionId, executionId, projectId, resumeToken, message }) => {
        localStorage.setItem(
          `eos_ai_execution_current_${projectId}`,
          sessionId,
        );
        localStorage.setItem(
          `eos_ai_execution_${projectId}_${sessionId}`,
          JSON.stringify({
            id: executionId,
            projectId,
            sessionId,
            resumeToken,
            message,
          }),
        );
      },
      {
        sessionId: fixture.sessionId,
        executionId: fixture.executionId,
        projectId: "e2e-project",
        resumeToken: "e2e-resumed-analysis-failure-token-opaque",
        message: fixture.question,
      },
    );
    await page.goto(`${DASHBOARD_PATH}ai`);

    await expect(
      page.getByText("A saved AI execution is ready to resume"),
    ).toBeVisible();
    const resumeRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/ai/chat/stream") &&
        request.method() === "POST",
    );
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    const requestBody = JSON.parse(
      (await resumeRequest).postData() ?? "{}",
    ) as Record<string, unknown>;
    expect(requestBody).toEqual(
      expect.objectContaining({
        projectId: "e2e-project",
        sessionId: fixture.sessionId,
        executionId: fixture.executionId,
        resumeToken: "e2e-resumed-analysis-failure-token-opaque",
        message: fixture.question,
      }),
    );

    await expect(
      page.getByText("Failed to send message", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("A saved AI execution is ready to resume"),
    ).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });

  test("recovers a missing token after an interrupted stream and resumes one execution", async ({
    page,
  }) => {
    const recovery = installInterruptedResumeFixture();
    await installApiFixtures(page, { interruptedResume: recovery });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const streamRequests: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/ai/chat/stream") &&
        request.method() === "POST"
      ) {
        try {
          streamRequests.push(request.postDataJSON() as Record<string, unknown>);
        } catch {
          // Ignore requests without a JSON body; the assertions below require
          // both journey requests to have a valid request envelope.
        }
      }
    });

    const composer = page.locator("textarea").first();
    await composer.fill(recovery.fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText("Execution paused — ready to resume from its durable checkpoint", {
        exact: true,
      }),
    ).toBeVisible();

    const storageKey = "eos_ai_execution_e2e-project_e2e-interrupted-resume-session";
    const pointerKey = "eos_ai_execution_current_e2e-project";
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
      .toContain(recovery.initialToken);

    await page.evaluate(
      ({ storageKey, pointerKey }) => {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
        delete saved.resumeToken;
        localStorage.setItem(storageKey, JSON.stringify(saved));
        localStorage.setItem(pointerKey, "e2e-interrupted-resume-session");
      },
      { storageKey, pointerKey },
    );
    await page.reload();

    await expect(
      page.getByText("A saved AI execution is ready to resume", {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
          return saved.resumeToken;
        }, storageKey),
      )
      .toBe(recovery.recoveredToken);

    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      page.getByText(recovery.fixture.answer, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => streamRequests.length)
      .toBe(2);
    expect(streamRequests[0]).toEqual(
      expect.objectContaining({
        projectId: "e2e-project",
        message: recovery.fixture.question,
      }),
    );
    expect(streamRequests[0]?.executionId).toBeUndefined();
    expect(streamRequests[0]?.sessionId).toBeUndefined();
    expect(streamRequests[1]).toEqual(
      expect.objectContaining({
        projectId: "e2e-project",
        sessionId: recovery.fixture.sessionId,
        executionId: recovery.fixture.executionId,
        resumeToken: recovery.recoveredToken,
        message: recovery.fixture.question,
      }),
    );
    expect(
      streamRequests.map((request) => request.executionId).filter(Boolean),
    ).toEqual([recovery.fixture.executionId]);
  });

  test("keeps the resumed AI session drawer overlaid on a phone viewport", async ({
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
    const drawer = page
      .getByText("Sessions", { exact: true })
      .locator("..")
      .locator("..");
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox?.width).toBeLessThanOrEqual(390);
    const duringOpen = await composer.boundingBox();
    expect(duringOpen?.width).toBeGreaterThan(250);

    await page.getByRole("button", { name: "Close sidebar" }).click();
    await expect(
      page.getByRole("button", { name: "Open sessions" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
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
