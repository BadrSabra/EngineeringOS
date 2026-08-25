// 54a56ddb0b1019f994a9df971c346606cf214ee3
var _process$env$DASHBOAR;
import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseClerkSignInTokenResponse, parseClerkUserLookupResponse, parseCreatedClerkUserResponse } from "../src/lib/clerk-handoff";
const DASHBOARD_PATH = "/dashboard/";
const TEST_USER = {
  firstName: "EngineeringOS",
  lastName: "Dashboard Smoke",
  email: (_process$env$DASHBOAR = process.env.DASHBOARD_E2E_EMAIL) !== null && _process$env$DASHBOAR !== void 0 ? _process$env$DASHBOAR : "engineeringos-dashboard-smoke@example.com"
};
const EXECUTION_ID = "e2e-controlled-execution";
const DEFAULT_LIVE_TIMEOUT_MS = 120000;
const LIVE_TEST_TIMEOUT_MARGIN_MS = 5000;
const HOSTILE_ORIGIN = "https://attacker.example";
const ORIGIN_DIAGNOSTIC_HEADERS = ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "vary"];
const DEFAULT_LIVE_PROMPT = "Perform a bounded forensic audit of this disposable project using read-only tools. " + "Produce at least one accepted evidence item and one validation checkpoint, and do not " + "report COMPLETED unless both are present. Report only verified evidence.";
const LIVE_CAMPAIGN_SCENARIOS = new Set(["provider-outage", "malformed-output", "delivery-success"]);
function liveCampaignScenario() {
  var _process$env$DASHBOAR2;
  const scenario = (_process$env$DASHBOAR2 = process.env.DASHBOARD_E2E_LIVE_SCENARIO) === null || _process$env$DASHBOAR2 === void 0 ? void 0 : _process$env$DASHBOAR2.trim();
  if (process.env.DASHBOARD_E2E_LIVE_CAMPAIGN === "1" && !scenario) {
    throw new Error("Live campaign requires DASHBOARD_E2E_LIVE_SCENARIO=provider-outage, malformed-output, or delivery-success.");
  }
  if (scenario && !LIVE_CAMPAIGN_SCENARIOS.has(scenario)) {
    throw new Error(`Unsupported live campaign scenario: ${scenario}.`);
  }
  return scenario;
}
function livePrompt() {
  var _process$env$DASHBOAR3;
  const scenario = liveCampaignScenario();
  if (scenario === "provider-outage") {
    return "Run a bounded forensic audit and report the OpenRouter rate-limit/provider-exhaustion outage as a failed or incomplete operation. Do not use prior analysis as a current answer; include the current operation and revision.";
  }
  if (scenario === "malformed-output") {
    return "Run a bounded forensic audit and treat malformed provider output as failed or incomplete. Do not claim success, apply, commit, or push without candidate-bound evidence.";
  }
  if (scenario === "delivery-success") {
    return "Run the bounded delivery proof campaign on this disposable project. Exercise apply, commit, and push only when each current operation, project revision, candidate identity, and candidate-bound evidence match. Report every terminal receipt.";
  }
  return (_process$env$DASHBOAR3 = process.env.DASHBOARD_E2E_LIVE_PROMPT) !== null && _process$env$DASHBOAR3 !== void 0 ? _process$env$DASHBOAR3 : DEFAULT_LIVE_PROMPT;
}
function liveTimeoutMs() {
  const configured = Number(process.env.DASHBOARD_E2E_LIVE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LIVE_TIMEOUT_MS;
}
function approvedDashboardOrigins() {
  var _process$env$DASHBOAR4;
  const origins = ((_process$env$DASHBOAR4 = process.env.DASHBOARD_E2E_APPROVED_ORIGINS) !== null && _process$env$DASHBOAR4 !== void 0 ? _process$env$DASHBOAR4 : "").split(",").map(origin => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new Error("DASHBOARD_E2E_APPROVED_ORIGINS must contain every approved dashboard origin.");
  }
  return origins.map(origin => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`Dashboard journey origin must be a bare origin: ${origin}`);
    }
    return parsed.origin;
  });
}
const dashboardFixture = {
  freshnessRevision: "2026-01-01T00:00:00.000Z",
  projectCount: 1,
  activeTaskCount: 0,
  completedTaskCount: 2,
  failedTaskCount: 0,
  taskStatusBreakdown: {
    pending: 0,
    running: 0
  },
  projectScores: [{
    projectId: "e2e-project",
    projectName: "Smoke Project",
    score: 92,
    trend: "stable"
  }],
  recentEvents: [{
    id: "e2e-event",
    type: "SmokeCheck",
    severity: "success",
    message: "Dashboard API fixture ready",
    timestamp: "2026-01-01T00:00:00.000Z"
  }],
  topRules: []
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
    detail: "Controlled browser fixture completed."
  },
  objective: {
    objective: "Verify the dashboard browser journey"
  },
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z"
};
function jsonResponse(body, status = 200, headers) {
  return {
    status,
    contentType: "application/json",
    ...(headers ? {
      headers
    } : {}),
    body: JSON.stringify(body)
  };
}
async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}
async function expectDashboardReady(page) {
  await expect(page.getByRole("heading", {
    name: "System Overview"
  })).toBeVisible();
  await expect(page.getByText("SYSTEM ONLINE", {
    exact: true
  })).toBeVisible();
}
async function restartApiForCampaign(page) {
  const controlUrl = process.env.DASHBOARD_E2E_CONTROL_URL;
  if (!controlUrl) throw new Error("Dashboard campaign control URL is missing.");
  const response = await page.request.post(`${controlUrl}/restart-api`, {
    timeout: 15000
  });
  expect(response.status()).toBe(204);
}
async function installApiFixtures(page, overrides) {
  await page.route("**/api/**", async route => {
    var _overrides$deliveryRe, _overrides$auditExpor2, _overrides$auditExpor3;
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/dashboard(?=\/|$)/, "");
    const arabicAi = overrides === null || overrides === void 0 ? void 0 : overrides.arabicAi;
    const alternateAi = overrides === null || overrides === void 0 ? void 0 : overrides.alternateAi;
    const disconnectAi = overrides === null || overrides === void 0 ? void 0 : overrides.disconnectAi;
    const aiFixtures = [arabicAi, alternateAi, disconnectAi].filter(fixture => Boolean(fixture));
    if (aiFixtures.length > 0 && path.endsWith("/api/ai/chat/sessions")) {
      const projectId = url.searchParams.get("projectId");
      const projectSessions = aiFixtures.filter(fixture => !fixture.projectId || fixture.projectId === projectId);
      return route.fulfill(jsonResponse(projectSessions.map(fixture => ({
        id: fixture.sessionId,
        title: fixture.question,
        updatedAt: "2026-01-01T00:02:00.000Z"
      }))));
    }
    if (overrides !== null && overrides !== void 0 && overrides.resumeFailure && path.endsWith("/api/ai/chat/stream")) {
      let requestBody = {};
      try {
        requestBody = route.request().postDataJSON();
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      if (requestBody.executionId === overrides.resumeFailure.fixture.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache"
          },
          body: overrides.resumeFailure.fixture.streamBody
        });
      }
    }
    if (overrides !== null && overrides !== void 0 && overrides.interruptedResume && path.endsWith("/api/ai/chat/stream")) {
      let requestBody = {};
      try {
        requestBody = route.request().postDataJSON();
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      const {
        fixture,
        resumedStreamBody
      } = overrides.interruptedResume;
      if (requestBody.executionId === fixture.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache"
          },
          body: resumedStreamBody
        });
      }
      if (!requestBody.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache"
          },
          // Deliberately stop after the durable execution identity. The
          // journey wraps this response in a browser-level stream error.
          body: fixture.streamBody
        });
      }
    }
    const streamFixture = disconnectAi !== null && disconnectAi !== void 0 ? disconnectAi : arabicAi;
    if (streamFixture && path.endsWith("/api/ai/chat/stream")) return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache"
      },
      body: streamFixture.streamBody
    });
    const messageFixture = aiFixtures.find(fixture => path.endsWith(`/api/ai/chat/${fixture.sessionId}/messages`));
    if (messageFixture) return route.fulfill(jsonResponse([{
      id: `${messageFixture.sessionId}-user-message`,
      sessionId: messageFixture.sessionId,
      role: "user",
      content: messageFixture.question,
      createdAt: "2026-01-01T00:01:00.000Z"
    }, messageFixture.message]));
    if (overrides !== null && overrides !== void 0 && overrides.auditExport && path.endsWith("/api/ai/chat/e2e-audit-session/messages")) {
      var _overrides$auditExpor;
      return route.fulfill(jsonResponse([{
        id: "e2e-audit-user-message",
        sessionId: "e2e-audit-session",
        role: "user",
        content: "Completed audit execution",
        createdAt: "2026-01-01T00:01:00.000Z"
      }, {
        id: "e2e-audit-assistant-message",
        sessionId: "e2e-audit-session",
        role: "assistant",
        content: "Completed audit execution",
        executionId: EXECUTION_ID,
        outcome: (_overrides$auditExpor = overrides.auditExport.messageOutcome) !== null && _overrides$auditExpor !== void 0 ? _overrides$auditExpor : "SUCCEEDED",
        createdAt: "2026-01-01T00:02:00.000Z"
      }]));
    }
    if (path === "/api/dashboard") return route.fulfill(jsonResponse(dashboardFixture));
    if (overrides !== null && overrides !== void 0 && overrides.auditExport && path === `/api/ai/executions/${EXECUTION_ID}/audit-export`) {
      overrides.auditExport.requests.push(route.request().url());
      if (overrides.auditExport.failFirstPreview && overrides.auditExport.requests.length === 1) {
        return route.fulfill(jsonResponse({
          error: "Temporary preview network failure."
        }, 503));
      }
      return route.fulfill(jsonResponse(overrides.auditExport.body, 200, {
        "Content-Disposition": `attachment; filename="${overrides.auditExport.filename}"`
      }));
    }
    if (overrides !== null && overrides !== void 0 && overrides.archiveUpload && path === "/api/upload/archive") {
      var _route$request$header;
      const contentType = (_route$request$header = route.request().headers()["content-type"]) !== null && _route$request$header !== void 0 ? _route$request$header : "";
      if (!contentType.startsWith("multipart/form-data;")) {
        return route.fulfill(jsonResponse({
          error: "Expected multipart archive upload."
        }, 400));
      }
      const body = route.request().postDataBuffer();
      if (!(body !== null && body !== void 0 && body.includes(Buffer.from("dashboard-journey.zip")))) {
        return route.fulfill(jsonResponse({
          error: "Expected the journey archive payload."
        }, 400));
      }
      return route.fulfill(jsonResponse({
        uploadId: overrides.archiveUpload.uploadId,
        originalName: overrides.archiveUpload.originalName
      }, 201, {
        "access-control-allow-origin": new URL(page.url()).origin,
        "access-control-allow-credentials": "true"
      }));
    }
    if (overrides !== null && overrides !== void 0 && overrides.liveTask && path === "/api/tasks") {
      return route.fulfill(jsonResponse([{
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
        updatedAt: "2026-01-01T00:00:01.000Z"
      }]));
    }
    if (overrides !== null && overrides !== void 0 && overrides.liveTask && path === `/api/tasks/${overrides.liveTask.id}/logs`) {
      var _overrides$liveTask$i;
      return route.fulfill(jsonResponse((_overrides$liveTask$i = overrides.liveTask.initialLogs) !== null && _overrides$liveTask$i !== void 0 ? _overrides$liveTask$i : []));
    }
    if (overrides !== null && overrides !== void 0 && overrides.liveTask && path === `/api/tasks/${overrides.liveTask.id}/logs/stream`) {
      const streamRequests = overrides.liveTask.streamRequests;
      streamRequests === null || streamRequests === void 0 || streamRequests.push(route.request().url());
      if (overrides.liveTask.failFirstStream && (streamRequests === null || streamRequests === void 0 ? void 0 : streamRequests.length) === 1 || overrides.liveTask.failStreamAttempts && streamRequests && streamRequests.length <= overrides.liveTask.failStreamAttempts) {
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
          "access-control-allow-credentials": "true"
        },
        body: `event: log\ndata: ${JSON.stringify(overrides.liveTask.log)}\n\n`
      });
    }
    if (path === "/api/projects") {
      var _overrides$projects;
      return route.fulfill(jsonResponse((_overrides$projects = overrides === null || overrides === void 0 ? void 0 : overrides.projects) !== null && _overrides$projects !== void 0 ? _overrides$projects : [{
        id: "e2e-project",
        name: "Smoke Project",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/smoke",
        qualityScore: 92
      }]));
    }
    if (overrides !== null && overrides !== void 0 && overrides.deliveryRecovery && path === "/api/ai/delivery/recoverable") {
      overrides.deliveryRecovery.requests.push(route.request().url());
      return route.fulfill(jsonResponse({
        operations: overrides.deliveryRecovery.operations
      }));
    }
    if (overrides !== null && overrides !== void 0 && (_overrides$deliveryRe = overrides.deliveryRecovery) !== null && _overrides$deliveryRe !== void 0 && _overrides$deliveryRe.recoveryAction && path === `/api/ai/delivery/${overrides.deliveryRecovery.recoveryAction.proposalId}/${overrides.deliveryRecovery.recoveryAction.action}`) {
      var _overrides$deliveryRe2, _overrides$deliveryRe3;
      (_overrides$deliveryRe2 = overrides.deliveryRecovery.actionRequests) === null || _overrides$deliveryRe2 === void 0 || _overrides$deliveryRe2.push(route.request().url());
      if (overrides.deliveryRecovery.recoveryAction.nextOperations) {
        overrides.deliveryRecovery.operations = overrides.deliveryRecovery.recoveryAction.nextOperations;
      }
      return route.fulfill(jsonResponse(overrides.deliveryRecovery.recoveryAction.response, (_overrides$deliveryRe3 = overrides.deliveryRecovery.recoveryAction.status) !== null && _overrides$deliveryRe3 !== void 0 ? _overrides$deliveryRe3 : 409));
    }
    if (path === "/api/events") {
      var _overrides$events, _url$searchParams$get;
      const events = (_overrides$events = overrides === null || overrides === void 0 ? void 0 : overrides.events) !== null && _overrides$events !== void 0 ? _overrides$events : dashboardFixture.recentEvents;
      const search = (_url$searchParams$get = url.searchParams.get("search")) === null || _url$searchParams$get === void 0 ? void 0 : _url$searchParams$get.toLowerCase();
      const filteredEvents = events.filter(event => {
        const projectId = url.searchParams.get("projectId");
        const severity = url.searchParams.get("severity");
        const correlationId = url.searchParams.get("correlationId");
        return (!projectId || event.projectId === projectId) && (!severity || event.severity === severity) && (!correlationId || event.correlationId === correlationId) && (!search || [event.message, event.type, event.correlationId].filter(value => typeof value === "string").some(value => value.toLowerCase().includes(search)));
      });
      const limit = Number(url.searchParams.get("limit")) || 50;
      const page = Number(url.searchParams.get("page")) || 1;
      return route.fulfill(jsonResponse({
        events: filteredEvents.slice((page - 1) * limit, page * limit),
        total: filteredEvents.length
      }));
    }
    if (overrides !== null && overrides !== void 0 && overrides.resumeFailure && path === `/api/ai/executions/${overrides.resumeFailure.fixture.executionId}`) {
      return route.fulfill(jsonResponse(overrides.resumeFailure.execution));
    }
    if (overrides !== null && overrides !== void 0 && overrides.interruptedResume && path === `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}`) {
      return route.fulfill(jsonResponse(overrides.interruptedResume.execution));
    }
    if (overrides !== null && overrides !== void 0 && overrides.interruptedResume && path === `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}/resume-capability`) {
      return route.fulfill(jsonResponse({
        executionId: overrides.interruptedResume.fixture.executionId,
        resumeToken: overrides.interruptedResume.recoveredToken
      }));
    }
    if (path === `/api/ai/executions/${EXECUTION_ID}`) return route.fulfill(jsonResponse((_overrides$auditExpor2 = overrides === null || overrides === void 0 || (_overrides$auditExpor3 = overrides.auditExport) === null || _overrides$auditExpor3 === void 0 ? void 0 : _overrides$auditExpor3.execution) !== null && _overrides$auditExpor2 !== void 0 ? _overrides$auditExpor2 : executionFixture));
    if (path === "/api/ai/mission-control") return route.fulfill(jsonResponse({
      updatedAt: "2026-01-01T00:01:00.000Z",
      executions: []
    }));

    // AI is deliberately not executed in this smoke journey. This response
    // verifies the user-visible unavailable/empty state without a provider.
    if (path.startsWith("/api/ai/")) return route.fulfill(jsonResponse({
      error: "AI provider not configured"
    }, 428));
    return route.continue();
  });
}
async function installArabicAiFixture(page, options) {
  var _options$sessionId, _options$question;
  const sessionId = (_options$sessionId = options === null || options === void 0 ? void 0 : options.sessionId) !== null && _options$sessionId !== void 0 ? _options$sessionId : "e2e-arabic-ai-session";
  const messageId = "e2e-arabic-ai-message";
  const source = "src/execution-tools.ts";
  const blocked = (options === null || options === void 0 ? void 0 : options.blocked) === true;
  const question = (_options$question = options === null || options === void 0 ? void 0 : options.question) !== null && _options$question !== void 0 ? _options$question : "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟";
  const answer = "عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.";
  const evidence = [{
    source,
    ...(blocked ? {
      excerpt: "provider timeout is handled here",
      supportsClaim: false,
      evidenceClass: "READ_CONFIRMED",
      citationStatus: "BLOCKED",
      citationReason: "MISSING_LITERAL_MATCH"
    } : {
      excerpt: 'return partialFromCollectedEvidence("provider timeout");',
      sourceSpan: {
        startLine: 42,
        endLine: 42
      },
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      citationStatus: "ACCEPTED",
      citationReason: "ACCEPTED_SOURCE_SPAN"
    })
  }];
  const toolTrace = [{
    kind: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false,
    prefetched: true
  }, {
    kind: "tool_result",
    tool: "read_file",
    source,
    cached: false,
    prefetched: true
  }, {
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
    finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER"
  }];
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
        complete: true
      }
    }
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
    createdAt: "2026-01-01T00:02:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId: "e2e-execution",
    status: "running",
    resumable: true
  }), sse({
    type: "stage",
    stage: "building-context"
  }), sse({
    type: "stage",
    stage: "calling-model"
  }), sse({
    type: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false,
    prefetched: true
  }), sse({
    type: "tool_result",
    tool: "read_file",
    source,
    cached: false,
    prefetched: true
  }), sse({
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
    finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER"
  }), sse({
    type: "delta",
    delta: answer
  }), sse({
    type: "done",
    sessionId,
    message,
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    behaviorEvidence: evidence,
    taskResult,
    pendingChanges: []
  })].join("");
  return {
    question,
    answer,
    source,
    sessionId,
    projectId: options === null || options === void 0 ? void 0 : options.projectId,
    streamBody,
    message
  };
}
function installToolFailureFixture() {
  const sessionId = "e2e-tool-failure-session";
  const messageId = "e2e-tool-failure-message";
  const source = "src/missing-release-fixture.ts";
  const question = "Which source file is available for the release check?";
  const answer = "ANALYSIS_INCOMPLETE: The required source read did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_EXECUTION_FAILED";
  const toolTrace = [{
    kind: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false
  }, {
    kind: "tool_result",
    tool: "read_file",
    source,
    resultKind: "failed",
    diagnosticCode,
    resultSummary: "The required source read did not complete."
  }, {
    kind: "done",
    stopReason: "tool_failure",
    iterations: 1,
    maxIterations: 8,
    toolCalls: 1,
    prefetchToolCalls: 0,
    loopToolCalls: 1,
    synthesisStarted: false,
    diagnosticCodes: [diagnosticCode]
  }];
  const message = {
    id: messageId,
    sessionId,
    role: "assistant",
    content: answer,
    toolTrace: JSON.stringify(toolTrace),
    createdAt: "2026-01-01T00:02:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId: "e2e-tool-failure-execution",
    status: "running",
    resumable: true
  }), sse({
    type: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false
  }), sse({
    type: "tool_result",
    tool: "read_file",
    source,
    resultKind: "failed",
    diagnosticCode,
    resultSummary: "The required source read did not complete."
  }), sse({
    type: "delta",
    delta: answer
  }), sse({
    type: "done",
    sessionId,
    message,
    toolTrace: JSON.stringify(toolTrace),
    pendingChanges: []
  })].join("");
  return {
    question,
    answer,
    source,
    sessionId,
    streamBody,
    message
  };
}
function installDisconnectedAiFixture() {
  const sessionId = "e2e-disconnected-ai-session";
  const executionId = "e2e-disconnected-ai-execution";
  const question = "What happens when the model disconnects after starting an answer?";
  const answer = "The model started an answer, but the provider disconnected before completion.";
  const diagnosticCode = "EXECUTION_PROVIDER_FAILURE";
  const toolTrace = [{
    kind: "done",
    stopReason: "provider_timeout",
    iterations: 1,
    maxIterations: 8,
    toolCalls: 0,
    prefetchToolCalls: 0,
    loopToolCalls: 0,
    synthesisStarted: false,
    diagnosticCodes: [diagnosticCode],
    diagnosticDetails: ["The provider disconnected after visible response text."]
  }];
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
    createdAt: "2026-01-01T00:02:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId,
    status: "running",
    resumable: true
  }), sse({
    type: "stage",
    stage: "calling-model"
  }), sse({
    type: "delta",
    delta: answer
  }),
  // The real route emits this after a provider disconnect so the client
  // drops the transient bubble before rendering the persisted result.
  sse({
    type: "stream_reset"
  }), sse({
    type: "done",
    sessionId,
    executionId,
    message,
    pendingChanges: []
  })].join("");
  return {
    question,
    answer,
    source: "provider",
    sessionId,
    executionId,
    streamBody,
    message
  };
}
function installResumedAnalysisFailureFixture() {
  const sessionId = "e2e-resumed-analysis-failure-session";
  const executionId = "e2e-resumed-analysis-failure-execution";
  const resumeToken = "e2e-resumed-analysis-failure-token-opaque";
  const question = "Verify the analysis evidence after reconnect.";
  const answer = "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_UNAVAILABLE";
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId,
    status: "running",
    resumable: true,
    resumeToken
  }), sse({
    type: "error",
    executionId,
    code: diagnosticCode,
    message: "The required analysis did not complete."
  })].join("");
  const fixture = {
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
      createdAt: "2026-01-01T00:02:00.000Z"
    }
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
        detail: "The required analysis tool was unavailable."
      },
      objective: {
        objective: question
      },
      error: "The required analysis did not complete.",
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z"
    }
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
    createdAt: "2026-01-01T00:03:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const fixture = {
    question,
    answer,
    source: "release-resume",
    sessionId,
    executionId,
    streamBody: [sse({
      type: "session_started",
      sessionId
    }), sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
      resumeToken: initialToken
    }), sse({
      type: "stage",
      stage: "calling-model"
    }), sse({
      type: "delta",
      delta: partialAnswer
    })].join(""),
    message
  };
  return {
    fixture,
    initialToken,
    recoveredToken,
    resumedStreamBody: [sse({
      type: "session_started",
      sessionId
    }), sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
      resumeToken: recoveredToken
    }), sse({
      type: "stage",
      stage: "resuming-checkpoint"
    }), sse({
      type: "delta",
      delta: answer
    }), sse({
      type: "done",
      sessionId,
      executionId,
      message,
      pendingChanges: []
    })].join(""),
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
        detail: "The browser transport disconnected after the execution started."
      },
      objective: {
        objective: question
      },
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z"
    }
  };
}
async function createReleaseSignInUrl(page) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required for the release-only programmatic Clerk handoff.");
  }
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json"
  };
  const userResponse = await page.request.get(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TEST_USER.email)}`, {
    headers
  });
  let userId = parseClerkUserLookupResponse(await userResponse.json());
  if (!userId) {
    const createdResponse = await page.request.post("https://api.clerk.com/v1/users", {
      headers,
      data: {
        email_address: [TEST_USER.email],
        first_name: TEST_USER.firstName,
        last_name: TEST_USER.lastName,
        skip_password_checks: true,
        skip_password_requirement: true
      }
    });
    userId = parseCreatedClerkUserResponse(await createdResponse.json());
  }
  if (!userId) {
    throw new Error("The isolated Clerk release user could not be provisioned.");
  }
  const tokenResponse = await page.request.post("https://api.clerk.com/v1/sign_in_tokens", {
    headers,
    data: {
      user_id: userId
    }
  });
  const token = parseClerkSignInTokenResponse(await tokenResponse.json());
  return `${new URL(DASHBOARD_PATH, page.url()).toString()}sign-in?__clerk_ticket=${encodeURIComponent(token)}`;
}
async function programmaticSignIn(page) {
  var _globalThis$signInCle;
  await page.goto(DASHBOARD_PATH);
  await expect(page.getByRole("link", {
    name: "Sign In",
    exact: true
  })).toBeVisible();
  const helper = (_globalThis$signInCle = globalThis.signInClerkUser) !== null && _globalThis$signInCle !== void 0 ? _globalThis$signInCle : globalThis.__ENGINEERINGOS_SIGN_IN_CLERK_USER__;
  if (!helper) {
    if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
      throw new Error("Clerk browser helper is unavailable. Run this journey in the Replit browser runner, which injects signInClerkUser.");
    }
    await page.goto(await createReleaseSignInUrl(page));
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`));
    return;
  }
  const signInUrl = await helper({
    ...TEST_USER,
    ttl: 900,
    basePath: DASHBOARD_PATH
  });
  await page.goto(signInUrl);
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`));
}
async function openNavigation(page, label, path) {
  await page.getByRole("link", {
    name: label,
    exact: true
  }).click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
}
function apiUrl(page, path) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  return new URL(path, apiBaseUrl ? apiBaseUrl : page.url()).toString();
}
async function liveRequest(page, path, options) {
  var _options$method;
  return page.evaluate(async ({
    url,
    method,
    body,
    timeout
  }) => {
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : {
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout ? AbortSignal.timeout(timeout) : undefined
    });
    return {
      status: response.status,
      body: await response.text()
    };
  }, {
    url: apiUrl(page, path),
    method: (_options$method = options === null || options === void 0 ? void 0 : options.method) !== null && _options$method !== void 0 ? _options$method : "GET",
    body: options === null || options === void 0 ? void 0 : options.body,
    timeout: options === null || options === void 0 ? void 0 : options.timeout
  });
}
const recordedOriginDiagnostics = [];
function originDiagnosticPath() {
  return process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH;
}
function relevantOriginHeaders(headers) {
  return Object.fromEntries(ORIGIN_DIAGNOSTIC_HEADERS.flatMap(name => headers[name] ? [[name, headers[name]]] : []));
}
async function writeOriginDiagnostics() {
  const outputPath = originDiagnosticPath();
  if (!outputPath) return;
  await mkdir(dirname(outputPath), {
    recursive: true
  });
  await writeFile(outputPath, `${JSON.stringify({
    diagnostics: recordedOriginDiagnostics
  }, null, 2)}\n`, "utf8");
}
async function expectOriginCanUseApi(page, origin) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error("DASHBOARD_E2E_API_BASE_URL is required for origin checks.");
  }
  const healthUrl = new URL("/api/healthz", apiBaseUrl).toString();
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const commonHeaders = {
    Origin: origin
  };
  const diagnostics = [];
  const check = async (phase, request, assertion) => {
    try {
      const response = await request();
      diagnostics.push({
        origin,
        phase,
        status: response.status(),
        headers: relevantOriginHeaders(response.headers())
      });
      recordedOriginDiagnostics.push(diagnostics.at(-1));
      await assertion(response);
    } catch (error) {
      const current = diagnostics.at(-1);
      if ((current === null || current === void 0 ? void 0 : current.phase) !== phase) {
        diagnostics.push({
          origin,
          phase
        });
      }
      diagnostics.at(-1).error = "origin check failed";
      await writeOriginDiagnostics();
      throw error;
    }
  };
  await check("GET", () => page.request.get(healthUrl, {
    headers: commonHeaders
  }), async response => {
    expect(response.status(), `${origin} credentialed GET status`).toBe(200);
    expect(response.headers()["access-control-allow-origin"]).toBe(origin);
    expect(response.headers()["access-control-allow-credentials"]).toBe("true");
  });
  await check("preflight", () => page.request.fetch(mutationUrl, {
    method: "OPTIONS",
    headers: {
      ...commonHeaders,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  }), async response => {
    var _response$headers$acc, _response$headers$acc2;
    expect(response.status(), `${origin} mutation preflight status`).toBe(204);
    expect(response.headers()["access-control-allow-origin"]).toBe(origin);
    expect(response.headers()["access-control-allow-credentials"], `${origin} mutation preflight credentials`).toBe("true");
    expect((_response$headers$acc = response.headers()["access-control-allow-methods"]) === null || _response$headers$acc === void 0 ? void 0 : _response$headers$acc.split(",").map(method => method.trim().toUpperCase()), `${origin} mutation preflight methods`).toContain("POST");
    expect((_response$headers$acc2 = response.headers()["access-control-allow-headers"]) === null || _response$headers$acc2 === void 0 ? void 0 : _response$headers$acc2.split(",").map(header => header.trim().toLowerCase()), `${origin} mutation preflight headers`).toContain("content-type");
  });
  await check("mutation", () => page.request.post(mutationUrl, {
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json"
    },
    data: {
      message: "origin contract"
    }
  }), async response => {
    expect(response.status(), `${origin} state-changing request must pass origin protection`).not.toBe(403);
    expect(response.headers()["access-control-allow-origin"]).toBe(origin);
    expect(response.headers()["access-control-allow-credentials"]).toBe("true");
  });
  await writeOriginDiagnostics();
}
async function expectHostileOriginRejected(page) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl) throw new Error("DASHBOARD_E2E_API_BASE_URL is required for origin checks.");
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const uploadUrl = new URL("/api/upload/archive", apiBaseUrl).toString();
  const liveUpdateUrl = new URL("/api/ai/chat/stream", apiBaseUrl).toString();
  const diagnostic = {
    origin: HOSTILE_ORIGIN,
    phase: "rejection"
  };
  recordedOriginDiagnostics.push(diagnostic);
  try {
    const response = await page.request.post(mutationUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json"
      },
      data: {
        message: "hostile origin contract"
      }
    });
    diagnostic.status = response.status();
    diagnostic.headers = relevantOriginHeaders(response.headers());
    expect(response.status()).toBe(403);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers()["access-control-allow-credentials"]).toBeUndefined();
    const hostileUpload = await page.request.post(uploadUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN
      },
      multipart: {
        archive: {
          name: "hostile-dashboard-journey.zip",
          mimeType: "application/zip",
          buffer: Buffer.from("not an archive")
        }
      }
    });
    expect(hostileUpload.status()).toBe(403);
    expect(hostileUpload.headers()["access-control-allow-origin"]).toBeUndefined();
    const hostileLiveUpdate = await page.request.post(liveUpdateUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json"
      },
      data: {}
    });
    expect(hostileLiveUpdate.status()).toBe(403);
    expect(hostileLiveUpdate.headers()["access-control-allow-origin"]).toBeUndefined();
  } catch (error) {
    diagnostic.error = "origin rejection check failed";
    await writeOriginDiagnostics();
    throw error;
  }
  await writeOriginDiagnostics();
}
function parseSse(body) {
  return body.split(/\n\n+/).flatMap(chunk => {
    var _chunk$split$find;
    const data = (_chunk$split$find = chunk.split("\n").find(line => line.startsWith("data: "))) === null || _chunk$split$find === void 0 ? void 0 : _chunk$split$find.slice("data: ".length);
    if (!data) return [];
    try {
      const value = JSON.parse(data);
      return value && typeof value === "object" ? [value] : [];
    } catch {
      return [];
    }
  });
}
async function liveJson(page, path) {
  const response = await liveRequest(page, path);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  }
  return JSON.parse(response.body);
}
async function liveArray(page, path) {
  const response = await liveRequest(page, path);
  if (response.status === 404) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  }
  const value = JSON.parse(response.body);
  return Array.isArray(value) ? value : [];
}
async function liveOptionalRecord(page, path) {
  const response = await liveRequest(page, path);
  if (response.status === 404) return undefined;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  }
  const value = JSON.parse(response.body);
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
test.describe("EngineeringOS dashboard browser journey", () => {
  test("exports one redacted live-provider mission correlation report", async ({
    page
  }) => {
    var _execution$operationI, _execution$flightStat, _gitLog$commits$0$sho, _gitLog$commits, _gitLog$commits2, _process$env$DASHBOAR5;
    // The Playwright deadline must leave room for the provider-bound request
    // and polling loop to consume their complete configured budget.
    test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
    test.skip(process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1", "Live-provider release journey is opt-in.");
    if (process.env.DASHBOARD_E2E_LIVE_DISPOSABLE !== "1") {
      throw new Error("Live-provider journey requires DASHBOARD_E2E_LIVE_DISPOSABLE=1 and a disposable project.");
    }
    const campaignScenario = liveCampaignScenario();
    const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
    if (!projectId) throw new Error("DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.");
    await programmaticSignIn(page);
    const streamResponse = await liveRequest(page, "/api/ai/chat/stream", {
      method: "POST",
      timeout: liveTimeoutMs(),
      body: {
        projectId,
        message: livePrompt(),
        idempotencyKey: `dashboard-live-${Date.now()}`
      }
    });
    if (streamResponse.status < 200 || streamResponse.status >= 300) {
      throw new Error(`Live-provider mission failed to start (${streamResponse.status}).`);
    }
    const sseEvents = parseSse(streamResponse.body);
    const started = sseEvents.find(event => event.type === "execution_started");
    const executionId = typeof (started === null || started === void 0 ? void 0 : started.executionId) === "string" ? started.executionId : undefined;
    if (!executionId) throw new Error("Live-provider stream did not emit execution_started.");
    let execution = {};
    const deadline = Date.now() + liveTimeoutMs();
    while (Date.now() < deadline) {
      execution = await liveJson(page, `/api/ai/executions/${executionId}`);
      if (["completed", "failed", "cancelled"].includes(String(execution.status))) break;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    if (!["completed", "failed", "cancelled"].includes(String(execution.status))) {
      throw new Error("Live-provider mission did not reach a terminal state within its bound.");
    }
    const sessionId = String(execution.sessionId);
    const messages = await liveArray(page, `/api/ai/chat/${sessionId}/messages`);
    const events = await liveArray(page, `/api/events?projectId=${encodeURIComponent(projectId)}&correlationId=${encodeURIComponent(String((_execution$operationI = execution.operationId) !== null && _execution$operationI !== void 0 ? _execution$operationI : ""))}`);
    const proposal = await liveOptionalRecord(page, `/api/ai/chat/${sessionId}/pending-proposal`);
    const gitLog = await liveJson(page, `/api/projects/${projectId}/git/log`);
    const missionControl = await liveJson(page, "/api/ai/mission-control");
    const dashboardState = await liveJson(page, "/api/dashboard");
    const checkpoint = execution.checkpoint && typeof execution.checkpoint === "object" ? execution.checkpoint : {};
    const recentSteps = Array.isArray(checkpoint.recentSteps) ? checkpoint.recentSteps : [];
    const validation = recentSteps.filter(step => (step === null || step === void 0 ? void 0 : step.kind) === "validation");
    const projectRevision = typeof execution.projectRevision === "string" ? execution.projectRevision : undefined;
    const candidateHash = validation.map(step => {
      var _step$validation$cand, _step$validation;
      return (_step$validation$cand = step === null || step === void 0 || (_step$validation = step.validation) === null || _step$validation === void 0 ? void 0 : _step$validation.candidateHash) !== null && _step$validation$cand !== void 0 ? _step$validation$cand : step === null || step === void 0 ? void 0 : step.candidateHash;
    }).find(value => typeof value === "string" && value.length > 0);
    const candidateIdentity = typeof execution.candidateIdentity === "string" ? execution.candidateIdentity : candidateHash ? `candidate:${candidateHash}` : `read-only:${projectRevision !== null && projectRevision !== void 0 ? projectRevision : "unknown"}`;
    if (!projectRevision) {
      throw new Error("Live-provider mission is missing its project revision.");
    }
    if (process.env.DASHBOARD_E2E_LIVE_CAMPAIGN === "1" && (!candidateIdentity || !projectRevision)) {
      throw new Error("Live campaign requires operation, revision, and candidate correlation.");
    }
    const evidenceCount = recentSteps.reduce((count, step) => count + (Number(step === null || step === void 0 ? void 0 : step.acceptedEvidenceCount) || 0), 0);
    const terminalState = String((_execution$flightStat = execution.flightState) !== null && _execution$flightStat !== void 0 ? _execution$flightStat : execution.status).toUpperCase();
    const successStates = new Set(["COMPLETED", "READY_FOR_REVIEW", "APPLIED", "COMMITTED", "PUSHED"]);
    if (campaignScenario === "delivery-success" && successStates.has(terminalState) && !candidateHash) {
      throw new Error("Delivery-success campaign cannot pass without a candidate-bound validation hash.");
    }
    const deliveryStages = {
      applied: events.some(event => (event === null || event === void 0 ? void 0 : event.type) === "AiChangesApplied"),
      committed: events.some(event => (event === null || event === void 0 ? void 0 : event.type) === "GitCommitCreated"),
      pushed: events.some(event => (event === null || event === void 0 ? void 0 : event.type) === "GitPushed")
    };
    if (campaignScenario === "delivery-success" && successStates.has(terminalState) && !Object.values(deliveryStages).every(Boolean)) {
      throw new Error("Delivery-success campaign cannot pass without operation-correlated apply, commit, and push evidence.");
    }
    if (successStates.has(terminalState) && (evidenceCount < 1 || validation.length < 1)) {
      throw new Error(`Live-provider mission reported ${terminalState} without accepted evidence and validation ` + `(evidence=${evidenceCount}, validation=${validation.length}).`);
    }
    const capture = {
      projectId,
      sessionId,
      operationId: execution.operationId,
      workspaceRevision: (_gitLog$commits$0$sho = (_gitLog$commits = gitLog.commits) === null || _gitLog$commits === void 0 || (_gitLog$commits = _gitLog$commits[0]) === null || _gitLog$commits === void 0 ? void 0 : _gitLog$commits.shortHash) !== null && _gitLog$commits$0$sho !== void 0 ? _gitLog$commits$0$sho : (_gitLog$commits2 = gitLog.commits) === null || _gitLog$commits2 === void 0 || (_gitLog$commits2 = _gitLog$commits2[0]) === null || _gitLog$commits2 === void 0 || (_gitLog$commits2 = _gitLog$commits2.hash) === null || _gitLog$commits2 === void 0 ? void 0 : _gitLog$commits2.slice(0, 12),
      projectRevision,
      candidateIdentity,
      candidateRevision: projectRevision,
      campaignScenario,
      deliveryStages,
      currentOperation: {
        operationId: execution.operationId,
        revision: projectRevision,
        status: execution.status,
        terminalState
      },
      retainedResult: terminalState === "FAILED" || terminalState === "BLOCKED" || terminalState === "INCOMPLETE" ? {
        operationId: execution.operationId,
        revision: projectRevision,
        label: "retained result from the current failed or incomplete operation"
      } : undefined,
      terminalState,
      execution: {
        id: execution.id,
        projectId: execution.projectId,
        sessionId: execution.sessionId,
        operationId: execution.operationId,
        status: execution.status,
        flightState: execution.flightState
      },
      messages: messages.map(({
        id,
        sessionId: messageSession,
        role,
        executionId: messageExecution,
        outcome
      }) => ({
        id,
        sessionId: messageSession,
        role,
        executionId: messageExecution,
        outcome
      })),
      sseEvents: sseEvents.map(({
        type,
        executionId: eventExecution,
        sessionId: eventSession,
        outcome,
        code
      }) => ({
        type,
        executionId: eventExecution,
        sessionId: eventSession,
        outcome,
        code
      })),
      checkpoints: [{
        sequence: checkpoint.sequence,
        stage: checkpoint.stage,
        updatedAt: checkpoint.updatedAt
      }],
      evidenceCount,
      proposals: proposal ? [{
        id: proposal.id,
        revision: proposal.revision,
        status: proposal.status
      }] : [],
      validation: validation.map(step => {
        var _step$validation$stat, _step$validation2, _step$validation$prof, _step$validation3;
        return {
          status: (_step$validation$stat = (_step$validation2 = step.validation) === null || _step$validation2 === void 0 ? void 0 : _step$validation2.status) !== null && _step$validation$stat !== void 0 ? _step$validation$stat : step.status,
          profile: (_step$validation$prof = (_step$validation3 = step.validation) === null || _step$validation3 === void 0 ? void 0 : _step$validation3.profile) !== null && _step$validation$prof !== void 0 ? _step$validation$prof : step.validationProfile
        };
      }),
      events: events.map(({
        type,
        severity,
        correlationId
      }) => ({
        type,
        severity,
        correlationId
      })),
      dashboard: missionControl,
      dashboardState: {
        projectCount: dashboardState.projectCount,
        activeTaskCount: dashboardState.activeTaskCount
      }
    };
    const outputPath = (_process$env$DASHBOAR5 = process.env.DASHBOARD_E2E_LIVE_REPORT_PATH) !== null && _process$env$DASHBOAR5 !== void 0 ? _process$env$DASHBOAR5 : "test-results/dashboard-journey/live-mission-correlation.json";
    await mkdir(dirname(outputPath), {
      recursive: true
    });
    await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  });
  test("signs in and traverses the authenticated operational shell", async ({
    page
  }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);
    for (const origin of approvedDashboardOrigins()) {
      await expectOriginCanUseApi(page, origin);
    }
    await expectHostileOriginRejected(page);
    await expect(page.getByRole("heading", {
      name: "System Overview"
    })).toBeVisible();
    await expect(page.getByText("SYSTEM ONLINE", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Smoke Project", {
      exact: true
    }).first()).toBeVisible();
    await expect(page.getByText("Dashboard API fixture ready", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Showing 1–1 of 1", {
      exact: true
    })).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Older"
    })).toBeDisabled();
    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await expect(page.getByRole("heading", {
      name: "Projects"
    })).toBeVisible();
    await expect(page.getByText("Smoke Project", {
      exact: true
    })).toBeVisible();
    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await expect(page.getByRole("heading", {
      name: "Event Stream"
    })).toBeVisible();
    await expect(page.getByText("Dashboard API fixture ready", {
      exact: true
    })).toBeVisible();
    await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.getByText(/AI provider not configured|No AI key configured|AI Assistant/i).first()).toBeVisible();
    await openNavigation(page, "Mission Control", `${DASHBOARD_PATH}mission-control`);
    await expect(page.getByRole("heading", {
      name: "No durable runs in the ledger"
    })).toBeVisible();
    await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`));
    await expect(page.getByRole("heading", {
      name: "Audit / Chat run"
    })).toBeVisible();
    await expect(page.getByText("Controlled browser fixture completed.", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("PROVEN", {
      exact: true
    }).first()).toBeVisible();
  });
  test("converges two browser sessions across reload, reconnect, stale results, and API restart", async ({
    browser,
    page
  }) => {
    test.skip(!process.env.DASHBOARD_E2E_CONTROL_URL, "The multi-process convergence campaign runs only under the release runner.");
    test.setTimeout(90000);
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    try {
      await Promise.all([programmaticSignIn(page), programmaticSignIn(secondPage)]);
      await Promise.all([page.goto(DASHBOARD_PATH), secondPage.goto(`${DASHBOARD_PATH}ai`)]);
      await expectDashboardReady(page);
      await expect(secondPage.locator("textarea").first()).toBeVisible();

      // A response that arrives after a newer request must not replace the
      // visible ready state with stale data. Keep the delay bounded so a
      // hung request cannot make this campaign pass indefinitely.
      const currentDashboardFixture = {
        ...dashboardFixture,
        freshnessRevision: "2026-01-01T00:03:00.000Z",
        projectScores: [{
          ...dashboardFixture.projectScores[0],
          projectName: "Concurrent Project",
          score: 97
        }],
        activeTaskCount: 1,
        taskStatusBreakdown: {
          pending: 0,
          running: 1
        }
      };
      let refreshCount = 0;
      let releaseStaleResponse;
      const staleResponseReleased = new Promise(resolve => {
        releaseStaleResponse = resolve;
      });
      await page.route("**/api/dashboard", async route => {
        refreshCount += 1;
        if (refreshCount === 1) return route.fulfill(jsonResponse(currentDashboardFixture));
        await staleResponseReleased;
        return route.fulfill(jsonResponse(dashboardFixture));
      });
      await page.getByRole("button", {
        name: "Refresh status"
      }).click();
      await expect(page.getByText("Concurrent Project", {
        exact: true
      })).toBeVisible();
      await expect(page.getByText("97", {
        exact: true
      })).toBeVisible();
      const staleRefresh = page.getByRole("button", {
        name: "Refresh status"
      }).click();
      await expect.poll(() => refreshCount).toBe(2);
      releaseStaleResponse();
      await staleRefresh;
      await expectDashboardReady(page);
      await expect(page.getByText("Concurrent Project", {
        exact: true
      })).toBeVisible();
      await expect(page.getByText("97", {
        exact: true
      })).toBeVisible();
      await expect(page.getByText("1", {
        exact: true
      }).first()).toBeVisible();

      // Simulate a dropped connection in the second browser and assert the
      // recovery action rendered by the dashboard, then let the next request
      // reconnect normally.
      let reconnectAttempt = 0;
      await secondPage.goto(DASHBOARD_PATH);
      await expectDashboardReady(secondPage);
      await secondPage.route("**/api/dashboard", async route => {
        reconnectAttempt += 1;
        // useGetDashboard retries once; hold both bounded attempts so the
        // rendered error state is observable before the operator retries.
        if (reconnectAttempt <= 2) {
          return route.fulfill(jsonResponse({
            error: "controlled reconnect interruption"
          }, 503));
        }
        return route.continue();
      });
      await secondPage.reload();
      await expect(secondPage.getByRole("heading", {
        name: "Failed to load dashboard"
      })).toBeVisible();
      await expect(secondPage.getByRole("button", {
        name: "Retry Connection"
      })).toBeVisible();
      await secondPage.unroute("**/api/dashboard");
      await secondPage.getByRole("button", {
        name: "Retry Connection"
      }).click();
      await expectDashboardReady(secondPage);
      await restartApiForCampaign(page);
      await Promise.all([page.reload(), secondPage.reload()]);
      await expectDashboardReady(page);
      await expectDashboardReady(secondPage);
      await page.reload();
      await expectDashboardReady(page);
      await expect(page.getByRole("button", {
        name: "Retry Connection"
      })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    } finally {
      await secondContext.close();
    }
  });
  test("previews and downloads the completed execution audit without duplicating effects", async ({
    page
  }) => {
    const auditRequests = [];
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
        proof: {
          required: false,
          verdict: "PROVEN"
        }
      },
      timeline: [],
      validations: [{
        status: "passed",
        profile: "release-safe"
      }],
      affectedFiles: ["src/feature.ts"],
      redaction: {
        excluded: ["provider secrets", "raw model output", "private runtime paths"]
      }
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "server-supplied-audit-name.json",
        requests: auditRequests,
        failFirstPreview: true
      }
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Completed audit execution"
      };
      localStorage.setItem("eos_ai_execution_current_e2e-project", "e2e-audit-session");
      localStorage.setItem("eos_ai_execution_e2e-project_e2e-audit-session", JSON.stringify(execution));
    });
    await page.goto(`${DASHBOARD_PATH}ai`);
    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText(/completed/i);
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await proof.getByRole("button", {
      name: "Preview audit"
    }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Audit preview temporarily unavailable");
    await expect(preview).toContainText("same execution and revision");
    await expect(preview.getByRole("button", {
      name: "Retry preview"
    })).toBeVisible();
    expect(auditRequests).toHaveLength(1);
    await preview.getByRole("button", {
      name: "Retry preview"
    }).click();
    await expect(preview).toContainText("provider secrets");
    await expect(preview).toContainText("raw model output");
    await expect(preview).toContainText("private runtime paths");
    await expect(preview).toContainText(EXECUTION_ID);
    await expect(preview).toContainText("e2e-operation");
    await expect(preview).toContainText("e2e-revision-42");
    expect(auditRequests).toHaveLength(2);
    expect(new URL(auditRequests[0]).pathname).toBe(`/api/ai/executions/${EXECUTION_ID}/audit-export`);
    await preview.getByRole("button", {
      name: "Close audit preview"
    }).click();
    await expect(preview).toBeHidden();
    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", {
      name: "Export audit"
    }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("server-supplied-audit-name.json");
    expect(auditRequests).toHaveLength(3);
    await page.reload();
    const reloadedProof = page.getByLabel("Agent execution proof");
    await expect(reloadedProof).toBeVisible();
    await expect(reloadedProof).toContainText(/completed/i);
    await expect(reloadedProof).toContainText("Execution e2e-controlled-execution");
    await expect(reloadedProof).toContainText("Revision: e2e-revision-42");
    await expect(page.getByLabel("Redacted audit preview")).toBeHidden();
    expect(auditRequests).toHaveLength(3);
  });
  test("keeps the cancelled execution audit handoff redacted and terminal", async ({
    page
  }) => {
    const auditRequests = [];
    const cancelledExecution = {
      ...executionFixture,
      status: "cancelled",
      flightState: "CANCELLED",
      checkpoint: {
        stage: "cancelled",
        detail: "Execution cancelled before any changes were applied."
      },
      terminalReason: "cancel_requested",
      completedAt: "2026-01-01T00:01:30.000Z",
      updatedAt: "2026-01-01T00:01:30.000Z"
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
        proof: {
          required: false,
          verdict: "NOT_RECORDED"
        }
      },
      timeline: [{
        type: "cancelled",
        detail: "Cancellation accepted by the server."
      }],
      validations: [],
      affectedFiles: [],
      redaction: {
        excluded: ["provider secrets", "raw model output", "private runtime paths"]
      }
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "cancelled-server-audit.json",
        requests: auditRequests,
        execution: cancelledExecution,
        messageOutcome: "CANCELLED",
        failFirstPreview: true
      }
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Cancelled audit execution"
      };
      localStorage.setItem("eos_ai_execution_current_e2e-project", "e2e-audit-session");
      localStorage.setItem("eos_ai_execution_e2e-project_e2e-audit-session", JSON.stringify(execution));
    });
    await page.goto(`${DASHBOARD_PATH}ai`);
    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText("Cancelled");
    await expect(proof).toContainText("Execution e2e-controlled-execution");
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await expect(proof).toContainText("Terminal reason: cancel_requested");
    await expect(proof.getByRole("button", {
      name: "Cancel"
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: "Resume"
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: "Approve & apply"
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: /commit verified changes/i
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: /push committed changes/i
    })).toHaveCount(0);
    await proof.getByRole("button", {
      name: "Preview audit"
    }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Audit preview temporarily unavailable");
    await expect(preview).toContainText("same execution and revision");
    await expect(preview.getByRole("button", {
      name: "Retry preview"
    })).toBeVisible();
    expect(auditRequests).toHaveLength(1);
    await preview.getByRole("button", {
      name: "Retry preview"
    }).click();
    await expect(preview).toContainText("cancelled");
    await expect(preview).toContainText(EXECUTION_ID);
    await expect(preview).toContainText("e2e-operation");
    await expect(preview).toContainText("e2e-revision-42");
    await expect(preview).toContainText("provider secrets");
    await expect(preview).toContainText("raw model output");
    await expect(preview).toContainText("private runtime paths");
    await expect(proof).toContainText("Cancelled");
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await expect(proof).toContainText("Terminal reason: cancel_requested");
    expect(auditRequests).toHaveLength(2);
    await preview.getByRole("button", {
      name: "Close audit preview"
    }).click();
    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", {
      name: "Export audit"
    }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("cancelled-server-audit.json");
    expect(auditRequests).toHaveLength(3);
    await page.reload();
    const reloadedProof = page.getByLabel("Agent execution proof");
    await expect(reloadedProof).toBeVisible();
    await expect(reloadedProof).toContainText("Cancelled");
    await expect(reloadedProof).toContainText("Revision: e2e-revision-42");
    await expect(page.getByLabel("Redacted audit preview")).toBeHidden();
    expect(auditRequests).toHaveLength(3);
  });
  test("uploads an archive and renders a live task update", async ({
    page
  }) => {
    var _process$env$DASHBOAR6;
    const taskId = "e2e-live-task";
    const liveLog = {
      id: "e2e-live-log",
      taskId,
      level: "info",
      message: "Live update received from the server",
      timestamp: "2026-01-01T00:00:02.000Z"
    };
    await installApiFixtures(page, {
      archiveUpload: {
        uploadId: "e2e-upload",
        originalName: "dashboard-journey.zip"
      },
      liveTask: {
        id: taskId,
        title: "Verify live dashboard updates",
        projectId: "e2e-project",
        log: liveLog
      }
    });
    await programmaticSignIn(page);

    // This is a valid, empty ZIP archive. Keeping it inline makes the browser
    // test self-contained while still exercising FormData and multipart bytes.
    const uploadResult = await page.evaluate(async apiBaseUrl => {
      const bytes = Uint8Array.from(atob("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="), character => character.charCodeAt(0));
      const body = new FormData();
      body.append("archive", new Blob([bytes], {
        type: "application/zip"
      }), "dashboard-journey.zip");
      const response = await fetch(new URL("/api/upload/archive", apiBaseUrl).toString(), {
        method: "POST",
        credentials: "include",
        body
      });
      return {
        status: response.status,
        body: await response.json()
      };
    }, (_process$env$DASHBOAR6 = process.env.DASHBOARD_E2E_API_BASE_URL) !== null && _process$env$DASHBOAR6 !== void 0 ? _process$env$DASHBOAR6 : page.url());
    expect(uploadResult.status).toBe(201);
    expect(uploadResult.body).toEqual({
      uploadId: "e2e-upload",
      originalName: "dashboard-journey.zip"
    });
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel("Expand task Verify live dashboard updates");
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", {
      name: "Logs"
    }).click();
    await expect(page.getByRole("region", {
      name: "Activity"
    })).toContainText("Live update received from the server");
  });
  test("recovers a live task update after a temporary stream failure", async ({
    page
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
        checkpointVersion: 3
      }
    };
    const streamRequests = [];
    await installApiFixtures(page, {
      liveTask: {
        id: taskId,
        title: "Recover live task updates",
        projectId: "e2e-project",
        log: liveLog,
        streamRequests,
        failFirstStream: true
      }
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel("Expand task Recover live task updates");
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", {
      name: "Logs"
    }).click();
    const activity = page.getByRole("region", {
      name: "Activity"
    });
    await expect(activity).toContainText(liveLog.message);
    await expect.poll(() => streamRequests.length, {
      message: "the task log stream should reconnect exactly once"
    }).toBe(2);
    expect(streamRequests).toHaveLength(2);
    expect(streamRequests[0]).toBe(streamRequests[1]);
    expect(new URL(streamRequests[1]).pathname).toBe(`/api/tasks/${taskId}/logs/stream`);
    await expect(activity.locator("summary").filter({
      hasText: liveLog.message
    })).toHaveCount(1);
  });
  test("shows an actionable terminal state when live task reconnects are exhausted", async ({
    page
  }) => {
    const taskId = "e2e-exhausted-live-task";
    const operationId = "e2e-exhausted-operation";
    const liveLog = {
      id: "e2e-exhausted-live-log",
      taskId,
      level: "info",
      message: "The only confirmed task update",
      timestamp: "2026-01-01T00:00:02.000Z",
      metadata: {
        operationId
      }
    };
    const streamRequests = [];
    const nonStreamRequests = [];
    page.on("request", request => {
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
        failStreamAttempts: 6
      }
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    await page.getByLabel("Expand task Recover exhausted live task updates").click();
    await page.getByRole("button", {
      name: "Logs"
    }).click();
    const activity = page.getByRole("region", {
      name: "Activity"
    });
    await expect(activity).toContainText(liveLog.message);
    await expect(page.getByText("Temporary stream failure.", {
      exact: false
    })).toBeVisible();
    await expect.poll(() => streamRequests.length, {
      message: "the task log stream should exhaust its bounded reconnect budget",
      timeout: 35000
    }).toBe(6);
    const exhausted = page.getByRole("alert");
    await expect(exhausted).toContainText("Live task updates could not reconnect");
    await expect(exhausted).toContainText("Reconnect attempts are exhausted");
    await expect(exhausted).toContainText(operationId);
    await expect(exhausted).toContainText("task has not been marked failed");
    await expect(exhausted.getByRole("button", {
      name: "Retry live updates"
    })).toBeVisible();
    await expect(exhausted.getByRole("button", {
      name: "Refresh task logs"
    })).toBeVisible();
    await exhausted.getByRole("button", {
      name: "Retry live updates"
    }).click();
    await expect(activity).toContainText("The only confirmed task update");
    await expect.poll(() => streamRequests.length).toBe(7);
    expect(new Set(streamRequests).size).toBe(1);
    expect(nonStreamRequests).not.toContain("POST");
    await expect(activity.locator("summary").filter({
      hasText: liveLog.message
    })).toHaveCount(1);
  });
  test("pages and reloads the filtered event stream without losing its window", async ({
    page
  }) => {
    const events = Array.from({
      length: 51
    }, (_, index) => ({
      id: `e2e-event-${index}`,
      projectId: "e2e-project",
      type: "AuditEvent",
      severity: index < 2 ? "success" : "info",
      correlationId: index < 2 ? "release-42" : null,
      message: index < 2 ? `Filtered release event ${index}` : `Older event ${index}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 51 - index)).toISOString()
    }));
    const eventRequests = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.endsWith("/api/events")) eventRequests.push(request.url());
    });
    await installApiFixtures(page, {
      events,
      projects: [{
        id: "e2e-project",
        name: "Smoke Project",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/smoke",
        qualityScore: 92
      }]
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}events`);
    await expect(page.getByText("Older event 49", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Older event 50", {
      exact: true
    })).not.toBeVisible();
    const firstRequest = new URL(eventRequests.at(-1));
    expect(firstRequest.searchParams.get("limit")).toBe("50");
    expect(firstRequest.searchParams.get("page")).toBe("1");
    await Promise.all([page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/api/events") && url.searchParams.get("page") === "2";
    }), page.getByRole("button", {
      name: "Older"
    }).click()]);
    await expect(page.getByText("Page 2.", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("Older event 50", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).not.toBeVisible();
    expect(new URL(eventRequests.at(-1)).searchParams.get("page")).toBe("2");
    await page.getByRole("button", {
      name: "Newer"
    }).click();
    await expect(page.getByText("Page 1.", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).toBeVisible();
    await page.getByPlaceholder("Search logs...").fill("Filtered release");
    await page.getByRole("button", {
      name: "Toggle event filters"
    }).click();
    await page.locator("select").nth(1).selectOption("success");
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Older event 1", {
      exact: true
    })).not.toBeVisible();
    await expect(page).toHaveURL(/search=Filtered\+release/);
    await expect(page).toHaveURL(/severity=success/);
    await page.reload();
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Older event 1", {
      exact: true
    })).not.toBeVisible();
    await expect(page.getByPlaceholder("Search logs...")).toHaveValue("Filtered release");
    await page.getByRole("button", {
      name: "Toggle event filters"
    }).click();
    await expect(page.locator("select").nth(1)).toHaveValue("success");
    const filteredRequest = new URL(eventRequests.at(-1));
    expect(filteredRequest.searchParams.get("limit")).toBe("50");
    expect(filteredRequest.searchParams.get("page")).toBe("1");
    expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
    expect(filteredRequest.searchParams.get("severity")).toBe("success");
  });
  test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
    page
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    await composer.fill(fixture.question);
    const sendButton = composer.locator("xpath=..").getByRole("button");
    await expect(sendButton).toBeEnabled();
    const streamResponsePromise = page.waitForResponse(response => response.url().includes("/api/ai/chat/stream"));
    await sendButton.click();
    const streamResponse = await streamResponsePromise;
    expect(streamResponse.status()).toBe(200);
    await expect(page.getByText(fixture.question, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("Agent activity", {
      exact: false
    })).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).click();
    await expect(page.getByText("Reading source", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText(fixture.source, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(/Behavior evidence · 1 excerpt/i).last()).toBeVisible();
    await expect(page.getByText('return partialFromCollectedEvidence("provider timeout");', {
      exact: true
    }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });
  test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
    page
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText("src/missing-release-fixture.ts");
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
  });
  test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
    page
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟"
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟"
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText("src/missing-release-fixture.ts");
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
  });
  test("keeps safe citation state when switching projects", async ({
    page
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟"
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟"
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
      projects: [{
        id: "e2e-project-one",
        name: "Citation Project One",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/project-one",
        qualityScore: 92
      }, {
        id: "e2e-project-two",
        name: "Citation Project Two",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/project-two",
        qualityScore: 88
      }]
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await expect(page.getByText(accepted.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(`${accepted.source}:42`, {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("Accepted: source span verified.", {
      exact: true
    }).last()).toBeVisible();
    await page.getByRole("combobox").selectOption("e2e-project-two");
    await expect(page.getByRole("button", {
      name: blocked.question,
      exact: true
    })).toBeVisible();
    await expect(page.getByText(accepted.answer, {
      exact: true
    })).toHaveCount(0);
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await expect(page.getByText("Blocked: no matching source text was found.", {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(`${blocked.source}:42`, {
      exact: false
    })).toHaveCount(0);
    await expect(page.getByText("Accepted: source span verified.", {
      exact: true
    })).toHaveCount(0);
    await page.getByRole("combobox").selectOption("e2e-project-one");
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await expect(page.getByText(`${accepted.source}:42`, {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("Accepted: source span verified.", {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("Blocked: no matching source text was found.", {
      exact: true
    })).toHaveCount(0);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
  });
  test("keeps safe citation state across repeated navigation", async ({
    page
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟"
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟"
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const assertAcceptedCitation = async () => {
      await expect(page.getByText(accepted.answer, {
        exact: true
      }).last()).toBeVisible();
      await expect(page.getByText(`${accepted.source}:42`, {
        exact: false
      }).last()).toBeVisible();
      await expect(page.getByText("Accepted: source span verified.", {
        exact: true
      }).last()).toBeVisible();
      await expect(page.getByText("Blocked: no matching source text was found.", {
        exact: true
      })).toHaveCount(0);
    };
    const assertBlockedCitation = async () => {
      await expect(page.getByText("Blocked: no matching source text was found.", {
        exact: true
      }).last()).toBeVisible();
      await expect(page.getByText(`${blocked.source}:42`, {
        exact: false
      })).toHaveCount(0);
      await expect(page.getByText("Accepted: source span verified.", {
        exact: true
      })).toHaveCount(0);
    };
    const assertNoInternalCitationDetails = async () => {
      const visibleText = await page.locator("body").innerText();
      expect(visibleText).not.toMatch(/MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
    };
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await assertAcceptedCitation();
    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await assertAcceptedCitation();
    await assertNoInternalCitationDetails();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await assertAcceptedCitation();
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await assertBlockedCitation();
    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();
  });
  test("keeps only the safe blocked citation reason after chat reload", async ({
    page
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText("src/missing-release-fixture.ts");
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });
  test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
    page
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText("src/missing-release-fixture.ts");
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i);
    await page.reload();
    await page.getByRole("button", {
      name: fixture.question,
      exact: true
    }).click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText("src/missing-release-fixture.ts");
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    const reloadedText = await page.locator("body").innerText();
    await expectNoHorizontalOverflow(page);
    expect(reloadedText).not.toMatch(/raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i);
  });
  test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
    page
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    const answer = page.getByText(fixture.answer, {
      exact: true
    });
    await expect(answer).toHaveCount(1);
    await expect(answer).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("provider failure", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("stopped: provider timeout", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("The provider disconnected after visible response text.", {
      exact: true
    })).toBeVisible();
    await page.reload();
    await page.getByRole("button", {
      name: fixture.question,
      exact: true
    }).click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    })).toHaveCount(1);
    await expect(page.getByText(fixture.answer, {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("provider failure", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("stopped: provider timeout", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("The provider disconnected after visible response text.", {
      exact: true
    })).toBeVisible();
  });
  test("resumes a failed analysis and keeps the execution incomplete", async ({
    page
  }) => {
    var _await$resumeRequest$;
    const {
      fixture,
      execution
    } = installResumedAnalysisFailureFixture();
    await installApiFixtures(page, {
      arabicAi: fixture,
      resumeFailure: {
        fixture,
        execution
      }
    });
    await programmaticSignIn(page);
    await page.evaluate(({
      sessionId,
      executionId,
      projectId,
      resumeToken,
      message
    }) => {
      localStorage.setItem(`eos_ai_execution_current_${projectId}`, sessionId);
      localStorage.setItem(`eos_ai_execution_${projectId}_${sessionId}`, JSON.stringify({
        id: executionId,
        projectId,
        sessionId,
        resumeToken,
        message
      }));
    }, {
      sessionId: fixture.sessionId,
      executionId: fixture.executionId,
      projectId: "e2e-project",
      resumeToken: "e2e-resumed-analysis-failure-token-opaque",
      message: fixture.question
    });
    await page.goto(`${DASHBOARD_PATH}ai`);
    await expect(page.getByText("A saved AI execution is ready to resume")).toBeVisible();
    const resumeRequest = page.waitForRequest(request => request.url().includes("/api/ai/chat/stream") && request.method() === "POST");
    await page.getByRole("button", {
      name: "Resume",
      exact: true
    }).click();
    const requestBody = JSON.parse((_await$resumeRequest$ = (await resumeRequest).postData()) !== null && _await$resumeRequest$ !== void 0 ? _await$resumeRequest$ : "{}");
    expect(requestBody).toEqual(expect.objectContaining({
      projectId: "e2e-project",
      sessionId: fixture.sessionId,
      executionId: fixture.executionId,
      resumeToken: "e2e-resumed-analysis-failure-token-opaque",
      message: fixture.question
    }));
    await expect(page.getByText("Failed to send message", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("A saved AI execution is ready to resume")).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });
  test("recovers a missing token after a real stream abort and resumes one execution", async ({
    page
  }) => {
    var _streamRequests$, _streamRequests$2;
    const recovery = installInterruptedResumeFixture();
    await installApiFixtures(page, {
      interruptedResume: recovery
    });
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const body = typeof (init === null || init === void 0 ? void 0 : init.body) === "string" ? init.body : "";
        if (!url.includes("/api/ai/chat/stream") || body.includes('"executionId"')) {
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
              const {
                done,
                value
              } = await reader.read();
              if (done) {
                if (buffered) controller.enqueue(encoder.encode(buffered));
                controller.close();
                return;
              }
              buffered += new TextDecoder().decode(value, {
                stream: true
              });
              const marker = buffered.indexOf('"type":"execution_started"');
              const frameEnd = marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
              if (frameEnd >= 0) {
                controller.enqueue(encoder.encode(buffered.slice(0, frameEnd + 2)));
                controller.error(new TypeError("network connection reset"));
                return;
              }
            }
          }
        });
        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      };
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const streamRequests = [];
    page.on("request", request => {
      if (request.url().includes("/api/ai/chat/stream") && request.method() === "POST") {
        try {
          streamRequests.push(request.postDataJSON());
        } catch {
          // Ignore requests without a JSON body; the assertions below require
          // both journey requests to have a valid request envelope.
        }
      }
    });
    const composer = page.locator("textarea").first();
    await composer.fill(recovery.fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText("Execution paused — ready to resume from its durable checkpoint", {
      exact: true
    })).toBeVisible();
    const storageKey = "eos_ai_execution_e2e-project_e2e-interrupted-resume-session";
    const pointerKey = "eos_ai_execution_current_e2e-project";
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toContain(recovery.initialToken);
    await page.evaluate(({
      storageKey,
      pointerKey
    }) => {
      var _localStorage$getItem;
      const saved = JSON.parse((_localStorage$getItem = localStorage.getItem(storageKey)) !== null && _localStorage$getItem !== void 0 ? _localStorage$getItem : "{}");
      delete saved.resumeToken;
      localStorage.setItem(storageKey, JSON.stringify(saved));
      localStorage.setItem(pointerKey, "e2e-interrupted-resume-session");
    }, {
      storageKey,
      pointerKey
    });
    await page.reload();
    await expect(page.getByText("A saved AI execution is ready to resume", {
      exact: true
    })).toBeVisible();
    await expect.poll(() => page.evaluate(key => {
      var _localStorage$getItem2;
      const saved = JSON.parse((_localStorage$getItem2 = localStorage.getItem(key)) !== null && _localStorage$getItem2 !== void 0 ? _localStorage$getItem2 : "{}");
      return saved.resumeToken;
    }, storageKey)).toBe(recovery.recoveredToken);
    await page.getByRole("button", {
      name: "Resume",
      exact: true
    }).click();
    await expect(page.getByText(recovery.fixture.answer, {
      exact: true
    })).toBeVisible();
    await expect.poll(() => streamRequests.length).toBe(2);
    expect(streamRequests[0]).toEqual(expect.objectContaining({
      projectId: "e2e-project",
      message: recovery.fixture.question
    }));
    expect((_streamRequests$ = streamRequests[0]) === null || _streamRequests$ === void 0 ? void 0 : _streamRequests$.executionId).toBeUndefined();
    expect((_streamRequests$2 = streamRequests[0]) === null || _streamRequests$2 === void 0 ? void 0 : _streamRequests$2.sessionId).toBeUndefined();
    expect(streamRequests[1]).toEqual(expect.objectContaining({
      projectId: "e2e-project",
      sessionId: recovery.fixture.sessionId,
      executionId: recovery.fixture.executionId,
      resumeToken: recovery.recoveredToken,
      message: recovery.fixture.question
    }));
    expect(streamRequests.map(request => request.executionId).filter(Boolean)).toEqual([recovery.fixture.executionId]);
  });
  test("projects delivery recovery states safely after reload", async ({
    page
  }) => {
    const recovery = {
      requests: [],
      operations: [{
        proposalId: "e2e-recovery-available-proposal",
        operationId: "e2e-recovery-available-operation",
        sessionId: "e2e-recovery-available-session",
        lifecycle: "blocked",
        status: "pending",
        createdAt: "2026-01-01T00:03:00.000Z",
        recoveryState: "recoverable",
        operatorExplanation: "The delivery stopped because validation needs to be run again.",
        nextAction: "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
        conflictReason: null,
        validationEvidence: [{
          profile: "workspace-typecheck",
          status: "failed"
        }],
        workspaceAvailable: true,
        changeCount: 2
      }, {
        proposalId: "e2e-recovery-missing-proposal",
        operationId: "e2e-recovery-missing-operation",
        sessionId: "e2e-recovery-missing-session",
        lifecycle: "abandoned",
        status: "pending",
        createdAt: "2026-01-01T00:02:00.000Z",
        recoveryState: "missing_workspace",
        operatorExplanation: "The saved delivery workspace is no longer available, so recovery cannot continue.",
        nextAction: "Start a new delivery from the current project rather than retrying this recovery.",
        conflictReason: "Workspace expired after the runner was recycled.",
        validationEvidence: null,
        workspaceAvailable: false,
        changeCount: 1
      }, {
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
        changeCount: 3
      }]
    };
    await installApiFixtures(page, {
      deliveryRecovery: recovery
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const region = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    await expect(region).toBeVisible();
    await expect(region.getByText("Recoverable", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("Workspace unavailable", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("Already discarded", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("The saved delivery workspace is no longer available, so recovery cannot continue.", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("This delivery recovery was already discarded.", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("Retained reason: Workspace expired after the runner was recycled.", {
      exact: true
    })).toBeVisible();
    const available = region.locator('[data-operation-id="e2e-recovery-available-operation"]');
    const missing = region.locator('[data-operation-id="e2e-recovery-missing-operation"]');
    const discarded = region.locator('[data-operation-id="e2e-recovery-discarded-operation"]');
    await expect(available).toHaveAttribute("data-recovery-state", "recoverable");
    await expect(missing).toHaveAttribute("data-recovery-state", "missing_workspace");
    await expect(discarded).toHaveAttribute("data-recovery-state", "discarded");
    await expect(available.getByRole("button", {
      name: "Resume validation"
    })).toBeEnabled();
    await expect(available.getByRole("button", {
      name: "Discard workspace"
    })).toBeEnabled();
    await expect(missing.getByRole("button", {
      name: "Resume validation"
    })).toBeDisabled();
    await expect(missing.getByRole("button", {
      name: "Discard workspace"
    })).toBeDisabled();
    await expect(discarded.getByRole("button", {
      name: "Resume validation"
    })).toBeDisabled();
    await expect(discarded.getByRole("button", {
      name: "Discard workspace"
    })).toBeDisabled();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/\/home\/runner|\/tmp\/|\/workspace\/|internal diagnostic/i);
    await expectNoHorizontalOverflow(page);
    await page.reload();
    const reloadedRegion = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    await expect(reloadedRegion).toBeVisible();
    await expect(reloadedRegion.locator('[data-operation-id="e2e-recovery-missing-operation"]').getByRole("button", {
      name: "Resume validation"
    })).toBeDisabled();
    await expect(reloadedRegion.locator('[data-operation-id="e2e-recovery-discarded-operation"]').getByRole("button", {
      name: "Discard workspace"
    })).toBeDisabled();
    expect(recovery.requests.length).toBeGreaterThanOrEqual(2);
    expect(recovery.requests.every(url => url.includes("projectId=e2e-project"))).toBe(true);
  });
  test("explains when delivery recovery loses a race and refreshes state", async ({
    page
  }) => {
    const recovery = {
      requests: [],
      actionRequests: [],
      operations: [{
        proposalId: "e2e-recovery-race-proposal",
        operationId: "e2e-recovery-race-operation",
        sessionId: "e2e-recovery-race-session",
        lifecycle: "blocked",
        status: "pending",
        createdAt: "2026-01-01T00:04:00.000Z",
        recoveryState: "recoverable",
        operatorExplanation: "The delivery stopped because the retained changes need review before validation can continue.",
        nextAction: "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
        conflictReason: null,
        validationEvidence: [{
          profile: "workspace-typecheck",
          status: "failed"
        }],
        workspaceAvailable: true,
        changeCount: 1
      }],
      recoveryAction: {
        proposalId: "e2e-recovery-race-proposal",
        action: "resume-validation",
        response: {
          error: "This delivery recovery was already discarded.",
          code: "DELIVERY_ALREADY_DISCARDED",
          lifecycle: "cancelled",
          recoveryState: "discarded",
          nextAction: "No action is required.",
          diagnostic: "Do not render this server detail."
        },
        nextOperations: [{
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
          changeCount: 1
        }]
      }
    };
    await installApiFixtures(page, {
      deliveryRecovery: recovery
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const region = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    const operation = region.locator('[data-operation-id="e2e-recovery-race-operation"]');
    await expect(operation.getByRole("button", {
      name: "Resume validation"
    })).toBeEnabled();
    await operation.getByRole("button", {
      name: "Resume validation"
    }).click();
    await expect(page.getByText("Recovery state changed", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("This recovery was already discarded. The recovery list was refreshed.", {
      exact: true
    })).toBeVisible();
    await expect.poll(() => recovery.requests.length).toBeGreaterThanOrEqual(2);
    await expect(operation).toHaveAttribute("data-recovery-state", "discarded");
    expect(recovery.actionRequests).toHaveLength(1);
    expect(recovery.actionRequests[0]).toContain("/api/ai/delivery/e2e-recovery-race-proposal/resume-validation");
    expect(await region.locator('[data-operation-id="e2e-recovery-race-operation"]').count()).toBe(1);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/Do not render this server detail|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
  });
  test("explains when an old recovery link points to a deleted operation", async ({
    page
  }) => {
    const recovery = {
      requests: [],
      actionRequests: [],
      operations: [{
        proposalId: "e2e-recovery-deleted-proposal",
        operationId: "e2e-recovery-deleted-operation",
        sessionId: "e2e-recovery-deleted-session",
        lifecycle: "blocked",
        status: "pending",
        createdAt: "2026-01-01T00:05:00.000Z",
        recoveryState: "recoverable",
        operatorExplanation: "The delivery stopped because the retained changes need review before validation can continue.",
        nextAction: "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
        conflictReason: null,
        validationEvidence: [{
          profile: "workspace-typecheck",
          status: "failed"
        }],
        workspaceAvailable: true,
        changeCount: 1
      }],
      recoveryAction: {
        proposalId: "e2e-recovery-deleted-proposal",
        action: "resume-validation",
        status: 404,
        response: {
          error: "Delivery operation not found",
          code: "DELIVERY_NOT_FOUND",
          diagnostic: "Do not render this server detail."
        },
        nextOperations: []
      }
    };
    await installApiFixtures(page, {
      deliveryRecovery: recovery
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const region = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    const operation = region.locator('[data-operation-id="e2e-recovery-deleted-operation"]');
    await expect(operation.getByRole("button", {
      name: "Resume validation"
    })).toBeEnabled();
    await operation.getByRole("button", {
      name: "Resume validation"
    }).click();
    await expect(page.getByText("Recovery link expired", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("This recovery operation no longer exists. The recovery list was refreshed.", {
      exact: true
    })).toBeVisible();
    await expect.poll(() => recovery.requests.length).toBeGreaterThanOrEqual(2);
    await expect.poll(() => region.count()).toBe(0);
    expect(recovery.actionRequests).toHaveLength(1);
    expect(recovery.actionRequests[0]).toContain("/api/ai/delivery/e2e-recovery-deleted-proposal/resume-validation");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/Delivery operation not found|Do not render this server detail|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
  });
  test("keeps the resumed AI session drawer overlaid on a phone viewport", async ({
    page
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    const beforeOpen = await composer.boundingBox();
    expect(beforeOpen === null || beforeOpen === void 0 ? void 0 : beforeOpen.width).toBeGreaterThan(250);
    await page.getByRole("button", {
      name: "Open sessions"
    }).click();
    await expect(page.getByText("Sessions", {
      exact: true
    })).toBeVisible();
    const drawer = page.getByText("Sessions", {
      exact: true
    }).locator("..").locator("..");
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox === null || drawerBox === void 0 ? void 0 : drawerBox.width).toBeLessThanOrEqual(390);
    const duringOpen = await composer.boundingBox();
    expect(duringOpen === null || duringOpen === void 0 ? void 0 : duringOpen.width).toBeGreaterThan(250);
    await page.getByRole("button", {
      name: "Close sidebar"
    }).click();
    await expect(page.getByRole("button", {
      name: "Open sessions"
    })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
  test("renders a user-visible API failure state", async ({
    page
  }) => {
    await page.route("**/api/dashboard", route => route.fulfill(jsonResponse({
      error: "controlled dashboard outage"
    }, 503)));
    await programmaticSignIn(page);
    await expect(page.getByRole("heading", {
      name: "Failed to load dashboard"
    })).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Retry Connection"
    })).toBeVisible();
  });
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiSE9TVElMRV9PUklHSU4iLCJPUklHSU5fRElBR05PU1RJQ19IRUFERVJTIiwiREVGQVVMVF9MSVZFX1BST01QVCIsIkxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TIiwiU2V0IiwibGl2ZUNhbXBhaWduU2NlbmFyaW8iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIyIiwic2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8iLCJ0cmltIiwiREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOIiwiRXJyb3IiLCJoYXMiLCJsaXZlUHJvbXB0IiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSMyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQiLCJsaXZlVGltZW91dE1zIiwiY29uZmlndXJlZCIsIk51bWJlciIsIkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TIiwiaXNGaW5pdGUiLCJhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI0Iiwib3JpZ2lucyIsIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyIsInNwbGl0IiwibWFwIiwib3JpZ2luIiwiZmlsdGVyIiwiQm9vbGVhbiIsImxlbmd0aCIsInBhcnNlZCIsIlVSTCIsInBhdGhuYW1lIiwic2VhcmNoIiwiaGFzaCIsImRhc2hib2FyZEZpeHR1cmUiLCJmcmVzaG5lc3NSZXZpc2lvbiIsInByb2plY3RDb3VudCIsImFjdGl2ZVRhc2tDb3VudCIsImNvbXBsZXRlZFRhc2tDb3VudCIsImZhaWxlZFRhc2tDb3VudCIsInRhc2tTdGF0dXNCcmVha2Rvd24iLCJwZW5kaW5nIiwicnVubmluZyIsInByb2plY3RTY29yZXMiLCJwcm9qZWN0SWQiLCJwcm9qZWN0TmFtZSIsInNjb3JlIiwidHJlbmQiLCJyZWNlbnRFdmVudHMiLCJpZCIsInR5cGUiLCJzZXZlcml0eSIsIm1lc3NhZ2UiLCJ0aW1lc3RhbXAiLCJ0b3BSdWxlcyIsImV4ZWN1dGlvbkZpeHR1cmUiLCJvcGVyYXRpb25JZCIsInN0YXR1cyIsImZsaWdodFN0YXRlIiwiZXZpZGVuY2VWZXJkaWN0IiwicHJvb2ZSZXF1aXJlZCIsInJlc3VtYWJsZSIsImNoZWNrcG9pbnRWZXJzaW9uIiwicHJvamVjdFJldmlzaW9uIiwiY2hlY2twb2ludCIsInN0YWdlIiwiZGV0YWlsIiwib2JqZWN0aXZlIiwic3RhcnRlZEF0IiwiY29tcGxldGVkQXQiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJqc29uUmVzcG9uc2UiLCJib2R5IiwiaGVhZGVycyIsImNvbnRlbnRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93IiwicGFnZSIsIm92ZXJmbG93IiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImRvY3VtZW50RWxlbWVudCIsInNjcm9sbFdpZHRoIiwidmlld3BvcnQiLCJ3aW5kb3ciLCJpbm5lcldpZHRoIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsImV4cGVjdERhc2hib2FyZFJlYWR5IiwiZ2V0QnlSb2xlIiwibmFtZSIsInRvQmVWaXNpYmxlIiwiZ2V0QnlUZXh0IiwiZXhhY3QiLCJyZXN0YXJ0QXBpRm9yQ2FtcGFpZ24iLCJjb250cm9sVXJsIiwiREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCIsInJlc3BvbnNlIiwicmVxdWVzdCIsInBvc3QiLCJ0aW1lb3V0IiwidG9CZSIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlIiwiX292ZXJyaWRlcyRhdWRpdEV4cG9yMiIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjMiLCJ1cmwiLCJwYXRoIiwicmVwbGFjZSIsImFyYWJpY0FpIiwiYWx0ZXJuYXRlQWkiLCJkaXNjb25uZWN0QWkiLCJhaUZpeHR1cmVzIiwiZml4dHVyZSIsImVuZHNXaXRoIiwic2VhcmNoUGFyYW1zIiwiZ2V0IiwicHJvamVjdFNlc3Npb25zIiwiZnVsZmlsbCIsInNlc3Npb25JZCIsInRpdGxlIiwicXVlc3Rpb24iLCJyZXN1bWVGYWlsdXJlIiwicmVxdWVzdEJvZHkiLCJwb3N0RGF0YUpTT04iLCJleGVjdXRpb25JZCIsInN0cmVhbUJvZHkiLCJpbnRlcnJ1cHRlZFJlc3VtZSIsInJlc3VtZWRTdHJlYW1Cb2R5Iiwic3RyZWFtRml4dHVyZSIsIm1lc3NhZ2VGaXh0dXJlIiwiZmluZCIsInJvbGUiLCJjb250ZW50IiwiYXVkaXRFeHBvcnQiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IiLCJvdXRjb21lIiwibWVzc2FnZU91dGNvbWUiLCJyZXF1ZXN0cyIsInB1c2giLCJmYWlsRmlyc3RQcmV2aWV3IiwiZXJyb3IiLCJmaWxlbmFtZSIsImFyY2hpdmVVcGxvYWQiLCJfcm91dGUkcmVxdWVzdCRoZWFkZXIiLCJzdGFydHNXaXRoIiwicG9zdERhdGFCdWZmZXIiLCJpbmNsdWRlcyIsIkJ1ZmZlciIsImZyb20iLCJ1cGxvYWRJZCIsIm9yaWdpbmFsTmFtZSIsImxpdmVUYXNrIiwiZGVzY3JpcHRpb24iLCJwaGFzZSIsInJlbGF0ZWRGaWxlcyIsInJldHJ5Q291bnQiLCJtYXhSZXRyaWVzIiwiX292ZXJyaWRlcyRsaXZlVGFzayRpIiwiaW5pdGlhbExvZ3MiLCJzdHJlYW1SZXF1ZXN0cyIsImZhaWxGaXJzdFN0cmVhbSIsImZhaWxTdHJlYW1BdHRlbXB0cyIsImFib3J0IiwibG9nIiwiX292ZXJyaWRlcyRwcm9qZWN0cyIsInByb2plY3RzIiwibGFuZ3VhZ2UiLCJmcmFtZXdvcmsiLCJyb290UGF0aCIsInF1YWxpdHlTY29yZSIsImRlbGl2ZXJ5UmVjb3ZlcnkiLCJvcGVyYXRpb25zIiwicmVjb3ZlcnlBY3Rpb24iLCJwcm9wb3NhbElkIiwiYWN0aW9uIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlMiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZTMiLCJhY3Rpb25SZXF1ZXN0cyIsIm5leHRPcGVyYXRpb25zIiwiX292ZXJyaWRlcyRldmVudHMiLCJfdXJsJHNlYXJjaFBhcmFtcyRnZXQiLCJldmVudHMiLCJ0b0xvd2VyQ2FzZSIsImZpbHRlcmVkRXZlbnRzIiwiZXZlbnQiLCJjb3JyZWxhdGlvbklkIiwidmFsdWUiLCJzb21lIiwibGltaXQiLCJzbGljZSIsInRvdGFsIiwiZXhlY3V0aW9uIiwicmVzdW1lVG9rZW4iLCJyZWNvdmVyZWRUb2tlbiIsImV4ZWN1dGlvbnMiLCJjb250aW51ZSIsImluc3RhbGxBcmFiaWNBaUZpeHR1cmUiLCJvcHRpb25zIiwiX29wdGlvbnMkc2Vzc2lvbklkIiwiX29wdGlvbnMkcXVlc3Rpb24iLCJtZXNzYWdlSWQiLCJzb3VyY2UiLCJibG9ja2VkIiwiYW5zd2VyIiwiZXZpZGVuY2UiLCJleGNlcnB0Iiwic3VwcG9ydHNDbGFpbSIsImV2aWRlbmNlQ2xhc3MiLCJjaXRhdGlvblN0YXR1cyIsImNpdGF0aW9uUmVhc29uIiwic291cmNlU3BhbiIsInN0YXJ0TGluZSIsImVuZExpbmUiLCJ0b29sVHJhY2UiLCJraW5kIiwidG9vbCIsImFyZ3MiLCJjYWNoZWQiLCJwcmVmZXRjaGVkIiwiY29kZSIsImNvbnNpc3RlbnQiLCJ2aW9sYXRpb25zIiwiZXZpZGVuY2VGaWxlQ291bnQiLCJhY2NlcHRlZEV2aWRlbmNlQ291bnQiLCJjb21wbGV0ZWRSZWFkRmlsZXMiLCJhY2NlcHRlZEV2aWRlbmNlRmlsZXMiLCJvYmplY3RpdmVUeXBlIiwicmVxdWlyZWRFZGdlcyIsInByb3ZlbkVkZ2VzIiwiY29tcGxldGlvbkdhdGVSZXN1bHQiLCJmaW5hbEFuc3dlclR5cGUiLCJ0YXNrUmVzdWx0IiwiY29uZmlkZW5jZSIsInNvdXJjZVNjb3BlIiwiY292ZXJhZ2UiLCJyZXF1ZXN0ZWRGaWVsZHMiLCJhbnN3ZXJlZEZpZWxkcyIsIm1pc3NpbmdGaWVsZHMiLCJjb21wbGV0ZSIsIm9wZXJhdGlvbk1vZGUiLCJzb3VyY2VzIiwiYmVoYXZpb3JFdmlkZW5jZSIsInNzZSIsImRlbHRhIiwicGVuZGluZ0NoYW5nZXMiLCJqb2luIiwiaW5zdGFsbFRvb2xGYWlsdXJlRml4dHVyZSIsImRpYWdub3N0aWNDb2RlIiwicmVzdWx0S2luZCIsInJlc3VsdFN1bW1hcnkiLCJzdG9wUmVhc29uIiwiaXRlcmF0aW9ucyIsIm1heEl0ZXJhdGlvbnMiLCJ0b29sQ2FsbHMiLCJwcmVmZXRjaFRvb2xDYWxscyIsImxvb3BUb29sQ2FsbHMiLCJzeW50aGVzaXNTdGFydGVkIiwiZGlhZ25vc3RpY0NvZGVzIiwiaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSIsImRpYWdub3N0aWNEZXRhaWxzIiwiZXJyb3JDb2RlIiwiZXJyb3JNZXNzYWdlIiwiaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlIiwiaW5zdGFsbEludGVycnVwdGVkUmVzdW1lRml4dHVyZSIsImluaXRpYWxUb2tlbiIsInBhcnRpYWxBbnN3ZXIiLCJjcmVhdGVSZWxlYXNlU2lnbkluVXJsIiwic2VjcmV0S2V5IiwiQ0xFUktfU0VDUkVUX0tFWSIsIkF1dGhvcml6YXRpb24iLCJ1c2VyUmVzcG9uc2UiLCJlbmNvZGVVUklDb21wb25lbnQiLCJ1c2VySWQiLCJqc29uIiwiY3JlYXRlZFJlc3BvbnNlIiwiZGF0YSIsImVtYWlsX2FkZHJlc3MiLCJmaXJzdF9uYW1lIiwibGFzdF9uYW1lIiwic2tpcF9wYXNzd29yZF9jaGVja3MiLCJza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50IiwidG9rZW5SZXNwb25zZSIsInVzZXJfaWQiLCJ0b2tlbiIsInRvU3RyaW5nIiwicHJvZ3JhbW1hdGljU2lnbkluIiwiX2dsb2JhbFRoaXMkc2lnbkluQ2xlIiwiZ290byIsImhlbHBlciIsImdsb2JhbFRoaXMiLCJzaWduSW5DbGVya1VzZXIiLCJfX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX18iLCJSVU5fQ09OVFJPTExFRF9SRUxFQVNFX1ZBTElEQVRJT04iLCJ0b0hhdmVVUkwiLCJSZWdFeHAiLCJyZXBsYWNlQWxsIiwic2lnbkluVXJsIiwidHRsIiwiYmFzZVBhdGgiLCJvcGVuTmF2aWdhdGlvbiIsImxhYmVsIiwiY2xpY2siLCJhcGlVcmwiLCJhcGlCYXNlVXJsIiwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwiLCJsaXZlUmVxdWVzdCIsIl9vcHRpb25zJG1ldGhvZCIsIm1ldGhvZCIsImZldGNoIiwiY3JlZGVudGlhbHMiLCJ1bmRlZmluZWQiLCJzaWduYWwiLCJBYm9ydFNpZ25hbCIsInRleHQiLCJyZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIiwib3JpZ2luRGlhZ25vc3RpY1BhdGgiLCJEQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIIiwicmVsZXZhbnRPcmlnaW5IZWFkZXJzIiwiT2JqZWN0IiwiZnJvbUVudHJpZXMiLCJmbGF0TWFwIiwid3JpdGVPcmlnaW5EaWFnbm9zdGljcyIsIm91dHB1dFBhdGgiLCJyZWN1cnNpdmUiLCJkaWFnbm9zdGljcyIsImV4cGVjdE9yaWdpbkNhblVzZUFwaSIsImhlYWx0aFVybCIsIm11dGF0aW9uVXJsIiwiY29tbW9uSGVhZGVycyIsIk9yaWdpbiIsImNoZWNrIiwiYXNzZXJ0aW9uIiwiYXQiLCJjdXJyZW50IiwiX3Jlc3BvbnNlJGhlYWRlcnMkYWNjIiwiX3Jlc3BvbnNlJGhlYWRlcnMkYWNjMiIsInRvVXBwZXJDYXNlIiwidG9Db250YWluIiwiaGVhZGVyIiwibm90IiwiZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkIiwidXBsb2FkVXJsIiwibGl2ZVVwZGF0ZVVybCIsImRpYWdub3N0aWMiLCJ0b0JlVW5kZWZpbmVkIiwiaG9zdGlsZVVwbG9hZCIsIm11bHRpcGFydCIsImFyY2hpdmUiLCJtaW1lVHlwZSIsImJ1ZmZlciIsImhvc3RpbGVMaXZlVXBkYXRlIiwicGFyc2VTc2UiLCJjaHVuayIsIl9jaHVuayRzcGxpdCRmaW5kIiwibGluZSIsInBhcnNlIiwibGl2ZUpzb24iLCJsaXZlQXJyYXkiLCJBcnJheSIsImlzQXJyYXkiLCJsaXZlT3B0aW9uYWxSZWNvcmQiLCJkZXNjcmliZSIsIl9leGVjdXRpb24kb3BlcmF0aW9uSSIsIl9leGVjdXRpb24kZmxpZ2h0U3RhdCIsIl9naXRMb2ckY29tbWl0cyQwJHNobyIsIl9naXRMb2ckY29tbWl0cyIsIl9naXRMb2ckY29tbWl0czIiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI1Iiwic2V0VGltZW91dCIsInNraXAiLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIiLCJEQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSIsImNhbXBhaWduU2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCIsInN0cmVhbVJlc3BvbnNlIiwiaWRlbXBvdGVuY3lLZXkiLCJEYXRlIiwibm93Iiwic3NlRXZlbnRzIiwic3RhcnRlZCIsImRlYWRsaW5lIiwiU3RyaW5nIiwiUHJvbWlzZSIsInJlc29sdmUiLCJtZXNzYWdlcyIsInByb3Bvc2FsIiwiZ2l0TG9nIiwibWlzc2lvbkNvbnRyb2wiLCJkYXNoYm9hcmRTdGF0ZSIsInJlY2VudFN0ZXBzIiwidmFsaWRhdGlvbiIsInN0ZXAiLCJjYW5kaWRhdGVIYXNoIiwiX3N0ZXAkdmFsaWRhdGlvbiRjYW5kIiwiX3N0ZXAkdmFsaWRhdGlvbiIsImNhbmRpZGF0ZUlkZW50aXR5IiwiZXZpZGVuY2VDb3VudCIsInJlZHVjZSIsImNvdW50IiwidGVybWluYWxTdGF0ZSIsInN1Y2Nlc3NTdGF0ZXMiLCJkZWxpdmVyeVN0YWdlcyIsImFwcGxpZWQiLCJjb21taXR0ZWQiLCJwdXNoZWQiLCJ2YWx1ZXMiLCJldmVyeSIsImNhcHR1cmUiLCJ3b3Jrc3BhY2VSZXZpc2lvbiIsImNvbW1pdHMiLCJzaG9ydEhhc2giLCJjYW5kaWRhdGVSZXZpc2lvbiIsImN1cnJlbnRPcGVyYXRpb24iLCJyZXZpc2lvbiIsInJldGFpbmVkUmVzdWx0IiwibWVzc2FnZVNlc3Npb24iLCJtZXNzYWdlRXhlY3V0aW9uIiwiZXZlbnRFeGVjdXRpb24iLCJldmVudFNlc3Npb24iLCJjaGVja3BvaW50cyIsInNlcXVlbmNlIiwicHJvcG9zYWxzIiwiX3N0ZXAkdmFsaWRhdGlvbiRzdGF0IiwiX3N0ZXAkdmFsaWRhdGlvbjIiLCJfc3RlcCR2YWxpZGF0aW9uJHByb2YiLCJfc3RlcCR2YWxpZGF0aW9uMyIsInByb2ZpbGUiLCJ2YWxpZGF0aW9uUHJvZmlsZSIsImRhc2hib2FyZCIsIkRBU0hCT0FSRF9FMkVfTElWRV9SRVBPUlRfUEFUSCIsImZpcnN0IiwidG9CZURpc2FibGVkIiwiYnJvd3NlciIsInNlY29uZENvbnRleHQiLCJuZXdDb250ZXh0Iiwic2Vjb25kUGFnZSIsIm5ld1BhZ2UiLCJhbGwiLCJsb2NhdG9yIiwiY3VycmVudERhc2hib2FyZEZpeHR1cmUiLCJyZWZyZXNoQ291bnQiLCJyZWxlYXNlU3RhbGVSZXNwb25zZSIsInN0YWxlUmVzcG9uc2VSZWxlYXNlZCIsInN0YWxlUmVmcmVzaCIsInBvbGwiLCJyZWNvbm5lY3RBdHRlbXB0IiwicmVsb2FkIiwidW5yb3V0ZSIsInRvSGF2ZUNvdW50IiwiY2xvc2UiLCJhdWRpdFJlcXVlc3RzIiwiYXVkaXRCb2R5IiwiZm9ybWF0IiwiZXhwb3J0ZWRBdCIsInByb29mIiwicmVxdWlyZWQiLCJ2ZXJkaWN0IiwidGltZWxpbmUiLCJ2YWxpZGF0aW9ucyIsImFmZmVjdGVkRmlsZXMiLCJyZWRhY3Rpb24iLCJleGNsdWRlZCIsImxvY2FsU3RvcmFnZSIsInNldEl0ZW0iLCJnZXRCeUxhYmVsIiwidG9Db250YWluVGV4dCIsInByZXZpZXciLCJ0b0hhdmVMZW5ndGgiLCJ0b0JlSGlkZGVuIiwiZG93bmxvYWRQcm9taXNlIiwid2FpdEZvckV2ZW50IiwiZG93bmxvYWQiLCJzdWdnZXN0ZWRGaWxlbmFtZSIsInJlbG9hZGVkUHJvb2YiLCJjYW5jZWxsZWRFeGVjdXRpb24iLCJ0ZXJtaW5hbFJlYXNvbiIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjYiLCJ0YXNrSWQiLCJsaXZlTG9nIiwibGV2ZWwiLCJ1cGxvYWRSZXN1bHQiLCJieXRlcyIsIlVpbnQ4QXJyYXkiLCJhdG9iIiwiY2hhcmFjdGVyIiwiY2hhckNvZGVBdCIsIkZvcm1EYXRhIiwiYXBwZW5kIiwiQmxvYiIsInRvRXF1YWwiLCJ0YXNrUm93IiwibWV0YWRhdGEiLCJhY3Rpdml0eSIsImhhc1RleHQiLCJub25TdHJlYW1SZXF1ZXN0cyIsIm9uIiwiZXhoYXVzdGVkIiwic2l6ZSIsIl8iLCJpbmRleCIsIlVUQyIsInRvSVNPU3RyaW5nIiwiZXZlbnRSZXF1ZXN0cyIsImZpcnN0UmVxdWVzdCIsIndhaXRGb3JSZXF1ZXN0IiwiZ2V0QnlQbGFjZWhvbGRlciIsImZpbGwiLCJudGgiLCJzZWxlY3RPcHRpb24iLCJ0b0hhdmVWYWx1ZSIsImZpbHRlcmVkUmVxdWVzdCIsImNvbXBvc2VyIiwic2VuZEJ1dHRvbiIsInRvQmVFbmFibGVkIiwic3RyZWFtUmVzcG9uc2VQcm9taXNlIiwid2FpdEZvclJlc3BvbnNlIiwibGFzdCIsInZpc2libGVUZXh0IiwiaW5uZXJUZXh0Iiwic2V0Vmlld3BvcnRTaXplIiwid2lkdGgiLCJoZWlnaHQiLCJ0b01hdGNoIiwiYWNjZXB0ZWQiLCJhc3NlcnRBY2NlcHRlZENpdGF0aW9uIiwiYXNzZXJ0QmxvY2tlZENpdGF0aW9uIiwiYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscyIsImdvQmFjayIsImdvRm9yd2FyZCIsInJlbG9hZGVkVGV4dCIsIl9hd2FpdCRyZXN1bWVSZXF1ZXN0JCIsInJlc3VtZVJlcXVlc3QiLCJwb3N0RGF0YSIsIm9iamVjdENvbnRhaW5pbmciLCJfc3RyZWFtUmVxdWVzdHMkIiwiX3N0cmVhbVJlcXVlc3RzJDIiLCJyZWNvdmVyeSIsImFkZEluaXRTY3JpcHQiLCJuYXRpdmVGZXRjaCIsImJpbmQiLCJpbnB1dCIsImluaXQiLCJSZXF1ZXN0IiwicmVhZGVyIiwiZ2V0UmVhZGVyIiwiZW5jb2RlciIsIlRleHRFbmNvZGVyIiwic3RyZWFtIiwiUmVhZGFibGVTdHJlYW0iLCJzdGFydCIsImNvbnRyb2xsZXIiLCJidWZmZXJlZCIsImRvbmUiLCJyZWFkIiwiZW5xdWV1ZSIsImVuY29kZSIsIlRleHREZWNvZGVyIiwiZGVjb2RlIiwibWFya2VyIiwiaW5kZXhPZiIsImZyYW1lRW5kIiwiVHlwZUVycm9yIiwiUmVzcG9uc2UiLCJzdGF0dXNUZXh0Iiwic3RvcmFnZUtleSIsInBvaW50ZXJLZXkiLCJrZXkiLCJnZXRJdGVtIiwiX2xvY2FsU3RvcmFnZSRnZXRJdGVtIiwic2F2ZWQiLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0yIiwibGlmZWN5Y2xlIiwicmVjb3ZlcnlTdGF0ZSIsIm9wZXJhdG9yRXhwbGFuYXRpb24iLCJuZXh0QWN0aW9uIiwiY29uZmxpY3RSZWFzb24iLCJ2YWxpZGF0aW9uRXZpZGVuY2UiLCJ3b3Jrc3BhY2VBdmFpbGFibGUiLCJjaGFuZ2VDb3VudCIsInJlZ2lvbiIsImF2YWlsYWJsZSIsIm1pc3NpbmciLCJkaXNjYXJkZWQiLCJ0b0hhdmVBdHRyaWJ1dGUiLCJyZWxvYWRlZFJlZ2lvbiIsInRvQmVHcmVhdGVyVGhhbk9yRXF1YWwiLCJvcGVyYXRpb24iLCJiZWZvcmVPcGVuIiwiYm91bmRpbmdCb3giLCJ0b0JlR3JlYXRlclRoYW4iLCJkcmF3ZXIiLCJkcmF3ZXJCb3giLCJkdXJpbmdPcGVuIl0sInNvdXJjZXMiOlsiZGFzaGJvYXJkLmpvdXJuZXkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZXhwZWN0LCB0ZXN0LCB0eXBlIFBhZ2UgfSBmcm9tIFwiQHBsYXl3cmlnaHQvdGVzdFwiO1xuaW1wb3J0IHsgbWtkaXIsIHdyaXRlRmlsZSB9IGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHtcbiAgcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UsXG4gIHBhcnNlQ2xlcmtVc2VyTG9va3VwUmVzcG9uc2UsXG4gIHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlLFxufSBmcm9tIFwiLi4vc3JjL2xpYi9jbGVyay1oYW5kb2ZmXCI7XG5cbmNvbnN0IERBU0hCT0FSRF9QQVRIID0gXCIvZGFzaGJvYXJkL1wiO1xuY29uc3QgVEVTVF9VU0VSID0ge1xuICBmaXJzdE5hbWU6IFwiRW5naW5lZXJpbmdPU1wiLFxuICBsYXN0TmFtZTogXCJEYXNoYm9hcmQgU21va2VcIixcbiAgZW1haWw6XG4gICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9FTUFJTCA/P1xuICAgIFwiZW5naW5lZXJpbmdvcy1kYXNoYm9hcmQtc21va2VAZXhhbXBsZS5jb21cIixcbn07XG5jb25zdCBFWEVDVVRJT05fSUQgPSBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiO1xuY29uc3QgREVGQVVMVF9MSVZFX1RJTUVPVVRfTVMgPSAxMjBfMDAwO1xuY29uc3QgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TID0gNV8wMDA7XG5jb25zdCBIT1NUSUxFX09SSUdJTiA9IFwiaHR0cHM6Ly9hdHRhY2tlci5leGFtcGxlXCI7XG5jb25zdCBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTID0gW1xuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIixcbiAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzXCIsXG4gIFwidmFyeVwiLFxuXSBhcyBjb25zdDtcbmNvbnN0IERFRkFVTFRfTElWRV9QUk9NUFQgPVxuICBcIlBlcmZvcm0gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IG9mIHRoaXMgZGlzcG9zYWJsZSBwcm9qZWN0IHVzaW5nIHJlYWQtb25seSB0b29scy4gXCIgK1xuICBcIlByb2R1Y2UgYXQgbGVhc3Qgb25lIGFjY2VwdGVkIGV2aWRlbmNlIGl0ZW0gYW5kIG9uZSB2YWxpZGF0aW9uIGNoZWNrcG9pbnQsIGFuZCBkbyBub3QgXCIgK1xuICBcInJlcG9ydCBDT01QTEVURUQgdW5sZXNzIGJvdGggYXJlIHByZXNlbnQuIFJlcG9ydCBvbmx5IHZlcmlmaWVkIGV2aWRlbmNlLlwiO1xuY29uc3QgTElWRV9DQU1QQUlHTl9TQ0VOQVJJT1MgPSBuZXcgU2V0KFtcbiAgXCJwcm92aWRlci1vdXRhZ2VcIixcbiAgXCJtYWxmb3JtZWQtb3V0cHV0XCIsXG4gIFwiZGVsaXZlcnktc3VjY2Vzc1wiLFxuXSk7XG5cbmZ1bmN0aW9uIGxpdmVDYW1wYWlnblNjZW5hcmlvKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHNjZW5hcmlvID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1NDRU5BUklPPy50cmltKCk7XG4gIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfQ0FNUEFJR04gPT09IFwiMVwiICYmICFzY2VuYXJpbykge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiTGl2ZSBjYW1wYWlnbiByZXF1aXJlcyBEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU89cHJvdmlkZXItb3V0YWdlLCBtYWxmb3JtZWQtb3V0cHV0LCBvciBkZWxpdmVyeS1zdWNjZXNzLlwiLFxuICAgICk7XG4gIH1cbiAgaWYgKHNjZW5hcmlvICYmICFMSVZFX0NBTVBBSUdOX1NDRU5BUklPUy5oYXMoc2NlbmFyaW8pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsaXZlIGNhbXBhaWduIHNjZW5hcmlvOiAke3NjZW5hcmlvfS5gKTtcbiAgfVxuICByZXR1cm4gc2NlbmFyaW87XG59XG5cbmZ1bmN0aW9uIGxpdmVQcm9tcHQoKTogc3RyaW5nIHtcbiAgY29uc3Qgc2NlbmFyaW8gPSBsaXZlQ2FtcGFpZ25TY2VuYXJpbygpO1xuICBpZiAoc2NlbmFyaW8gPT09IFwicHJvdmlkZXItb3V0YWdlXCIpIHtcbiAgICByZXR1cm4gXCJSdW4gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IGFuZCByZXBvcnQgdGhlIE9wZW5Sb3V0ZXIgcmF0ZS1saW1pdC9wcm92aWRlci1leGhhdXN0aW9uIG91dGFnZSBhcyBhIGZhaWxlZCBvciBpbmNvbXBsZXRlIG9wZXJhdGlvbi4gRG8gbm90IHVzZSBwcmlvciBhbmFseXNpcyBhcyBhIGN1cnJlbnQgYW5zd2VyOyBpbmNsdWRlIHRoZSBjdXJyZW50IG9wZXJhdGlvbiBhbmQgcmV2aXNpb24uXCI7XG4gIH1cbiAgaWYgKHNjZW5hcmlvID09PSBcIm1hbGZvcm1lZC1vdXRwdXRcIikge1xuICAgIHJldHVybiBcIlJ1biBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgYW5kIHRyZWF0IG1hbGZvcm1lZCBwcm92aWRlciBvdXRwdXQgYXMgZmFpbGVkIG9yIGluY29tcGxldGUuIERvIG5vdCBjbGFpbSBzdWNjZXNzLCBhcHBseSwgY29tbWl0LCBvciBwdXNoIHdpdGhvdXQgY2FuZGlkYXRlLWJvdW5kIGV2aWRlbmNlLlwiO1xuICB9XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJkZWxpdmVyeS1zdWNjZXNzXCIpIHtcbiAgICByZXR1cm4gXCJSdW4gdGhlIGJvdW5kZWQgZGVsaXZlcnkgcHJvb2YgY2FtcGFpZ24gb24gdGhpcyBkaXNwb3NhYmxlIHByb2plY3QuIEV4ZXJjaXNlIGFwcGx5LCBjb21taXQsIGFuZCBwdXNoIG9ubHkgd2hlbiBlYWNoIGN1cnJlbnQgb3BlcmF0aW9uLCBwcm9qZWN0IHJldmlzaW9uLCBjYW5kaWRhdGUgaWRlbnRpdHksIGFuZCBjYW5kaWRhdGUtYm91bmQgZXZpZGVuY2UgbWF0Y2guIFJlcG9ydCBldmVyeSB0ZXJtaW5hbCByZWNlaXB0LlwiO1xuICB9XG4gIHJldHVybiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPTVBUID8/IERFRkFVTFRfTElWRV9QUk9NUFQ7XG59XG5cbmZ1bmN0aW9uIGxpdmVUaW1lb3V0TXMoKTogbnVtYmVyIHtcbiAgY29uc3QgY29uZmlndXJlZCA9IE51bWJlcihwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfVElNRU9VVF9NUyk7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZCkgJiYgY29uZmlndXJlZCA+IDBcbiAgICA/IGNvbmZpZ3VyZWRcbiAgICA6IERFRkFVTFRfTElWRV9USU1FT1VUX01TO1xufVxuXG5mdW5jdGlvbiBhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMoKTogc3RyaW5nW10ge1xuICBjb25zdCBvcmlnaW5zID0gKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyA/PyBcIlwiKVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChvcmlnaW4pID0+IG9yaWdpbi50cmltKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKG9yaWdpbnMubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJEQVNIQk9BUkRfRTJFX0FQUFJPVkVEX09SSUdJTlMgbXVzdCBjb250YWluIGV2ZXJ5IGFwcHJvdmVkIGRhc2hib2FyZCBvcmlnaW4uXCIsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gb3JpZ2lucy5tYXAoKG9yaWdpbikgPT4ge1xuICAgIGNvbnN0IHBhcnNlZCA9IG5ldyBVUkwob3JpZ2luKTtcbiAgICBpZiAoXG4gICAgICBwYXJzZWQub3JpZ2luICE9PSBvcmlnaW4gfHxcbiAgICAgIHBhcnNlZC5wYXRobmFtZSAhPT0gXCIvXCIgfHxcbiAgICAgIHBhcnNlZC5zZWFyY2ggfHxcbiAgICAgIHBhcnNlZC5oYXNoXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBEYXNoYm9hcmQgam91cm5leSBvcmlnaW4gbXVzdCBiZSBhIGJhcmUgb3JpZ2luOiAke29yaWdpbn1gLFxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhcnNlZC5vcmlnaW47XG4gIH0pO1xufVxuXG5jb25zdCBkYXNoYm9hcmRGaXh0dXJlID0ge1xuICBmcmVzaG5lc3NSZXZpc2lvbjogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgcHJvamVjdENvdW50OiAxLFxuICBhY3RpdmVUYXNrQ291bnQ6IDAsXG4gIGNvbXBsZXRlZFRhc2tDb3VudDogMixcbiAgZmFpbGVkVGFza0NvdW50OiAwLFxuICB0YXNrU3RhdHVzQnJlYWtkb3duOiB7IHBlbmRpbmc6IDAsIHJ1bm5pbmc6IDAgfSxcbiAgcHJvamVjdFNjb3JlczogW1xuICAgIHtcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgcHJvamVjdE5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgc2NvcmU6IDkyLFxuICAgICAgdHJlbmQ6IFwic3RhYmxlXCIsXG4gICAgfSxcbiAgXSxcbiAgcmVjZW50RXZlbnRzOiBbXG4gICAge1xuICAgICAgaWQ6IFwiZTJlLWV2ZW50XCIsXG4gICAgICB0eXBlOiBcIlNtb2tlQ2hlY2tcIixcbiAgICAgIHNldmVyaXR5OiBcInN1Y2Nlc3NcIixcbiAgICAgIG1lc3NhZ2U6IFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgfSxcbiAgXSxcbiAgdG9wUnVsZXM6IFtdLFxufTtcblxuY29uc3QgZXhlY3V0aW9uRml4dHVyZSA9IHtcbiAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gIG9wZXJhdGlvbklkOiBcImUyZS1vcGVyYXRpb25cIixcbiAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICBmbGlnaHRTdGF0ZTogXCJDT01QTEVURURcIixcbiAgZXZpZGVuY2VWZXJkaWN0OiBcIlBST1ZFTlwiLFxuICBwcm9vZlJlcXVpcmVkOiBmYWxzZSxcbiAgcmVzdW1hYmxlOiBmYWxzZSxcbiAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gIHByb2plY3RSZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgY2hlY2twb2ludDoge1xuICAgIHN0YWdlOiBcImNvbXBsZXRlXCIsXG4gICAgZGV0YWlsOiBcIkNvbnRyb2xsZWQgYnJvd3NlciBmaXh0dXJlIGNvbXBsZXRlZC5cIixcbiAgfSxcbiAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogXCJWZXJpZnkgdGhlIGRhc2hib2FyZCBicm93c2VyIGpvdXJuZXlcIiB9LFxuICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIGNvbXBsZXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbn07XG5cbmZ1bmN0aW9uIGpzb25SZXNwb25zZShcbiAgYm9keTogdW5rbm93bixcbiAgc3RhdHVzID0gMjAwLFxuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbikge1xuICByZXR1cm4ge1xuICAgIHN0YXR1cyxcbiAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgLi4uKGhlYWRlcnMgPyB7IGhlYWRlcnMgfSA6IHt9KSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZTogUGFnZSkge1xuICBjb25zdCBvdmVyZmxvdyA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gKHtcbiAgICBkb2N1bWVudDogZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbFdpZHRoLFxuICAgIGJvZHk6IGRvY3VtZW50LmJvZHkuc2Nyb2xsV2lkdGgsXG4gICAgdmlld3BvcnQ6IHdpbmRvdy5pbm5lcldpZHRoLFxuICB9KSk7XG4gIGV4cGVjdChvdmVyZmxvdy5kb2N1bWVudCkudG9CZUxlc3NUaGFuT3JFcXVhbChvdmVyZmxvdy52aWV3cG9ydCArIDEpO1xuICBleHBlY3Qob3ZlcmZsb3cuYm9keSkudG9CZUxlc3NUaGFuT3JFcXVhbChvdmVyZmxvdy52aWV3cG9ydCArIDEpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlOiBQYWdlKSB7XG4gIGF3YWl0IGV4cGVjdChcbiAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIlN5c3RlbSBPdmVydmlld1wiIH0pLFxuICApLnRvQmVWaXNpYmxlKCk7XG4gIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlNZU1RFTSBPTkxJTkVcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzdGFydEFwaUZvckNhbXBhaWduKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3QgY29udHJvbFVybCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQ09OVFJPTF9VUkw7XG4gIGlmICghY29udHJvbFVybCkgdGhyb3cgbmV3IEVycm9yKFwiRGFzaGJvYXJkIGNhbXBhaWduIGNvbnRyb2wgVVJMIGlzIG1pc3NpbmcuXCIpO1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KGAke2NvbnRyb2xVcmx9L3Jlc3RhcnQtYXBpYCwge1xuICAgIHRpbWVvdXQ6IDE1XzAwMCxcbiAgfSk7XG4gIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSkudG9CZSgyMDQpO1xufVxuXG50eXBlIEFyYWJpY0FpRml4dHVyZSA9IHtcbiAgcXVlc3Rpb246IHN0cmluZztcbiAgYW5zd2VyOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgZXhlY3V0aW9uSWQ/OiBzdHJpbmc7XG4gIHByb2plY3RJZD86IHN0cmluZztcbiAgc3RyZWFtQm9keTogc3RyaW5nO1xuICBtZXNzYWdlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn07XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3RhbGxBcGlGaXh0dXJlcyhcbiAgcGFnZTogUGFnZSxcbiAgb3ZlcnJpZGVzPzoge1xuICAgIGFyYWJpY0FpPzogQXJhYmljQWlGaXh0dXJlO1xuICAgIGFsdGVybmF0ZUFpPzogQXJhYmljQWlGaXh0dXJlO1xuICAgIGRpc2Nvbm5lY3RBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICByZXN1bWVGYWlsdXJlPzoge1xuICAgICAgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlO1xuICAgICAgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICB9O1xuICAgIGludGVycnVwdGVkUmVzdW1lPzoge1xuICAgICAgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlO1xuICAgICAgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIHJlY292ZXJlZFRva2VuOiBzdHJpbmc7XG4gICAgICByZXN1bWVkU3RyZWFtQm9keTogc3RyaW5nO1xuICAgIH07XG4gICAgZGVsaXZlcnlSZWNvdmVyeT86IHtcbiAgICAgIG9wZXJhdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIHJlcXVlc3RzOiBzdHJpbmdbXTtcbiAgICAgIGFjdGlvblJlcXVlc3RzPzogc3RyaW5nW107XG4gICAgICByZWNvdmVyeUFjdGlvbj86IHtcbiAgICAgICAgcHJvcG9zYWxJZDogc3RyaW5nO1xuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiB8IFwiZGlzY2FyZFwiO1xuICAgICAgICByZXNwb25zZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIHN0YXR1cz86IG51bWJlcjtcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICB9O1xuICAgIH07XG4gICAgcHJvamVjdHM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgZXZlbnRzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIGFyY2hpdmVVcGxvYWQ/OiB7XG4gICAgICB1cGxvYWRJZDogc3RyaW5nO1xuICAgICAgb3JpZ2luYWxOYW1lOiBzdHJpbmc7XG4gICAgfTtcbiAgICBhdWRpdEV4cG9ydD86IHtcbiAgICAgIGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgZmlsZW5hbWU6IHN0cmluZztcbiAgICAgIHJlcXVlc3RzOiBzdHJpbmdbXTtcbiAgICAgIGV4ZWN1dGlvbj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgbWVzc2FnZU91dGNvbWU/OiBzdHJpbmc7XG4gICAgICBmYWlsRmlyc3RQcmV2aWV3PzogYm9vbGVhbjtcbiAgICB9O1xuICAgIGxpdmVUYXNrPzoge1xuICAgICAgaWQ6IHN0cmluZztcbiAgICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgICBwcm9qZWN0SWQ6IHN0cmluZztcbiAgICAgIGxvZzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBpbml0aWFsTG9ncz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIHN0cmVhbVJlcXVlc3RzPzogc3RyaW5nW107XG4gICAgICBmYWlsRmlyc3RTdHJlYW0/OiBib29sZWFuO1xuICAgICAgZmFpbFN0cmVhbUF0dGVtcHRzPzogbnVtYmVyO1xuICAgIH07XG4gIH0sXG4pIHtcbiAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS8qKlwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgY29uc3QgcGF0aCA9IHVybC5wYXRobmFtZS5yZXBsYWNlKC9eXFwvZGFzaGJvYXJkKD89XFwvfCQpLywgXCJcIik7XG4gICAgY29uc3QgYXJhYmljQWkgPSBvdmVycmlkZXM/LmFyYWJpY0FpO1xuICAgIGNvbnN0IGFsdGVybmF0ZUFpID0gb3ZlcnJpZGVzPy5hbHRlcm5hdGVBaTtcbiAgICBjb25zdCBkaXNjb25uZWN0QWkgPSBvdmVycmlkZXM/LmRpc2Nvbm5lY3RBaTtcbiAgICBjb25zdCBhaUZpeHR1cmVzID0gW2FyYWJpY0FpLCBhbHRlcm5hdGVBaSwgZGlzY29ubmVjdEFpXS5maWx0ZXIoXG4gICAgICAoZml4dHVyZSk6IGZpeHR1cmUgaXMgQXJhYmljQWlGaXh0dXJlID0+IEJvb2xlYW4oZml4dHVyZSksXG4gICAgKTtcblxuICAgIGlmIChhaUZpeHR1cmVzLmxlbmd0aCA+IDAgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zZXNzaW9uc1wiKSkge1xuICAgICAgY29uc3QgcHJvamVjdElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwcm9qZWN0SWRcIik7XG4gICAgICBjb25zdCBwcm9qZWN0U2Vzc2lvbnMgPSBhaUZpeHR1cmVzLmZpbHRlcihcbiAgICAgICAgKGZpeHR1cmUpID0+ICFmaXh0dXJlLnByb2plY3RJZCB8fCBmaXh0dXJlLnByb2plY3RJZCA9PT0gcHJvamVjdElkLFxuICAgICAgKTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgcHJvamVjdFNlc3Npb25zLm1hcCgoZml4dHVyZSkgPT4gKHtcbiAgICAgICAgICAgIGlkOiBmaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgICAgIHRpdGxlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpIHtcbiAgICAgIGxldCByZXF1ZXN0Qm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3RCb2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBub3JtYWwgcHJvdmlkZXItZnJlZSBmYWxsYmFjayBiZWxvdyBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICAgIH1cbiAgICAgIGlmIChcbiAgICAgICAgcmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQgPT09IG92ZXJyaWRlcy5yZXN1bWVGYWlsdXJlLmZpeHR1cmUuZXhlY3V0aW9uSWRcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICBib2R5OiBvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSkge1xuICAgICAgbGV0IHJlcXVlc3RCb2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVxdWVzdEJvZHkgPSByb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIG5vcm1hbCBwcm92aWRlci1mcmVlIGZhbGxiYWNrIGJlbG93IGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgICAgfVxuICAgICAgY29uc3QgeyBmaXh0dXJlLCByZXN1bWVkU3RyZWFtQm9keSB9ID0gb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lO1xuICAgICAgaWYgKHJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkID09PSBmaXh0dXJlLmV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIGJvZHk6IHJlc3VtZWRTdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghcmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHN0b3AgYWZ0ZXIgdGhlIGR1cmFibGUgZXhlY3V0aW9uIGlkZW50aXR5LiBUaGVcbiAgICAgICAgICAvLyBqb3VybmV5IHdyYXBzIHRoaXMgcmVzcG9uc2UgaW4gYSBicm93c2VyLWxldmVsIHN0cmVhbSBlcnJvci5cbiAgICAgICAgICBib2R5OiBmaXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzdHJlYW1GaXh0dXJlID0gZGlzY29ubmVjdEFpID8/IGFyYWJpY0FpO1xuICAgIGlmIChzdHJlYW1GaXh0dXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgIGJvZHk6IHN0cmVhbUZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgIH0pO1xuICAgIGNvbnN0IG1lc3NhZ2VGaXh0dXJlID0gYWlGaXh0dXJlcy5maW5kKChmaXh0dXJlKSA9PlxuICAgICAgcGF0aC5lbmRzV2l0aChgL2FwaS9haS9jaGF0LyR7Zml4dHVyZS5zZXNzaW9uSWR9L21lc3NhZ2VzYCksXG4gICAgKTtcbiAgICBpZiAobWVzc2FnZUZpeHR1cmUpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogYCR7bWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkfS11c2VyLW1lc3NhZ2VgLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlRml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IG1lc3NhZ2VGaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUZpeHR1cmUubWVzc2FnZSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvZTJlLWF1ZGl0LXNlc3Npb24vbWVzc2FnZXNcIilcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC11c2VyLW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC1hc3Npc3RhbnQtbWVzc2FnZVwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBleGVjdXRpb25JZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICAgICAgb3V0Y29tZTogb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0Lm1lc3NhZ2VPdXRjb21lID8/IFwiU1VDQ0VFREVEXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZGFzaGJvYXJkXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoZGFzaGJvYXJkRml4dHVyZSkpO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGggPT09IGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9L2F1ZGl0LWV4cG9ydGBcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5yZXF1ZXN0cy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICBpZiAoXG4gICAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5mYWlsRmlyc3RQcmV2aWV3ICYmXG4gICAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5yZXF1ZXN0cy5sZW5ndGggPT09IDFcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgICB7IGVycm9yOiBcIlRlbXBvcmFyeSBwcmV2aWV3IG5ldHdvcmsgZmFpbHVyZS5cIiB9LFxuICAgICAgICAgICAgNTAzLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5ib2R5LCAyMDAsIHtcbiAgICAgICAgICBcIkNvbnRlbnQtRGlzcG9zaXRpb25cIjogYGF0dGFjaG1lbnQ7IGZpbGVuYW1lPVwiJHtvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmlsZW5hbWV9XCJgLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LmFyY2hpdmVVcGxvYWQgJiYgcGF0aCA9PT0gXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIpIHtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcm91dGUucmVxdWVzdCgpLmhlYWRlcnMoKVtcImNvbnRlbnQtdHlwZVwiXSA/PyBcIlwiO1xuICAgICAgaWYgKCFjb250ZW50VHlwZS5zdGFydHNXaXRoKFwibXVsdGlwYXJ0L2Zvcm0tZGF0YTtcIikpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgbXVsdGlwYXJ0IGFyY2hpdmUgdXBsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBjb25zdCBib2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhQnVmZmVyKCk7XG4gICAgICBpZiAoIWJvZHk/LmluY2x1ZGVzKEJ1ZmZlci5mcm9tKFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIpKSkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJFeHBlY3RlZCB0aGUgam91cm5leSBhcmNoaXZlIHBheWxvYWQuXCIgfSwgNDAwKSxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAge1xuICAgICAgICAgICAgdXBsb2FkSWQ6IG92ZXJyaWRlcy5hcmNoaXZlVXBsb2FkLnVwbG9hZElkLFxuICAgICAgICAgICAgb3JpZ2luYWxOYW1lOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC5vcmlnaW5hbE5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAyMDEsXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIjogbmV3IFVSTChwYWdlLnVybCgpKS5vcmlnaW4sXG4gICAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5saXZlVGFzayAmJiBwYXRoID09PSBcIi9hcGkvdGFza3NcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IG92ZXJyaWRlcy5saXZlVGFzay5pZCxcbiAgICAgICAgICAgIHByb2plY3RJZDogb3ZlcnJpZGVzLmxpdmVUYXNrLnByb2plY3RJZCxcbiAgICAgICAgICAgIHRpdGxlOiBvdmVycmlkZXMubGl2ZVRhc2sudGl0bGUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBIHRhc2sgdXNlZCB0byB2ZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlcy5cIixcbiAgICAgICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgICAgICBwaGFzZTogXCJFeGVjdXRpb25cIixcbiAgICAgICAgICAgIHJlbGF0ZWRGaWxlczogW10sXG4gICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAxLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICBdKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiZcbiAgICAgIHBhdGggPT09IGAvYXBpL3Rhc2tzLyR7b3ZlcnJpZGVzLmxpdmVUYXNrLmlkfS9sb2dzYFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKG92ZXJyaWRlcy5saXZlVGFzay5pbml0aWFsTG9ncyA/PyBbXSkpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9ncy9zdHJlYW1gXG4gICAgKSB7XG4gICAgICBjb25zdCBzdHJlYW1SZXF1ZXN0cyA9IG92ZXJyaWRlcy5saXZlVGFzay5zdHJlYW1SZXF1ZXN0cztcbiAgICAgIHN0cmVhbVJlcXVlc3RzPy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICBpZiAoXG4gICAgICAgIChvdmVycmlkZXMubGl2ZVRhc2suZmFpbEZpcnN0U3RyZWFtICYmIHN0cmVhbVJlcXVlc3RzPy5sZW5ndGggPT09IDEpIHx8XG4gICAgICAgIChvdmVycmlkZXMubGl2ZVRhc2suZmFpbFN0cmVhbUF0dGVtcHRzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMgJiZcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cy5sZW5ndGggPD0gb3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cylcbiAgICAgICkge1xuICAgICAgICAvLyBFeGVyY2lzZSB0aGUgYnJvd3NlcidzIHJlY29ubmVjdCBwYXRoIHdpdGhvdXQgY2hhbmdpbmcgdGhlIHRhc2tcbiAgICAgICAgLy8gbGlmZWN5Y2xlIG9yIHN5bnRoZXNpemluZyBhIHN1Y2Nlc3NmdWwgcmVzcG9uc2UgZm9yIHRoZSBmaXJzdCB0cnkuXG4gICAgICAgIHJldHVybiByb3V0ZS5hYm9ydChcImNvbm5lY3Rpb25yZXNldFwiKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiLFxuICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIjogXCJ0cnVlXCIsXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IGBldmVudDogbG9nXFxuZGF0YTogJHtKU09OLnN0cmluZ2lmeShvdmVycmlkZXMubGl2ZVRhc2subG9nKX1cXG5cXG5gLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvcHJvamVjdHNcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXM/LnByb2plY3RzID8/IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICAgICAgbmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICAgICAgcXVhbGl0eVNjb3JlOiA5MixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeSAmJlxuICAgICAgcGF0aCA9PT0gXCIvYXBpL2FpL2RlbGl2ZXJ5L3JlY292ZXJhYmxlXCJcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlcXVlc3RzLnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBvcGVyYXRpb25zOiBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5kZWxpdmVyeVJlY292ZXJ5Py5yZWNvdmVyeUFjdGlvbiAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZGVsaXZlcnkvJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5wcm9wb3NhbElkfS8ke292ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLmFjdGlvbn1gXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zKSB7XG4gICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5Lm9wZXJhdGlvbnMgPVxuICAgICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5yZXNwb25zZSxcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5zdGF0dXMgPz8gNDA5LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9ldmVudHNcIikge1xuICAgICAgY29uc3QgZXZlbnRzID0gb3ZlcnJpZGVzPy5ldmVudHMgPz8gZGFzaGJvYXJkRml4dHVyZS5yZWNlbnRFdmVudHM7XG4gICAgICBjb25zdCBzZWFyY2ggPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInNlYXJjaFwiKT8udG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGZpbHRlcmVkRXZlbnRzID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+IHtcbiAgICAgICAgY29uc3QgcHJvamVjdElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwcm9qZWN0SWRcIik7XG4gICAgICAgIGNvbnN0IHNldmVyaXR5ID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKTtcbiAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiY29ycmVsYXRpb25JZFwiKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAoIXByb2plY3RJZCB8fCBldmVudC5wcm9qZWN0SWQgPT09IHByb2plY3RJZCkgJiZcbiAgICAgICAgICAoIXNldmVyaXR5IHx8IGV2ZW50LnNldmVyaXR5ID09PSBzZXZlcml0eSkgJiZcbiAgICAgICAgICAoIWNvcnJlbGF0aW9uSWQgfHwgZXZlbnQuY29ycmVsYXRpb25JZCA9PT0gY29ycmVsYXRpb25JZCkgJiZcbiAgICAgICAgICAoIXNlYXJjaCB8fFxuICAgICAgICAgICAgW2V2ZW50Lm1lc3NhZ2UsIGV2ZW50LnR5cGUsIGV2ZW50LmNvcnJlbGF0aW9uSWRdXG4gICAgICAgICAgICAgIC5maWx0ZXIoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIilcbiAgICAgICAgICAgICAgLnNvbWUoKHZhbHVlKSA9PiB2YWx1ZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaCkpKVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgICBjb25zdCBsaW1pdCA9IE51bWJlcih1cmwuc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKSB8fCA1MDtcbiAgICAgIGNvbnN0IHBhZ2UgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKSB8fCAxO1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXZlbnRzOiBmaWx0ZXJlZEV2ZW50cy5zbGljZSgocGFnZSAtIDEpICogbGltaXQsIHBhZ2UgKiBsaW1pdCksXG4gICAgICAgICAgdG90YWw6IGZpbHRlcmVkRXZlbnRzLmxlbmd0aCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5leGVjdXRpb24pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke292ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH0vcmVzdW1lLWNhcGFiaWxpdHlgXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHtcbiAgICAgICAgICBleGVjdXRpb25JZDogb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgICAgcmVzdW1lVG9rZW46IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5yZWNvdmVyZWRUb2tlbixcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gYC9hcGkvYWkvZXhlY3V0aW9ucy8ke0VYRUNVVElPTl9JRH1gKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXM/LmF1ZGl0RXhwb3J0Py5leGVjdXRpb24gPz8gZXhlY3V0aW9uRml4dHVyZSksXG4gICAgICApO1xuICAgIGlmIChwYXRoID09PSBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLCBleGVjdXRpb25zOiBbXSB9KSxcbiAgICAgICk7XG5cbiAgICAvLyBBSSBpcyBkZWxpYmVyYXRlbHkgbm90IGV4ZWN1dGVkIGluIHRoaXMgc21va2Ugam91cm5leS4gVGhpcyByZXNwb25zZVxuICAgIC8vIHZlcmlmaWVzIHRoZSB1c2VyLXZpc2libGUgdW5hdmFpbGFibGUvZW1wdHkgc3RhdGUgd2l0aG91dCBhIHByb3ZpZGVyLlxuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoXCIvYXBpL2FpL1wiKSlcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJBSSBwcm92aWRlciBub3QgY29uZmlndXJlZFwiIH0sIDQyOCksXG4gICAgICApO1xuXG4gICAgcmV0dXJuIHJvdXRlLmNvbnRpbnVlKCk7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKFxuICBwYWdlOiBQYWdlLFxuICBvcHRpb25zPzoge1xuICAgIGJsb2NrZWQ/OiBib29sZWFuO1xuICAgIHNlc3Npb25JZD86IHN0cmluZztcbiAgICBxdWVzdGlvbj86IHN0cmluZztcbiAgICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIH0sXG4pIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gb3B0aW9ucz8uc2Vzc2lvbklkID8/IFwiZTJlLWFyYWJpYy1haS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLWFyYWJpYy1haS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL2V4ZWN1dGlvbi10b29scy50c1wiO1xuICBjb25zdCBibG9ja2VkID0gb3B0aW9ucz8uYmxvY2tlZCA9PT0gdHJ1ZTtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIG9wdGlvbnM/LnF1ZXN0aW9uID8/XG4gICAgXCLZhdin2LDYpyDZitit2K/YqyDYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipIHByb3ZpZGVyIHRpbWVvdXQg2K/Yp9iu2YQgZXhlY3V0aW9uLXRvb2xzLnRz2J9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIti52YbYryDYp9mG2KrZh9in2KEg2YXZh9mE2Kkg2YXYstmI2K8g2KfZhNiw2YPYp9ihINin2YTYp9i12LfZhtin2LnZitiMINmK2LnZitivINin2YTZhdiz2KfYsSDYqtmC2LHZitix2YvYpyDYrNiy2KbZitmL2Kcg2YXZhiDYp9mE2KPYr9mE2Kkg2KfZhNiq2Yog2KzZj9mF2LnYqiDYqNiv2YQg2KXYtdiv2KfYsSBGaW5kaW5nINi62YrYsSDZhdir2KjYqi5cIjtcbiAgY29uc3QgZXZpZGVuY2UgPSBbXG4gICAge1xuICAgICAgc291cmNlLFxuICAgICAgLi4uKGJsb2NrZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBleGNlcnB0OiBcInByb3ZpZGVyIHRpbWVvdXQgaXMgaGFuZGxlZCBoZXJlXCIsXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiBmYWxzZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiUkVBRF9DT05GSVJNRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkJMT0NLRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uUmVhc29uOiBcIk1JU1NJTkdfTElURVJBTF9NQVRDSFwiLFxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBleGNlcnB0OiAncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsXG4gICAgICAgICAgICBzb3VyY2VTcGFuOiB7IHN0YXJ0TGluZTogNDIsIGVuZExpbmU6IDQyIH0sXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiB0cnVlLFxuICAgICAgICAgICAgZXZpZGVuY2VDbGFzczogXCJCRUhBVklPUl9QUk9WRU5cIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkFDQ0VQVEVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJBQ0NFUFRFRF9TT1VSQ0VfU1BBTlwiLFxuICAgICAgICAgIH0pLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IHRvb2xUcmFjZSA9IFtcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9LFxuICBdO1xuICBjb25zdCB0YXNrUmVzdWx0ID0ge1xuICAgIGtpbmQ6IFwiQkVIQVZJT1JfQU5TV0VSX1JFU1VMVFwiLFxuICAgIGFuc3dlcjoge1xuICAgICAgYW5zd2VyLFxuICAgICAgZXZpZGVuY2UsXG4gICAgICBjb25maWRlbmNlOiAxLFxuICAgICAgc291cmNlU2NvcGU6IFtzb3VyY2VdLFxuICAgICAgY292ZXJhZ2U6IHtcbiAgICAgICAgcmVxdWVzdGVkRmllbGRzOiBbXCJ0aW1lb3V0IGJlaGF2aW9yXCJdLFxuICAgICAgICBhbnN3ZXJlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgbWlzc2luZ0ZpZWxkczogW10sXG4gICAgICAgIGNvbXBsZXRlOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYCR7YW5zd2VyfVxcblxcbiMjIDYpIEZpbmFsIEp1ZGdtZW50XFxuTk9UIFBST1ZFTmAsXG4gICAgb3BlcmF0aW9uTW9kZTogXCJGT1JFTlNJQ19BVURJVFwiLFxuICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBiZWhhdmlvckV2aWRlbmNlOiBldmlkZW5jZSxcbiAgICB0YXNrUmVzdWx0LFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkOiBcImUyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJidWlsZGluZy1jb250ZXh0XCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgICB0YXNrUmVzdWx0LFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBwcm9qZWN0SWQ6IG9wdGlvbnM/LnByb2plY3RJZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtdG9vbC1mYWlsdXJlLXNlc3Npb25cIjtcbiAgY29uc3QgbWVzc2FnZUlkID0gXCJlMmUtdG9vbC1mYWlsdXJlLW1lc3NhZ2VcIjtcbiAgY29uc3Qgc291cmNlID0gXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIldoaWNoIHNvdXJjZSBmaWxlIGlzIGF2YWlsYWJsZSBmb3IgdGhlIHJlbGVhc2UgY2hlY2s/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJBTkFMWVNJU19JTkNPTVBMRVRFOiBUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZSwgc28gbm8gdmVyaWZpZWQgcmVzdWx0IGlzIGF2YWlsYWJsZS5cIjtcbiAgY29uc3QgZGlhZ25vc3RpY0NvZGUgPSBcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0sXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInRvb2xfZmFpbHVyZVwiLFxuICAgICAgaXRlcmF0aW9uczogMSxcbiAgICAgIG1heEl0ZXJhdGlvbnM6IDgsXG4gICAgICB0b29sQ2FsbHM6IDEsXG4gICAgICBwcmVmZXRjaFRvb2xDYWxsczogMCxcbiAgICAgIGxvb3BUb29sQ2FsbHM6IDEsXG4gICAgICBzeW50aGVzaXNTdGFydGVkOiBmYWxzZSxcbiAgICAgIGRpYWdub3N0aWNDb2RlczogW2RpYWdub3N0aWNDb2RlXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtdG9vbC1mYWlsdXJlLWV4ZWN1dGlvblwiLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIHJlc3VsdEtpbmQ6IFwiZmFpbGVkXCIsXG4gICAgICBkaWFnbm9zdGljQ29kZSxcbiAgICAgIHJlc3VsdFN1bW1hcnk6IFwiVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2UsXG4gICAgc2Vzc2lvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSgpOiBBcmFiaWNBaUZpeHR1cmUge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWRpc2Nvbm5lY3RlZC1haS1leGVjdXRpb25cIjtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIFwiV2hhdCBoYXBwZW5zIHdoZW4gdGhlIG1vZGVsIGRpc2Nvbm5lY3RzIGFmdGVyIHN0YXJ0aW5nIGFuIGFuc3dlcj9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBtb2RlbCBzdGFydGVkIGFuIGFuc3dlciwgYnV0IHRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYmVmb3JlIGNvbXBsZXRpb24uXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJFWEVDVVRJT05fUFJPVklERVJfRkFJTFVSRVwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInByb3ZpZGVyX3RpbWVvdXRcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAwLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAwLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgICBkaWFnbm9zdGljRGV0YWlsczogW1xuICAgICAgICBcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYWZ0ZXIgdmlzaWJsZSByZXNwb25zZSB0ZXh0LlwiLFxuICAgICAgXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1kaXNjb25uZWN0ZWQtYWktbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgb3V0Y29tZTogXCJGQUlMRURcIixcbiAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgIGVycm9yTWVzc2FnZTogXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgLy8gVGhlIHJlYWwgcm91dGUgZW1pdHMgdGhpcyBhZnRlciBhIHByb3ZpZGVyIGRpc2Nvbm5lY3Qgc28gdGhlIGNsaWVudFxuICAgIC8vIGRyb3BzIHRoZSB0cmFuc2llbnQgYnViYmxlIGJlZm9yZSByZW5kZXJpbmcgdGhlIHBlcnNpc3RlZCByZXN1bHQuXG4gICAgc3NlKHsgdHlwZTogXCJzdHJlYW1fcmVzZXRcIiB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicHJvdmlkZXJcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLWV4ZWN1dGlvblwiO1xuICBjb25zdCByZXN1bWVUb2tlbiA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIlZlcmlmeSB0aGUgYW5hbHlzaXMgZXZpZGVuY2UgYWZ0ZXIgcmVjb25uZWN0LlwiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX1VOQVZBSUxBQkxFXCI7XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICByZXN1bWVUb2tlbixcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJlcnJvclwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBjb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICAgIG1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwic3JjL21pc3NpbmctYW5hbHlzaXMtdG9vbC50c1wiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2U6IHtcbiAgICAgIGlkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtbWVzc2FnZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIGVycm9yQ29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGZpeHR1cmUsXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJGQUlMRURcIixcbiAgICAgIGV2aWRlbmNlVmVyZGljdDogXCJJTkNPTVBMRVRFXCIsXG4gICAgICBwcm9vZlJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcInRvb2wtZXhlY3V0aW9uXCIsXG4gICAgICAgIGRldGFpbDogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgdG9vbCB3YXMgdW5hdmFpbGFibGUuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIGVycm9yOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLWV4ZWN1dGlvblwiO1xuICBjb25zdCBpbml0aWFsVG9rZW4gPSBcImUyZS1pbnRlcnJ1cHRlZC1pbml0aWFsLXRva2VuXCI7XG4gIGNvbnN0IHJlY292ZXJlZFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVjb3ZlcmVkLXRva2VuXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJDb250aW51ZSB0aGUgaW50ZXJydXB0ZWQgcmVsZWFzZSBleGVjdXRpb24uXCI7XG4gIGNvbnN0IHBhcnRpYWxBbnN3ZXIgPVxuICAgIFwiVGhlIHJlbGVhc2UgZXhlY3V0aW9uIHN0YXJ0ZWQgYmVmb3JlIHRoZSBicm93c2VyIGRpc2Nvbm5lY3RlZC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBvcmlnaW5hbCByZWxlYXNlIGV4ZWN1dGlvbiByZXN1bWVkIGFmdGVyIGNhcGFiaWxpdHkgcmVjb3ZlcnkuXCI7XG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgaWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1tZXNzYWdlXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIG91dGNvbWU6IFwiQ09NUExFVEVEXCIsXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZTogXCJyZWxlYXNlLXJlc3VtZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5OiBbXG4gICAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgICBzc2Uoe1xuICAgICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICAgIHJlc3VtZVRva2VuOiBpbml0aWFsVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogcGFydGlhbEFuc3dlciB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgbWVzc2FnZSxcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGluaXRpYWxUb2tlbixcbiAgICByZWNvdmVyZWRUb2tlbixcbiAgICByZXN1bWVkU3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcmVkVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwicmVzdW1pbmctY2hlY2twb2ludFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICAgIH0pLFxuICAgIF0uam9pbihcIlwiKSxcbiAgICBleGVjdXRpb246IHtcbiAgICAgIGlkOiBleGVjdXRpb25JZCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1vcGVyYXRpb25cIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHN0YXR1czogXCJwYXVzZWRcIixcbiAgICAgIGZsaWdodFN0YXRlOiBcIlBBVVNFRFwiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIixcbiAgICAgICAgZGV0YWlsOlxuICAgICAgICAgIFwiVGhlIGJyb3dzZXIgdHJhbnNwb3J0IGRpc2Nvbm5lY3RlZCBhZnRlciB0aGUgZXhlY3V0aW9uIHN0YXJ0ZWQuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgc2VjcmV0S2V5ID0gcHJvY2Vzcy5lbnYuQ0xFUktfU0VDUkVUX0tFWTtcbiAgaWYgKCFzZWNyZXRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkNMRVJLX1NFQ1JFVF9LRVkgaXMgcmVxdWlyZWQgZm9yIHRoZSByZWxlYXNlLW9ubHkgcHJvZ3JhbW1hdGljIENsZXJrIGhhbmRvZmYuXCIsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3NlY3JldEtleX1gLFxuICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICB9O1xuICBjb25zdCB1c2VyUmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QuZ2V0KFxuICAgIGBodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnM/ZW1haWxfYWRkcmVzcz0ke2VuY29kZVVSSUNvbXBvbmVudChURVNUX1VTRVIuZW1haWwpfWAsXG4gICAgeyBoZWFkZXJzIH0sXG4gICk7XG4gIGxldCB1c2VySWQgPSBwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlKGF3YWl0IHVzZXJSZXNwb25zZS5qc29uKCkpO1xuXG4gIGlmICghdXNlcklkKSB7XG4gICAgY29uc3QgY3JlYXRlZFJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgICBcImh0dHBzOi8vYXBpLmNsZXJrLmNvbS92MS91c2Vyc1wiLFxuICAgICAge1xuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgZW1haWxfYWRkcmVzczogW1RFU1RfVVNFUi5lbWFpbF0sXG4gICAgICAgICAgZmlyc3RfbmFtZTogVEVTVF9VU0VSLmZpcnN0TmFtZSxcbiAgICAgICAgICBsYXN0X25hbWU6IFRFU1RfVVNFUi5sYXN0TmFtZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX2NoZWNrczogdHJ1ZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuICAgIHVzZXJJZCA9IHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlKGF3YWl0IGNyZWF0ZWRSZXNwb25zZS5qc29uKCkpO1xuICB9XG5cbiAgaWYgKCF1c2VySWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIlRoZSBpc29sYXRlZCBDbGVyayByZWxlYXNlIHVzZXIgY291bGQgbm90IGJlIHByb3Zpc2lvbmVkLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCB0b2tlblJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvc2lnbl9pbl90b2tlbnNcIixcbiAgICB7IGhlYWRlcnMsIGRhdGE6IHsgdXNlcl9pZDogdXNlcklkIH0gfSxcbiAgKTtcbiAgY29uc3QgdG9rZW4gPSBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZShhd2FpdCB0b2tlblJlc3BvbnNlLmpzb24oKSk7XG5cbiAgcmV0dXJuIGAke25ldyBVUkwoREFTSEJPQVJEX1BBVEgsIHBhZ2UudXJsKCkpLnRvU3RyaW5nKCl9c2lnbi1pbj9fX2NsZXJrX3RpY2tldD0ke2VuY29kZVVSSUNvbXBvbmVudCh0b2tlbil9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2U6IFBhZ2UpIHtcbiAgYXdhaXQgcGFnZS5nb3RvKERBU0hCT0FSRF9QQVRIKTtcbiAgYXdhaXQgZXhwZWN0KFxuICAgIHBhZ2UuZ2V0QnlSb2xlKFwibGlua1wiLCB7IG5hbWU6IFwiU2lnbiBJblwiLCBleGFjdDogdHJ1ZSB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuXG4gIGNvbnN0IGhlbHBlciA9XG4gICAgZ2xvYmFsVGhpcy5zaWduSW5DbGVya1VzZXIgPz9cbiAgICBnbG9iYWxUaGlzLl9fRU5HSU5FRVJJTkdPU19TSUdOX0lOX0NMRVJLX1VTRVJfXztcbiAgaWYgKCFoZWxwZXIpIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuUlVOX0NPTlRST0xMRURfUkVMRUFTRV9WQUxJREFUSU9OICE9PSBcIjFcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkNsZXJrIGJyb3dzZXIgaGVscGVyIGlzIHVuYXZhaWxhYmxlLiBSdW4gdGhpcyBqb3VybmV5IGluIHRoZSBSZXBsaXQgYnJvd3NlciBydW5uZXIsIHdoaWNoIGluamVjdHMgc2lnbkluQ2xlcmtVc2VyLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgYXdhaXQgcGFnZS5nb3RvKGF3YWl0IGNyZWF0ZVJlbGVhc2VTaWduSW5VcmwocGFnZSkpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNpZ25JblVybCA9IGF3YWl0IGhlbHBlcih7XG4gICAgLi4uVEVTVF9VU0VSLFxuICAgIHR0bDogOTAwLFxuICAgIGJhc2VQYXRoOiBEQVNIQk9BUkRfUEFUSCxcbiAgfSk7XG4gIGF3YWl0IHBhZ2UuZ290byhzaWduSW5VcmwpO1xuICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5OYXZpZ2F0aW9uKHBhZ2U6IFBhZ2UsIGxhYmVsOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBsYWJlbCwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAke3BhdGgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCkpO1xufVxuXG5mdW5jdGlvbiBhcGlVcmwocGFnZTogUGFnZSwgcGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYXBpQmFzZVVybCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMO1xuICByZXR1cm4gbmV3IFVSTChwYXRoLCBhcGlCYXNlVXJsID8gYXBpQmFzZVVybCA6IHBhZ2UudXJsKCkpLnRvU3RyaW5nKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVSZXF1ZXN0KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiB7IG1ldGhvZD86IHN0cmluZzsgYm9keT86IHVua25vd247IHRpbWVvdXQ/OiBudW1iZXIgfSxcbik6IFByb21pc2U8eyBzdGF0dXM6IG51bWJlcjsgYm9keTogc3RyaW5nIH0+IHtcbiAgcmV0dXJuIHBhZ2UuZXZhbHVhdGUoXG4gICAgYXN5bmMgKHsgdXJsLCBtZXRob2QsIGJvZHksIHRpbWVvdXQgfSkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgIGhlYWRlcnM6XG4gICAgICAgICAgYm9keSA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgICAgOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGJvZHk6IGJvZHkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgICAgICBzaWduYWw6IHRpbWVvdXQgPyBBYm9ydFNpZ25hbC50aW1lb3V0KHRpbWVvdXQpIDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4geyBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cywgYm9keTogYXdhaXQgcmVzcG9uc2UudGV4dCgpIH07XG4gICAgfSxcbiAgICB7XG4gICAgICB1cmw6IGFwaVVybChwYWdlLCBwYXRoKSxcbiAgICAgIG1ldGhvZDogb3B0aW9ucz8ubWV0aG9kID8/IFwiR0VUXCIsXG4gICAgICBib2R5OiBvcHRpb25zPy5ib2R5LFxuICAgICAgdGltZW91dDogb3B0aW9ucz8udGltZW91dCxcbiAgICB9LFxuICApO1xufVxuXG50eXBlIE9yaWdpbkRpYWdub3N0aWMgPSB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICBwaGFzZTogXCJHRVRcIiB8IFwicHJlZmxpZ2h0XCIgfCBcIm11dGF0aW9uXCIgfCBcInJlamVjdGlvblwiO1xuICBzdGF0dXM/OiBudW1iZXI7XG4gIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBlcnJvcj86IHN0cmluZztcbn07XG5jb25zdCByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcblxuZnVuY3Rpb24gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfT1JJR0lOX0RJQUdOT1NUSUNTX1BBVEg7XG59XG5cbmZ1bmN0aW9uIHJlbGV2YW50T3JpZ2luSGVhZGVycyhcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMuZmxhdE1hcCgobmFtZSkgPT5cbiAgICAgIGhlYWRlcnNbbmFtZV0gPyBbW25hbWUsIGhlYWRlcnNbbmFtZV1dXSA6IFtdLFxuICAgICksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKSB7XG4gIGNvbnN0IG91dHB1dFBhdGggPSBvcmlnaW5EaWFnbm9zdGljUGF0aCgpO1xuICBpZiAoIW91dHB1dFBhdGgpIHJldHVybjtcbiAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShcbiAgICBvdXRwdXRQYXRoLFxuICAgIGAke0pTT04uc3RyaW5naWZ5KHsgZGlhZ25vc3RpY3M6IHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MgfSwgbnVsbCwgMil9XFxuYCxcbiAgICBcInV0ZjhcIixcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2U6IFBhZ2UsIG9yaWdpbjogc3RyaW5nKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJEQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCBpcyByZXF1aXJlZCBmb3Igb3JpZ2luIGNoZWNrcy5cIixcbiAgICApO1xuICB9XG4gIGNvbnN0IGhlYWx0aFVybCA9IG5ldyBVUkwoXCIvYXBpL2hlYWx0aHpcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGNvbW1vbkhlYWRlcnMgPSB7IE9yaWdpbjogb3JpZ2luIH07XG5cbiAgY29uc3QgZGlhZ25vc3RpY3M6IE9yaWdpbkRpYWdub3N0aWNbXSA9IFtdO1xuICBjb25zdCBjaGVjayA9IGFzeW5jIChcbiAgICBwaGFzZTogT3JpZ2luRGlhZ25vc3RpY1tcInBoYXNlXCJdLFxuICAgIHJlcXVlc3Q6ICgpID0+IFByb21pc2U8aW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZT4sXG4gICAgYXNzZXJ0aW9uOiAoXG4gICAgICByZXNwb25zZTogaW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZSxcbiAgICApID0+IFByb21pc2U8dm9pZD4sXG4gICkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3QoKTtcbiAgICAgIGRpYWdub3N0aWNzLnB1c2goe1xuICAgICAgICBvcmlnaW4sXG4gICAgICAgIHBoYXNlLFxuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cygpLFxuICAgICAgICBoZWFkZXJzOiByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKSxcbiAgICAgIH0pO1xuICAgICAgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcy5wdXNoKGRpYWdub3N0aWNzLmF0KC0xKSEpO1xuICAgICAgYXdhaXQgYXNzZXJ0aW9uKHJlc3BvbnNlKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgY3VycmVudCA9IGRpYWdub3N0aWNzLmF0KC0xKTtcbiAgICAgIGlmIChjdXJyZW50Py5waGFzZSAhPT0gcGhhc2UpIHtcbiAgICAgICAgZGlhZ25vc3RpY3MucHVzaCh7IG9yaWdpbiwgcGhhc2UgfSk7XG4gICAgICB9XG4gICAgICBkaWFnbm9zdGljcy5hdCgtMSkhLmVycm9yID0gXCJvcmlnaW4gY2hlY2sgZmFpbGVkXCI7XG4gICAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH07XG5cbiAgYXdhaXQgY2hlY2soXG4gICAgXCJHRVRcIixcbiAgICAoKSA9PiBwYWdlLnJlcXVlc3QuZ2V0KGhlYWx0aFVybCwgeyBoZWFkZXJzOiBjb21tb25IZWFkZXJzIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IGNyZWRlbnRpYWxlZCBHRVQgc3RhdHVzYCkudG9CZSgyMDApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgY2hlY2soXG4gICAgXCJwcmVmbGlnaHRcIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LmZldGNoKG11dGF0aW9uVXJsLCB7XG4gICAgICAgIG1ldGhvZDogXCJPUFRJT05TXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAuLi5jb21tb25IZWFkZXJzLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1NZXRob2RcIjogXCJQT1NUXCIsXG4gICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1SZXF1ZXN0LUhlYWRlcnNcIjogXCJjb250ZW50LXR5cGVcIixcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBzdGF0dXNgKS50b0JlKFxuICAgICAgICAyMDQsXG4gICAgICApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgY3JlZGVudGlhbHNgLFxuICAgICAgKS50b0JlKFwidHJ1ZVwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgobWV0aG9kKSA9PiBtZXRob2QudHJpbSgpLnRvVXBwZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBtZXRob2RzYCxcbiAgICAgICkudG9Db250YWluKFwiUE9TVFwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVyc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgoaGVhZGVyKSA9PiBoZWFkZXIudHJpbSgpLnRvTG93ZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBoZWFkZXJzYCxcbiAgICAgICkudG9Db250YWluKFwiY29udGVudC10eXBlXCIpO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwibXV0YXRpb25cIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LnBvc3QobXV0YXRpb25VcmwsIHtcbiAgICAgICAgaGVhZGVyczogeyAuLi5jb21tb25IZWFkZXJzLCBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwib3JpZ2luIGNvbnRyYWN0XCIgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgYCR7b3JpZ2lufSBzdGF0ZS1jaGFuZ2luZyByZXF1ZXN0IG11c3QgcGFzcyBvcmlnaW4gcHJvdGVjdGlvbmAsXG4gICAgICApLm5vdC50b0JlKDQwMyk7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlKG9yaWdpbik7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0pLnRvQmUoXG4gICAgICAgIFwidHJ1ZVwiLFxuICAgICAgKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKVxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IHVwbG9hZFVybCA9IG5ldyBVUkwoXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGxpdmVVcGRhdGVVcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBkaWFnbm9zdGljOiBPcmlnaW5EaWFnbm9zdGljID0ge1xuICAgIG9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgcGhhc2U6IFwicmVqZWN0aW9uXCIsXG4gIH07XG4gIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljKTtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIE9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgfSxcbiAgICAgIGRhdGE6IHsgbWVzc2FnZTogXCJob3N0aWxlIG9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgfSk7XG4gICAgZGlhZ25vc3RpYy5zdGF0dXMgPSByZXNwb25zZS5zdGF0dXMoKTtcbiAgICBkaWFnbm9zdGljLmhlYWRlcnMgPSByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKTtcbiAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KFxuICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlVXBsb2FkID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QodXBsb2FkVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7IE9yaWdpbjogSE9TVElMRV9PUklHSU4gfSxcbiAgICAgIG11bHRpcGFydDoge1xuICAgICAgICBhcmNoaXZlOiB7XG4gICAgICAgICAgbmFtZTogXCJob3N0aWxlLWRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgICAgIG1pbWVUeXBlOiBcImFwcGxpY2F0aW9uL3ppcFwiLFxuICAgICAgICAgIGJ1ZmZlcjogQnVmZmVyLmZyb20oXCJub3QgYW4gYXJjaGl2ZVwiKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVVcGxvYWQuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlVXBsb2FkLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSxcbiAgICApLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIGNvbnN0IGhvc3RpbGVMaXZlVXBkYXRlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QobGl2ZVVwZGF0ZVVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7fSxcbiAgICB9KTtcbiAgICBleHBlY3QoaG9zdGlsZUxpdmVVcGRhdGUuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlTGl2ZVVwZGF0ZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgZGlhZ25vc3RpYy5lcnJvciA9IFwib3JpZ2luIHJlamVjdGlvbiBjaGVjayBmYWlsZWRcIjtcbiAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNzZShib2R5OiBzdHJpbmcpOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4ge1xuICByZXR1cm4gYm9keS5zcGxpdCgvXFxuXFxuKy8pLmZsYXRNYXAoKGNodW5rKSA9PiB7XG4gICAgY29uc3QgZGF0YSA9IGNodW5rXG4gICAgICAuc3BsaXQoXCJcXG5cIilcbiAgICAgIC5maW5kKChsaW5lKSA9PiBsaW5lLnN0YXJ0c1dpdGgoXCJkYXRhOiBcIikpXG4gICAgICA/LnNsaWNlKFwiZGF0YTogXCIubGVuZ3RoKTtcbiAgICBpZiAoIWRhdGEpIHJldHVybiBbXTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKGRhdGEpIGFzIHVua25vd247XG4gICAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiXG4gICAgICAgID8gW3ZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XVxuICAgICAgICA6IFtdO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVKc29uKFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBwYXRoKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSkgYXMgUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGl2ZUFycmF5KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIFtdO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTGl2ZSBjb3JyZWxhdGlvbiByZXF1ZXN0IGZhaWxlZDogJHtwYXRofSAoJHtyZXNwb25zZS5zdGF0dXN9KWAsXG4gICAgKTtcbiAgfVxuICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVPcHRpb25hbFJlY29yZChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkPiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgID8gKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIGFueT4pXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbnRlc3QuZGVzY3JpYmUoXCJFbmdpbmVlcmluZ09TIGRhc2hib2FyZCBicm93c2VyIGpvdXJuZXlcIiwgKCkgPT4ge1xuICB0ZXN0KFwiZXhwb3J0cyBvbmUgcmVkYWN0ZWQgbGl2ZS1wcm92aWRlciBtaXNzaW9uIGNvcnJlbGF0aW9uIHJlcG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICAvLyBUaGUgUGxheXdyaWdodCBkZWFkbGluZSBtdXN0IGxlYXZlIHJvb20gZm9yIHRoZSBwcm92aWRlci1ib3VuZCByZXF1ZXN0XG4gICAgLy8gYW5kIHBvbGxpbmcgbG9vcCB0byBjb25zdW1lIHRoZWlyIGNvbXBsZXRlIGNvbmZpZ3VyZWQgYnVkZ2V0LlxuICAgIHRlc3Quc2V0VGltZW91dChsaXZlVGltZW91dE1zKCkgKyBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMpO1xuICAgIHRlc3Quc2tpcChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiAhPT0gXCIxXCIsXG4gICAgICBcIkxpdmUtcHJvdmlkZXIgcmVsZWFzZSBqb3VybmV5IGlzIG9wdC1pbi5cIixcbiAgICApO1xuICAgIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIGpvdXJuZXkgcmVxdWlyZXMgREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEU9MSBhbmQgYSBkaXNwb3NhYmxlIHByb2plY3QuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBjYW1wYWlnblNjZW5hcmlvID0gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTtcbiAgICBjb25zdCBwcm9qZWN0SWQgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRDtcbiAgICBpZiAoIXByb2plY3RJZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCBpcyByZXF1aXJlZCBmb3IgdGhlIGxpdmUtcHJvdmlkZXIgam91cm5leS5cIixcbiAgICAgICk7XG5cbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIHRpbWVvdXQ6IGxpdmVUaW1lb3V0TXMoKSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgcHJvamVjdElkLFxuICAgICAgICAgbWVzc2FnZTogbGl2ZVByb21wdCgpLFxuICAgICAgICBpZGVtcG90ZW5jeUtleTogYGRhc2hib2FyZC1saXZlLSR7RGF0ZS5ub3coKX1gLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBpZiAoc3RyZWFtUmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHN0cmVhbVJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiBmYWlsZWQgdG8gc3RhcnQgKCR7c3RyZWFtUmVzcG9uc2Uuc3RhdHVzfSkuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IHNzZUV2ZW50cyA9IHBhcnNlU3NlKHN0cmVhbVJlc3BvbnNlLmJvZHkpO1xuICAgIGNvbnN0IHN0YXJ0ZWQgPSBzc2VFdmVudHMuZmluZChcbiAgICAgIChldmVudCkgPT4gZXZlbnQudHlwZSA9PT0gXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICk7XG4gICAgY29uc3QgZXhlY3V0aW9uSWQgPVxuICAgICAgdHlwZW9mIHN0YXJ0ZWQ/LmV4ZWN1dGlvbklkID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gc3RhcnRlZC5leGVjdXRpb25JZFxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBpZiAoIWV4ZWN1dGlvbklkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTGl2ZS1wcm92aWRlciBzdHJlYW0gZGlkIG5vdCBlbWl0IGV4ZWN1dGlvbl9zdGFydGVkLlwiKTtcblxuICAgIGxldCBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyBsaXZlVGltZW91dE1zKCk7XG4gICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xuICAgICAgZXhlY3V0aW9uID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke2V4ZWN1dGlvbklkfWApO1xuICAgICAgaWYgKFxuICAgICAgICBbXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJjYW5jZWxsZWRcIl0uaW5jbHVkZXMoU3RyaW5nKGV4ZWN1dGlvbi5zdGF0dXMpKVxuICAgICAgKVxuICAgICAgICBicmVhaztcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDc1MCkpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICAhW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gZGlkIG5vdCByZWFjaCBhIHRlcm1pbmFsIHN0YXRlIHdpdGhpbiBpdHMgYm91bmQuXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHNlc3Npb25JZCA9IFN0cmluZyhleGVjdXRpb24uc2Vzc2lvbklkKTtcbiAgICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IGxpdmVBcnJheShcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9tZXNzYWdlc2AsXG4gICAgKTtcbiAgICBjb25zdCBldmVudHMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvZXZlbnRzP3Byb2plY3RJZD0ke2VuY29kZVVSSUNvbXBvbmVudChwcm9qZWN0SWQpfSZjb3JyZWxhdGlvbklkPSR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhleGVjdXRpb24ub3BlcmF0aW9uSWQgPz8gXCJcIikpfWAsXG4gICAgKTtcbiAgICBjb25zdCBwcm9wb3NhbCA9IGF3YWl0IGxpdmVPcHRpb25hbFJlY29yZChcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9wZW5kaW5nLXByb3Bvc2FsYCxcbiAgICApO1xuICAgIGNvbnN0IGdpdExvZyA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL3Byb2plY3RzLyR7cHJvamVjdElkfS9naXQvbG9nYCk7XG4gICAgY29uc3QgbWlzc2lvbkNvbnRyb2wgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpO1xuICAgIGNvbnN0IGRhc2hib2FyZFN0YXRlID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2Rhc2hib2FyZFwiKTtcbiAgICBjb25zdCBjaGVja3BvaW50ID1cbiAgICAgIGV4ZWN1dGlvbi5jaGVja3BvaW50ICYmIHR5cGVvZiBleGVjdXRpb24uY2hlY2twb2ludCA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IChleGVjdXRpb24uY2hlY2twb2ludCBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgICAgICA6IHt9O1xuICAgIGNvbnN0IHJlY2VudFN0ZXBzID0gQXJyYXkuaXNBcnJheShjaGVja3BvaW50LnJlY2VudFN0ZXBzKVxuICAgICAgPyBjaGVja3BvaW50LnJlY2VudFN0ZXBzXG4gICAgICA6IFtdO1xuICAgIGNvbnN0IHZhbGlkYXRpb24gPSByZWNlbnRTdGVwcy5maWx0ZXIoXG4gICAgICAoc3RlcCkgPT4gc3RlcD8ua2luZCA9PT0gXCJ2YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBjb25zdCBwcm9qZWN0UmV2aXNpb24gPVxuICAgICAgdHlwZW9mIGV4ZWN1dGlvbi5wcm9qZWN0UmV2aXNpb24gPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUhhc2ggPSB2YWxpZGF0aW9uXG4gICAgICAubWFwKChzdGVwKSA9PiBzdGVwPy52YWxpZGF0aW9uPy5jYW5kaWRhdGVIYXNoID8/IHN0ZXA/LmNhbmRpZGF0ZUhhc2gpXG4gICAgICAuZmluZCgodmFsdWUpOiB2YWx1ZSBpcyBzdHJpbmcgPT4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLmxlbmd0aCA+IDApO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUlkZW50aXR5ID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHkgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHlcbiAgICAgICAgOiBjYW5kaWRhdGVIYXNoXG4gICAgICAgICAgPyBgY2FuZGlkYXRlOiR7Y2FuZGlkYXRlSGFzaH1gXG4gICAgICAgICAgOiBgcmVhZC1vbmx5OiR7cHJvamVjdFJldmlzaW9uID8/IFwidW5rbm93blwifWA7XG4gICAgaWYgKCFwcm9qZWN0UmV2aXNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgbWlzc2lvbiBpcyBtaXNzaW5nIGl0cyBwcm9qZWN0IHJldmlzaW9uLlwiKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOID09PSBcIjFcIiAmJlxuICAgICAgKCFjYW5kaWRhdGVJZGVudGl0eSB8fCAhcHJvamVjdFJldmlzaW9uKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTGl2ZSBjYW1wYWlnbiByZXF1aXJlcyBvcGVyYXRpb24sIHJldmlzaW9uLCBhbmQgY2FuZGlkYXRlIGNvcnJlbGF0aW9uLlwiKTtcbiAgICB9XG4gICAgY29uc3QgZXZpZGVuY2VDb3VudCA9IHJlY2VudFN0ZXBzLnJlZHVjZShcbiAgICAgIChjb3VudCwgc3RlcCkgPT4gY291bnQgKyAoTnVtYmVyKHN0ZXA/LmFjY2VwdGVkRXZpZGVuY2VDb3VudCkgfHwgMCksXG4gICAgICAwLFxuICAgICk7XG4gICAgY29uc3QgdGVybWluYWxTdGF0ZSA9IFN0cmluZyhcbiAgICAgIGV4ZWN1dGlvbi5mbGlnaHRTdGF0ZSA/PyBleGVjdXRpb24uc3RhdHVzLFxuICAgICkudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBzdWNjZXNzU3RhdGVzID0gbmV3IFNldChbXG4gICAgICBcIkNPTVBMRVRFRFwiLFxuICAgICAgXCJSRUFEWV9GT1JfUkVWSUVXXCIsXG4gICAgICBcIkFQUExJRURcIixcbiAgICAgIFwiQ09NTUlUVEVEXCIsXG4gICAgICBcIlBVU0hFRFwiLFxuICAgIF0pO1xuICAgIGlmIChcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8gPT09IFwiZGVsaXZlcnktc3VjY2Vzc1wiICYmXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgIWNhbmRpZGF0ZUhhc2hcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgYSBjYW5kaWRhdGUtYm91bmQgdmFsaWRhdGlvbiBoYXNoLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgZGVsaXZlcnlTdGFnZXMgPSB7XG4gICAgICBhcHBsaWVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkFpQ2hhbmdlc0FwcGxpZWRcIiksXG4gICAgICBjb21taXR0ZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0Q29tbWl0Q3JlYXRlZFwiKSxcbiAgICAgIHB1c2hlZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJHaXRQdXNoZWRcIiksXG4gICAgfTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFPYmplY3QudmFsdWVzKGRlbGl2ZXJ5U3RhZ2VzKS5ldmVyeShCb29sZWFuKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkRlbGl2ZXJ5LXN1Y2Nlc3MgY2FtcGFpZ24gY2Fubm90IHBhc3Mgd2l0aG91dCBvcGVyYXRpb24tY29ycmVsYXRlZCBhcHBseSwgY29tbWl0LCBhbmQgcHVzaCBldmlkZW5jZS5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAoZXZpZGVuY2VDb3VudCA8IDEgfHwgdmFsaWRhdGlvbi5sZW5ndGggPCAxKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTGl2ZS1wcm92aWRlciBtaXNzaW9uIHJlcG9ydGVkICR7dGVybWluYWxTdGF0ZX0gd2l0aG91dCBhY2NlcHRlZCBldmlkZW5jZSBhbmQgdmFsaWRhdGlvbiBgICtcbiAgICAgICAgICBgKGV2aWRlbmNlPSR7ZXZpZGVuY2VDb3VudH0sIHZhbGlkYXRpb249JHt2YWxpZGF0aW9uLmxlbmd0aH0pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBjYXB0dXJlID0ge1xuICAgICAgcHJvamVjdElkLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgIHdvcmtzcGFjZVJldmlzaW9uOlxuICAgICAgICBnaXRMb2cuY29tbWl0cz8uWzBdPy5zaG9ydEhhc2ggPz9cbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uaGFzaD8uc2xpY2UoMCwgMTIpLFxuICAgICAgcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FuZGlkYXRlSWRlbnRpdHksXG4gICAgICBjYW5kaWRhdGVSZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyxcbiAgICAgIGRlbGl2ZXJ5U3RhZ2VzLFxuICAgICAgY3VycmVudE9wZXJhdGlvbjoge1xuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICByZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsU3RhdGUsXG4gICAgICB9LFxuICAgICAgcmV0YWluZWRSZXN1bHQ6XG4gICAgICAgIHRlcm1pbmFsU3RhdGUgPT09IFwiRkFJTEVEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJCTE9DS0VEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJJTkNPTVBMRVRFXCJcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgICAgICAgbGFiZWw6IFwicmV0YWluZWQgcmVzdWx0IGZyb20gdGhlIGN1cnJlbnQgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBleGVjdXRpb24uaWQsXG4gICAgICAgIHByb2plY3RJZDogZXhlY3V0aW9uLnByb2plY3RJZCxcbiAgICAgICAgc2Vzc2lvbklkOiBleGVjdXRpb24uc2Vzc2lvbklkLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIGZsaWdodFN0YXRlOiBleGVjdXRpb24uZmxpZ2h0U3RhdGUsXG4gICAgICB9LFxuICAgICAgbWVzc2FnZXM6IG1lc3NhZ2VzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSksXG4gICAgICApLFxuICAgICAgc3NlRXZlbnRzOiBzc2VFdmVudHMubWFwKFxuICAgICAgICAoe1xuICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IGV2ZW50RXhlY3V0aW9uLFxuICAgICAgICAgIHNlc3Npb25JZDogZXZlbnRTZXNzaW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgICAgY29kZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIGNoZWNrcG9pbnRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzZXF1ZW5jZTogY2hlY2twb2ludC5zZXF1ZW5jZSxcbiAgICAgICAgICBzdGFnZTogY2hlY2twb2ludC5zdGFnZSxcbiAgICAgICAgICB1cGRhdGVkQXQ6IGNoZWNrcG9pbnQudXBkYXRlZEF0LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGV2aWRlbmNlQ291bnQsXG4gICAgICBwcm9wb3NhbHM6IHByb3Bvc2FsXG4gICAgICAgID8gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogcHJvcG9zYWwuaWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9wb3NhbC5yZXZpc2lvbixcbiAgICAgICAgICAgICAgc3RhdHVzOiBwcm9wb3NhbC5zdGF0dXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF1cbiAgICAgICAgOiBbXSxcbiAgICAgIHZhbGlkYXRpb246IHZhbGlkYXRpb24ubWFwKChzdGVwKSA9PiAoe1xuICAgICAgICBzdGF0dXM6IHN0ZXAudmFsaWRhdGlvbj8uc3RhdHVzID8/IHN0ZXAuc3RhdHVzLFxuICAgICAgICBwcm9maWxlOiBzdGVwLnZhbGlkYXRpb24/LnByb2ZpbGUgPz8gc3RlcC52YWxpZGF0aW9uUHJvZmlsZSxcbiAgICAgIH0pKSxcbiAgICAgIGV2ZW50czogZXZlbnRzLm1hcCgoeyB0eXBlLCBzZXZlcml0eSwgY29ycmVsYXRpb25JZCB9KSA9PiAoe1xuICAgICAgICB0eXBlLFxuICAgICAgICBzZXZlcml0eSxcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIH0pKSxcbiAgICAgIGRhc2hib2FyZDogbWlzc2lvbkNvbnRyb2wsXG4gICAgICBkYXNoYm9hcmRTdGF0ZToge1xuICAgICAgICBwcm9qZWN0Q291bnQ6IGRhc2hib2FyZFN0YXRlLnByb2plY3RDb3VudCxcbiAgICAgICAgYWN0aXZlVGFza0NvdW50OiBkYXNoYm9hcmRTdGF0ZS5hY3RpdmVUYXNrQ291bnQsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgb3V0cHV0UGF0aCA9XG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUkVQT1JUX1BBVEggPz9cbiAgICAgIFwidGVzdC1yZXN1bHRzL2Rhc2hib2FyZC1qb3VybmV5L2xpdmUtbWlzc2lvbi1jb3JyZWxhdGlvbi5qc29uXCI7XG4gICAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgd3JpdGVGaWxlKFxuICAgICAgb3V0cHV0UGF0aCxcbiAgICAgIGAke0pTT04uc3RyaW5naWZ5KGNhcHR1cmUsIG51bGwsIDIpfVxcbmAsXG4gICAgICBcInV0ZjhcIixcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwic2lnbnMgaW4gYW5kIHRyYXZlcnNlcyB0aGUgYXV0aGVudGljYXRlZCBvcGVyYXRpb25hbCBzaGVsbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGZvciAoY29uc3Qgb3JpZ2luIG9mIGFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucygpKSB7XG4gICAgICBhd2FpdCBleHBlY3RPcmlnaW5DYW5Vc2VBcGkocGFnZSwgb3JpZ2luKTtcbiAgICB9XG4gICAgYXdhaXQgZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkKHBhZ2UpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU2hvd2luZyAx4oCTMSBvZiAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT2xkZXJcIiB9KSkudG9CZURpc2FibGVkKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiUHJvamVjdHNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkV2ZW50IFN0cmVhbVwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiQUkgQXNzaXN0YW50XCIsIGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLm5vdC50b0hhdmVVUkwoL3NpZ24taW4vKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXG4gICAgICAgICAgL0FJIHByb3ZpZGVyIG5vdCBjb25maWd1cmVkfE5vIEFJIGtleSBjb25maWd1cmVkfEFJIEFzc2lzdGFudC9pLFxuICAgICAgICApXG4gICAgICAgIC5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKFxuICAgICAgcGFnZSxcbiAgICAgIFwiTWlzc2lvbiBDb250cm9sXCIsXG4gICAgICBgJHtEQVNIQk9BUkRfUEFUSH1taXNzaW9uLWNvbnRyb2xgLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJObyBkdXJhYmxlIHJ1bnMgaW4gdGhlIGxlZGdlclwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1mbGlnaHQtZGVjaz9leGVjdXRpb25JZD0ke0VYRUNVVElPTl9JRH1gKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChcbiAgICAgICAgYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1mbGlnaHQtZGVja1xcXFw/ZXhlY3V0aW9uSWQ9YCxcbiAgICAgICksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkF1ZGl0IC8gQ2hhdCBydW5cIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUFJPVkVOXCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJjb252ZXJnZXMgdHdvIGJyb3dzZXIgc2Vzc2lvbnMgYWNyb3NzIHJlbG9hZCwgcmVjb25uZWN0LCBzdGFsZSByZXN1bHRzLCBhbmQgQVBJIHJlc3RhcnRcIiwgYXN5bmMgKHtcbiAgICBicm93c2VyLFxuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICB0ZXN0LnNraXAoXG4gICAgICAhcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCxcbiAgICAgIFwiVGhlIG11bHRpLXByb2Nlc3MgY29udmVyZ2VuY2UgY2FtcGFpZ24gcnVucyBvbmx5IHVuZGVyIHRoZSByZWxlYXNlIHJ1bm5lci5cIixcbiAgICApO1xuICAgIHRlc3Quc2V0VGltZW91dCg5MF8wMDApO1xuXG4gICAgY29uc3Qgc2Vjb25kQ29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCgpO1xuICAgIGNvbnN0IHNlY29uZFBhZ2UgPSBhd2FpdCBzZWNvbmRDb250ZXh0Lm5ld1BhZ2UoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW3Byb2dyYW1tYXRpY1NpZ25JbihwYWdlKSwgcHJvZ3JhbW1hdGljU2lnbkluKHNlY29uZFBhZ2UpXSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgIHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCksXG4gICAgICAgIHNlY29uZFBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApLFxuICAgICAgXSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdChzZWNvbmRQYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgICAvLyBBIHJlc3BvbnNlIHRoYXQgYXJyaXZlcyBhZnRlciBhIG5ld2VyIHJlcXVlc3QgbXVzdCBub3QgcmVwbGFjZSB0aGVcbiAgICAgIC8vIHZpc2libGUgcmVhZHkgc3RhdGUgd2l0aCBzdGFsZSBkYXRhLiBLZWVwIHRoZSBkZWxheSBib3VuZGVkIHNvIGFcbiAgICAgIC8vIGh1bmcgcmVxdWVzdCBjYW5ub3QgbWFrZSB0aGlzIGNhbXBhaWduIHBhc3MgaW5kZWZpbml0ZWx5LlxuICAgICAgY29uc3QgY3VycmVudERhc2hib2FyZEZpeHR1cmUgPSB7XG4gICAgICAgIC4uLmRhc2hib2FyZEZpeHR1cmUsXG4gICAgICAgIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICBwcm9qZWN0U2NvcmVzOiBbeyAuLi5kYXNoYm9hcmRGaXh0dXJlLnByb2plY3RTY29yZXNbMF0sIHByb2plY3ROYW1lOiBcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCBzY29yZTogOTcgfV0sXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogMSxcbiAgICAgICAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAxIH0sXG4gICAgICB9O1xuICAgICAgbGV0IHJlZnJlc2hDb3VudCA9IDA7XG4gICAgICBsZXQgcmVsZWFzZVN0YWxlUmVzcG9uc2UhOiAoKSA9PiB2b2lkO1xuICAgICAgY29uc3Qgc3RhbGVSZXNwb25zZVJlbGVhc2VkID0gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UgPSByZXNvbHZlO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICAgICAgcmVmcmVzaENvdW50ICs9IDE7XG4gICAgICAgIGlmIChyZWZyZXNoQ291bnQgPT09IDEpIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShjdXJyZW50RGFzaGJvYXJkRml4dHVyZSkpO1xuICAgICAgICBhd2FpdCBzdGFsZVJlc3BvbnNlUmVsZWFzZWQ7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShkYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHN0YXR1c1wiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJDb25jdXJyZW50IFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjk3XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBjb25zdCBzdGFsZVJlZnJlc2ggPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCBzdGF0dXNcIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVmcmVzaENvdW50KS50b0JlKDIpO1xuICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UoKTtcbiAgICAgIGF3YWl0IHN0YWxlUmVmcmVzaDtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCI5N1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiMVwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICAgIC8vIFNpbXVsYXRlIGEgZHJvcHBlZCBjb25uZWN0aW9uIGluIHRoZSBzZWNvbmQgYnJvd3NlciBhbmQgYXNzZXJ0IHRoZVxuICAgICAgLy8gcmVjb3ZlcnkgYWN0aW9uIHJlbmRlcmVkIGJ5IHRoZSBkYXNoYm9hcmQsIHRoZW4gbGV0IHRoZSBuZXh0IHJlcXVlc3RcbiAgICAgIC8vIHJlY29ubmVjdCBub3JtYWxseS5cbiAgICAgIGxldCByZWNvbm5lY3RBdHRlbXB0ID0gMDtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgICAgICByZWNvbm5lY3RBdHRlbXB0ICs9IDE7XG4gICAgICAgIC8vIHVzZUdldERhc2hib2FyZCByZXRyaWVzIG9uY2U7IGhvbGQgYm90aCBib3VuZGVkIGF0dGVtcHRzIHNvIHRoZVxuICAgICAgICAvLyByZW5kZXJlZCBlcnJvciBzdGF0ZSBpcyBvYnNlcnZhYmxlIGJlZm9yZSB0aGUgb3BlcmF0b3IgcmV0cmllcy5cbiAgICAgICAgaWYgKHJlY29ubmVjdEF0dGVtcHQgPD0gMikge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiY29udHJvbGxlZCByZWNvbm5lY3QgaW50ZXJydXB0aW9uXCIgfSwgNTAzKSxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnJlbG9hZCgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS51bnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuXG4gICAgICBhd2FpdCByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbcGFnZS5yZWxvYWQoKSwgc2Vjb25kUGFnZS5yZWxvYWQoKV0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcblxuICAgICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBzZWNvbmRDb250ZXh0LmNsb3NlKCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KFwicHJldmlld3MgYW5kIGRvd25sb2FkcyB0aGUgY29tcGxldGVkIGV4ZWN1dGlvbiBhdWRpdCB3aXRob3V0IGR1cGxpY2F0aW5nIGVmZmVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYXVkaXRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIlBST1ZFTlwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtdLFxuICAgICAgdmFsaWRhdGlvbnM6IFt7IHN0YXR1czogXCJwYXNzZWRcIiwgcHJvZmlsZTogXCJyZWxlYXNlLXNhZmVcIiB9XSxcbiAgICAgIGFmZmVjdGVkRmlsZXM6IFtcInNyYy9mZWF0dXJlLnRzXCJdLFxuICAgICAgcmVkYWN0aW9uOiB7XG4gICAgICAgIGV4Y2x1ZGVkOiBbXG4gICAgICAgICAgXCJwcm92aWRlciBzZWNyZXRzXCIsXG4gICAgICAgICAgXCJyYXcgbW9kZWwgb3V0cHV0XCIsXG4gICAgICAgICAgXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXVkaXRFeHBvcnQ6IHtcbiAgICAgICAgYm9keTogYXVkaXRCb2R5LFxuICAgICAgICBmaWxlbmFtZTogXCJzZXJ2ZXItc3VwcGxpZWQtYXVkaXQtbmFtZS5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBmYWlsRmlyc3RQcmV2aWV3OiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb24gPSB7XG4gICAgICAgIGlkOiBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgfTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiLFxuICAgICAgICBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICApO1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShleGVjdXRpb24pLFxuICAgICAgKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoL2NvbXBsZXRlZC9pKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KEVYRUNVVElPTl9JRCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtb3BlcmF0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KG5ldyBVUkwoYXVkaXRSZXF1ZXN0c1swXSkucGF0aG5hbWUpLnRvQmUoXG4gICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgLFxuICAgICk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2UgYXVkaXQgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVIaWRkZW4oKTtcblxuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwic2VydmVyLXN1cHBsaWVkLWF1ZGl0LW5hbWUuanNvblwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KC9jb21wbGV0ZWQvaSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpLFxuICAgICkudG9CZUhpZGRlbigpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgY2FuY2VsbGVkIGV4ZWN1dGlvbiBhdWRpdCBoYW5kb2ZmIHJlZGFjdGVkIGFuZCB0ZXJtaW5hbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhdWRpdFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGNhbmNlbGxlZEV4ZWN1dGlvbiA9IHtcbiAgICAgIC4uLmV4ZWN1dGlvbkZpeHR1cmUsXG4gICAgICBzdGF0dXM6IFwiY2FuY2VsbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJDQU5DRUxMRURcIixcbiAgICAgIGNoZWNrcG9pbnQ6IHtcbiAgICAgICAgc3RhZ2U6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIGRldGFpbDogXCJFeGVjdXRpb24gY2FuY2VsbGVkIGJlZm9yZSBhbnkgY2hhbmdlcyB3ZXJlIGFwcGxpZWQuXCIsXG4gICAgICB9LFxuICAgICAgdGVybWluYWxSZWFzb246IFwiY2FuY2VsX3JlcXVlc3RlZFwiLFxuICAgICAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgfTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIk5PVF9SRUNPUkRFRFwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtcbiAgICAgICAgeyB0eXBlOiBcImNhbmNlbGxlZFwiLCBkZXRhaWw6IFwiQ2FuY2VsbGF0aW9uIGFjY2VwdGVkIGJ5IHRoZSBzZXJ2ZXIuXCIgfSxcbiAgICAgIF0sXG4gICAgICB2YWxpZGF0aW9uczogW10sXG4gICAgICBhZmZlY3RlZEZpbGVzOiBbXSxcbiAgICAgIHJlZGFjdGlvbjoge1xuICAgICAgICBleGNsdWRlZDogW1xuICAgICAgICAgIFwicHJvdmlkZXIgc2VjcmV0c1wiLFxuICAgICAgICAgIFwicmF3IG1vZGVsIG91dHB1dFwiLFxuICAgICAgICAgIFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGF1ZGl0RXhwb3J0OiB7XG4gICAgICAgIGJvZHk6IGF1ZGl0Qm9keSxcbiAgICAgICAgZmlsZW5hbWU6IFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBleGVjdXRpb246IGNhbmNlbGxlZEV4ZWN1dGlvbixcbiAgICAgICAgbWVzc2FnZU91dGNvbWU6IFwiQ0FOQ0VMTEVEXCIsXG4gICAgICAgIGZhaWxGaXJzdFByZXZpZXc6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHtcbiAgICAgICAgaWQ6IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgbWVzc2FnZTogXCJDYW5jZWxsZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICB9O1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCIsXG4gICAgICAgIFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICk7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbiksXG4gICAgICApO1xuICAgIH0pO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiVGVybWluYWwgcmVhc29uOiBjYW5jZWxfcmVxdWVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNhbmNlbFwiIH0pKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiB9KSkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJBcHByb3ZlICYgYXBwbHlcIiB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IC9jb21taXQgdmVyaWZpZWQgY2hhbmdlcy9pIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogL3B1c2ggY29tbWl0dGVkIGNoYW5nZXMvaSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChFWEVDVVRJT05fSUQpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLW9wZXJhdGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlRlcm1pbmFsIHJlYXNvbjogY2FuY2VsX3JlcXVlc3RlZFwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIGF1ZGl0IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpKS50b0JlSGlkZGVuKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgfSk7XG5cbiAgdGVzdChcInVwbG9hZHMgYW4gYXJjaGl2ZSBhbmQgcmVuZGVycyBhIGxpdmUgdGFzayB1cGRhdGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtbGl2ZS10YXNrXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJMaXZlIHVwZGF0ZSByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXJcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmNoaXZlVXBsb2FkOiB7XG4gICAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgICAgb3JpZ2luYWxOYW1lOiBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgfSxcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIC8vIFRoaXMgaXMgYSB2YWxpZCwgZW1wdHkgWklQIGFyY2hpdmUuIEtlZXBpbmcgaXQgaW5saW5lIG1ha2VzIHRoZSBicm93c2VyXG4gICAgLy8gdGVzdCBzZWxmLWNvbnRhaW5lZCB3aGlsZSBzdGlsbCBleGVyY2lzaW5nIEZvcm1EYXRhIGFuZCBtdWx0aXBhcnQgYnl0ZXMuXG4gICAgY29uc3QgdXBsb2FkUmVzdWx0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAoYXBpQmFzZVVybCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZXMgPSBVaW50OEFycmF5LmZyb20oXG4gICAgICAgIGF0b2IoXCJVRXNGQmdBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PVwiKSxcbiAgICAgICAgKGNoYXJhY3RlcikgPT4gY2hhcmFjdGVyLmNoYXJDb2RlQXQoMCksXG4gICAgICApO1xuICAgICAgY29uc3QgYm9keSA9IG5ldyBGb3JtRGF0YSgpO1xuICAgICAgYm9keS5hcHBlbmQoXG4gICAgICAgIFwiYXJjaGl2ZVwiLFxuICAgICAgICBuZXcgQmxvYihbYnl0ZXNdLCB7IHR5cGU6IFwiYXBwbGljYXRpb24vemlwXCIgfSksXG4gICAgICAgIFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICApO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChcbiAgICAgICAgbmV3IFVSTChcIi9hcGkvdXBsb2FkL2FyY2hpdmVcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKSxcbiAgICAgICAgeyBtZXRob2Q6IFwiUE9TVFwiLCBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsIGJvZHkgfSxcbiAgICAgICk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgYm9keTogKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICB9O1xuICAgIH0sIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMID8/IHBhZ2UudXJsKCkpO1xuICAgIGV4cGVjdCh1cGxvYWRSZXN1bHQuc3RhdHVzKS50b0JlKDIwMSk7XG4gICAgZXhwZWN0KHVwbG9hZFJlc3VsdC5ib2R5KS50b0VxdWFsKHtcbiAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgIG9yaWdpbmFsTmFtZTogXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICB9KTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBjb25zdCB0YXNrUm93ID0gcGFnZS5nZXRCeUxhYmVsKFxuICAgICAgXCJFeHBhbmQgdGFzayBWZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlc1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tSb3cpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgdGFza1Jvdy5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSkpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkxpdmUgdXBkYXRlIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclwiLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZWNvdmVycyBhIGxpdmUgdGFzayB1cGRhdGUgYWZ0ZXIgYSB0ZW1wb3Jhcnkgc3RyZWFtIGZhaWx1cmVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIkF1dGhvcml0YXRpdmUgdXBkYXRlIHJlY2VpdmVkIGFmdGVyIHJlY29ubmVjdFwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY29ubmVjdGluZy1vcGVyYXRpb25cIixcbiAgICAgICAgY2hlY2twb2ludFZlcnNpb246IDMsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgbGl2ZSB0YXNrIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgICAgc3RyZWFtUmVxdWVzdHMsXG4gICAgICAgIGZhaWxGaXJzdFN0cmVhbTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGNvbnN0IHRhc2tSb3cgPSBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGxpdmUgdGFzayB1cGRhdGVzXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrUm93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHRhc2tSb3cuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoLCB7XG4gICAgICAgIG1lc3NhZ2U6IFwidGhlIHRhc2sgbG9nIHN0cmVhbSBzaG91bGQgcmVjb25uZWN0IGV4YWN0bHkgb25jZVwiLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9CZShzdHJlYW1SZXF1ZXN0c1sxXSk7XG4gICAgZXhwZWN0KG5ldyBVUkwoc3RyZWFtUmVxdWVzdHNbMV0pLnBhdGhuYW1lKS50b0JlKFxuICAgICAgYC9hcGkvdGFza3MvJHt0YXNrSWR9L2xvZ3Mvc3RyZWFtYCxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwic2hvd3MgYW4gYWN0aW9uYWJsZSB0ZXJtaW5hbCBzdGF0ZSB3aGVuIGxpdmUgdGFzayByZWNvbm5lY3RzIGFyZSBleGhhdXN0ZWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtZXhoYXVzdGVkLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gXCJlMmUtZXhoYXVzdGVkLW9wZXJhdGlvblwiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtZXhoYXVzdGVkLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIlRoZSBvbmx5IGNvbmZpcm1lZCB0YXNrIHVwZGF0ZVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHsgb3BlcmF0aW9uSWQgfSxcbiAgICB9O1xuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IG5vblN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL3Rhc2tzL1wiKSkgcmV0dXJuO1xuICAgICAgaWYgKCFyZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2xvZ3Mvc3RyZWFtXCIpKSBub25TdHJlYW1SZXF1ZXN0cy5wdXNoKHJlcXVlc3QubWV0aG9kKCkpO1xuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIGV4aGF1c3RlZCBsaXZlIHRhc2sgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgICBpbml0aWFsTG9nczogW2xpdmVMb2ddLFxuICAgICAgICBzdHJlYW1SZXF1ZXN0cyxcbiAgICAgICAgZmFpbFN0cmVhbUF0dGVtcHRzOiA2LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBleGhhdXN0ZWQgbGl2ZSB0YXNrIHVwZGF0ZXNcIikuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlRlbXBvcmFyeSBzdHJlYW0gZmFpbHVyZS5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgsIHtcbiAgICAgICAgbWVzc2FnZTogXCJ0aGUgdGFzayBsb2cgc3RyZWFtIHNob3VsZCBleGhhdXN0IGl0cyBib3VuZGVkIHJlY29ubmVjdCBidWRnZXRcIixcbiAgICAgICAgdGltZW91dDogMzVfMDAwLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDYpO1xuICAgIGNvbnN0IGV4aGF1c3RlZCA9IHBhZ2UuZ2V0QnlSb2xlKFwiYWxlcnRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIkxpdmUgdGFzayB1cGRhdGVzIGNvdWxkIG5vdCByZWNvbm5lY3RcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIlJlY29ubmVjdCBhdHRlbXB0cyBhcmUgZXhoYXVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQob3BlcmF0aW9uSWQpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJ0YXNrIGhhcyBub3QgYmVlbiBtYXJrZWQgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBsaXZlIHVwZGF0ZXNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCB0YXNrIGxvZ3NcIiB9KSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IGxpdmUgdXBkYXRlc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KFwiVGhlIG9ubHkgY29uZmlybWVkIHRhc2sgdXBkYXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCkudG9CZSg3KTtcbiAgICBleHBlY3QobmV3IFNldChzdHJlYW1SZXF1ZXN0cykuc2l6ZSkudG9CZSgxKTtcbiAgICBleHBlY3Qobm9uU3RyZWFtUmVxdWVzdHMpLm5vdC50b0NvbnRhaW4oXCJQT1NUXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwicGFnZXMgYW5kIHJlbG9hZHMgdGhlIGZpbHRlcmVkIGV2ZW50IHN0cmVhbSB3aXRob3V0IGxvc2luZyBpdHMgd2luZG93XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGV2ZW50cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDUxIH0sIChfLCBpbmRleCkgPT4gKHtcbiAgICAgIGlkOiBgZTJlLWV2ZW50LSR7aW5kZXh9YCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgdHlwZTogXCJBdWRpdEV2ZW50XCIsXG4gICAgICBzZXZlcml0eTogaW5kZXggPCAyID8gXCJzdWNjZXNzXCIgOiBcImluZm9cIixcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGluZGV4IDwgMiA/IFwicmVsZWFzZS00MlwiIDogbnVsbCxcbiAgICAgIG1lc3NhZ2U6XG4gICAgICAgIGluZGV4IDwgMiA/IGBGaWx0ZXJlZCByZWxlYXNlIGV2ZW50ICR7aW5kZXh9YCA6IGBPbGRlciBldmVudCAke2luZGV4fWAsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKERhdGUuVVRDKDIwMjYsIDAsIDEsIDAsIDAsIDUxIC0gaW5kZXgpKS50b0lTT1N0cmluZygpLFxuICAgIH0pKTtcbiAgICBjb25zdCBldmVudFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAobmV3IFVSTChyZXF1ZXN0LnVybCgpKS5wYXRobmFtZS5lbmRzV2l0aChcIi9hcGkvZXZlbnRzXCIpKVxuICAgICAgICBldmVudFJlcXVlc3RzLnB1c2gocmVxdWVzdC51cmwoKSk7XG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGV2ZW50cyxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA0OVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDUwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBmaXJzdFJlcXVlc3QgPSBuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISk7XG4gICAgZXhwZWN0KGZpcnN0UmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpLnRvQmUoXCI1MFwiKTtcbiAgICBleHBlY3QoZmlyc3RSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMVwiKTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHBhZ2Uud2FpdEZvclJlcXVlc3QoKHJlcXVlc3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCgpKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICB1cmwucGF0aG5hbWUuZW5kc1dpdGgoXCIvYXBpL2V2ZW50c1wiKSAmJlxuICAgICAgICAgIHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSA9PT0gXCIyXCJcbiAgICAgICAgKTtcbiAgICAgIH0pLFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9sZGVyXCIgfSkuY2xpY2soKSxcbiAgICBdKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQYWdlIDIuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNTBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISkuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIyXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJOZXdlclwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUGFnZSAxLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlQbGFjZWhvbGRlcihcIlNlYXJjaCBsb2dzLi4uXCIpLmZpbGwoXCJGaWx0ZXJlZCByZWxlYXNlXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJUb2dnbGUgZXZlbnQgZmlsdGVyc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5sb2NhdG9yKFwic2VsZWN0XCIpLm50aCgxKS5zZWxlY3RPcHRpb24oXCJzdWNjZXNzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgMVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc2VhcmNoPUZpbHRlcmVkXFwrcmVsZWFzZS8pO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NldmVyaXR5PXN1Y2Nlc3MvKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVBsYWNlaG9sZGVyKFwiU2VhcmNoIGxvZ3MuLi5cIikpLnRvSGF2ZVZhbHVlKFxuICAgICAgXCJGaWx0ZXJlZCByZWxlYXNlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiVG9nZ2xlIGV2ZW50IGZpbHRlcnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJzZWxlY3RcIikubnRoKDEpKS50b0hhdmVWYWx1ZShcInN1Y2Nlc3NcIik7XG4gICAgY29uc3QgZmlsdGVyZWRSZXF1ZXN0ID0gbmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKS50b0JlKFwiNTBcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjFcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwic2VhcmNoXCIpKS50b0JlKFwiRmlsdGVyZWQgcmVsZWFzZVwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKSkudG9CZShcInN1Y2Nlc3NcIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZW5kZXJzIGFuIEFyYWJpYyBzb3VyY2UtYmFja2VkIEFJIGFuc3dlciB3aXRob3V0IGludGVybmFsIGRpYWdub3N0aWNzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBjb25zdCBzZW5kQnV0dG9uID0gY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKTtcbiAgICBhd2FpdCBleHBlY3Qoc2VuZEJ1dHRvbikudG9CZUVuYWJsZWQoKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZVByb21pc2UgPSBwYWdlLndhaXRGb3JSZXNwb25zZSgocmVzcG9uc2UpID0+XG4gICAgICByZXNwb25zZS51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiksXG4gICAgKTtcbiAgICBhd2FpdCBzZW5kQnV0dG9uLmNsaWNrKCk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBzdHJlYW1SZXNwb25zZVByb21pc2U7XG4gICAgZXhwZWN0KHN0cmVhbVJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwMCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLnF1ZXN0aW9uLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFnZW50IGFjdGl2aXR5XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUmVhZGluZyBzb3VyY2VcIiwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuc291cmNlLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoL0JlaGF2aW9yIGV2aWRlbmNlIMK3IDEgZXhjZXJwdC9pKS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dCgncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydCB3aXRoIGFjY2VwdGVkIGV2aWRlbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBmYWlsZWQg4oCUIG9wZXJhdGlvbiBibG9ja2VkXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSBhY3Jvc3MgYnJvd3NlciBiYWNrIGFuZCBmb3J3YXJkIG5hdmlnYXRpb24gd2l0aCBibG9ja2VkIGV2aWRlbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBmYWlsZWQg4oCUIG9wZXJhdGlvbiBibG9ja2VkXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSB3aGVuIHN3aXRjaGluZyBwcm9qZWN0c1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgICAgcHJvamVjdHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0LW9uZVwiLFxuICAgICAgICAgIG5hbWU6IFwiQ2l0YXRpb24gUHJvamVjdCBPbmVcIixcbiAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImFjdGl2ZVwiLFxuICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Byb2plY3Qtb25lXCIsXG4gICAgICAgICAgcXVhbGl0eVNjb3JlOiA5MixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0LXR3b1wiLFxuICAgICAgICAgIG5hbWU6IFwiQ2l0YXRpb24gUHJvamVjdCBUd29cIixcbiAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImFjdGl2ZVwiLFxuICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Byb2plY3QtdHdvXCIsXG4gICAgICAgICAgcXVhbGl0eVNjb3JlOiA4OCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiY29tYm9ib3hcIikuc2VsZWN0T3B0aW9uKFwiZTJlLXByb2plY3QtdHdvXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUNvdW50KFxuICAgICAgMCxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2Jsb2NrZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiY29tYm9ib3hcIikuc2VsZWN0T3B0aW9uKFwiZTJlLXByb2plY3Qtb25lXCIpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgYWNyb3NzIHJlcGVhdGVkIG5hdmlnYXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1hY2NlcHRlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2LPZhNmI2YMg2YXZh9mE2KkgcHJvdmlkZXIg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBjb25zdCBibG9ja2VkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBibG9ja2VkOiB0cnVlLFxuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWJsb2NrZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINin2YTYr9mE2YrZhCDYp9mE2YXYrdis2YjYqCDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogYWNjZXB0ZWQsXG4gICAgICBhbHRlcm5hdGVBaTogYmxvY2tlZCxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlXG4gICAgICAgICAgLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KVxuICAgICAgICAgIC5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICB9O1xuICAgIGNvbnN0IGFzc2VydEJsb2NrZWRDaXRhdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZVxuICAgICAgICAgIC5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YmxvY2tlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgfTtcbiAgICBjb25zdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgICAgL01JU1NJTkdfTElURVJBTF9NQVRDSHxyYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICAgICk7XG4gICAgfTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiUHJvamVjdHNcIiwgYCR7REFTSEJPQVJEX1BBVEh9cHJvamVjdHNgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG4gICAgYXdhaXQgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscygpO1xuXG4gICAgYXdhaXQgcGFnZS5nb0ZvcndhcmQoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfXByb2plY3RzJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiRXZlbnQgU3RyZWFtXCIsIGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QmxvY2tlZENpdGF0aW9uKCk7XG4gICAgYXdhaXQgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscygpO1xuXG4gICAgYXdhaXQgcGFnZS5nb0ZvcndhcmQoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWV2ZW50cyRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QmxvY2tlZENpdGF0aW9uKCk7XG4gICAgYXdhaXQgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscygpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgb25seSB0aGUgc2FmZSBibG9ja2VkIGNpdGF0aW9uIHJlYXNvbiBhZnRlciBjaGF0IHJlbG9hZFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZGlkIG5vdCBjb21wbGV0ZSDigJQgQkxPQ0tFRC9JTkNPTVBMRVRFXCIsIHtcbiAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRvb2wgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVE9PTF9FWEVDVVRJT05fRkFJTEVEXCIpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGZhaWxlZCDigJQgb3BlcmF0aW9uIGJsb2NrZWRcIiwgeyBleGFjdDogdHJ1ZSB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBmYWlsZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBkaWQgbm90IGNvbXBsZXRlIOKAlCBCTE9DS0VEL0lOQ09NUExFVEVcIiwge1xuICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVG9vbCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZmFpbGVkIOKAlCBvcGVyYXRpb24gYmxvY2tlZFwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3IGV4Y2VwdGlvbnxzdGFjayB0cmFjZXxcXC9ob21lXFwvcnVubmVyfHNlY3JldHxmaXh0dXJlIGRpYWdub3N0aWMvaSxcbiAgICApO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogZml4dHVyZS5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBmYWlsZWQg4oCUIG9wZXJhdGlvbiBibG9ja2VkXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCByZWxvYWRlZFRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3JhdyBleGNlcHRpb258c3RhY2sgdHJhY2V8XFwvaG9tZVxcL3J1bm5lcnxzZWNyZXR8Zml4dHVyZSBkaWFnbm9zdGljL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcInByZXNlcnZlcyBvbmUgcGFydGlhbCBhbnN3ZXIgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IGFuZCBtYXJrcyBpdCBpbmNvbXBsZXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGNvbnN0IGFuc3dlciA9IHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhbnN3ZXIpLnRvSGF2ZUNvdW50KDEpO1xuICAgIGF3YWl0IGV4cGVjdChhbnN3ZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiSU5DT01QTEVURTpcIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJwcm92aWRlciBmYWlsdXJlXCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJzdG9wcGVkOiBwcm92aWRlciB0aW1lb3V0XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGZpeHR1cmUucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoXG4gICAgICAxLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZXN1bWVzIGEgZmFpbGVkIGFuYWx5c2lzIGFuZCBrZWVwcyB0aGUgZXhlY3V0aW9uIGluY29tcGxldGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgeyBmaXh0dXJlLCBleGVjdXRpb24gfSA9IGluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogZml4dHVyZSxcbiAgICAgIHJlc3VtZUZhaWx1cmU6IHsgZml4dHVyZSwgZXhlY3V0aW9uIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHNlc3Npb25JZCwgZXhlY3V0aW9uSWQsIHByb2plY3RJZCwgcmVzdW1lVG9rZW4sIG1lc3NhZ2UgfSkgPT4ge1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50XyR7cHJvamVjdElkfWAsXG4gICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICApO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl8ke3Byb2plY3RJZH1fJHtzZXNzaW9uSWR9YCxcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICByZXN1bWVUb2tlbixcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHJlc3VtZVRva2VuOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCIsXG4gICAgICAgIG1lc3NhZ2U6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9LFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVzdW1lUmVxdWVzdCA9IHBhZ2Uud2FpdEZvclJlcXVlc3QoXG4gICAgICAocmVxdWVzdCkgPT5cbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcmVxdWVzdEJvZHkgPSBKU09OLnBhcnNlKFxuICAgICAgKGF3YWl0IHJlc3VtZVJlcXVlc3QpLnBvc3REYXRhKCkgPz8gXCJ7fVwiLFxuICAgICkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZXhwZWN0KHJlcXVlc3RCb2R5KS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBmaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQ6IGZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgIHJlc3VtZVRva2VuOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCIsXG4gICAgICAgIG1lc3NhZ2U6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGYWlsZWQgdG8gc2VuZCBtZXNzYWdlXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQSBzYXZlZCBBSSBleGVjdXRpb24gaXMgcmVhZHkgdG8gcmVzdW1lXCIpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZWNvdmVycyBhIG1pc3NpbmcgdG9rZW4gYWZ0ZXIgYSByZWFsIHN0cmVhbSBhYm9ydCBhbmQgcmVzdW1lcyBvbmUgZXhlY3V0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0gaW5zdGFsbEludGVycnVwdGVkUmVzdW1lRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGludGVycnVwdGVkUmVzdW1lOiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwYWdlLmFkZEluaXRTY3JpcHQoKCkgPT4ge1xuICAgICAgY29uc3QgbmF0aXZlRmV0Y2ggPSB3aW5kb3cuZmV0Y2guYmluZCh3aW5kb3cpO1xuICAgICAgd2luZG93LmZldGNoID0gYXN5bmMgKGlucHV0LCBpbml0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVybCA9XG4gICAgICAgICAgdHlwZW9mIGlucHV0ID09PSBcInN0cmluZ1wiXG4gICAgICAgICAgICA/IGlucHV0XG4gICAgICAgICAgICA6IGlucHV0IGluc3RhbmNlb2YgUmVxdWVzdFxuICAgICAgICAgICAgICA/IGlucHV0LnVybFxuICAgICAgICAgICAgICA6IFN0cmluZyhpbnB1dCk7XG4gICAgICAgIGNvbnN0IGJvZHkgPSB0eXBlb2YgaW5pdD8uYm9keSA9PT0gXCJzdHJpbmdcIiA/IGluaXQuYm9keSA6IFwiXCI7XG4gICAgICAgIGlmIChcbiAgICAgICAgICAhdXJsLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSB8fFxuICAgICAgICAgIGJvZHkuaW5jbHVkZXMoJ1wiZXhlY3V0aW9uSWRcIicpXG4gICAgICAgICkge1xuICAgICAgICAgIHJldHVybiBuYXRpdmVGZXRjaChpbnB1dCwgaW5pdCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IG5hdGl2ZUZldGNoKGlucHV0LCBpbml0KTtcbiAgICAgICAgaWYgKCFyZXNwb25zZS5ib2R5KSByZXR1cm4gcmVzcG9uc2U7XG4gICAgICAgIGNvbnN0IHJlYWRlciA9IHJlc3BvbnNlLmJvZHkuZ2V0UmVhZGVyKCk7XG4gICAgICAgIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKTtcbiAgICAgICAgY29uc3Qgc3RyZWFtID0gbmV3IFJlYWRhYmxlU3RyZWFtKHtcbiAgICAgICAgICBhc3luYyBzdGFydChjb250cm9sbGVyKSB7XG4gICAgICAgICAgICBsZXQgYnVmZmVyZWQgPSBcIlwiO1xuICAgICAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICAgICAgY29uc3QgeyBkb25lLCB2YWx1ZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgICAgICAgICAgaWYgKGRvbmUpIHtcbiAgICAgICAgICAgICAgICBpZiAoYnVmZmVyZWQpIGNvbnRyb2xsZXIuZW5xdWV1ZShlbmNvZGVyLmVuY29kZShidWZmZXJlZCkpO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuY2xvc2UoKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnVmZmVyZWQgKz0gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHZhbHVlLCB7IHN0cmVhbTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgY29uc3QgbWFya2VyID0gYnVmZmVyZWQuaW5kZXhPZignXCJ0eXBlXCI6XCJleGVjdXRpb25fc3RhcnRlZFwiJyk7XG4gICAgICAgICAgICAgIGNvbnN0IGZyYW1lRW5kID1cbiAgICAgICAgICAgICAgICBtYXJrZXIgPCAwID8gLTEgOiBidWZmZXJlZC5pbmRleE9mKFwiXFxuXFxuXCIsIG1hcmtlcik7XG4gICAgICAgICAgICAgIGlmIChmcmFtZUVuZCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKFxuICAgICAgICAgICAgICAgICAgZW5jb2Rlci5lbmNvZGUoYnVmZmVyZWQuc2xpY2UoMCwgZnJhbWVFbmQgKyAyKSksXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVycm9yKG5ldyBUeXBlRXJyb3IoXCJuZXR3b3JrIGNvbm5lY3Rpb24gcmVzZXRcIikpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKHN0cmVhbSwge1xuICAgICAgICAgIHN0YXR1czogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICAgIHN0YXR1c1RleHQ6IHJlc3BvbnNlLnN0YXR1c1RleHQsXG4gICAgICAgICAgaGVhZGVyczogcmVzcG9uc2UuaGVhZGVycyxcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4gPSBbXTtcbiAgICBwYWdlLm9uKFwicmVxdWVzdFwiLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKFxuICAgICAgICByZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSAmJlxuICAgICAgICByZXF1ZXN0Lm1ldGhvZCgpID09PSBcIlBPU1RcIlxuICAgICAgKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMucHVzaChcbiAgICAgICAgICAgIHJlcXVlc3QucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gSWdub3JlIHJlcXVlc3RzIHdpdGhvdXQgYSBKU09OIGJvZHk7IHRoZSBhc3NlcnRpb25zIGJlbG93IHJlcXVpcmVcbiAgICAgICAgICAvLyBib3RoIGpvdXJuZXkgcmVxdWVzdHMgdG8gaGF2ZSBhIHZhbGlkIHJlcXVlc3QgZW52ZWxvcGUuXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIkV4ZWN1dGlvbiBwYXVzZWQg4oCUIHJlYWR5IHRvIHJlc3VtZSBmcm9tIGl0cyBkdXJhYmxlIGNoZWNrcG9pbnRcIixcbiAgICAgICAge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCBzdG9yYWdlS2V5ID1cbiAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtaW50ZXJydXB0ZWQtcmVzdW1lLXNlc3Npb25cIjtcbiAgICBjb25zdCBwb2ludGVyS2V5ID0gXCJlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfZTJlLXByb2plY3RcIjtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHBhZ2UuZXZhbHVhdGUoKGtleSkgPT4gbG9jYWxTdG9yYWdlLmdldEl0ZW0oa2V5KSwgc3RvcmFnZUtleSkpXG4gICAgICAudG9Db250YWluKHJlY292ZXJ5LmluaXRpYWxUb2tlbik7XG5cbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKFxuICAgICAgKHsgc3RvcmFnZUtleSwgcG9pbnRlcktleSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IHNhdmVkID0gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShzdG9yYWdlS2V5KSA/PyBcInt9XCIpO1xuICAgICAgICBkZWxldGUgc2F2ZWQucmVzdW1lVG9rZW47XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKHN0b3JhZ2VLZXksIEpTT04uc3RyaW5naWZ5KHNhdmVkKSk7XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKHBvaW50ZXJLZXksIFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCIpO1xuICAgICAgfSxcbiAgICAgIHsgc3RvcmFnZUtleSwgcG9pbnRlcktleSB9LFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQSBzYXZlZCBBSSBleGVjdXRpb24gaXMgcmVhZHkgdG8gcmVzdW1lXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PlxuICAgICAgICBwYWdlLmV2YWx1YXRlKChrZXkpID0+IHtcbiAgICAgICAgICBjb25zdCBzYXZlZCA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oa2V5KSA/PyBcInt9XCIpO1xuICAgICAgICAgIHJldHVybiBzYXZlZC5yZXN1bWVUb2tlbjtcbiAgICAgICAgfSwgc3RvcmFnZUtleSksXG4gICAgICApXG4gICAgICAudG9CZShyZWNvdmVyeS5yZWNvdmVyZWRUb2tlbik7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQocmVjb3ZlcnkuZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCkudG9CZSgyKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0pLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBtZXNzYWdlOiByZWNvdmVyeS5maXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSksXG4gICAgKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0/LmV4ZWN1dGlvbklkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdPy5zZXNzaW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMV0pLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IHJlY292ZXJ5LmZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogcmVjb3ZlcnkuZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcmVzdW1lVG9rZW46IHJlY292ZXJ5LnJlY292ZXJlZFRva2VuLFxuICAgICAgICBtZXNzYWdlOiByZWNvdmVyeS5maXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSksXG4gICAgKTtcbiAgICBleHBlY3QoXG4gICAgICBzdHJlYW1SZXF1ZXN0cy5tYXAoKHJlcXVlc3QpID0+IHJlcXVlc3QuZXhlY3V0aW9uSWQpLmZpbHRlcihCb29sZWFuKSxcbiAgICApLnRvRXF1YWwoW3JlY292ZXJ5LmZpeHR1cmUuZXhlY3V0aW9uSWRdKTtcbiAgfSk7XG5cbiAgdGVzdChcInByb2plY3RzIGRlbGl2ZXJ5IHJlY292ZXJ5IHN0YXRlcyBzYWZlbHkgYWZ0ZXIgcmVsb2FkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB2YWxpZGF0aW9uIG5lZWRzIHRvIGJlIHJ1biBhZ2Fpbi5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJSZXN1bWUgdmFsaWRhdGlvbiB0byByZS1jaGVjayB0aGUgc2F2ZWQgY2hhbmdlcywgb3IgZGlzY2FyZCB0aGlzIHJlY292ZXJ5IGlmIGl0IGlzIG5vIGxvbmdlciBuZWVkZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBbeyBwcm9maWxlOiBcIndvcmtzcGFjZS10eXBlY2hlY2tcIiwgc3RhdHVzOiBcImZhaWxlZFwiIH1dLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogdHJ1ZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LW1pc3NpbmctcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LW1pc3Npbmctc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJhYmFuZG9uZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcIm1pc3Npbmdfd29ya3NwYWNlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIHNhdmVkIGRlbGl2ZXJ5IHdvcmtzcGFjZSBpcyBubyBsb25nZXIgYXZhaWxhYmxlLCBzbyByZWNvdmVyeSBjYW5ub3QgY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiU3RhcnQgYSBuZXcgZGVsaXZlcnkgZnJvbSB0aGUgY3VycmVudCBwcm9qZWN0IHJhdGhlciB0aGFuIHJldHJ5aW5nIHRoaXMgcmVjb3ZlcnkuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IFwiV29ya3NwYWNlIGV4cGlyZWQgYWZ0ZXIgdGhlIHJ1bm5lciB3YXMgcmVjeWNsZWQuXCIsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBudWxsLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInJlamVjdGVkXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOiBcIk5vIGFjdGlvbiBpcyByZXF1aXJlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogXCJJbnRlcm5hbCBkaWFnbm9zdGljOiBzaG91bGQgbmV2ZXIgYmUgcmVuZGVyZWRcIixcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVnaW9uKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWdpb24uZ2V0QnlUZXh0KFwiUmVjb3ZlcmFibGVcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFwiV29ya3NwYWNlIHVuYXZhaWxhYmxlXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJBbHJlYWR5IGRpc2NhcmRlZFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoZSBzYXZlZCBkZWxpdmVyeSB3b3Jrc3BhY2UgaXMgbm8gbG9uZ2VyIGF2YWlsYWJsZSwgc28gcmVjb3ZlcnkgY2Fubm90IGNvbnRpbnVlLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcbiAgICAgICAgXCJSZXRhaW5lZCByZWFzb246IFdvcmtzcGFjZSBleHBpcmVkIGFmdGVyIHRoZSBydW5uZXIgd2FzIHJlY3ljbGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IGF2YWlsYWJsZSA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGNvbnN0IG1pc3NpbmcgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktbWlzc2luZy1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgY29uc3QgZGlzY2FyZGVkID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZSkudG9IYXZlQXR0cmlidXRlKFxuICAgICAgXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsXG4gICAgICBcInJlY292ZXJhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QobWlzc2luZykudG9IYXZlQXR0cmlidXRlKFxuICAgICAgXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsXG4gICAgICBcIm1pc3Npbmdfd29ya3NwYWNlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwiZGlzY2FyZGVkXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QobWlzc2luZy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRGlzYWJsZWQoKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL1xcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvfFxcL3dvcmtzcGFjZVxcL3xpbnRlcm5hbCBkaWFnbm9zdGljL2ksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRSZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRSZWdpb24pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVsb2FkZWRSZWdpb25cbiAgICAgICAgLmxvY2F0b3IoJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiXScpXG4gICAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSksXG4gICAgKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZFJlZ2lvblxuICAgICAgICAubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1vcGVyYXRpb25cIl0nKVxuICAgICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pLFxuICAgICkudG9CZURpc2FibGVkKCk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICBleHBlY3QocmVjb3ZlcnkucmVxdWVzdHMuZXZlcnkoKHVybCkgPT4gdXJsLmluY2x1ZGVzKFwicHJvamVjdElkPWUyZS1wcm9qZWN0XCIpKSkudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgdGVzdChcImV4cGxhaW5zIHdoZW4gZGVsaXZlcnkgcmVjb3ZlcnkgbG9zZXMgYSByYWNlIGFuZCByZWZyZXNoZXMgc3RhdGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBhY3Rpb25SZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDQ6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHRoZSByZXRhaW5lZCBjaGFuZ2VzIG5lZWQgcmV2aWV3IGJlZm9yZSB2YWxpZGF0aW9uIGNhbiBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJSZXN1bWUgdmFsaWRhdGlvbiB0byByZS1jaGVjayB0aGUgc2F2ZWQgY2hhbmdlcywgb3IgZGlzY2FyZCB0aGlzIHJlY292ZXJ5IGlmIGl0IGlzIG5vIGxvbmdlciBuZWVkZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBbeyBwcm9maWxlOiBcIndvcmtzcGFjZS10eXBlY2hlY2tcIiwgc3RhdHVzOiBcImZhaWxlZFwiIH1dLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogdHJ1ZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZWNvdmVyeUFjdGlvbjoge1xuICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsXCIsXG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIGFzIGNvbnN0LFxuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIGVycm9yOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgIGNvZGU6IFwiREVMSVZFUllfQUxSRUFEWV9ESVNDQVJERURcIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICBuZXh0QWN0aW9uOiBcIk5vIGFjdGlvbiBpcyByZXF1aXJlZC5cIixcbiAgICAgICAgICBkaWFnbm9zdGljOiBcIkRvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsLlwiLFxuICAgICAgICB9LFxuICAgICAgICBuZXh0T3BlcmF0aW9uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXNlc3Npb25cIixcbiAgICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICAgIHN0YXR1czogXCJyZWplY3RlZFwiLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDQ6MDAuMDAwWlwiLFxuICAgICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgICBuZXh0QWN0aW9uOiBcIk5vIGFjdGlvbiBpcyByZXF1aXJlZC5cIixcbiAgICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBudWxsLFxuICAgICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXJ5IHN0YXRlIGNoYW5nZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGlzIHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC4gVGhlIHJlY292ZXJ5IGxpc3Qgd2FzIHJlZnJlc2hlZC5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiByZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpXG4gICAgICAudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uKS50b0hhdmVBdHRyaWJ1dGUoXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsIFwiZGlzY2FyZGVkXCIpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0c1swXSkudG9Db250YWluKFxuICAgICAgXCIvYXBpL2FpL2RlbGl2ZXJ5L2UyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsL3Jlc3VtZS12YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBleHBlY3QoYXdhaXQgcmVnaW9uLmxvY2F0b3IoJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiXScpLmNvdW50KCkpLnRvQmUoMSk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goL0RvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2kpO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwiZXhwbGFpbnMgd2hlbiBhbiBvbGQgcmVjb3ZlcnkgbGluayBwb2ludHMgdG8gYSBkZWxldGVkIG9wZXJhdGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIGFjdGlvblJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNTowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdGhlIHJldGFpbmVkIGNoYW5nZXMgbmVlZCByZXZpZXcgYmVmb3JlIHZhbGlkYXRpb24gY2FuIGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5QWN0aW9uOiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWxcIixcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgIHN0YXR1czogNDA0LFxuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIGVycm9yOiBcIkRlbGl2ZXJ5IG9wZXJhdGlvbiBub3QgZm91bmRcIixcbiAgICAgICAgICBjb2RlOiBcIkRFTElWRVJZX05PVF9GT1VORFwiLFxuICAgICAgICAgIGRpYWdub3N0aWM6IFwiRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWwuXCIsXG4gICAgICAgIH0sXG4gICAgICAgIG5leHRPcGVyYXRpb25zOiBbXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgb3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3ZlcnkgbGluayBleHBpcmVkXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhpcyByZWNvdmVyeSBvcGVyYXRpb24gbm8gbG9uZ2VyIGV4aXN0cy4gVGhlIHJlY292ZXJ5IGxpc3Qgd2FzIHJlZnJlc2hlZC5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHJlZ2lvbi5jb3VudCgpKS50b0JlKDApO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0c1swXSkudG9Db250YWluKFxuICAgICAgXCIvYXBpL2FpL2RlbGl2ZXJ5L2UyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsL3Jlc3VtZS12YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9EZWxpdmVyeSBvcGVyYXRpb24gbm90IGZvdW5kfERvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSByZXN1bWVkIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMzkwLCBoZWlnaHQ6IDg0NCB9KTtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgZXhwZWN0KGNvbXBvc2VyKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGJlZm9yZU9wZW4gPSBhd2FpdCBjb21wb3Nlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChiZWZvcmVPcGVuPy53aWR0aCkudG9CZUdyZWF0ZXJUaGFuKDI1MCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT3BlbiBzZXNzaW9uc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiU2Vzc2lvbnNcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBkcmF3ZXIgPSBwYWdlXG4gICAgICAuZ2V0QnlUZXh0KFwiU2Vzc2lvbnNcIiwgeyBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKTtcbiAgICBjb25zdCBkcmF3ZXJCb3ggPSBhd2FpdCBkcmF3ZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoZHJhd2VyQm94Py53aWR0aCkudG9CZUxlc3NUaGFuT3JFcXVhbCgzOTApO1xuICAgIGNvbnN0IGR1cmluZ09wZW4gPSBhd2FpdCBjb21wb3Nlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChkdXJpbmdPcGVuPy53aWR0aCkudG9CZUdyZWF0ZXJUaGFuKDI1MCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2Ugc2lkZWJhclwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9wZW4gc2Vzc2lvbnNcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZW5kZXJzIGEgdXNlci12aXNpYmxlIEFQSSBmYWlsdXJlIHN0YXRlXCIsIGFzeW5jICh7IHBhZ2UgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIChyb3V0ZSkgPT5cbiAgICAgIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcImNvbnRyb2xsZWQgZGFzaGJvYXJkIG91dGFnZVwiIH0sIDUwMyksXG4gICAgICApLFxuICAgICk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRmFpbGVkIHRvIGxvYWQgZGFzaGJvYXJkXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICB9KTtcbn0pO1xuIl0sIm1hcHBpbmdzIjoiO0FBQUEsU0FBU0EsTUFBTSxFQUFFQyxJQUFJLFFBQW1CLGtCQUFrQjtBQUMxRCxTQUFTQyxLQUFLLEVBQUVDLFNBQVMsUUFBUSxrQkFBa0I7QUFDbkQsU0FBU0MsT0FBTyxRQUFRLFdBQVc7QUFDbkMsU0FDRUMsNkJBQTZCLEVBQzdCQyw0QkFBNEIsRUFDNUJDLDZCQUE2QixRQUN4QiwwQkFBMEI7QUFFakMsTUFBTUMsY0FBYyxHQUFHLGFBQWE7QUFDcEMsTUFBTUMsU0FBUyxHQUFHO0VBQ2hCQyxTQUFTLEVBQUUsZUFBZTtFQUMxQkMsUUFBUSxFQUFF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