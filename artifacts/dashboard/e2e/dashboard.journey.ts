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
const ORIGIN_DIAGNOSTIC_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "vary",
] as const;
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
  projectRevision: "e2e-revision-42",
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

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  return {
    status,
    contentType: "application/json",
    ...(headers ? { headers } : {}),
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
    deliveryRecovery?: {
      operations: Array<Record<string, unknown>>;
      requests: string[];
      actionRequests?: string[];
      recoveryAction?: {
        proposalId: string;
        action: "resume-validation" | "discard";
        response: Record<string, unknown>;
        nextOperations?: Array<Record<string, unknown>>;
      };
    };
    projects?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
    archiveUpload?: {
      uploadId: string;
      originalName: string;
    };
    auditExport?: {
      body: Record<string, unknown>;
      filename: string;
      requests: string[];
      execution?: Record<string, unknown>;
      messageOutcome?: string;
      failFirstPreview?: boolean;
    };
    liveTask?: {
      id: string;
      title: string;
      projectId: string;
      log: Record<string, unknown>;
      initialLogs?: Array<Record<string, unknown>>;
      streamRequests?: string[];
      failFirstStream?: boolean;
      failStreamAttempts?: number;
    };
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
          // Deliberately stop after the durable execution identity. The
          // journey wraps this response in a browser-level stream error.
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
    if (
      overrides?.auditExport &&
      path.endsWith("/api/ai/chat/e2e-audit-session/messages")
    ) {
      return route.fulfill(
        jsonResponse([
          {
            id: "e2e-audit-user-message",
            sessionId: "e2e-audit-session",
            role: "user",
            content: "Completed audit execution",
            createdAt: "2026-01-01T00:01:00.000Z",
          },
          {
            id: "e2e-audit-assistant-message",
            sessionId: "e2e-audit-session",
            role: "assistant",
            content: "Completed audit execution",
            executionId: EXECUTION_ID,
            outcome: overrides.auditExport.messageOutcome ?? "SUCCEEDED",
            createdAt: "2026-01-01T00:02:00.000Z",
          },
        ]),
      );
    }

    if (path === "/api/dashboard")
      return route.fulfill(jsonResponse(dashboardFixture));
    if (
      overrides?.auditExport &&
      path === `/api/ai/executions/${EXECUTION_ID}/audit-export`
    ) {
      overrides.auditExport.requests.push(route.request().url());
      if (
        overrides.auditExport.failFirstPreview &&
        overrides.auditExport.requests.length === 1
      ) {
        return route.fulfill(
          jsonResponse(
            { error: "Temporary preview network failure." },
            503,
          ),
        );
      }
      return route.fulfill(
        jsonResponse(overrides.auditExport.body, 200, {
          "Content-Disposition": `attachment; filename="${overrides.auditExport.filename}"`,
        }),
      );
    }
    if (overrides?.archiveUpload && path === "/api/upload/archive") {
      const contentType = route.request().headers()["content-type"] ?? "";
      if (!contentType.startsWith("multipart/form-data;")) {
        return route.fulfill(
          jsonResponse({ error: "Expected multipart archive upload." }, 400),
        );
      }
      const body = route.request().postDataBuffer();
      if (!body?.includes(Buffer.from("dashboard-journey.zip"))) {
        return route.fulfill(
          jsonResponse({ error: "Expected the journey archive payload." }, 400),
        );
      }
      return route.fulfill(
        jsonResponse(
          {
            uploadId: overrides.archiveUpload.uploadId,
            originalName: overrides.archiveUpload.originalName,
          },
          201,
          {
            "access-control-allow-origin": new URL(page.url()).origin,
            "access-control-allow-credentials": "true",
          },
        ),
      );
    }
    if (overrides?.liveTask && path === "/api/tasks") {
      return route.fulfill(
        jsonResponse([
          {
            id: overrides.liveTask.id,
            projectId: overrides.liveTask.projectId,
            title: overrides.liveTask.title,
            description: "A task used to verify live dashboard updates.",
            status: "running",
            phase: "Execution",
            relatedFiles: [],
            retryCount: 0,
            maxRetries: 2,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ]),
      );
    }
    if (
      overrides?.liveTask &&
      path === `/api/tasks/${overrides.liveTask.id}/logs`
    ) {
      return route.fulfill(jsonResponse(overrides.liveTask.initialLogs ?? []));
    }
    if (
      overrides?.liveTask &&
      path === `/api/tasks/${overrides.liveTask.id}/logs/stream`
    ) {
      const streamRequests = overrides.liveTask.streamRequests;
      streamRequests?.push(route.request().url());
      if (
        (overrides.liveTask.failFirstStream && streamRequests?.length === 1) ||
        (overrides.liveTask.failStreamAttempts &&
          streamRequests &&
          streamRequests.length <= overrides.liveTask.failStreamAttempts)
      ) {
        // Exercise the browser's reconnect path without changing the task
        // lifecycle or synthesizing a successful response for the first try.
        return route.abort("connectionreset");
      }
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache",
          "access-control-allow-origin": new URL(page.url()).origin,
          "access-control-allow-credentials": "true",
        },
        body: `event: log\ndata: ${JSON.stringify(overrides.liveTask.log)}\n\n`,
      });
    }
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
    if (
      overrides?.deliveryRecovery &&
      path === "/api/ai/delivery/recoverable"
    ) {
      overrides.deliveryRecovery.requests.push(route.request().url());
      return route.fulfill(
        jsonResponse({ operations: overrides.deliveryRecovery.operations }),
      );
    }
    if (
      overrides?.deliveryRecovery?.recoveryAction &&
      path ===
        `/api/ai/delivery/${overrides.deliveryRecovery.recoveryAction.proposalId}/${overrides.deliveryRecovery.recoveryAction.action}`
    ) {
      overrides.deliveryRecovery.actionRequests?.push(route.request().url());
      if (overrides.deliveryRecovery.recoveryAction.nextOperations) {
        overrides.deliveryRecovery.operations =
          overrides.deliveryRecovery.recoveryAction.nextOperations;
      }
      return route.fulfill(
        jsonResponse(overrides.deliveryRecovery.recoveryAction.response, 409),
      );
    }
    if (path === "/api/events") {
      const events = overrides?.events ?? dashboardFixture.recentEvents;
      const search = url.searchParams.get("search")?.toLowerCase();
      const filteredEvents = events.filter((event) => {
        const projectId = url.searchParams.get("projectId");
        const severity = url.searchParams.get("severity");
        const correlationId = url.searchParams.get("correlationId");
        return (
          (!projectId || event.projectId === projectId) &&
          (!severity || event.severity === severity) &&
          (!correlationId || event.correlationId === correlationId) &&
          (!search ||
            [event.message, event.type, event.correlationId]
              .filter((value): value is string => typeof value === "string")
              .some((value) => value.toLowerCase().includes(search)))
        );
      });
      const limit = Number(url.searchParams.get("limit")) || 50;
      const page = Number(url.searchParams.get("page")) || 1;
      return route.fulfill(
        jsonResponse({
          events: filteredEvents.slice((page - 1) * limit, page * limit),
          total: filteredEvents.length,
        }),
      );
    }
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
      return route.fulfill(
        jsonResponse(overrides?.auditExport?.execution ?? executionFixture),
      );
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
  const partialAnswer =
    "The release execution started before the browser disconnected.";
  const answer =
    "The original release execution resumed after capability recovery.";
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
      sse({
        type: "done",
        sessionId,
        executionId,
        message,
        pendingChanges: [],
      }),
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
        detail:
          "The browser transport disconnected after the execution started.",
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

type OriginDiagnostic = {
  origin: string;
  phase: "GET" | "preflight" | "mutation" | "rejection";
  status?: number;
  headers?: Record<string, string>;
  error?: string;
};
const recordedOriginDiagnostics: OriginDiagnostic[] = [];

function originDiagnosticPath(): string | undefined {
  return process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH;
}

function relevantOriginHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    ORIGIN_DIAGNOSTIC_HEADERS.flatMap((name) =>
      headers[name] ? [[name, headers[name]]] : [],
    ),
  );
}

async function writeOriginDiagnostics() {
  const outputPath = originDiagnosticPath();
  if (!outputPath) return;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ diagnostics: recordedOriginDiagnostics }, null, 2)}\n`,
    "utf8",
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

  const diagnostics: OriginDiagnostic[] = [];
  const check = async (
    phase: OriginDiagnostic["phase"],
    request: () => Promise<import("@playwright/test").APIResponse>,
    assertion: (
      response: import("@playwright/test").APIResponse,
    ) => Promise<void>,
  ) => {
    try {
      const response = await request();
      diagnostics.push({
        origin,
        phase,
        status: response.status(),
        headers: relevantOriginHeaders(response.headers()),
      });
      recordedOriginDiagnostics.push(diagnostics.at(-1)!);
      await assertion(response);
    } catch (error) {
      const current = diagnostics.at(-1);
      if (current?.phase !== phase) {
        diagnostics.push({ origin, phase });
      }
      diagnostics.at(-1)!.error = "origin check failed";
      await writeOriginDiagnostics();
      throw error;
    }
  };

  await check(
    "GET",
    () => page.request.get(healthUrl, { headers: commonHeaders }),
    async (response) => {
      expect(response.status(), `${origin} credentialed GET status`).toBe(200);
      expect(response.headers()["access-control-allow-origin"]).toBe(origin);
      expect(response.headers()["access-control-allow-credentials"]).toBe(
        "true",
      );
    },
  );
  await check(
    "preflight",
    () =>
      page.request.fetch(mutationUrl, {
        method: "OPTIONS",
        headers: {
          ...commonHeaders,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    async (response) => {
      expect(response.status(), `${origin} mutation preflight status`).toBe(
        204,
      );
      expect(response.headers()["access-control-allow-origin"]).toBe(origin);
      expect(
        response.headers()["access-control-allow-credentials"],
        `${origin} mutation preflight credentials`,
      ).toBe("true");
      expect(
        response
          .headers()
          ["access-control-allow-methods"]?.split(",")
          .map((method) => method.trim().toUpperCase()),
        `${origin} mutation preflight methods`,
      ).toContain("POST");
      expect(
        response
          .headers()
          ["access-control-allow-headers"]?.split(",")
          .map((header) => header.trim().toLowerCase()),
        `${origin} mutation preflight headers`,
      ).toContain("content-type");
    },
  );
  await check(
    "mutation",
    () =>
      page.request.post(mutationUrl, {
        headers: { ...commonHeaders, "Content-Type": "application/json" },
        data: { message: "origin contract" },
      }),
    async (response) => {
      expect(
        response.status(),
        `${origin} state-changing request must pass origin protection`,
      ).not.toBe(403);
      expect(response.headers()["access-control-allow-origin"]).toBe(origin);
      expect(response.headers()["access-control-allow-credentials"]).toBe(
        "true",
      );
    },
  );
  await writeOriginDiagnostics();
}

async function expectHostileOriginRejected(page: Page) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl)
    throw new Error(
      "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
    );
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const uploadUrl = new URL("/api/upload/archive", apiBaseUrl).toString();
  const liveUpdateUrl = new URL("/api/ai/chat/stream", apiBaseUrl).toString();
  const diagnostic: OriginDiagnostic = {
    origin: HOSTILE_ORIGIN,
    phase: "rejection",
  };
  recordedOriginDiagnostics.push(diagnostic);
  try {
    const response = await page.request.post(mutationUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json",
      },
      data: { message: "hostile origin contract" },
    });
    diagnostic.status = response.status();
    diagnostic.headers = relevantOriginHeaders(response.headers());
    expect(response.status()).toBe(403);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    expect(
      response.headers()["access-control-allow-credentials"],
    ).toBeUndefined();

    const hostileUpload = await page.request.post(uploadUrl, {
      headers: { Origin: HOSTILE_ORIGIN },
      multipart: {
        archive: {
          name: "hostile-dashboard-journey.zip",
          mimeType: "application/zip",
          buffer: Buffer.from("not an archive"),
        },
      },
    });
    expect(hostileUpload.status()).toBe(403);
    expect(
      hostileUpload.headers()["access-control-allow-origin"],
    ).toBeUndefined();

    const hostileLiveUpdate = await page.request.post(liveUpdateUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json",
      },
      data: {},
    });
    expect(hostileLiveUpdate.status()).toBe(403);
    expect(
      hostileLiveUpdate.headers()["access-control-allow-origin"],
    ).toBeUndefined();
  } catch (error) {
    diagnostic.error = "origin rejection check failed";
    await writeOriginDiagnostics();
    throw error;
  }
  await writeOriginDiagnostics();
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
    if (process.env.DASHBOARD_E2E_LIVE_DISPOSABLE !== "1") {
      throw new Error(
        "Live-provider journey requires DASHBOARD_E2E_LIVE_DISPOSABLE=1 and a disposable project.",
      );
    }
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
    await expect(
      page.getByText("Showing 1–1 of 1", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();

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

  test("previews and downloads the completed execution audit without duplicating effects", async ({
    page,
  }) => {
    const auditRequests: string[] = [];
    const auditBody = {
      format: "engineeringos.execution-audit.v1",
      exportedAt: "2026-01-01T00:02:00.000Z",
      execution: {
        id: EXECUTION_ID,
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        operationId: executionFixture.operationId,
        status: "completed",
        terminalState: "completed",
        revision: "e2e-revision-42",
        proof: { required: false, verdict: "PROVEN" },
      },
      timeline: [],
      validations: [{ status: "passed", profile: "release-safe" }],
      affectedFiles: ["src/feature.ts"],
      redaction: {
        excluded: [
          "provider secrets",
          "raw model output",
          "private runtime paths",
        ],
      },
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "server-supplied-audit-name.json",
        requests: auditRequests,
        failFirstPreview: true,
      },
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Completed audit execution",
      };
      localStorage.setItem(
        "eos_ai_execution_current_e2e-project",
        "e2e-audit-session",
      );
      localStorage.setItem(
        "eos_ai_execution_e2e-project_e2e-audit-session",
        JSON.stringify(execution),
      );
    });
    await page.goto(`${DASHBOARD_PATH}ai`);

    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText(/completed/i);
    await expect(proof).toContainText("Revision: e2e-revision-42");

    await proof.getByRole("button", { name: "Preview audit" }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Audit preview temporarily unavailable");
    await expect(preview).toContainText("same execution and revision");
    await expect(preview.getByRole("button", { name: "Retry preview" })).toBeVisible();
    expect(auditRequests).toHaveLength(1);

    await preview.getByRole("button", { name: "Retry preview" }).click();
    await expect(preview).toContainText("provider secrets");
    await expect(preview).toContainText("raw model output");
    await expect(preview).toContainText("private runtime paths");
    await expect(preview).toContainText(EXECUTION_ID);
    await expect(preview).toContainText("e2e-operation");
    await expect(preview).toContainText("e2e-revision-42");
    expect(auditRequests).toHaveLength(2);
    expect(new URL(auditRequests[0]).pathname).toBe(
      `/api/ai/executions/${EXECUTION_ID}/audit-export`,
    );

    await preview.getByRole("button", { name: "Close audit preview" }).click();
    await expect(preview).toBeHidden();

    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", { name: "Export audit" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("server-supplied-audit-name.json");
    expect(auditRequests).toHaveLength(3);

    await page.reload();
    const reloadedProof = page.getByLabel("Agent execution proof");
    await expect(reloadedProof).toBeVisible();
    await expect(reloadedProof).toContainText(/completed/i);
    await expect(reloadedProof).toContainText("Execution e2e-controlled-execution");
    await expect(reloadedProof).toContainText("Revision: e2e-revision-42");
    await expect(
      page.getByLabel("Redacted audit preview"),
    ).toBeHidden();
    expect(auditRequests).toHaveLength(3);
  });

  test("keeps the cancelled execution audit handoff redacted and terminal", async ({
    page,
  }) => {
    const auditRequests: string[] = [];
    const cancelledExecution = {
      ...executionFixture,
      status: "cancelled",
      flightState: "CANCELLED",
      checkpoint: {
        stage: "cancelled",
        detail: "Execution cancelled before any changes were applied.",
      },
      terminalReason: "cancel_requested",
      completedAt: "2026-01-01T00:01:30.000Z",
      updatedAt: "2026-01-01T00:01:30.000Z",
    };
    const auditBody = {
      format: "engineeringos.execution-audit.v1",
      exportedAt: "2026-01-01T00:02:00.000Z",
      execution: {
        id: EXECUTION_ID,
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        operationId: executionFixture.operationId,
        status: "cancelled",
        terminalState: "cancelled",
        revision: "e2e-revision-42",
        proof: { required: false, verdict: "NOT_RECORDED" },
      },
      timeline: [
        { type: "cancelled", detail: "Cancellation accepted by the server." },
      ],
      validations: [],
      affectedFiles: [],
      redaction: {
        excluded: [
          "provider secrets",
          "raw model output",
          "private runtime paths",
        ],
      },
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "cancelled-server-audit.json",
        requests: auditRequests,
        execution: cancelledExecution,
        messageOutcome: "CANCELLED",
      },
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Cancelled audit execution",
      };
      localStorage.setItem(
        "eos_ai_execution_current_e2e-project",
        "e2e-audit-session",
      );
      localStorage.setItem(
        "eos_ai_execution_e2e-project_e2e-audit-session",
        JSON.stringify(execution),
      );
    });
    await page.goto(`${DASHBOARD_PATH}ai`);

    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText("Cancelled");
    await expect(proof).toContainText("Execution e2e-controlled-execution");
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await expect(proof).toContainText("Terminal reason: cancel_requested");
    await expect(proof.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(proof.getByRole("button", { name: "Resume" })).toHaveCount(0);
    await expect(
      proof.getByRole("button", { name: "Approve & apply" }),
    ).toHaveCount(0);
    await expect(
      proof.getByRole("button", { name: /commit verified changes/i }),
    ).toHaveCount(0);
    await expect(
      proof.getByRole("button", { name: /push committed changes/i }),
    ).toHaveCount(0);

    await proof.getByRole("button", { name: "Preview audit" }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("cancelled");
    await expect(preview).toContainText(EXECUTION_ID);
    await expect(preview).toContainText("e2e-operation");
    await expect(preview).toContainText("e2e-revision-42");
    await expect(preview).toContainText("provider secrets");
    await expect(preview).toContainText("raw model output");
    await expect(preview).toContainText("private runtime paths");
    expect(auditRequests).toHaveLength(1);

    await preview.getByRole("button", { name: "Close audit preview" }).click();
    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", { name: "Export audit" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("cancelled-server-audit.json");
    expect(auditRequests).toHaveLength(2);

    await page.reload();
    const reloadedProof = page.getByLabel("Agent execution proof");
    await expect(reloadedProof).toBeVisible();
    await expect(reloadedProof).toContainText("Cancelled");
    await expect(reloadedProof).toContainText("Revision: e2e-revision-42");
    await expect(page.getByLabel("Redacted audit preview")).toBeHidden();
    expect(auditRequests).toHaveLength(2);
  });

  test("uploads an archive and renders a live task update", async ({
    page,
  }) => {
    const taskId = "e2e-live-task";
    const liveLog = {
      id: "e2e-live-log",
      taskId,
      level: "info",
      message: "Live update received from the server",
      timestamp: "2026-01-01T00:00:02.000Z",
    };
    await installApiFixtures(page, {
      archiveUpload: {
        uploadId: "e2e-upload",
        originalName: "dashboard-journey.zip",
      },
      liveTask: {
        id: taskId,
        title: "Verify live dashboard updates",
        projectId: "e2e-project",
        log: liveLog,
      },
    });
    await programmaticSignIn(page);

    // This is a valid, empty ZIP archive. Keeping it inline makes the browser
    // test self-contained while still exercising FormData and multipart bytes.
    const uploadResult = await page.evaluate(async (apiBaseUrl) => {
      const bytes = Uint8Array.from(
        atob("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="),
        (character) => character.charCodeAt(0),
      );
      const body = new FormData();
      body.append(
        "archive",
        new Blob([bytes], { type: "application/zip" }),
        "dashboard-journey.zip",
      );
      const response = await fetch(
        new URL("/api/upload/archive", apiBaseUrl).toString(),
        { method: "POST", credentials: "include", body },
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    }, process.env.DASHBOARD_E2E_API_BASE_URL ?? page.url());
    expect(uploadResult.status).toBe(201);
    expect(uploadResult.body).toEqual({
      uploadId: "e2e-upload",
      originalName: "dashboard-journey.zip",
    });

    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel(
      "Expand task Verify live dashboard updates",
    );
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", { name: "Logs" }).click();
    await expect(page.getByRole("region", { name: "Activity" })).toContainText(
      "Live update received from the server",
    );
  });

  test("recovers a live task update after a temporary stream failure", async ({
    page,
  }) => {
    const taskId = "e2e-reconnecting-live-task";
    const liveLog = {
      id: "e2e-reconnecting-live-log",
      taskId,
      level: "info",
      message: "Authoritative update received after reconnect",
      timestamp: "2026-01-01T00:00:02.000Z",
      metadata: {
        operationId: "e2e-reconnecting-operation",
        checkpointVersion: 3,
      },
    };
    const streamRequests: string[] = [];
    await installApiFixtures(page, {
      liveTask: {
        id: taskId,
        title: "Recover live task updates",
        projectId: "e2e-project",
        log: liveLog,
        streamRequests,
        failFirstStream: true,
      },
    });
    await programmaticSignIn(page);

    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel("Expand task Recover live task updates");
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", { name: "Logs" }).click();

    const activity = page.getByRole("region", { name: "Activity" });
    await expect(activity).toContainText(liveLog.message);
    await expect
      .poll(() => streamRequests.length, {
        message: "the task log stream should reconnect exactly once",
      })
      .toBe(2);
    expect(streamRequests).toHaveLength(2);
    expect(streamRequests[0]).toBe(streamRequests[1]);
    expect(new URL(streamRequests[1]).pathname).toBe(
      `/api/tasks/${taskId}/logs/stream`,
    );
    await expect(
      activity.locator("summary").filter({ hasText: liveLog.message }),
    ).toHaveCount(1);
  });

  test("shows an actionable terminal state when live task reconnects are exhausted", async ({
    page,
  }) => {
    const taskId = "e2e-exhausted-live-task";
    const operationId = "e2e-exhausted-operation";
    const liveLog = {
      id: "e2e-exhausted-live-log",
      taskId,
      level: "info",
      message: "The only confirmed task update",
      timestamp: "2026-01-01T00:00:02.000Z",
      metadata: { operationId },
    };
    const streamRequests: string[] = [];
    const nonStreamRequests: string[] = [];
    page.on("request", (request) => {
      if (!request.url().includes("/api/tasks/")) return;
      if (!request.url().includes("/logs/stream")) nonStreamRequests.push(request.method());
    });
    await installApiFixtures(page, {
      liveTask: {
        id: taskId,
        title: "Recover exhausted live task updates",
        projectId: "e2e-project",
        log: liveLog,
        initialLogs: [liveLog],
        streamRequests,
        failStreamAttempts: 6,
      },
    });
    await programmaticSignIn(page);

    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    await page.getByLabel("Expand task Recover exhausted live task updates").click();
    await page.getByRole("button", { name: "Logs" }).click();

    const activity = page.getByRole("region", { name: "Activity" });
    await expect(activity).toContainText(liveLog.message);
    await expect(page.getByText("Temporary stream failure.", { exact: false })).toBeVisible();
    await expect
      .poll(() => streamRequests.length, {
        message: "the task log stream should exhaust its bounded reconnect budget",
        timeout: 35_000,
      })
      .toBe(6);
    const exhausted = page.getByRole("alert");
    await expect(exhausted).toContainText("Live task updates could not reconnect");
    await expect(exhausted).toContainText("Reconnect attempts are exhausted");
    await expect(exhausted).toContainText(operationId);
    await expect(exhausted).toContainText("task has not been marked failed");
    await expect(exhausted.getByRole("button", { name: "Retry live updates" })).toBeVisible();
    await expect(exhausted.getByRole("button", { name: "Refresh task logs" })).toBeVisible();

    await exhausted.getByRole("button", { name: "Retry live updates" }).click();
    await expect(activity).toContainText("The only confirmed task update");
    await expect.poll(() => streamRequests.length).toBe(7);
    expect(new Set(streamRequests).size).toBe(1);
    expect(nonStreamRequests).not.toContain("POST");
    await expect(
      activity.locator("summary").filter({ hasText: liveLog.message }),
    ).toHaveCount(1);
  });

  test("pages and reloads the filtered event stream without losing its window", async ({
    page,
  }) => {
    const events = Array.from({ length: 51 }, (_, index) => ({
      id: `e2e-event-${index}`,
      projectId: "e2e-project",
      type: "AuditEvent",
      severity: index < 2 ? "success" : "info",
      correlationId: index < 2 ? "release-42" : null,
      message:
        index < 2 ? `Filtered release event ${index}` : `Older event ${index}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 51 - index)).toISOString(),
    }));
    const eventRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/api/events"))
        eventRequests.push(request.url());
    });
    await installApiFixtures(page, {
      events,
      projects: [
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
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}events`);

    await expect(
      page.getByText("Older event 49", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Older event 50", { exact: true }),
    ).not.toBeVisible();
    const firstRequest = new URL(eventRequests.at(-1)!);
    expect(firstRequest.searchParams.get("limit")).toBe("50");
    expect(firstRequest.searchParams.get("page")).toBe("1");

    await Promise.all([
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname.endsWith("/api/events") &&
          url.searchParams.get("page") === "2"
        );
      }),
      page.getByRole("button", { name: "Older" }).click(),
    ]);
    await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Older event 50", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).not.toBeVisible();
    expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
    await page.getByRole("button", { name: "Newer" }).click();
    await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).toBeVisible();

    await page.getByPlaceholder("Search logs...").fill("Filtered release");
    await page.getByRole("button", { name: "Toggle event filters" }).click();
    await page.locator("select").nth(1).selectOption("success");
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Older event 1", { exact: true }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/search=Filtered\+release/);
    await expect(page).toHaveURL(/severity=success/);

    await page.reload();
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Older event 1", { exact: true }),
    ).not.toBeVisible();
    await expect(page.getByPlaceholder("Search logs...")).toHaveValue(
      "Filtered release",
    );
    await page.getByRole("button", { name: "Toggle event filters" }).click();
    await expect(page.locator("select").nth(1)).toHaveValue("success");
    const filteredRequest = new URL(eventRequests.at(-1)!);
    expect(filteredRequest.searchParams.get("limit")).toBe("50");
    expect(filteredRequest.searchParams.get("page")).toBe("1");
    expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
    expect(filteredRequest.searchParams.get("severity")).toBe("success");
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

  test("recovers a missing token after a real stream abort and resumes one execution", async ({
    page,
  }) => {
    const recovery = installInterruptedResumeFixture();
    await installApiFixtures(page, { interruptedResume: recovery });
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        const body = typeof init?.body === "string" ? init.body : "";
        if (
          !url.includes("/api/ai/chat/stream") ||
          body.includes('"executionId"')
        ) {
          return nativeFetch(input, init);
        }

        const response = await nativeFetch(input, init);
        if (!response.body) return response;
        const reader = response.body.getReader();
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let buffered = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                if (buffered) controller.enqueue(encoder.encode(buffered));
                controller.close();
                return;
              }
              buffered += new TextDecoder().decode(value, { stream: true });
              const marker = buffered.indexOf('"type":"execution_started"');
              const frameEnd =
                marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
              if (frameEnd >= 0) {
                controller.enqueue(
                  encoder.encode(buffered.slice(0, frameEnd + 2)),
                );
                controller.error(new TypeError("network connection reset"));
                return;
              }
            }
          },
        });
        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      };
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const streamRequests: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/ai/chat/stream") &&
        request.method() === "POST"
      ) {
        try {
          streamRequests.push(
            request.postDataJSON() as Record<string, unknown>,
          );
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
      page.getByText(
        "Execution paused — ready to resume from its durable checkpoint",
        {
          exact: true,
        },
      ),
    ).toBeVisible();

    const storageKey =
      "eos_ai_execution_e2e-project_e2e-interrupted-resume-session";
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
    await expect.poll(() => streamRequests.length).toBe(2);
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

  test("projects delivery recovery states safely after reload", async ({
    page,
  }) => {
    const recovery = {
      requests: [] as string[],
      operations: [
        {
          proposalId: "e2e-recovery-available-proposal",
          operationId: "e2e-recovery-available-operation",
          sessionId: "e2e-recovery-available-session",
          lifecycle: "blocked",
          status: "pending",
          createdAt: "2026-01-01T00:03:00.000Z",
          recoveryState: "recoverable",
          operatorExplanation:
            "The delivery stopped because validation needs to be run again.",
          nextAction:
            "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
          conflictReason: null,
          validationEvidence: [{ profile: "workspace-typecheck", status: "failed" }],
          workspaceAvailable: true,
          changeCount: 2,
        },
        {
          proposalId: "e2e-recovery-missing-proposal",
          operationId: "e2e-recovery-missing-operation",
          sessionId: "e2e-recovery-missing-session",
          lifecycle: "abandoned",
          status: "pending",
          createdAt: "2026-01-01T00:02:00.000Z",
          recoveryState: "missing_workspace",
          operatorExplanation:
            "The saved delivery workspace is no longer available, so recovery cannot continue.",
          nextAction:
            "Start a new delivery from the current project rather than retrying this recovery.",
          conflictReason: "Workspace expired after the runner was recycled.",
          validationEvidence: null,
          workspaceAvailable: false,
          changeCount: 1,
        },
        {
          proposalId: "e2e-recovery-discarded-proposal",
          operationId: "e2e-recovery-discarded-operation",
          sessionId: "e2e-recovery-discarded-session",
          lifecycle: "cancelled",
          status: "rejected",
          createdAt: "2026-01-01T00:01:00.000Z",
          recoveryState: "discarded",
          operatorExplanation: "This delivery recovery was already discarded.",
          nextAction: "No action is required.",
          conflictReason: "Internal diagnostic: should never be rendered",
          validationEvidence: null,
          workspaceAvailable: false,
          changeCount: 3,
        },
      ],
    };
    await installApiFixtures(page, { deliveryRecovery: recovery });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const region = page.getByRole("region", {
      name: "Recoverable delivery operations",
    });
    await expect(region).toBeVisible();
    await expect(region.getByText("Recoverable", { exact: true })).toBeVisible();
    await expect(
      region.getByText("Workspace unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      region.getByText("Already discarded", { exact: true }),
    ).toBeVisible();
    await expect(
      region.getByText(
        "The saved delivery workspace is no longer available, so recovery cannot continue.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      region.getByText("This delivery recovery was already discarded.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      region.getByText(
        "Retained reason: Workspace expired after the runner was recycled.",
        { exact: true },
      ),
    ).toBeVisible();

    const available = region.locator(
      '[data-operation-id="e2e-recovery-available-operation"]',
    );
    const missing = region.locator(
      '[data-operation-id="e2e-recovery-missing-operation"]',
    );
    const discarded = region.locator(
      '[data-operation-id="e2e-recovery-discarded-operation"]',
    );
    await expect(available).toHaveAttribute(
      "data-recovery-state",
      "recoverable",
    );
    await expect(missing).toHaveAttribute(
      "data-recovery-state",
      "missing_workspace",
    );
    await expect(discarded).toHaveAttribute(
      "data-recovery-state",
      "discarded",
    );
    await expect(available.getByRole("button", { name: "Resume validation" })).toBeEnabled();
    await expect(available.getByRole("button", { name: "Discard workspace" })).toBeEnabled();
    await expect(missing.getByRole("button", { name: "Resume validation" })).toBeDisabled();
    await expect(missing.getByRole("button", { name: "Discard workspace" })).toBeDisabled();
    await expect(discarded.getByRole("button", { name: "Resume validation" })).toBeDisabled();
    await expect(discarded.getByRole("button", { name: "Discard workspace" })).toBeDisabled();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /\/home\/runner|\/tmp\/|\/workspace\/|internal diagnostic/i,
    );
    await expectNoHorizontalOverflow(page);

    await page.reload();
    const reloadedRegion = page.getByRole("region", {
      name: "Recoverable delivery operations",
    });
    await expect(reloadedRegion).toBeVisible();
    await expect(
      reloadedRegion
        .locator('[data-operation-id="e2e-recovery-missing-operation"]')
        .getByRole("button", { name: "Resume validation" }),
    ).toBeDisabled();
    await expect(
      reloadedRegion
        .locator('[data-operation-id="e2e-recovery-discarded-operation"]')
        .getByRole("button", { name: "Discard workspace" }),
    ).toBeDisabled();
    expect(recovery.requests.length).toBeGreaterThanOrEqual(2);
    expect(recovery.requests.every((url) => url.includes("projectId=e2e-project"))).toBe(true);
  });

  test("explains when delivery recovery loses a race and refreshes state", async ({
    page,
  }) => {
    const recovery = {
      requests: [] as string[],
      actionRequests: [] as string[],
      operations: [
        {
          proposalId: "e2e-recovery-race-proposal",
          operationId: "e2e-recovery-race-operation",
          sessionId: "e2e-recovery-race-session",
          lifecycle: "blocked",
          status: "pending",
          createdAt: "2026-01-01T00:04:00.000Z",
          recoveryState: "recoverable",
          operatorExplanation:
            "The delivery stopped because the retained changes need review before validation can continue.",
          nextAction:
            "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
          conflictReason: null,
          validationEvidence: [{ profile: "workspace-typecheck", status: "failed" }],
          workspaceAvailable: true,
          changeCount: 1,
        },
      ],
      recoveryAction: {
        proposalId: "e2e-recovery-race-proposal",
        action: "resume-validation" as const,
        response: {
          error: "This delivery recovery was already discarded.",
          code: "DELIVERY_ALREADY_DISCARDED",
          lifecycle: "cancelled",
          recoveryState: "discarded",
          nextAction: "No action is required.",
          diagnostic: "Do not render this server detail.",
        },
        nextOperations: [
          {
            proposalId: "e2e-recovery-race-proposal",
            operationId: "e2e-recovery-race-operation",
            sessionId: "e2e-recovery-race-session",
            lifecycle: "cancelled",
            status: "rejected",
            createdAt: "2026-01-01T00:04:00.000Z",
            recoveryState: "discarded",
            operatorExplanation: "This delivery recovery was already discarded.",
            nextAction: "No action is required.",
            conflictReason: null,
            validationEvidence: null,
            workspaceAvailable: false,
            changeCount: 1,
          },
        ],
      },
    };
    await installApiFixtures(page, { deliveryRecovery: recovery });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const region = page.getByRole("region", {
      name: "Recoverable delivery operations",
    });
    const operation = region.locator(
      '[data-operation-id="e2e-recovery-race-operation"]',
    );
    await expect(operation.getByRole("button", { name: "Resume validation" })).toBeEnabled();
    await operation.getByRole("button", { name: "Resume validation" }).click();

    await expect(page.getByText("Recovery state changed", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "This recovery was already discarded. The recovery list was refreshed.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect
      .poll(() => recovery.requests.length)
      .toBeGreaterThanOrEqual(2);
    await expect(operation).toHaveAttribute("data-recovery-state", "discarded");
    expect(recovery.actionRequests).toHaveLength(1);
    expect(recovery.actionRequests[0]).toContain(
      "/api/ai/delivery/e2e-recovery-race-proposal/resume-validation",
    );
    expect(await region.locator('[data-operation-id="e2e-recovery-race-operation"]').count()).toBe(1);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/Do not render this server detail|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
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
