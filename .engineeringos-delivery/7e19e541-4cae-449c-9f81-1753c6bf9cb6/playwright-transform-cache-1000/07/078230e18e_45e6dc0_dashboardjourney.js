// b9ffb6957033693bb1f4cd86aff844f3a6d37170
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
    var _ref, _overrides$deliveryRe, _overrides$auditExpor2, _overrides$auditExpor3;
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
    let requestedMessage;
    try {
      requestedMessage = route.request().postDataJSON().message;
    } catch {
      // The default provider-unavailable response handles malformed requests.
    }
    const streamFixture = (_ref = disconnectAi !== null && disconnectAi !== void 0 ? disconnectAi : aiFixtures.find(fixture => typeof requestedMessage === "string" && (requestedMessage === fixture.question || requestedMessage.includes(fixture.question)))) !== null && _ref !== void 0 ? _ref : arabicAi;
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
    expect(visibleText).toContain("NOT PROVEN");
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
    await expect(page.getByText(`${fixture.source}:42`, {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(fixture.source);
    await expect(page.locator("body")).toContainText("Accepted: source span verified.");
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
    await composer.fill(blocked.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(blocked.answer, {
      exact: true
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
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
    const fixture = installToolFailureFixture();
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
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).toContain("Persisted execution proof");
    expect(visibleText).toContain("The required source read did not complete.");
  });
  test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
    page
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    const fixture = installToolFailureFixture();
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
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i);
    await expectNoHorizontalOverflow(page);
  });
  test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
    page
  }) => {
    const fixture = installDisconnectedAiFixture();
    await installApiFixtures(page, {
      disconnectAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    const answer = page.getByText(fixture.answer, {
      exact: true
    });
    await expect(answer.last()).toBeVisible();
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
    }).last()).toBeVisible();
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
    await page.getByLabel("Agent execution proof").getByRole("button", {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiSE9TVElMRV9PUklHSU4iLCJPUklHSU5fRElBR05PU1RJQ19IRUFERVJTIiwiREVGQVVMVF9MSVZFX1BST01QVCIsIkxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TIiwiU2V0IiwibGl2ZUNhbXBhaWduU2NlbmFyaW8iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIyIiwic2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8iLCJ0cmltIiwiREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOIiwiRXJyb3IiLCJoYXMiLCJsaXZlUHJvbXB0IiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSMyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQiLCJsaXZlVGltZW91dE1zIiwiY29uZmlndXJlZCIsIk51bWJlciIsIkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TIiwiaXNGaW5pdGUiLCJhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI0Iiwib3JpZ2lucyIsIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyIsInNwbGl0IiwibWFwIiwib3JpZ2luIiwiZmlsdGVyIiwiQm9vbGVhbiIsImxlbmd0aCIsInBhcnNlZCIsIlVSTCIsInBhdGhuYW1lIiwic2VhcmNoIiwiaGFzaCIsImRhc2hib2FyZEZpeHR1cmUiLCJmcmVzaG5lc3NSZXZpc2lvbiIsInByb2plY3RDb3VudCIsImFjdGl2ZVRhc2tDb3VudCIsImNvbXBsZXRlZFRhc2tDb3VudCIsImZhaWxlZFRhc2tDb3VudCIsInRhc2tTdGF0dXNCcmVha2Rvd24iLCJwZW5kaW5nIiwicnVubmluZyIsInByb2plY3RTY29yZXMiLCJwcm9qZWN0SWQiLCJwcm9qZWN0TmFtZSIsInNjb3JlIiwidHJlbmQiLCJyZWNlbnRFdmVudHMiLCJpZCIsInR5cGUiLCJzZXZlcml0eSIsIm1lc3NhZ2UiLCJ0aW1lc3RhbXAiLCJ0b3BSdWxlcyIsImV4ZWN1dGlvbkZpeHR1cmUiLCJvcGVyYXRpb25JZCIsInN0YXR1cyIsImZsaWdodFN0YXRlIiwiZXZpZGVuY2VWZXJkaWN0IiwicHJvb2ZSZXF1aXJlZCIsInJlc3VtYWJsZSIsImNoZWNrcG9pbnRWZXJzaW9uIiwicHJvamVjdFJldmlzaW9uIiwiY2hlY2twb2ludCIsInN0YWdlIiwiZGV0YWlsIiwib2JqZWN0aXZlIiwic3RhcnRlZEF0IiwiY29tcGxldGVkQXQiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJqc29uUmVzcG9uc2UiLCJib2R5IiwiaGVhZGVycyIsImNvbnRlbnRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93IiwicGFnZSIsIm92ZXJmbG93IiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImRvY3VtZW50RWxlbWVudCIsInNjcm9sbFdpZHRoIiwidmlld3BvcnQiLCJ3aW5kb3ciLCJpbm5lcldpZHRoIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsImV4cGVjdERhc2hib2FyZFJlYWR5IiwiZ2V0QnlSb2xlIiwibmFtZSIsInRvQmVWaXNpYmxlIiwiZ2V0QnlUZXh0IiwiZXhhY3QiLCJyZXN0YXJ0QXBpRm9yQ2FtcGFpZ24iLCJjb250cm9sVXJsIiwiREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCIsInJlc3BvbnNlIiwicmVxdWVzdCIsInBvc3QiLCJ0aW1lb3V0IiwidG9CZSIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX3JlZiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZSIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjIiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IzIiwidXJsIiwicGF0aCIsInJlcGxhY2UiLCJhcmFiaWNBaSIsImFsdGVybmF0ZUFpIiwiZGlzY29ubmVjdEFpIiwiYWlGaXh0dXJlcyIsImZpeHR1cmUiLCJlbmRzV2l0aCIsInNlYXJjaFBhcmFtcyIsImdldCIsInByb2plY3RTZXNzaW9ucyIsImZ1bGZpbGwiLCJzZXNzaW9uSWQiLCJ0aXRsZSIsInF1ZXN0aW9uIiwicmVzdW1lRmFpbHVyZSIsInJlcXVlc3RCb2R5IiwicG9zdERhdGFKU09OIiwiZXhlY3V0aW9uSWQiLCJzdHJlYW1Cb2R5IiwiaW50ZXJydXB0ZWRSZXN1bWUiLCJyZXN1bWVkU3RyZWFtQm9keSIsInJlcXVlc3RlZE1lc3NhZ2UiLCJzdHJlYW1GaXh0dXJlIiwiZmluZCIsImluY2x1ZGVzIiwibWVzc2FnZUZpeHR1cmUiLCJyb2xlIiwiY29udGVudCIsImF1ZGl0RXhwb3J0IiwiX292ZXJyaWRlcyRhdWRpdEV4cG9yIiwib3V0Y29tZSIsIm1lc3NhZ2VPdXRjb21lIiwicmVxdWVzdHMiLCJwdXNoIiwiZmFpbEZpcnN0UHJldmlldyIsImVycm9yIiwiZmlsZW5hbWUiLCJhcmNoaXZlVXBsb2FkIiwiX3JvdXRlJHJlcXVlc3QkaGVhZGVyIiwic3RhcnRzV2l0aCIsInBvc3REYXRhQnVmZmVyIiwiQnVmZmVyIiwiZnJvbSIsInVwbG9hZElkIiwib3JpZ2luYWxOYW1lIiwibGl2ZVRhc2siLCJkZXNjcmlwdGlvbiIsInBoYXNlIiwicmVsYXRlZEZpbGVzIiwicmV0cnlDb3VudCIsIm1heFJldHJpZXMiLCJfb3ZlcnJpZGVzJGxpdmVUYXNrJGkiLCJpbml0aWFsTG9ncyIsInN0cmVhbVJlcXVlc3RzIiwiZmFpbEZpcnN0U3RyZWFtIiwiZmFpbFN0cmVhbUF0dGVtcHRzIiwiYWJvcnQiLCJsb2ciLCJfb3ZlcnJpZGVzJHByb2plY3RzIiwicHJvamVjdHMiLCJsYW5ndWFnZSIsImZyYW1ld29yayIsInJvb3RQYXRoIiwicXVhbGl0eVNjb3JlIiwiZGVsaXZlcnlSZWNvdmVyeSIsIm9wZXJhdGlvbnMiLCJyZWNvdmVyeUFjdGlvbiIsInByb3Bvc2FsSWQiLCJhY3Rpb24iLCJfb3ZlcnJpZGVzJGRlbGl2ZXJ5UmUyIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlMyIsImFjdGlvblJlcXVlc3RzIiwibmV4dE9wZXJhdGlvbnMiLCJfb3ZlcnJpZGVzJGV2ZW50cyIsIl91cmwkc2VhcmNoUGFyYW1zJGdldCIsImV2ZW50cyIsInRvTG93ZXJDYXNlIiwiZmlsdGVyZWRFdmVudHMiLCJldmVudCIsImNvcnJlbGF0aW9uSWQiLCJ2YWx1ZSIsInNvbWUiLCJsaW1pdCIsInNsaWNlIiwidG90YWwiLCJleGVjdXRpb24iLCJyZXN1bWVUb2tlbiIsInJlY292ZXJlZFRva2VuIiwiZXhlY3V0aW9ucyIsImNvbnRpbnVlIiwiaW5zdGFsbEFyYWJpY0FpRml4dHVyZSIsIm9wdGlvbnMiLCJfb3B0aW9ucyRzZXNzaW9uSWQiLCJfb3B0aW9ucyRxdWVzdGlvbiIsIm1lc3NhZ2VJZCIsInNvdXJjZSIsImJsb2NrZWQiLCJhbnN3ZXIiLCJldmlkZW5jZSIsImV4Y2VycHQiLCJzdXBwb3J0c0NsYWltIiwiZXZpZGVuY2VDbGFzcyIsImNpdGF0aW9uU3RhdHVzIiwiY2l0YXRpb25SZWFzb24iLCJzb3VyY2VTcGFuIiwic3RhcnRMaW5lIiwiZW5kTGluZSIsInRvb2xUcmFjZSIsImtpbmQiLCJ0b29sIiwiYXJncyIsImNhY2hlZCIsInByZWZldGNoZWQiLCJjb2RlIiwiY29uc2lzdGVudCIsInZpb2xhdGlvbnMiLCJldmlkZW5jZUZpbGVDb3VudCIsImFjY2VwdGVkRXZpZGVuY2VDb3VudCIsImNvbXBsZXRlZFJlYWRGaWxlcyIsImFjY2VwdGVkRXZpZGVuY2VGaWxlcyIsIm9iamVjdGl2ZVR5cGUiLCJyZXF1aXJlZEVkZ2VzIiwicHJvdmVuRWRnZXMiLCJjb21wbGV0aW9uR2F0ZVJlc3VsdCIsImZpbmFsQW5zd2VyVHlwZSIsInRhc2tSZXN1bHQiLCJjb25maWRlbmNlIiwic291cmNlU2NvcGUiLCJjb3ZlcmFnZSIsInJlcXVlc3RlZEZpZWxkcyIsImFuc3dlcmVkRmllbGRzIiwibWlzc2luZ0ZpZWxkcyIsImNvbXBsZXRlIiwib3BlcmF0aW9uTW9kZSIsInNvdXJjZXMiLCJiZWhhdmlvckV2aWRlbmNlIiwic3NlIiwiZGVsdGEiLCJwZW5kaW5nQ2hhbmdlcyIsImpvaW4iLCJpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlIiwiZGlhZ25vc3RpY0NvZGUiLCJyZXN1bHRLaW5kIiwicmVzdWx0U3VtbWFyeSIsInN0b3BSZWFzb24iLCJpdGVyYXRpb25zIiwibWF4SXRlcmF0aW9ucyIsInRvb2xDYWxscyIsInByZWZldGNoVG9vbENhbGxzIiwibG9vcFRvb2xDYWxscyIsInN5bnRoZXNpc1N0YXJ0ZWQiLCJkaWFnbm9zdGljQ29kZXMiLCJpbnN0YWxsRGlzY29ubmVjdGVkQWlGaXh0dXJlIiwiZGlhZ25vc3RpY0RldGFpbHMiLCJlcnJvckNvZGUiLCJlcnJvck1lc3NhZ2UiLCJpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUiLCJpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlIiwiaW5pdGlhbFRva2VuIiwicGFydGlhbEFuc3dlciIsImNyZWF0ZVJlbGVhc2VTaWduSW5VcmwiLCJzZWNyZXRLZXkiLCJDTEVSS19TRUNSRVRfS0VZIiwiQXV0aG9yaXphdGlvbiIsInVzZXJSZXNwb25zZSIsImVuY29kZVVSSUNvbXBvbmVudCIsInVzZXJJZCIsImpzb24iLCJjcmVhdGVkUmVzcG9uc2UiLCJkYXRhIiwiZW1haWxfYWRkcmVzcyIsImZpcnN0X25hbWUiLCJsYXN0X25hbWUiLCJza2lwX3Bhc3N3b3JkX2NoZWNrcyIsInNraXBfcGFzc3dvcmRfcmVxdWlyZW1lbnQiLCJ0b2tlblJlc3BvbnNlIiwidXNlcl9pZCIsInRva2VuIiwidG9TdHJpbmciLCJwcm9ncmFtbWF0aWNTaWduSW4iLCJfZ2xvYmFsVGhpcyRzaWduSW5DbGUiLCJnb3RvIiwiaGVscGVyIiwiZ2xvYmFsVGhpcyIsInNpZ25JbkNsZXJrVXNlciIsIl9fRU5HSU5FRVJJTkdPU19TSUdOX0lOX0NMRVJLX1VTRVJfXyIsIlJVTl9DT05UUk9MTEVEX1JFTEVBU0VfVkFMSURBVElPTiIsInRvSGF2ZVVSTCIsIlJlZ0V4cCIsInJlcGxhY2VBbGwiLCJzaWduSW5VcmwiLCJ0dGwiLCJiYXNlUGF0aCIsIm9wZW5OYXZpZ2F0aW9uIiwibGFiZWwiLCJjbGljayIsImFwaVVybCIsImFwaUJhc2VVcmwiLCJEQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCIsImxpdmVSZXF1ZXN0IiwiX29wdGlvbnMkbWV0aG9kIiwibWV0aG9kIiwiZmV0Y2giLCJjcmVkZW50aWFscyIsInVuZGVmaW5lZCIsInNpZ25hbCIsIkFib3J0U2lnbmFsIiwidGV4dCIsInJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MiLCJvcmlnaW5EaWFnbm9zdGljUGF0aCIsIkRBU0hCT0FSRF9FMkVfT1JJR0lOX0RJQUdOT1NUSUNTX1BBVEgiLCJyZWxldmFudE9yaWdpbkhlYWRlcnMiLCJPYmplY3QiLCJmcm9tRW50cmllcyIsImZsYXRNYXAiLCJ3cml0ZU9yaWdpbkRpYWdub3N0aWNzIiwib3V0cHV0UGF0aCIsInJlY3Vyc2l2ZSIsImRpYWdub3N0aWNzIiwiZXhwZWN0T3JpZ2luQ2FuVXNlQXBpIiwiaGVhbHRoVXJsIiwibXV0YXRpb25VcmwiLCJjb21tb25IZWFkZXJzIiwiT3JpZ2luIiwiY2hlY2siLCJhc3NlcnRpb24iLCJhdCIsImN1cnJlbnQiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MyIiwidG9VcHBlckNhc2UiLCJ0b0NvbnRhaW4iLCJoZWFkZXIiLCJub3QiLCJleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQiLCJ1cGxvYWRVcmwiLCJsaXZlVXBkYXRlVXJsIiwiZGlhZ25vc3RpYyIsInRvQmVVbmRlZmluZWQiLCJob3N0aWxlVXBsb2FkIiwibXVsdGlwYXJ0IiwiYXJjaGl2ZSIsIm1pbWVUeXBlIiwiYnVmZmVyIiwiaG9zdGlsZUxpdmVVcGRhdGUiLCJwYXJzZVNzZSIsImNodW5rIiwiX2NodW5rJHNwbGl0JGZpbmQiLCJsaW5lIiwicGFyc2UiLCJsaXZlSnNvbiIsImxpdmVBcnJheSIsIkFycmF5IiwiaXNBcnJheSIsImxpdmVPcHRpb25hbFJlY29yZCIsImRlc2NyaWJlIiwiX2V4ZWN1dGlvbiRvcGVyYXRpb25JIiwiX2V4ZWN1dGlvbiRmbGlnaHRTdGF0IiwiX2dpdExvZyRjb21taXRzJDAkc2hvIiwiX2dpdExvZyRjb21taXRzIiwiX2dpdExvZyRjb21taXRzMiIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjUiLCJzZXRUaW1lb3V0Iiwic2tpcCIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiIsIkRBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFIiwiY2FtcGFpZ25TY2VuYXJpbyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEIiwic3RyZWFtUmVzcG9uc2UiLCJpZGVtcG90ZW5jeUtleSIsIkRhdGUiLCJub3ciLCJzc2VFdmVudHMiLCJzdGFydGVkIiwiZGVhZGxpbmUiLCJTdHJpbmciLCJQcm9taXNlIiwicmVzb2x2ZSIsIm1lc3NhZ2VzIiwicHJvcG9zYWwiLCJnaXRMb2ciLCJtaXNzaW9uQ29udHJvbCIsImRhc2hib2FyZFN0YXRlIiwicmVjZW50U3RlcHMiLCJ2YWxpZGF0aW9uIiwic3RlcCIsImNhbmRpZGF0ZUhhc2giLCJfc3RlcCR2YWxpZGF0aW9uJGNhbmQiLCJfc3RlcCR2YWxpZGF0aW9uIiwiY2FuZGlkYXRlSWRlbnRpdHkiLCJldmlkZW5jZUNvdW50IiwicmVkdWNlIiwiY291bnQiLCJ0ZXJtaW5hbFN0YXRlIiwic3VjY2Vzc1N0YXRlcyIsImRlbGl2ZXJ5U3RhZ2VzIiwiYXBwbGllZCIsImNvbW1pdHRlZCIsInB1c2hlZCIsInZhbHVlcyIsImV2ZXJ5IiwiY2FwdHVyZSIsIndvcmtzcGFjZVJldmlzaW9uIiwiY29tbWl0cyIsInNob3J0SGFzaCIsImNhbmRpZGF0ZVJldmlzaW9uIiwiY3VycmVudE9wZXJhdGlvbiIsInJldmlzaW9uIiwicmV0YWluZWRSZXN1bHQiLCJtZXNzYWdlU2Vzc2lvbiIsIm1lc3NhZ2VFeGVjdXRpb24iLCJldmVudEV4ZWN1dGlvbiIsImV2ZW50U2Vzc2lvbiIsImNoZWNrcG9pbnRzIiwic2VxdWVuY2UiLCJwcm9wb3NhbHMiLCJfc3RlcCR2YWxpZGF0aW9uJHN0YXQiLCJfc3RlcCR2YWxpZGF0aW9uMiIsIl9zdGVwJHZhbGlkYXRpb24kcHJvZiIsIl9zdGVwJHZhbGlkYXRpb24zIiwicHJvZmlsZSIsInZhbGlkYXRpb25Qcm9maWxlIiwiZGFzaGJvYXJkIiwiREFTSEJPQVJEX0UyRV9MSVZFX1JFUE9SVF9QQVRIIiwiZmlyc3QiLCJicm93c2VyIiwic2Vjb25kQ29udGV4dCIsIm5ld0NvbnRleHQiLCJzZWNvbmRQYWdlIiwibmV3UGFnZSIsImFsbCIsImxvY2F0b3IiLCJjdXJyZW50RGFzaGJvYXJkRml4dHVyZSIsInJlZnJlc2hDb3VudCIsInJlbGVhc2VTdGFsZVJlc3BvbnNlIiwic3RhbGVSZXNwb25zZVJlbGVhc2VkIiwic3RhbGVSZWZyZXNoIiwicG9sbCIsInJlY29ubmVjdEF0dGVtcHQiLCJyZWxvYWQiLCJ1bnJvdXRlIiwidG9IYXZlQ291bnQiLCJjbG9zZSIsImF1ZGl0UmVxdWVzdHMiLCJhdWRpdEJvZHkiLCJmb3JtYXQiLCJleHBvcnRlZEF0IiwicHJvb2YiLCJyZXF1aXJlZCIsInZlcmRpY3QiLCJ0aW1lbGluZSIsInZhbGlkYXRpb25zIiwiYWZmZWN0ZWRGaWxlcyIsInJlZGFjdGlvbiIsImV4Y2x1ZGVkIiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsImdldEJ5TGFiZWwiLCJ0b0NvbnRhaW5UZXh0IiwicHJldmlldyIsInRvSGF2ZUxlbmd0aCIsInRvQmVIaWRkZW4iLCJkb3dubG9hZFByb21pc2UiLCJ3YWl0Rm9yRXZlbnQiLCJkb3dubG9hZCIsInN1Z2dlc3RlZEZpbGVuYW1lIiwicmVsb2FkZWRQcm9vZiIsImNhbmNlbGxlZEV4ZWN1dGlvbiIsInRlcm1pbmFsUmVhc29uIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSNiIsInRhc2tJZCIsImxpdmVMb2ciLCJsZXZlbCIsInVwbG9hZFJlc3VsdCIsImJ5dGVzIiwiVWludDhBcnJheSIsImF0b2IiLCJjaGFyYWN0ZXIiLCJjaGFyQ29kZUF0IiwiRm9ybURhdGEiLCJhcHBlbmQiLCJCbG9iIiwidG9FcXVhbCIsInRhc2tSb3ciLCJtZXRhZGF0YSIsImFjdGl2aXR5IiwiaGFzVGV4dCIsIm5vblN0cmVhbVJlcXVlc3RzIiwib24iLCJleGhhdXN0ZWQiLCJzaXplIiwiXyIsImluZGV4IiwiVVRDIiwidG9JU09TdHJpbmciLCJldmVudFJlcXVlc3RzIiwiZmlyc3RSZXF1ZXN0Iiwid2FpdEZvclJlcXVlc3QiLCJnZXRCeVBsYWNlaG9sZGVyIiwiZmlsbCIsIm50aCIsInNlbGVjdE9wdGlvbiIsInRvSGF2ZVZhbHVlIiwiZmlsdGVyZWRSZXF1ZXN0IiwiY29tcG9zZXIiLCJzZW5kQnV0dG9uIiwidG9CZUVuYWJsZWQiLCJzdHJlYW1SZXNwb25zZVByb21pc2UiLCJ3YWl0Rm9yUmVzcG9uc2UiLCJsYXN0IiwidmlzaWJsZVRleHQiLCJpbm5lclRleHQiLCJzZXRWaWV3cG9ydFNpemUiLCJ3aWR0aCIsImhlaWdodCIsInRvTWF0Y2giLCJhY2NlcHRlZCIsImFzc2VydEFjY2VwdGVkQ2l0YXRpb24iLCJhc3NlcnRCbG9ja2VkQ2l0YXRpb24iLCJhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzIiwiZ29CYWNrIiwiZ29Gb3J3YXJkIiwiX2F3YWl0JHJlc3VtZVJlcXVlc3QkIiwicmVzdW1lUmVxdWVzdCIsInBvc3REYXRhIiwib2JqZWN0Q29udGFpbmluZyIsIl9zdHJlYW1SZXF1ZXN0cyQiLCJfc3RyZWFtUmVxdWVzdHMkMiIsInJlY292ZXJ5IiwiYWRkSW5pdFNjcmlwdCIsIm5hdGl2ZUZldGNoIiwiYmluZCIsImlucHV0IiwiaW5pdCIsIlJlcXVlc3QiLCJyZWFkZXIiLCJnZXRSZWFkZXIiLCJlbmNvZGVyIiwiVGV4dEVuY29kZXIiLCJzdHJlYW0iLCJSZWFkYWJsZVN0cmVhbSIsInN0YXJ0IiwiY29udHJvbGxlciIsImJ1ZmZlcmVkIiwiZG9uZSIsInJlYWQiLCJlbnF1ZXVlIiwiZW5jb2RlIiwiVGV4dERlY29kZXIiLCJkZWNvZGUiLCJtYXJrZXIiLCJpbmRleE9mIiwiZnJhbWVFbmQiLCJUeXBlRXJyb3IiLCJSZXNwb25zZSIsInN0YXR1c1RleHQiLCJzdG9yYWdlS2V5IiwicG9pbnRlcktleSIsImtleSIsImdldEl0ZW0iLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0iLCJzYXZlZCIsIl9sb2NhbFN0b3JhZ2UkZ2V0SXRlbTIiLCJsaWZlY3ljbGUiLCJyZWNvdmVyeVN0YXRlIiwib3BlcmF0b3JFeHBsYW5hdGlvbiIsIm5leHRBY3Rpb24iLCJjb25mbGljdFJlYXNvbiIsInZhbGlkYXRpb25FdmlkZW5jZSIsIndvcmtzcGFjZUF2YWlsYWJsZSIsImNoYW5nZUNvdW50IiwicmVnaW9uIiwiYXZhaWxhYmxlIiwibWlzc2luZyIsImRpc2NhcmRlZCIsInRvSGF2ZUF0dHJpYnV0ZSIsInRvQmVEaXNhYmxlZCIsInJlbG9hZGVkUmVnaW9uIiwidG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCIsIm9wZXJhdGlvbiIsImJlZm9yZU9wZW4iLCJib3VuZGluZ0JveCIsInRvQmVHcmVhdGVyVGhhbiIsImRyYXdlciIsImRyYXdlckJveCIsImR1cmluZ09wZW4iXSwic291cmNlcyI6WyJkYXNoYm9hcmQuam91cm5leS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleHBlY3QsIHRlc3QsIHR5cGUgUGFnZSB9IGZyb20gXCJAcGxheXdyaWdodC90ZXN0XCI7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQge1xuICBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZSxcbiAgcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZSxcbiAgcGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UsXG59IGZyb20gXCIuLi9zcmMvbGliL2NsZXJrLWhhbmRvZmZcIjtcblxuY29uc3QgREFTSEJPQVJEX1BBVEggPSBcIi9kYXNoYm9hcmQvXCI7XG5jb25zdCBURVNUX1VTRVIgPSB7XG4gIGZpcnN0TmFtZTogXCJFbmdpbmVlcmluZ09TXCIsXG4gIGxhc3ROYW1lOiBcIkRhc2hib2FyZCBTbW9rZVwiLFxuICBlbWFpbDpcbiAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0VNQUlMID8/XG4gICAgXCJlbmdpbmVlcmluZ29zLWRhc2hib2FyZC1zbW9rZUBleGFtcGxlLmNvbVwiLFxufTtcbmNvbnN0IEVYRUNVVElPTl9JRCA9IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCI7XG5jb25zdCBERUZBVUxUX0xJVkVfVElNRU9VVF9NUyA9IDEyMF8wMDA7XG5jb25zdCBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMgPSA1XzAwMDtcbmNvbnN0IEhPU1RJTEVfT1JJR0lOID0gXCJodHRwczovL2F0dGFja2VyLmV4YW1wbGVcIjtcbmNvbnN0IE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMgPSBbXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCIsXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIixcbiAgXCJ2YXJ5XCIsXG5dIGFzIGNvbnN0O1xuY29uc3QgREVGQVVMVF9MSVZFX1BST01QVCA9XG4gIFwiUGVyZm9ybSBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgb2YgdGhpcyBkaXNwb3NhYmxlIHByb2plY3QgdXNpbmcgcmVhZC1vbmx5IHRvb2xzLiBcIiArXG4gIFwiUHJvZHVjZSBhdCBsZWFzdCBvbmUgYWNjZXB0ZWQgZXZpZGVuY2UgaXRlbSBhbmQgb25lIHZhbGlkYXRpb24gY2hlY2twb2ludCwgYW5kIGRvIG5vdCBcIiArXG4gIFwicmVwb3J0IENPTVBMRVRFRCB1bmxlc3MgYm90aCBhcmUgcHJlc2VudC4gUmVwb3J0IG9ubHkgdmVyaWZpZWQgZXZpZGVuY2UuXCI7XG5jb25zdCBMSVZFX0NBTVBBSUdOX1NDRU5BUklPUyA9IG5ldyBTZXQoW1xuICBcInByb3ZpZGVyLW91dGFnZVwiLFxuICBcIm1hbGZvcm1lZC1vdXRwdXRcIixcbiAgXCJkZWxpdmVyeS1zdWNjZXNzXCIsXG5dKTtcblxuZnVuY3Rpb24gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgc2NlbmFyaW8gPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8/LnRyaW0oKTtcbiAgaWYgKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiYgIXNjZW5hcmlvKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJMaXZlIGNhbXBhaWduIHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9TQ0VOQVJJTz1wcm92aWRlci1vdXRhZ2UsIG1hbGZvcm1lZC1vdXRwdXQsIG9yIGRlbGl2ZXJ5LXN1Y2Nlc3MuXCIsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NlbmFyaW8gJiYgIUxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TLmhhcyhzY2VuYXJpbykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxpdmUgY2FtcGFpZ24gc2NlbmFyaW86ICR7c2NlbmFyaW99LmApO1xuICB9XG4gIHJldHVybiBzY2VuYXJpbztcbn1cblxuZnVuY3Rpb24gbGl2ZVByb21wdCgpOiBzdHJpbmcge1xuICBjb25zdCBzY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJwcm92aWRlci1vdXRhZ2VcIikge1xuICAgIHJldHVybiBcIlJ1biBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgYW5kIHJlcG9ydCB0aGUgT3BlblJvdXRlciByYXRlLWxpbWl0L3Byb3ZpZGVyLWV4aGF1c3Rpb24gb3V0YWdlIGFzIGEgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uLiBEbyBub3QgdXNlIHByaW9yIGFuYWx5c2lzIGFzIGEgY3VycmVudCBhbnN3ZXI7IGluY2x1ZGUgdGhlIGN1cnJlbnQgb3BlcmF0aW9uIGFuZCByZXZpc2lvbi5cIjtcbiAgfVxuICBpZiAoc2NlbmFyaW8gPT09IFwibWFsZm9ybWVkLW91dHB1dFwiKSB7XG4gICAgcmV0dXJuIFwiUnVuIGEgYm91bmRlZCBmb3JlbnNpYyBhdWRpdCBhbmQgdHJlYXQgbWFsZm9ybWVkIHByb3ZpZGVyIG91dHB1dCBhcyBmYWlsZWQgb3IgaW5jb21wbGV0ZS4gRG8gbm90IGNsYWltIHN1Y2Nlc3MsIGFwcGx5LCBjb21taXQsIG9yIHB1c2ggd2l0aG91dCBjYW5kaWRhdGUtYm91bmQgZXZpZGVuY2UuXCI7XG4gIH1cbiAgaWYgKHNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIikge1xuICAgIHJldHVybiBcIlJ1biB0aGUgYm91bmRlZCBkZWxpdmVyeSBwcm9vZiBjYW1wYWlnbiBvbiB0aGlzIGRpc3Bvc2FibGUgcHJvamVjdC4gRXhlcmNpc2UgYXBwbHksIGNvbW1pdCwgYW5kIHB1c2ggb25seSB3aGVuIGVhY2ggY3VycmVudCBvcGVyYXRpb24sIHByb2plY3QgcmV2aXNpb24sIGNhbmRpZGF0ZSBpZGVudGl0eSwgYW5kIGNhbmRpZGF0ZS1ib3VuZCBldmlkZW5jZSBtYXRjaC4gUmVwb3J0IGV2ZXJ5IHRlcm1pbmFsIHJlY2VpcHQuXCI7XG4gIH1cbiAgcmV0dXJuIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQgPz8gREVGQVVMVF9MSVZFX1BST01QVDtcbn1cblxuZnVuY3Rpb24gbGl2ZVRpbWVvdXRNcygpOiBudW1iZXIge1xuICBjb25zdCBjb25maWd1cmVkID0gTnVtYmVyKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TKTtcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkKSAmJiBjb25maWd1cmVkID4gMFxuICAgID8gY29uZmlndXJlZFxuICAgIDogREVGQVVMVF9MSVZFX1RJTUVPVVRfTVM7XG59XG5cbmZ1bmN0aW9uIGFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG9yaWdpbnMgPSAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TID8/IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKG9yaWdpbikgPT4gb3JpZ2luLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAob3JpZ2lucy5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyBtdXN0IGNvbnRhaW4gZXZlcnkgYXBwcm92ZWQgZGFzaGJvYXJkIG9yaWdpbi5cIixcbiAgICApO1xuICB9XG4gIHJldHVybiBvcmlnaW5zLm1hcCgob3JpZ2luKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChvcmlnaW4pO1xuICAgIGlmIChcbiAgICAgIHBhcnNlZC5vcmlnaW4gIT09IG9yaWdpbiB8fFxuICAgICAgcGFyc2VkLnBhdGhuYW1lICE9PSBcIi9cIiB8fFxuICAgICAgcGFyc2VkLnNlYXJjaCB8fFxuICAgICAgcGFyc2VkLmhhc2hcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYERhc2hib2FyZCBqb3VybmV5IG9yaWdpbiBtdXN0IGJlIGEgYmFyZSBvcmlnaW46ICR7b3JpZ2lufWAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkLm9yaWdpbjtcbiAgfSk7XG59XG5cbmNvbnN0IGRhc2hib2FyZEZpeHR1cmUgPSB7XG4gIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICBwcm9qZWN0Q291bnQ6IDEsXG4gIGFjdGl2ZVRhc2tDb3VudDogMCxcbiAgY29tcGxldGVkVGFza0NvdW50OiAyLFxuICBmYWlsZWRUYXNrQ291bnQ6IDAsXG4gIHRhc2tTdGF0dXNCcmVha2Rvd246IHsgcGVuZGluZzogMCwgcnVubmluZzogMCB9LFxuICBwcm9qZWN0U2NvcmVzOiBbXG4gICAge1xuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBwcm9qZWN0TmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICBzY29yZTogOTIsXG4gICAgICB0cmVuZDogXCJzdGFibGVcIixcbiAgICB9LFxuICBdLFxuICByZWNlbnRFdmVudHM6IFtcbiAgICB7XG4gICAgICBpZDogXCJlMmUtZXZlbnRcIixcbiAgICAgIHR5cGU6IFwiU21va2VDaGVja1wiLFxuICAgICAgc2V2ZXJpdHk6IFwic3VjY2Vzc1wiLFxuICAgICAgbWVzc2FnZTogXCJEYXNoYm9hcmQgQVBJIGZpeHR1cmUgcmVhZHlcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICB9LFxuICBdLFxuICB0b3BSdWxlczogW10sXG59O1xuXG5jb25zdCBleGVjdXRpb25GaXh0dXJlID0ge1xuICBpZDogRVhFQ1VUSU9OX0lELFxuICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgb3BlcmF0aW9uSWQ6IFwiZTJlLW9wZXJhdGlvblwiLFxuICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gIGZsaWdodFN0YXRlOiBcIkNPTVBMRVRFRFwiLFxuICBldmlkZW5jZVZlcmRpY3Q6IFwiUFJPVkVOXCIsXG4gIHByb29mUmVxdWlyZWQ6IGZhbHNlLFxuICByZXN1bWFibGU6IGZhbHNlLFxuICBjaGVja3BvaW50VmVyc2lvbjogMSxcbiAgcHJvamVjdFJldmlzaW9uOiBcImUyZS1yZXZpc2lvbi00MlwiLFxuICBjaGVja3BvaW50OiB7XG4gICAgc3RhZ2U6IFwiY29tcGxldGVcIixcbiAgICBkZXRhaWw6IFwiQ29udHJvbGxlZCBicm93c2VyIGZpeHR1cmUgY29tcGxldGVkLlwiLFxuICB9LFxuICBvYmplY3RpdmU6IHsgb2JqZWN0aXZlOiBcIlZlcmlmeSB0aGUgZGFzaGJvYXJkIGJyb3dzZXIgam91cm5leVwiIH0sXG4gIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxufTtcblxuZnVuY3Rpb24ganNvblJlc3BvbnNlKFxuICBib2R5OiB1bmtub3duLFxuICBzdGF0dXMgPSAyMDAsXG4gIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuKSB7XG4gIHJldHVybiB7XG4gICAgc3RhdHVzLFxuICAgIGNvbnRlbnRUeXBlOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAuLi4oaGVhZGVycyA/IHsgaGVhZGVycyB9IDoge30pLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IG92ZXJmbG93ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiAoe1xuICAgIGRvY3VtZW50OiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsV2lkdGgsXG4gICAgYm9keTogZG9jdW1lbnQuYm9keS5zY3JvbGxXaWR0aCxcbiAgICB2aWV3cG9ydDogd2luZG93LmlubmVyV2lkdGgsXG4gIH0pKTtcbiAgZXhwZWN0KG92ZXJmbG93LmRvY3VtZW50KS50b0JlTGVzc1RoYW5PckVxdWFsKG92ZXJmbG93LnZpZXdwb3J0ICsgMSk7XG4gIGV4cGVjdChvdmVyZmxvdy5ib2R5KS50b0JlTGVzc1RoYW5PckVxdWFsKG92ZXJmbG93LnZpZXdwb3J0ICsgMSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2U6IFBhZ2UpIHtcbiAgYXdhaXQgZXhwZWN0KFxuICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiU3lzdGVtIE92ZXJ2aWV3XCIgfSksXG4gICkudG9CZVZpc2libGUoKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiU1lTVEVNIE9OTElORVwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZTogUGFnZSkge1xuICBjb25zdCBjb250cm9sVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTDtcbiAgaWYgKCFjb250cm9sVXJsKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXNoYm9hcmQgY2FtcGFpZ24gY29udHJvbCBVUkwgaXMgbWlzc2luZy5cIik7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoYCR7Y29udHJvbFVybH0vcmVzdGFydC1hcGlgLCB7XG4gICAgdGltZW91dDogMTVfMDAwLFxuICB9KTtcbiAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwNCk7XG59XG5cbnR5cGUgQXJhYmljQWlGaXh0dXJlID0ge1xuICBxdWVzdGlvbjogc3RyaW5nO1xuICBhbnN3ZXI6IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG4gIHNlc3Npb25JZDogc3RyaW5nO1xuICBleGVjdXRpb25JZD86IHN0cmluZztcbiAgcHJvamVjdElkPzogc3RyaW5nO1xuICBzdHJlYW1Cb2R5OiBzdHJpbmc7XG4gIG1lc3NhZ2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufTtcblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFwaUZpeHR1cmVzKFxuICBwYWdlOiBQYWdlLFxuICBvdmVycmlkZXM/OiB7XG4gICAgYXJhYmljQWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgYWx0ZXJuYXRlQWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgZGlzY29ubmVjdEFpPzogQXJhYmljQWlGaXh0dXJlO1xuICAgIHJlc3VtZUZhaWx1cmU/OiB7XG4gICAgICBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgICBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIH07XG4gICAgaW50ZXJydXB0ZWRSZXN1bWU/OiB7XG4gICAgICBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgICBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgcmVjb3ZlcmVkVG9rZW46IHN0cmluZztcbiAgICAgIHJlc3VtZWRTdHJlYW1Cb2R5OiBzdHJpbmc7XG4gICAgfTtcbiAgICBkZWxpdmVyeVJlY292ZXJ5Pzoge1xuICAgICAgb3BlcmF0aW9uczogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgcmVxdWVzdHM6IHN0cmluZ1tdO1xuICAgICAgYWN0aW9uUmVxdWVzdHM/OiBzdHJpbmdbXTtcbiAgICAgIHJlY292ZXJ5QWN0aW9uPzoge1xuICAgICAgICBwcm9wb3NhbElkOiBzdHJpbmc7XG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIHwgXCJkaXNjYXJkXCI7XG4gICAgICAgIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgc3RhdHVzPzogbnVtYmVyO1xuICAgICAgICBuZXh0T3BlcmF0aW9ucz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIH07XG4gICAgfTtcbiAgICBwcm9qZWN0cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICBldmVudHM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgYXJjaGl2ZVVwbG9hZD86IHtcbiAgICAgIHVwbG9hZElkOiBzdHJpbmc7XG4gICAgICBvcmlnaW5hbE5hbWU6IHN0cmluZztcbiAgICB9O1xuICAgIGF1ZGl0RXhwb3J0Pzoge1xuICAgICAgYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBmaWxlbmFtZTogc3RyaW5nO1xuICAgICAgcmVxdWVzdHM6IHN0cmluZ1tdO1xuICAgICAgZXhlY3V0aW9uPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBtZXNzYWdlT3V0Y29tZT86IHN0cmluZztcbiAgICAgIGZhaWxGaXJzdFByZXZpZXc/OiBib29sZWFuO1xuICAgIH07XG4gICAgbGl2ZVRhc2s/OiB7XG4gICAgICBpZDogc3RyaW5nO1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIHByb2plY3RJZDogc3RyaW5nO1xuICAgICAgbG9nOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIGluaXRpYWxMb2dzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgc3RyZWFtUmVxdWVzdHM/OiBzdHJpbmdbXTtcbiAgICAgIGZhaWxGaXJzdFN0cmVhbT86IGJvb2xlYW47XG4gICAgICBmYWlsU3RyZWFtQXR0ZW1wdHM/OiBudW1iZXI7XG4gICAgfTtcbiAgfSxcbikge1xuICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpLyoqXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICBjb25zdCBwYXRoID0gdXJsLnBhdGhuYW1lLnJlcGxhY2UoL15cXC9kYXNoYm9hcmQoPz1cXC98JCkvLCBcIlwiKTtcbiAgICBjb25zdCBhcmFiaWNBaSA9IG92ZXJyaWRlcz8uYXJhYmljQWk7XG4gICAgY29uc3QgYWx0ZXJuYXRlQWkgPSBvdmVycmlkZXM/LmFsdGVybmF0ZUFpO1xuICAgIGNvbnN0IGRpc2Nvbm5lY3RBaSA9IG92ZXJyaWRlcz8uZGlzY29ubmVjdEFpO1xuICAgIGNvbnN0IGFpRml4dHVyZXMgPSBbYXJhYmljQWksIGFsdGVybmF0ZUFpLCBkaXNjb25uZWN0QWldLmZpbHRlcihcbiAgICAgIChmaXh0dXJlKTogZml4dHVyZSBpcyBBcmFiaWNBaUZpeHR1cmUgPT4gQm9vbGVhbihmaXh0dXJlKSxcbiAgICApO1xuXG4gICAgaWYgKGFpRml4dHVyZXMubGVuZ3RoID4gMCAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3Nlc3Npb25zXCIpKSB7XG4gICAgICBjb25zdCBwcm9qZWN0SWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInByb2plY3RJZFwiKTtcbiAgICAgIGNvbnN0IHByb2plY3RTZXNzaW9ucyA9IGFpRml4dHVyZXMuZmlsdGVyKFxuICAgICAgICAoZml4dHVyZSkgPT4gIWZpeHR1cmUucHJvamVjdElkIHx8IGZpeHR1cmUucHJvamVjdElkID09PSBwcm9qZWN0SWQsXG4gICAgICApO1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBwcm9qZWN0U2Vzc2lvbnMubWFwKChmaXh0dXJlKSA9PiAoe1xuICAgICAgICAgICAgaWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICAgICAgdGl0bGU6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSkpLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8ucmVzdW1lRmFpbHVyZSAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSkge1xuICAgICAgbGV0IHJlcXVlc3RCb2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVxdWVzdEJvZHkgPSByb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIG5vcm1hbCBwcm92aWRlci1mcmVlIGZhbGxiYWNrIGJlbG93IGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICByZXF1ZXN0Qm9keS5leGVjdXRpb25JZCA9PT0gb3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5leGVjdXRpb25JZFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIGJvZHk6IG92ZXJyaWRlcy5yZXN1bWVGYWlsdXJlLmZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKSB7XG4gICAgICBsZXQgcmVxdWVzdEJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Qm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgbm9ybWFsIHByb3ZpZGVyLWZyZWUgZmFsbGJhY2sgYmVsb3cgaGFuZGxlcyBtYWxmb3JtZWQgcmVxdWVzdHMuXG4gICAgICB9XG4gICAgICBjb25zdCB7IGZpeHR1cmUsIHJlc3VtZWRTdHJlYW1Cb2R5IH0gPSBvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWU7XG4gICAgICBpZiAocmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQgPT09IGZpeHR1cmUuZXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgYm9keTogcmVzdW1lZFN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKCFyZXF1ZXN0Qm9keS5leGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICAvLyBEZWxpYmVyYXRlbHkgc3RvcCBhZnRlciB0aGUgZHVyYWJsZSBleGVjdXRpb24gaWRlbnRpdHkuIFRoZVxuICAgICAgICAgIC8vIGpvdXJuZXkgd3JhcHMgdGhpcyByZXNwb25zZSBpbiBhIGJyb3dzZXItbGV2ZWwgc3RyZWFtIGVycm9yLlxuICAgICAgICAgIGJvZHk6IGZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIGxldCByZXF1ZXN0ZWRNZXNzYWdlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIHJlcXVlc3RlZE1lc3NhZ2UgPSAocm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAubWVzc2FnZSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBUaGUgZGVmYXVsdCBwcm92aWRlci11bmF2YWlsYWJsZSByZXNwb25zZSBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICB9XG4gICAgY29uc3Qgc3RyZWFtRml4dHVyZSA9XG4gICAgICBkaXNjb25uZWN0QWkgPz9cbiAgICAgIGFpRml4dHVyZXMuZmluZChcbiAgICAgICAgKGZpeHR1cmUpID0+XG4gICAgICAgICAgdHlwZW9mIHJlcXVlc3RlZE1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiZcbiAgICAgICAgICAocmVxdWVzdGVkTWVzc2FnZSA9PT0gZml4dHVyZS5xdWVzdGlvbiB8fFxuICAgICAgICAgICAgcmVxdWVzdGVkTWVzc2FnZS5pbmNsdWRlcyhmaXh0dXJlLnF1ZXN0aW9uKSksXG4gICAgICApID8/XG4gICAgICBhcmFiaWNBaTtcbiAgICBpZiAoc3RyZWFtRml4dHVyZSAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSlcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICBib2R5OiBzdHJlYW1GaXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICB9KTtcbiAgICBjb25zdCBtZXNzYWdlRml4dHVyZSA9IGFpRml4dHVyZXMuZmluZCgoZml4dHVyZSkgPT5cbiAgICAgIHBhdGguZW5kc1dpdGgoYC9hcGkvYWkvY2hhdC8ke2ZpeHR1cmUuc2Vzc2lvbklkfS9tZXNzYWdlc2ApLFxuICAgICk7XG4gICAgaWYgKG1lc3NhZ2VGaXh0dXJlKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IGAke21lc3NhZ2VGaXh0dXJlLnNlc3Npb25JZH0tdXNlci1tZXNzYWdlYCxcbiAgICAgICAgICAgIHNlc3Npb25JZDogbWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBtZXNzYWdlRml4dHVyZS5xdWVzdGlvbixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIG1lc3NhZ2VGaXh0dXJlLm1lc3NhZ2UsXG4gICAgICAgIF0pLFxuICAgICAgKTtcbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmF1ZGl0RXhwb3J0ICYmXG4gICAgICBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L2UyZS1hdWRpdC1zZXNzaW9uL21lc3NhZ2VzXCIpXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogXCJlMmUtYXVkaXQtdXNlci1tZXNzYWdlXCIsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogXCJlMmUtYXVkaXQtYXNzaXN0YW50LW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgICAgICAgZXhlY3V0aW9uSWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgICAgIG91dGNvbWU6IG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5tZXNzYWdlT3V0Y29tZSA/PyBcIlNVQ0NFRURFRFwiLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0pLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL2Rhc2hib2FyZFwiKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKGRhc2hib2FyZEZpeHR1cmUpKTtcbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmF1ZGl0RXhwb3J0ICYmXG4gICAgICBwYXRoID09PSBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmFpbEZpcnN0UHJldmlldyAmJlxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMubGVuZ3RoID09PSAxXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgeyBlcnJvcjogXCJUZW1wb3JhcnkgcHJldmlldyBuZXR3b3JrIGZhaWx1cmUuXCIgfSxcbiAgICAgICAgICAgIDUwMyxcbiAgICAgICAgICApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXMuYXVkaXRFeHBvcnQuYm9keSwgMjAwLCB7XG4gICAgICAgICAgXCJDb250ZW50LURpc3Bvc2l0aW9uXCI6IGBhdHRhY2htZW50OyBmaWxlbmFtZT1cIiR7b3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LmZpbGVuYW1lfVwiYCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5hcmNoaXZlVXBsb2FkICYmIHBhdGggPT09IFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiKSB7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJvdXRlLnJlcXVlc3QoKS5oZWFkZXJzKClbXCJjb250ZW50LXR5cGVcIl0gPz8gXCJcIjtcbiAgICAgIGlmICghY29udGVudFR5cGUuc3RhcnRzV2l0aChcIm11bHRpcGFydC9mb3JtLWRhdGE7XCIpKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkV4cGVjdGVkIG11bHRpcGFydCBhcmNoaXZlIHVwbG9hZC5cIiB9LCA0MDApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgY29uc3QgYm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUJ1ZmZlcigpO1xuICAgICAgaWYgKCFib2R5Py5pbmNsdWRlcyhCdWZmZXIuZnJvbShcImRhc2hib2FyZC1qb3VybmV5LnppcFwiKSkpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgdGhlIGpvdXJuZXkgYXJjaGl2ZSBwYXlsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVwbG9hZElkOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC51cGxvYWRJZCxcbiAgICAgICAgICAgIG9yaWdpbmFsTmFtZTogb3ZlcnJpZGVzLmFyY2hpdmVVcGxvYWQub3JpZ2luYWxOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgMjAxLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiOiBcInRydWVcIixcbiAgICAgICAgICB9LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiYgcGF0aCA9PT0gXCIvYXBpL3Rhc2tzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBvdmVycmlkZXMubGl2ZVRhc2suaWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICB0aXRsZTogb3ZlcnJpZGVzLmxpdmVUYXNrLnRpdGxlLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQSB0YXNrIHVzZWQgdG8gdmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXMuXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgcGhhc2U6IFwiRXhlY3V0aW9uXCIsXG4gICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMS4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9nc2BcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMubGl2ZVRhc2suaW5pdGlhbExvZ3MgPz8gW10pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5saXZlVGFzayAmJlxuICAgICAgcGF0aCA9PT0gYC9hcGkvdGFza3MvJHtvdmVycmlkZXMubGl2ZVRhc2suaWR9L2xvZ3Mvc3RyZWFtYFxuICAgICkge1xuICAgICAgY29uc3Qgc3RyZWFtUmVxdWVzdHMgPSBvdmVycmlkZXMubGl2ZVRhc2suc3RyZWFtUmVxdWVzdHM7XG4gICAgICBzdHJlYW1SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxGaXJzdFN0cmVhbSAmJiBzdHJlYW1SZXF1ZXN0cz8ubGVuZ3RoID09PSAxKSB8fFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cyAmJlxuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMubGVuZ3RoIDw9IG92ZXJyaWRlcy5saXZlVGFzay5mYWlsU3RyZWFtQXR0ZW1wdHMpXG4gICAgICApIHtcbiAgICAgICAgLy8gRXhlcmNpc2UgdGhlIGJyb3dzZXIncyByZWNvbm5lY3QgcGF0aCB3aXRob3V0IGNoYW5naW5nIHRoZSB0YXNrXG4gICAgICAgIC8vIGxpZmVjeWNsZSBvciBzeW50aGVzaXppbmcgYSBzdWNjZXNzZnVsIHJlc3BvbnNlIGZvciB0aGUgZmlyc3QgdHJ5LlxuICAgICAgICByZXR1cm4gcm91dGUuYWJvcnQoXCJjb25uZWN0aW9ucmVzZXRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiOiBuZXcgVVJMKHBhZ2UudXJsKCkpLm9yaWdpbixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OiBgZXZlbnQ6IGxvZ1xcbmRhdGE6ICR7SlNPTi5zdHJpbmdpZnkob3ZlcnJpZGVzLmxpdmVUYXNrLmxvZyl9XFxuXFxuYCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL3Byb2plY3RzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5wcm9qZWN0cyA/PyBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Ntb2tlXCIsXG4gICAgICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmRlbGl2ZXJ5UmVjb3ZlcnkgJiZcbiAgICAgIHBhdGggPT09IFwiL2FwaS9haS9kZWxpdmVyeS9yZWNvdmVyYWJsZVwiXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZXF1ZXN0cy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgb3BlcmF0aW9uczogb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3Zlcnkub3BlcmF0aW9ucyB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeT8ucmVjb3ZlcnlBY3Rpb24gJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2RlbGl2ZXJ5LyR7b3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucHJvcG9zYWxJZH0vJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5hY3Rpb259YFxuICAgICkge1xuICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHM/LnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIGlmIChvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucykge1xuICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zID1cbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucztcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucmVzcG9uc2UsXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24uc3RhdHVzID8/IDQwOSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZXZlbnRzXCIpIHtcbiAgICAgIGNvbnN0IGV2ZW50cyA9IG92ZXJyaWRlcz8uZXZlbnRzID8/IGRhc2hib2FyZEZpeHR1cmUucmVjZW50RXZlbnRzO1xuICAgICAgY29uc3Qgc2VhcmNoID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFyY2hcIik/LnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBmaWx0ZXJlZEV2ZW50cyA9IGV2ZW50cy5maWx0ZXIoKGV2ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgICBjb25zdCBzZXZlcml0eSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic2V2ZXJpdHlcIik7XG4gICAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImNvcnJlbGF0aW9uSWRcIik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgKCFwcm9qZWN0SWQgfHwgZXZlbnQucHJvamVjdElkID09PSBwcm9qZWN0SWQpICYmXG4gICAgICAgICAgKCFzZXZlcml0eSB8fCBldmVudC5zZXZlcml0eSA9PT0gc2V2ZXJpdHkpICYmXG4gICAgICAgICAgKCFjb3JyZWxhdGlvbklkIHx8IGV2ZW50LmNvcnJlbGF0aW9uSWQgPT09IGNvcnJlbGF0aW9uSWQpICYmXG4gICAgICAgICAgKCFzZWFyY2ggfHxcbiAgICAgICAgICAgIFtldmVudC5tZXNzYWdlLCBldmVudC50eXBlLCBldmVudC5jb3JyZWxhdGlvbklkXVxuICAgICAgICAgICAgICAuZmlsdGVyKCh2YWx1ZSk6IHZhbHVlIGlzIHN0cmluZyA9PiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpXG4gICAgICAgICAgICAgIC5zb21lKCh2YWx1ZSkgPT4gdmFsdWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2gpKSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGltaXQgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkgfHwgNTA7XG4gICAgICBjb25zdCBwYWdlID0gTnVtYmVyKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkgfHwgMTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uoe1xuICAgICAgICAgIGV2ZW50czogZmlsdGVyZWRFdmVudHMuc2xpY2UoKHBhZ2UgLSAxKSAqIGxpbWl0LCBwYWdlICogbGltaXQpLFxuICAgICAgICAgIHRvdGFsOiBmaWx0ZXJlZEV2ZW50cy5sZW5ndGgsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmV4ZWN1dGlvbikpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWR9L3Jlc3VtZS1jYXBhYmlsaXR5YFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICAgIHJlc3VtZVRva2VuOiBvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9YClcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5hdWRpdEV4cG9ydD8uZXhlY3V0aW9uID8/IGV4ZWN1dGlvbkZpeHR1cmUpLFxuICAgICAgKTtcbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIiwgZXhlY3V0aW9uczogW10gfSksXG4gICAgICApO1xuXG4gICAgLy8gQUkgaXMgZGVsaWJlcmF0ZWx5IG5vdCBleGVjdXRlZCBpbiB0aGlzIHNtb2tlIGpvdXJuZXkuIFRoaXMgcmVzcG9uc2VcbiAgICAvLyB2ZXJpZmllcyB0aGUgdXNlci12aXNpYmxlIHVuYXZhaWxhYmxlL2VtcHR5IHN0YXRlIHdpdGhvdXQgYSBwcm92aWRlci5cbiAgICBpZiAocGF0aC5zdGFydHNXaXRoKFwiL2FwaS9haS9cIikpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWRcIiB9LCA0MjgpLFxuICAgICAgKTtcblxuICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFyYWJpY0FpRml4dHVyZShcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9ucz86IHtcbiAgICBibG9ja2VkPzogYm9vbGVhbjtcbiAgICBzZXNzaW9uSWQ/OiBzdHJpbmc7XG4gICAgcXVlc3Rpb24/OiBzdHJpbmc7XG4gICAgcHJvamVjdElkPzogc3RyaW5nO1xuICB9LFxuKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IG9wdGlvbnM/LnNlc3Npb25JZCA/PyBcImUyZS1hcmFiaWMtYWktc2Vzc2lvblwiO1xuICBjb25zdCBtZXNzYWdlSWQgPSBcImUyZS1hcmFiaWMtYWktbWVzc2FnZVwiO1xuICBjb25zdCBzb3VyY2UgPSBcInNyYy9leGVjdXRpb24tdG9vbHMudHNcIjtcbiAgY29uc3QgYmxvY2tlZCA9IG9wdGlvbnM/LmJsb2NrZWQgPT09IHRydWU7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBvcHRpb25zPy5xdWVzdGlvbiA/P1xuICAgIFwi2YXYp9iw2Kcg2YrYrdiv2Ksg2LnZhtivINin2YbYqtmH2KfYoSDZhdmH2YTYqSBwcm92aWRlciB0aW1lb3V0INiv2KfYrtmEIGV4ZWN1dGlvbi10b29scy50c9ifXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCLYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipINmF2LLZiNivINin2YTYsNmD2KfYoSDYp9mE2KfYtdi32YbYp9i52YrYjCDZiti52YrYryDYp9mE2YXYs9in2LEg2KrZgtix2YrYsdmL2Kcg2KzYstim2YrZi9inINmF2YYg2KfZhNij2K/ZhNipINin2YTYqtmKINis2Y/Zhdi52Kog2KjYr9mEINil2LXYr9in2LEgRmluZGluZyDYutmK2LEg2YXYq9io2KouXCI7XG4gIGNvbnN0IGV2aWRlbmNlID0gW1xuICAgIHtcbiAgICAgIHNvdXJjZSxcbiAgICAgIC4uLihibG9ja2VkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgZXhjZXJwdDogXCJwcm92aWRlciB0aW1lb3V0IGlzIGhhbmRsZWQgaGVyZVwiLFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogZmFsc2UsXG4gICAgICAgICAgICBldmlkZW5jZUNsYXNzOiBcIlJFQURfQ09ORklSTUVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJCTE9DS0VEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJNSVNTSU5HX0xJVEVSQUxfTUFUQ0hcIixcbiAgICAgICAgICB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgZXhjZXJwdDogJ3JldHVybiBwYXJ0aWFsRnJvbUNvbGxlY3RlZEV2aWRlbmNlKFwicHJvdmlkZXIgdGltZW91dFwiKTsnLFxuICAgICAgICAgICAgc291cmNlU3BhbjogeyBzdGFydExpbmU6IDQyLCBlbmRMaW5lOiA0MiB9LFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogdHJ1ZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiQkVIQVZJT1JfUFJPVkVOXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJBQ0NFUFRFRFwiLFxuICAgICAgICAgICAgY2l0YXRpb25SZWFzb246IFwiQUNDRVBURURfU09VUkNFX1NQQU5cIixcbiAgICAgICAgICB9KSxcbiAgICB9LFxuICBdO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgdGFza1Jlc3VsdCA9IHtcbiAgICBraW5kOiBcIkJFSEFWSU9SX0FOU1dFUl9SRVNVTFRcIixcbiAgICBhbnN3ZXI6IHtcbiAgICAgIGFuc3dlcixcbiAgICAgIGV2aWRlbmNlLFxuICAgICAgY29uZmlkZW5jZTogMSxcbiAgICAgIHNvdXJjZVNjb3BlOiBbc291cmNlXSxcbiAgICAgIGNvdmVyYWdlOiB7XG4gICAgICAgIHJlcXVlc3RlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgYW5zd2VyZWRGaWVsZHM6IFtcInRpbWVvdXQgYmVoYXZpb3JcIl0sXG4gICAgICAgIG1pc3NpbmdGaWVsZHM6IFtdLFxuICAgICAgICBjb21wbGV0ZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGAke2Fuc3dlcn1cXG5cXG4jIyA2KSBGaW5hbCBKdWRnbWVudFxcbk5PVCBQUk9WRU5gLFxuICAgIG9wZXJhdGlvbk1vZGU6IFwiRk9SRU5TSUNfQVVESVRcIixcbiAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgdGFza1Jlc3VsdCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtZXhlY3V0aW9uXCIsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiYnVpbGRpbmctY29udGV4dFwiIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICAgIGJlaGF2aW9yRXZpZGVuY2U6IGV2aWRlbmNlLFxuICAgICAgdGFza1Jlc3VsdCxcbiAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICB9KSxcbiAgXS5qb2luKFwiXCIpO1xuXG4gIHJldHVybiB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZSxcbiAgICBzZXNzaW9uSWQsXG4gICAgcHJvamVjdElkOiBvcHRpb25zPy5wcm9qZWN0SWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk6IEFyYWJpY0FpRml4dHVyZSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJXaGljaCBzb3VyY2UgZmlsZSBpcyBhdmFpbGFibGUgZm9yIHRoZSByZWxlYXNlIGNoZWNrP1wiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgcmVzdWx0S2luZDogXCJmYWlsZWRcIixcbiAgICAgIGRpYWdub3N0aWNDb2RlLFxuICAgICAgcmVzdWx0U3VtbWFyeTogXCJUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJ0b29sX2ZhaWx1cmVcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAxLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAxLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQ6IFwiZTJlLXRvb2wtZmFpbHVyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtZGlzY29ubmVjdGVkLWFpLXNlc3Npb25cIjtcbiAgY29uc3QgZXhlY3V0aW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktZXhlY3V0aW9uXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBcIldoYXQgaGFwcGVucyB3aGVuIHRoZSBtb2RlbCBkaXNjb25uZWN0cyBhZnRlciBzdGFydGluZyBhbiBhbnN3ZXI/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgbW9kZWwgc3RhcnRlZCBhbiBhbnN3ZXIsIGJ1dCB0aGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiRVhFQ1VUSU9OX1BST1ZJREVSX0ZBSUxVUkVcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJwcm92aWRlcl90aW1lb3V0XCIsXG4gICAgICBpdGVyYXRpb25zOiAxLFxuICAgICAgbWF4SXRlcmF0aW9uczogOCxcbiAgICAgIHRvb2xDYWxsczogMCxcbiAgICAgIHByZWZldGNoVG9vbENhbGxzOiAwLFxuICAgICAgbG9vcFRvb2xDYWxsczogMCxcbiAgICAgIHN5bnRoZXNpc1N0YXJ0ZWQ6IGZhbHNlLFxuICAgICAgZGlhZ25vc3RpY0NvZGVzOiBbZGlhZ25vc3RpY0NvZGVdLFxuICAgICAgZGlhZ25vc3RpY0RldGFpbHM6IFtcbiAgICAgICAgXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIixcbiAgICAgIF0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogXCJlMmUtZGlzY29ubmVjdGVkLWFpLW1lc3NhZ2VcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgZXJyb3JDb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgY29tcGxldGlvbi5cIixcbiAgICBleGVjdXRpb25JZCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIC8vIFRoZSByZWFsIHJvdXRlIGVtaXRzIHRoaXMgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IHNvIHRoZSBjbGllbnRcbiAgICAvLyBkcm9wcyB0aGUgdHJhbnNpZW50IGJ1YmJsZSBiZWZvcmUgcmVuZGVyaW5nIHRoZSBwZXJzaXN0ZWQgcmVzdWx0LlxuICAgIHNzZSh7IHR5cGU6IFwic3RyZWFtX3Jlc2V0XCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInByb3ZpZGVyXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1leGVjdXRpb25cIjtcbiAgY29uc3QgcmVzdW1lVG9rZW4gPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJWZXJpZnkgdGhlIGFuYWx5c2lzIGV2aWRlbmNlIGFmdGVyIHJlY29ubmVjdC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIkFOQUxZU0lTX0lOQ09NUExFVEU6IFRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLCBzbyBubyB2ZXJpZmllZCByZXN1bHQgaXMgYXZhaWxhYmxlLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiVE9PTF9VTkFWQUlMQUJMRVwiO1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgcmVzdW1lVG9rZW4sXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXJyb3JcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgY29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBtZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG4gIGNvbnN0IGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZSA9IHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInNyYy9taXNzaW5nLWFuYWx5c2lzLXRvb2wudHNcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlOiB7XG4gICAgICBpZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW1lc3NhZ2VcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgICBvdXRjb21lOiBcIkZBSUxFRFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgICAgZXJyb3JNZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGV4ZWN1dGlvbjoge1xuICAgICAgaWQ6IGV4ZWN1dGlvbklkLFxuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW9wZXJhdGlvblwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgZmxpZ2h0U3RhdGU6IFwiRkFJTEVEXCIsXG4gICAgICBldmlkZW5jZVZlcmRpY3Q6IFwiSU5DT01QTEVURVwiLFxuICAgICAgcHJvb2ZSZXF1aXJlZDogdHJ1ZSxcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJ0b29sLWV4ZWN1dGlvblwiLFxuICAgICAgICBkZXRhaWw6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIHRvb2wgd2FzIHVuYXZhaWxhYmxlLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBlcnJvcjogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1leGVjdXRpb25cIjtcbiAgY29uc3QgaW5pdGlhbFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtaW5pdGlhbC10b2tlblwiO1xuICBjb25zdCByZWNvdmVyZWRUb2tlbiA9IFwiZTJlLWludGVycnVwdGVkLXJlY292ZXJlZC10b2tlblwiO1xuICBjb25zdCBxdWVzdGlvbiA9IFwiQ29udGludWUgdGhlIGludGVycnVwdGVkIHJlbGVhc2UgZXhlY3V0aW9uLlwiO1xuICBjb25zdCBwYXJ0aWFsQW5zd2VyID1cbiAgICBcIlRoZSByZWxlYXNlIGV4ZWN1dGlvbiBzdGFydGVkIGJlZm9yZSB0aGUgYnJvd3NlciBkaXNjb25uZWN0ZWQuXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgb3JpZ2luYWwgcmVsZWFzZSBleGVjdXRpb24gcmVzdW1lZCBhZnRlciBjYXBhYmlsaXR5IHJlY292ZXJ5LlwiO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICBleGVjdXRpb25JZCxcbiAgICBvdXRjb21lOiBcIkNPTVBMRVRFRFwiLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicmVsZWFzZS1yZXN1bWVcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogaW5pdGlhbFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IHBhcnRpYWxBbnN3ZXIgfSksXG4gICAgXS5qb2luKFwiXCIpLFxuICAgIG1lc3NhZ2UsXG4gIH07XG4gIHJldHVybiB7XG4gICAgZml4dHVyZSxcbiAgICBpbml0aWFsVG9rZW4sXG4gICAgcmVjb3ZlcmVkVG9rZW4sXG4gICAgcmVzdW1lZFN0cmVhbUJvZHk6IFtcbiAgICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdW1lVG9rZW46IHJlY292ZXJlZFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcInJlc3VtaW5nLWNoZWNrcG9pbnRcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgICB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwicGF1c2VkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJQQVVTRURcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIsXG4gICAgICAgIGRldGFpbDpcbiAgICAgICAgICBcIlRoZSBicm93c2VyIHRyYW5zcG9ydCBkaXNjb25uZWN0ZWQgYWZ0ZXIgdGhlIGV4ZWN1dGlvbiBzdGFydGVkLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlUmVsZWFzZVNpZ25JblVybChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IHNlY3JldEtleSA9IHByb2Nlc3MuZW52LkNMRVJLX1NFQ1JFVF9LRVk7XG4gIGlmICghc2VjcmV0S2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJDTEVSS19TRUNSRVRfS0VZIGlzIHJlcXVpcmVkIGZvciB0aGUgcmVsZWFzZS1vbmx5IHByb2dyYW1tYXRpYyBDbGVyayBoYW5kb2ZmLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBoZWFkZXJzID0ge1xuICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtzZWNyZXRLZXl9YCxcbiAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgfTtcbiAgY29uc3QgdXNlclJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LmdldChcbiAgICBgaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3VzZXJzP2VtYWlsX2FkZHJlc3M9JHtlbmNvZGVVUklDb21wb25lbnQoVEVTVF9VU0VSLmVtYWlsKX1gLFxuICAgIHsgaGVhZGVycyB9LFxuICApO1xuICBsZXQgdXNlcklkID0gcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZShhd2FpdCB1c2VyUmVzcG9uc2UuanNvbigpKTtcblxuICBpZiAoIXVzZXJJZCkge1xuICAgIGNvbnN0IGNyZWF0ZWRSZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnNcIixcbiAgICAgIHtcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGVtYWlsX2FkZHJlc3M6IFtURVNUX1VTRVIuZW1haWxdLFxuICAgICAgICAgIGZpcnN0X25hbWU6IFRFU1RfVVNFUi5maXJzdE5hbWUsXG4gICAgICAgICAgbGFzdF9uYW1lOiBURVNUX1VTRVIubGFzdE5hbWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9jaGVja3M6IHRydWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9yZXF1aXJlbWVudDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB1c2VySWQgPSBwYXJzZUNyZWF0ZWRDbGVya1VzZXJSZXNwb25zZShhd2FpdCBjcmVhdGVkUmVzcG9uc2UuanNvbigpKTtcbiAgfVxuXG4gIGlmICghdXNlcklkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJUaGUgaXNvbGF0ZWQgQ2xlcmsgcmVsZWFzZSB1c2VyIGNvdWxkIG5vdCBiZSBwcm92aXNpb25lZC5cIixcbiAgICApO1xuICB9XG5cbiAgY29uc3QgdG9rZW5SZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgIFwiaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3NpZ25faW5fdG9rZW5zXCIsXG4gICAgeyBoZWFkZXJzLCBkYXRhOiB7IHVzZXJfaWQ6IHVzZXJJZCB9IH0sXG4gICk7XG4gIGNvbnN0IHRva2VuID0gcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UoYXdhaXQgdG9rZW5SZXNwb25zZS5qc29uKCkpO1xuXG4gIHJldHVybiBgJHtuZXcgVVJMKERBU0hCT0FSRF9QQVRILCBwYWdlLnVybCgpKS50b1N0cmluZygpfXNpZ24taW4/X19jbGVya190aWNrZXQ9JHtlbmNvZGVVUklDb21wb25lbnQodG9rZW4pfWA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByb2dyYW1tYXRpY1NpZ25JbihwYWdlOiBQYWdlKSB7XG4gIGF3YWl0IHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gIGF3YWl0IGV4cGVjdChcbiAgICBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBcIlNpZ24gSW5cIiwgZXhhY3Q6IHRydWUgfSksXG4gICkudG9CZVZpc2libGUoKTtcblxuICBjb25zdCBoZWxwZXIgPVxuICAgIGdsb2JhbFRoaXMuc2lnbkluQ2xlcmtVc2VyID8/XG4gICAgZ2xvYmFsVGhpcy5fX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX187XG4gIGlmICghaGVscGVyKSB7XG4gICAgaWYgKHByb2Nlc3MuZW52LlJVTl9DT05UUk9MTEVEX1JFTEVBU0VfVkFMSURBVElPTiAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJDbGVyayBicm93c2VyIGhlbHBlciBpcyB1bmF2YWlsYWJsZS4gUnVuIHRoaXMgam91cm5leSBpbiB0aGUgUmVwbGl0IGJyb3dzZXIgcnVubmVyLCB3aGljaCBpbmplY3RzIHNpZ25JbkNsZXJrVXNlci5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGF3YWl0IHBhZ2UuZ290byhhd2FpdCBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2UpKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfSRgKSxcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzaWduSW5VcmwgPSBhd2FpdCBoZWxwZXIoe1xuICAgIC4uLlRFU1RfVVNFUixcbiAgICB0dGw6IDkwMCxcbiAgICBiYXNlUGF0aDogREFTSEJPQVJEX1BBVEgsXG4gIH0pO1xuICBhd2FpdCBwYWdlLmdvdG8oc2lnbkluVXJsKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuTmF2aWdhdGlvbihwYWdlOiBQYWdlLCBsYWJlbDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpIHtcbiAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJsaW5rXCIsIHsgbmFtZTogbGFiZWwsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKCk7XG4gIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgJHtwYXRoLnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApKTtcbn1cblxuZnVuY3Rpb24gYXBpVXJsKHBhZ2U6IFBhZ2UsIHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgcmV0dXJuIG5ldyBVUkwocGF0aCwgYXBpQmFzZVVybCA/IGFwaUJhc2VVcmwgOiBwYWdlLnVybCgpKS50b1N0cmluZygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlUmVxdWVzdChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuICBvcHRpb25zPzogeyBtZXRob2Q/OiBzdHJpbmc7IGJvZHk/OiB1bmtub3duOyB0aW1lb3V0PzogbnVtYmVyIH0sXG4pOiBQcm9taXNlPHsgc3RhdHVzOiBudW1iZXI7IGJvZHk6IHN0cmluZyB9PiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKFxuICAgIGFzeW5jICh7IHVybCwgbWV0aG9kLCBib2R5LCB0aW1lb3V0IH0pID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOlxuICAgICAgICAgIGJvZHkgPT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICAgIDogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBib2R5OiBib2R5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgICAgICAgc2lnbmFsOiB0aW1lb3V0ID8gQWJvcnRTaWduYWwudGltZW91dCh0aW1lb3V0KSA6IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsIGJvZHk6IGF3YWl0IHJlc3BvbnNlLnRleHQoKSB9O1xuICAgIH0sXG4gICAge1xuICAgICAgdXJsOiBhcGlVcmwocGFnZSwgcGF0aCksXG4gICAgICBtZXRob2Q6IG9wdGlvbnM/Lm1ldGhvZCA/PyBcIkdFVFwiLFxuICAgICAgYm9keTogb3B0aW9ucz8uYm9keSxcbiAgICAgIHRpbWVvdXQ6IG9wdGlvbnM/LnRpbWVvdXQsXG4gICAgfSxcbiAgKTtcbn1cblxudHlwZSBPcmlnaW5EaWFnbm9zdGljID0ge1xuICBvcmlnaW46IHN0cmluZztcbiAgcGhhc2U6IFwiR0VUXCIgfCBcInByZWZsaWdodFwiIHwgXCJtdXRhdGlvblwiIHwgXCJyZWplY3Rpb25cIjtcbiAgc3RhdHVzPzogbnVtYmVyO1xuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgZXJyb3I/OiBzdHJpbmc7XG59O1xuY29uc3QgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljczogT3JpZ2luRGlhZ25vc3RpY1tdID0gW107XG5cbmZ1bmN0aW9uIG9yaWdpbkRpYWdub3N0aWNQYXRoKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIO1xufVxuXG5mdW5jdGlvbiByZWxldmFudE9yaWdpbkhlYWRlcnMoXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTLmZsYXRNYXAoKG5hbWUpID0+XG4gICAgICBoZWFkZXJzW25hbWVdID8gW1tuYW1lLCBoZWFkZXJzW25hbWVdXV0gOiBbXSxcbiAgICApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCkge1xuICBjb25zdCBvdXRwdXRQYXRoID0gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTtcbiAgaWYgKCFvdXRwdXRQYXRoKSByZXR1cm47XG4gIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICBhd2FpdCB3cml0ZUZpbGUoXG4gICAgb3V0cHV0UGF0aCxcbiAgICBgJHtKU09OLnN0cmluZ2lmeSh7IGRpYWdub3N0aWNzOiByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIH0sIG51bGwsIDIpfVxcbmAsXG4gICAgXCJ1dGY4XCIsXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE9yaWdpbkNhblVzZUFwaShwYWdlOiBQYWdlLCBvcmlnaW46IHN0cmluZykge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgfVxuICBjb25zdCBoZWFsdGhVcmwgPSBuZXcgVVJMKFwiL2FwaS9oZWFsdGh6XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBjb21tb25IZWFkZXJzID0geyBPcmlnaW46IG9yaWdpbiB9O1xuXG4gIGNvbnN0IGRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcbiAgY29uc3QgY2hlY2sgPSBhc3luYyAoXG4gICAgcGhhc2U6IE9yaWdpbkRpYWdub3N0aWNbXCJwaGFzZVwiXSxcbiAgICByZXF1ZXN0OiAoKSA9PiBQcm9taXNlPGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2U+LFxuICAgIGFzc2VydGlvbjogKFxuICAgICAgcmVzcG9uc2U6IGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2UsXG4gICAgKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0KCk7XG4gICAgICBkaWFnbm9zdGljcy5wdXNoKHtcbiAgICAgICAgb3JpZ2luLFxuICAgICAgICBwaGFzZSxcbiAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgaGVhZGVyczogcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSksXG4gICAgICB9KTtcbiAgICAgIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljcy5hdCgtMSkhKTtcbiAgICAgIGF3YWl0IGFzc2VydGlvbihyZXNwb25zZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBkaWFnbm9zdGljcy5hdCgtMSk7XG4gICAgICBpZiAoY3VycmVudD8ucGhhc2UgIT09IHBoYXNlKSB7XG4gICAgICAgIGRpYWdub3N0aWNzLnB1c2goeyBvcmlnaW4sIHBoYXNlIH0pO1xuICAgICAgfVxuICAgICAgZGlhZ25vc3RpY3MuYXQoLTEpIS5lcnJvciA9IFwib3JpZ2luIGNoZWNrIGZhaWxlZFwiO1xuICAgICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9O1xuXG4gIGF3YWl0IGNoZWNrKFxuICAgIFwiR0VUXCIsXG4gICAgKCkgPT4gcGFnZS5yZXF1ZXN0LmdldChoZWFsdGhVcmwsIHsgaGVhZGVyczogY29tbW9uSGVhZGVycyB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBjcmVkZW50aWFsZWQgR0VUIHN0YXR1c2ApLnRvQmUoMjAwKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSkudG9CZShcbiAgICAgICAgXCJ0cnVlXCIsXG4gICAgICApO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwicHJlZmxpZ2h0XCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5mZXRjaChtdXRhdGlvblVybCwge1xuICAgICAgICBtZXRob2Q6IFwiT1BUSU9OU1wiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgLi4uY29tbW9uSGVhZGVycyxcbiAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLVJlcXVlc3QtTWV0aG9kXCI6IFwiUE9TVFwiLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1IZWFkZXJzXCI6IFwiY29udGVudC10eXBlXCIsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgc3RhdHVzYCkudG9CZShcbiAgICAgICAgMjA0LFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgICAgIGAke29yaWdpbn0gbXV0YXRpb24gcHJlZmxpZ2h0IGNyZWRlbnRpYWxzYCxcbiAgICAgICkudG9CZShcInRydWVcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKG1ldGhvZCkgPT4gbWV0aG9kLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgbWV0aG9kc2AsXG4gICAgICApLnRvQ29udGFpbihcIlBPU1RcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKGhlYWRlcikgPT4gaGVhZGVyLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgaGVhZGVyc2AsXG4gICAgICApLnRvQ29udGFpbihcImNvbnRlbnQtdHlwZVwiKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCBjaGVjayhcbiAgICBcIm11dGF0aW9uXCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICAgIGhlYWRlcnM6IHsgLi4uY29tbW9uSGVhZGVycywgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgZGF0YTogeyBtZXNzYWdlOiBcIm9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2Uuc3RhdHVzKCksXG4gICAgICAgIGAke29yaWdpbn0gc3RhdGUtY2hhbmdpbmcgcmVxdWVzdCBtdXN0IHBhc3Mgb3JpZ2luIHByb3RlY3Rpb25gLFxuICAgICAgKS5ub3QudG9CZSg0MDMpO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQocGFnZTogUGFnZSkge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybClcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIGlzIHJlcXVpcmVkIGZvciBvcmlnaW4gY2hlY2tzLlwiLFxuICAgICk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCB1cGxvYWRVcmwgPSBuZXcgVVJMKFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBsaXZlVXBkYXRlVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgZGlhZ25vc3RpYzogT3JpZ2luRGlhZ25vc3RpYyA9IHtcbiAgICBvcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgIHBoYXNlOiBcInJlamVjdGlvblwiLFxuICB9O1xuICByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzLnB1c2goZGlhZ25vc3RpYyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChtdXRhdGlvblVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwiaG9zdGlsZSBvcmlnaW4gY29udHJhY3RcIiB9LFxuICAgIH0pO1xuICAgIGRpYWdub3N0aWMuc3RhdHVzID0gcmVzcG9uc2Uuc3RhdHVzKCk7XG4gICAgZGlhZ25vc3RpYy5oZWFkZXJzID0gcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChcbiAgICAgIHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgY29uc3QgaG9zdGlsZVVwbG9hZCA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KHVwbG9hZFVybCwge1xuICAgICAgaGVhZGVyczogeyBPcmlnaW46IEhPU1RJTEVfT1JJR0lOIH0sXG4gICAgICBtdWx0aXBhcnQ6IHtcbiAgICAgICAgYXJjaGl2ZToge1xuICAgICAgICAgIG5hbWU6IFwiaG9zdGlsZS1kYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgICAgICBtaW1lVHlwZTogXCJhcHBsaWNhdGlvbi96aXBcIixcbiAgICAgICAgICBidWZmZXI6IEJ1ZmZlci5mcm9tKFwibm90IGFuIGFyY2hpdmVcIiksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChob3N0aWxlVXBsb2FkLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZVVwbG9hZC5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlTGl2ZVVwZGF0ZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KGxpdmVVcGRhdGVVcmwsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgT3JpZ2luOiBIT1NUSUxFX09SSUdJTixcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICB9LFxuICAgICAgZGF0YToge30sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVMaXZlVXBkYXRlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZUxpdmVVcGRhdGUuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGRpYWdub3N0aWMuZXJyb3IgPSBcIm9yaWdpbiByZWplY3Rpb24gY2hlY2sgZmFpbGVkXCI7XG4gICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG4gIGF3YWl0IHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VTc2UoYm9keTogc3RyaW5nKTogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHtcbiAgcmV0dXJuIGJvZHkuc3BsaXQoL1xcblxcbisvKS5mbGF0TWFwKChjaHVuaykgPT4ge1xuICAgIGNvbnN0IGRhdGEgPSBjaHVua1xuICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAuZmluZCgobGluZSkgPT4gbGluZS5zdGFydHNXaXRoKFwiZGF0YTogXCIpKVxuICAgICAgPy5zbGljZShcImRhdGE6IFwiLmxlbmd0aCk7XG4gICAgaWYgKCFkYXRhKSByZXR1cm4gW107XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShkYXRhKSBhcyB1bmtub3duO1xuICAgICAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IFt2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPl1cbiAgICAgICAgOiBbXTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlSnNvbihcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIHJldHVybiBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVBcnJheShcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pj4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiBbXTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFtdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gIHBhZ2U6IFBhZ2UsXG4gIHBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSlcbiAgICA/ICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG50ZXN0LmRlc2NyaWJlKFwiRW5naW5lZXJpbmdPUyBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIsICgpID0+IHtcbiAgdGVzdChcImV4cG9ydHMgb25lIHJlZGFjdGVkIGxpdmUtcHJvdmlkZXIgbWlzc2lvbiBjb3JyZWxhdGlvbiByZXBvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgLy8gVGhlIFBsYXl3cmlnaHQgZGVhZGxpbmUgbXVzdCBsZWF2ZSByb29tIGZvciB0aGUgcHJvdmlkZXItYm91bmQgcmVxdWVzdFxuICAgIC8vIGFuZCBwb2xsaW5nIGxvb3AgdG8gY29uc3VtZSB0aGVpciBjb21wbGV0ZSBjb25maWd1cmVkIGJ1ZGdldC5cbiAgICB0ZXN0LnNldFRpbWVvdXQobGl2ZVRpbWVvdXRNcygpICsgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TKTtcbiAgICB0ZXN0LnNraXAoXG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIgIT09IFwiMVwiLFxuICAgICAgXCJMaXZlLXByb3ZpZGVyIHJlbGVhc2Ugam91cm5leSBpcyBvcHQtaW4uXCIsXG4gICAgKTtcbiAgICBpZiAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEUgIT09IFwiMVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBqb3VybmV5IHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFPTEgYW5kIGEgZGlzcG9zYWJsZSBwcm9qZWN0LlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FtcGFpZ25TY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gICAgY29uc3QgcHJvamVjdElkID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQ7XG4gICAgaWYgKCFwcm9qZWN0SWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQgaXMgcmVxdWlyZWQgZm9yIHRoZSBsaXZlLXByb3ZpZGVyIGpvdXJuZXkuXCIsXG4gICAgICApO1xuXG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIsIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICB0aW1lb3V0OiBsaXZlVGltZW91dE1zKCksXG4gICAgICBib2R5OiB7XG4gICAgICAgIHByb2plY3RJZCxcbiAgICAgICAgIG1lc3NhZ2U6IGxpdmVQcm9tcHQoKSxcbiAgICAgICAgaWRlbXBvdGVuY3lLZXk6IGBkYXNoYm9hcmQtbGl2ZS0ke0RhdGUubm93KCl9YCxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgaWYgKHN0cmVhbVJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCBzdHJlYW1SZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBMaXZlLXByb3ZpZGVyIG1pc3Npb24gZmFpbGVkIHRvIHN0YXJ0ICgke3N0cmVhbVJlc3BvbnNlLnN0YXR1c30pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBzc2VFdmVudHMgPSBwYXJzZVNzZShzdHJlYW1SZXNwb25zZS5ib2R5KTtcbiAgICBjb25zdCBzdGFydGVkID0gc3NlRXZlbnRzLmZpbmQoXG4gICAgICAoZXZlbnQpID0+IGV2ZW50LnR5cGUgPT09IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICApO1xuICAgIGNvbnN0IGV4ZWN1dGlvbklkID1cbiAgICAgIHR5cGVvZiBzdGFydGVkPy5leGVjdXRpb25JZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHN0YXJ0ZWQuZXhlY3V0aW9uSWRcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgaWYgKCFleGVjdXRpb25JZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgc3RyZWFtIGRpZCBub3QgZW1pdCBleGVjdXRpb25fc3RhcnRlZC5cIik7XG5cbiAgICBsZXQgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgbGl2ZVRpbWVvdXRNcygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICAgIGV4ZWN1dGlvbiA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtleGVjdXRpb25JZH1gKTtcbiAgICAgIGlmIChcbiAgICAgICAgW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICAgIClcbiAgICAgICAgYnJlYWs7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCA3NTApKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgIVtcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcImNhbmNlbGxlZFwiXS5pbmNsdWRlcyhTdHJpbmcoZXhlY3V0aW9uLnN0YXR1cykpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBtaXNzaW9uIGRpZCBub3QgcmVhY2ggYSB0ZXJtaW5hbCBzdGF0ZSB3aXRoaW4gaXRzIGJvdW5kLlwiLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBzZXNzaW9uSWQgPSBTdHJpbmcoZXhlY3V0aW9uLnNlc3Npb25JZCk7XG4gICAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vbWVzc2FnZXNgLFxuICAgICk7XG4gICAgY29uc3QgZXZlbnRzID0gYXdhaXQgbGl2ZUFycmF5KFxuICAgICAgcGFnZSxcbiAgICAgIGAvYXBpL2V2ZW50cz9wcm9qZWN0SWQ9JHtlbmNvZGVVUklDb21wb25lbnQocHJvamVjdElkKX0mY29ycmVsYXRpb25JZD0ke2VuY29kZVVSSUNvbXBvbmVudChTdHJpbmcoZXhlY3V0aW9uLm9wZXJhdGlvbklkID8/IFwiXCIpKX1gLFxuICAgICk7XG4gICAgY29uc3QgcHJvcG9zYWwgPSBhd2FpdCBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vcGVuZGluZy1wcm9wb3NhbGAsXG4gICAgKTtcbiAgICBjb25zdCBnaXRMb2cgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBgL2FwaS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vZ2l0L2xvZ2ApO1xuICAgIGNvbnN0IG1pc3Npb25Db250cm9sID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKTtcbiAgICBjb25zdCBkYXNoYm9hcmRTdGF0ZSA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIFwiL2FwaS9kYXNoYm9hcmRcIik7XG4gICAgY29uc3QgY2hlY2twb2ludCA9XG4gICAgICBleGVjdXRpb24uY2hlY2twb2ludCAmJiB0eXBlb2YgZXhlY3V0aW9uLmNoZWNrcG9pbnQgPT09IFwib2JqZWN0XCJcbiAgICAgICAgPyAoZXhlY3V0aW9uLmNoZWNrcG9pbnQgYXMgUmVjb3JkPHN0cmluZywgYW55PilcbiAgICAgICAgOiB7fTtcbiAgICBjb25zdCByZWNlbnRTdGVwcyA9IEFycmF5LmlzQXJyYXkoY2hlY2twb2ludC5yZWNlbnRTdGVwcylcbiAgICAgID8gY2hlY2twb2ludC5yZWNlbnRTdGVwc1xuICAgICAgOiBbXTtcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gcmVjZW50U3RlcHMuZmlsdGVyKFxuICAgICAgKHN0ZXApID0+IHN0ZXA/LmtpbmQgPT09IFwidmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgY29uc3QgcHJvamVjdFJldmlzaW9uID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLnByb2plY3RSZXZpc2lvblxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBjYW5kaWRhdGVIYXNoID0gdmFsaWRhdGlvblxuICAgICAgLm1hcCgoc3RlcCkgPT4gc3RlcD8udmFsaWRhdGlvbj8uY2FuZGlkYXRlSGFzaCA/PyBzdGVwPy5jYW5kaWRhdGVIYXNoKVxuICAgICAgLmZpbmQoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS5sZW5ndGggPiAwKTtcbiAgICBjb25zdCBjYW5kaWRhdGVJZGVudGl0eSA9XG4gICAgICB0eXBlb2YgZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5ID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5XG4gICAgICAgIDogY2FuZGlkYXRlSGFzaFxuICAgICAgICAgID8gYGNhbmRpZGF0ZToke2NhbmRpZGF0ZUhhc2h9YFxuICAgICAgICAgIDogYHJlYWQtb25seToke3Byb2plY3RSZXZpc2lvbiA/PyBcInVua25vd25cIn1gO1xuICAgIGlmICghcHJvamVjdFJldmlzaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gaXMgbWlzc2luZyBpdHMgcHJvamVjdCByZXZpc2lvbi5cIik7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiZcbiAgICAgICghY2FuZGlkYXRlSWRlbnRpdHkgfHwgIXByb2plY3RSZXZpc2lvbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUgY2FtcGFpZ24gcmVxdWlyZXMgb3BlcmF0aW9uLCByZXZpc2lvbiwgYW5kIGNhbmRpZGF0ZSBjb3JyZWxhdGlvbi5cIik7XG4gICAgfVxuICAgIGNvbnN0IGV2aWRlbmNlQ291bnQgPSByZWNlbnRTdGVwcy5yZWR1Y2UoXG4gICAgICAoY291bnQsIHN0ZXApID0+IGNvdW50ICsgKE51bWJlcihzdGVwPy5hY2NlcHRlZEV2aWRlbmNlQ291bnQpIHx8IDApLFxuICAgICAgMCxcbiAgICApO1xuICAgIGNvbnN0IHRlcm1pbmFsU3RhdGUgPSBTdHJpbmcoXG4gICAgICBleGVjdXRpb24uZmxpZ2h0U3RhdGUgPz8gZXhlY3V0aW9uLnN0YXR1cyxcbiAgICApLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3Qgc3VjY2Vzc1N0YXRlcyA9IG5ldyBTZXQoW1xuICAgICAgXCJDT01QTEVURURcIixcbiAgICAgIFwiUkVBRFlfRk9SX1JFVklFV1wiLFxuICAgICAgXCJBUFBMSUVEXCIsXG4gICAgICBcIkNPTU1JVFRFRFwiLFxuICAgICAgXCJQVVNIRURcIixcbiAgICBdKTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFjYW5kaWRhdGVIYXNoXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiRGVsaXZlcnktc3VjY2VzcyBjYW1wYWlnbiBjYW5ub3QgcGFzcyB3aXRob3V0IGEgY2FuZGlkYXRlLWJvdW5kIHZhbGlkYXRpb24gaGFzaC5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGRlbGl2ZXJ5U3RhZ2VzID0ge1xuICAgICAgYXBwbGllZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJBaUNoYW5nZXNBcHBsaWVkXCIpLFxuICAgICAgY29tbWl0dGVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkdpdENvbW1pdENyZWF0ZWRcIiksXG4gICAgICBwdXNoZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0UHVzaGVkXCIpLFxuICAgIH07XG4gICAgaWYgKFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyA9PT0gXCJkZWxpdmVyeS1zdWNjZXNzXCIgJiZcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAhT2JqZWN0LnZhbHVlcyhkZWxpdmVyeVN0YWdlcykuZXZlcnkoQm9vbGVhbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgb3BlcmF0aW9uLWNvcnJlbGF0ZWQgYXBwbHksIGNvbW1pdCwgYW5kIHB1c2ggZXZpZGVuY2UuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgKGV2aWRlbmNlQ291bnQgPCAxIHx8IHZhbGlkYXRpb24ubGVuZ3RoIDwgMSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiByZXBvcnRlZCAke3Rlcm1pbmFsU3RhdGV9IHdpdGhvdXQgYWNjZXB0ZWQgZXZpZGVuY2UgYW5kIHZhbGlkYXRpb24gYCArXG4gICAgICAgICAgYChldmlkZW5jZT0ke2V2aWRlbmNlQ291bnR9LCB2YWxpZGF0aW9uPSR7dmFsaWRhdGlvbi5sZW5ndGh9KS5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FwdHVyZSA9IHtcbiAgICAgIHByb2plY3RJZCxcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICB3b3Jrc3BhY2VSZXZpc2lvbjpcbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uc2hvcnRIYXNoID8/XG4gICAgICAgIGdpdExvZy5jb21taXRzPy5bMF0/Lmhhc2g/LnNsaWNlKDAsIDEyKSxcbiAgICAgIHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbmRpZGF0ZUlkZW50aXR5LFxuICAgICAgY2FuZGlkYXRlUmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8sXG4gICAgICBkZWxpdmVyeVN0YWdlcyxcbiAgICAgIGN1cnJlbnRPcGVyYXRpb246IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgfSxcbiAgICAgIHJldGFpbmVkUmVzdWx0OlxuICAgICAgICB0ZXJtaW5hbFN0YXRlID09PSBcIkZBSUxFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiQkxPQ0tFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiSU5DT01QTEVURVwiXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9qZWN0UmV2aXNpb24sXG4gICAgICAgICAgICAgIGxhYmVsOiBcInJldGFpbmVkIHJlc3VsdCBmcm9tIHRoZSBjdXJyZW50IGZhaWxlZCBvciBpbmNvbXBsZXRlIG9wZXJhdGlvblwiLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgdGVybWluYWxTdGF0ZSxcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogZXhlY3V0aW9uLmlkLFxuICAgICAgICBwcm9qZWN0SWQ6IGV4ZWN1dGlvbi5wcm9qZWN0SWQsXG4gICAgICAgIHNlc3Npb25JZDogZXhlY3V0aW9uLnNlc3Npb25JZCxcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICBmbGlnaHRTdGF0ZTogZXhlY3V0aW9uLmZsaWdodFN0YXRlLFxuICAgICAgfSxcbiAgICAgIG1lc3NhZ2VzOiBtZXNzYWdlcy5tYXAoXG4gICAgICAgICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIHNzZUV2ZW50czogc3NlRXZlbnRzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgdHlwZSxcbiAgICAgICAgICBleGVjdXRpb25JZDogZXZlbnRFeGVjdXRpb24sXG4gICAgICAgICAgc2Vzc2lvbklkOiBldmVudFNlc3Npb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgICBjb2RlLFxuICAgICAgICB9KSxcbiAgICAgICksXG4gICAgICBjaGVja3BvaW50czogW1xuICAgICAgICB7XG4gICAgICAgICAgc2VxdWVuY2U6IGNoZWNrcG9pbnQuc2VxdWVuY2UsXG4gICAgICAgICAgc3RhZ2U6IGNoZWNrcG9pbnQuc3RhZ2UsXG4gICAgICAgICAgdXBkYXRlZEF0OiBjaGVja3BvaW50LnVwZGF0ZWRBdCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBldmlkZW5jZUNvdW50LFxuICAgICAgcHJvcG9zYWxzOiBwcm9wb3NhbFxuICAgICAgICA/IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IHByb3Bvc2FsLmlkLFxuICAgICAgICAgICAgICByZXZpc2lvbjogcHJvcG9zYWwucmV2aXNpb24sXG4gICAgICAgICAgICAgIHN0YXR1czogcHJvcG9zYWwuc3RhdHVzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdXG4gICAgICAgIDogW10sXG4gICAgICB2YWxpZGF0aW9uOiB2YWxpZGF0aW9uLm1hcCgoc3RlcCkgPT4gKHtcbiAgICAgICAgc3RhdHVzOiBzdGVwLnZhbGlkYXRpb24/LnN0YXR1cyA/PyBzdGVwLnN0YXR1cyxcbiAgICAgICAgcHJvZmlsZTogc3RlcC52YWxpZGF0aW9uPy5wcm9maWxlID8/IHN0ZXAudmFsaWRhdGlvblByb2ZpbGUsXG4gICAgICB9KSksXG4gICAgICBldmVudHM6IGV2ZW50cy5tYXAoKHsgdHlwZSwgc2V2ZXJpdHksIGNvcnJlbGF0aW9uSWQgfSkgPT4gKHtcbiAgICAgICAgdHlwZSxcbiAgICAgICAgc2V2ZXJpdHksXG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB9KSksXG4gICAgICBkYXNoYm9hcmQ6IG1pc3Npb25Db250cm9sLFxuICAgICAgZGFzaGJvYXJkU3RhdGU6IHtcbiAgICAgICAgcHJvamVjdENvdW50OiBkYXNoYm9hcmRTdGF0ZS5wcm9qZWN0Q291bnQsXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogZGFzaGJvYXJkU3RhdGUuYWN0aXZlVGFza0NvdW50LFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IG91dHB1dFBhdGggPVxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1JFUE9SVF9QQVRIID8/XG4gICAgICBcInRlc3QtcmVzdWx0cy9kYXNoYm9hcmQtam91cm5leS9saXZlLW1pc3Npb24tY29ycmVsYXRpb24uanNvblwiO1xuICAgIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHdyaXRlRmlsZShcbiAgICAgIG91dHB1dFBhdGgsXG4gICAgICBgJHtKU09OLnN0cmluZ2lmeShjYXB0dXJlLCBudWxsLCAyKX1cXG5gLFxuICAgICAgXCJ1dGY4XCIsXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcInNpZ25zIGluIGFuZCB0cmF2ZXJzZXMgdGhlIGF1dGhlbnRpY2F0ZWQgb3BlcmF0aW9uYWwgc2hlbGxcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBmb3IgKGNvbnN0IG9yaWdpbiBvZiBhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMoKSkge1xuICAgICAgYXdhaXQgZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2UsIG9yaWdpbik7XG4gICAgfVxuICAgIGF3YWl0IGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiU3lzdGVtIE92ZXJ2aWV3XCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU1lTVEVNIE9OTElORVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiUHJvamVjdHNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkV2ZW50IFN0cmVhbVwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiQUkgQXNzaXN0YW50XCIsIGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLm5vdC50b0hhdmVVUkwoL3NpZ24taW4vKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXG4gICAgICAgICAgL0FJIHByb3ZpZGVyIG5vdCBjb25maWd1cmVkfE5vIEFJIGtleSBjb25maWd1cmVkfEFJIEFzc2lzdGFudC9pLFxuICAgICAgICApXG4gICAgICAgIC5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKFxuICAgICAgcGFnZSxcbiAgICAgIFwiTWlzc2lvbiBDb250cm9sXCIsXG4gICAgICBgJHtEQVNIQk9BUkRfUEFUSH1taXNzaW9uLWNvbnRyb2xgLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJObyBkdXJhYmxlIHJ1bnMgaW4gdGhlIGxlZGdlclwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1mbGlnaHQtZGVjaz9leGVjdXRpb25JZD0ke0VYRUNVVElPTl9JRH1gKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChcbiAgICAgICAgYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1mbGlnaHQtZGVja1xcXFw/ZXhlY3V0aW9uSWQ9YCxcbiAgICAgICksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkF1ZGl0IC8gQ2hhdCBydW5cIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUFJPVkVOXCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJjb252ZXJnZXMgdHdvIGJyb3dzZXIgc2Vzc2lvbnMgYWNyb3NzIHJlbG9hZCwgcmVjb25uZWN0LCBzdGFsZSByZXN1bHRzLCBhbmQgQVBJIHJlc3RhcnRcIiwgYXN5bmMgKHtcbiAgICBicm93c2VyLFxuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICB0ZXN0LnNraXAoXG4gICAgICAhcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCxcbiAgICAgIFwiVGhlIG11bHRpLXByb2Nlc3MgY29udmVyZ2VuY2UgY2FtcGFpZ24gcnVucyBvbmx5IHVuZGVyIHRoZSByZWxlYXNlIHJ1bm5lci5cIixcbiAgICApO1xuICAgIHRlc3Quc2V0VGltZW91dCg5MF8wMDApO1xuXG4gICAgY29uc3Qgc2Vjb25kQ29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCgpO1xuICAgIGNvbnN0IHNlY29uZFBhZ2UgPSBhd2FpdCBzZWNvbmRDb250ZXh0Lm5ld1BhZ2UoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW3Byb2dyYW1tYXRpY1NpZ25JbihwYWdlKSwgcHJvZ3JhbW1hdGljU2lnbkluKHNlY29uZFBhZ2UpXSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgIHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCksXG4gICAgICAgIHNlY29uZFBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApLFxuICAgICAgXSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdChzZWNvbmRQYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgICAvLyBBIHJlc3BvbnNlIHRoYXQgYXJyaXZlcyBhZnRlciBhIG5ld2VyIHJlcXVlc3QgbXVzdCBub3QgcmVwbGFjZSB0aGVcbiAgICAgIC8vIHZpc2libGUgcmVhZHkgc3RhdGUgd2l0aCBzdGFsZSBkYXRhLiBLZWVwIHRoZSBkZWxheSBib3VuZGVkIHNvIGFcbiAgICAgIC8vIGh1bmcgcmVxdWVzdCBjYW5ub3QgbWFrZSB0aGlzIGNhbXBhaWduIHBhc3MgaW5kZWZpbml0ZWx5LlxuICAgICAgY29uc3QgY3VycmVudERhc2hib2FyZEZpeHR1cmUgPSB7XG4gICAgICAgIC4uLmRhc2hib2FyZEZpeHR1cmUsXG4gICAgICAgIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICBwcm9qZWN0U2NvcmVzOiBbeyAuLi5kYXNoYm9hcmRGaXh0dXJlLnByb2plY3RTY29yZXNbMF0sIHByb2plY3ROYW1lOiBcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCBzY29yZTogOTcgfV0sXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogMSxcbiAgICAgICAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAxIH0sXG4gICAgICB9O1xuICAgICAgbGV0IHJlZnJlc2hDb3VudCA9IDA7XG4gICAgICBsZXQgcmVsZWFzZVN0YWxlUmVzcG9uc2UhOiAoKSA9PiB2b2lkO1xuICAgICAgY29uc3Qgc3RhbGVSZXNwb25zZVJlbGVhc2VkID0gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UgPSByZXNvbHZlO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICAgICAgcmVmcmVzaENvdW50ICs9IDE7XG4gICAgICAgIGlmIChyZWZyZXNoQ291bnQgPT09IDEpIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShjdXJyZW50RGFzaGJvYXJkRml4dHVyZSkpO1xuICAgICAgICBhd2FpdCBzdGFsZVJlc3BvbnNlUmVsZWFzZWQ7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShkYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHN0YXR1c1wiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJDb25jdXJyZW50IFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjk3XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBjb25zdCBzdGFsZVJlZnJlc2ggPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCBzdGF0dXNcIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVmcmVzaENvdW50KS50b0JlKDIpO1xuICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UoKTtcbiAgICAgIGF3YWl0IHN0YWxlUmVmcmVzaDtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCI5N1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiMVwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICAgIC8vIFNpbXVsYXRlIGEgZHJvcHBlZCBjb25uZWN0aW9uIGluIHRoZSBzZWNvbmQgYnJvd3NlciBhbmQgYXNzZXJ0IHRoZVxuICAgICAgLy8gcmVjb3ZlcnkgYWN0aW9uIHJlbmRlcmVkIGJ5IHRoZSBkYXNoYm9hcmQsIHRoZW4gbGV0IHRoZSBuZXh0IHJlcXVlc3RcbiAgICAgIC8vIHJlY29ubmVjdCBub3JtYWxseS5cbiAgICAgIGxldCByZWNvbm5lY3RBdHRlbXB0ID0gMDtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgICAgICByZWNvbm5lY3RBdHRlbXB0ICs9IDE7XG4gICAgICAgIC8vIHVzZUdldERhc2hib2FyZCByZXRyaWVzIG9uY2U7IGhvbGQgYm90aCBib3VuZGVkIGF0dGVtcHRzIHNvIHRoZVxuICAgICAgICAvLyByZW5kZXJlZCBlcnJvciBzdGF0ZSBpcyBvYnNlcnZhYmxlIGJlZm9yZSB0aGUgb3BlcmF0b3IgcmV0cmllcy5cbiAgICAgICAgaWYgKHJlY29ubmVjdEF0dGVtcHQgPD0gMikge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiY29udHJvbGxlZCByZWNvbm5lY3QgaW50ZXJydXB0aW9uXCIgfSwgNTAzKSxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnJlbG9hZCgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS51bnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuXG4gICAgICBhd2FpdCByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbcGFnZS5yZWxvYWQoKSwgc2Vjb25kUGFnZS5yZWxvYWQoKV0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcblxuICAgICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBzZWNvbmRDb250ZXh0LmNsb3NlKCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KFwicHJldmlld3MgYW5kIGRvd25sb2FkcyB0aGUgY29tcGxldGVkIGV4ZWN1dGlvbiBhdWRpdCB3aXRob3V0IGR1cGxpY2F0aW5nIGVmZmVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYXVkaXRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIlBST1ZFTlwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtdLFxuICAgICAgdmFsaWRhdGlvbnM6IFt7IHN0YXR1czogXCJwYXNzZWRcIiwgcHJvZmlsZTogXCJyZWxlYXNlLXNhZmVcIiB9XSxcbiAgICAgIGFmZmVjdGVkRmlsZXM6IFtcInNyYy9mZWF0dXJlLnRzXCJdLFxuICAgICAgcmVkYWN0aW9uOiB7XG4gICAgICAgIGV4Y2x1ZGVkOiBbXG4gICAgICAgICAgXCJwcm92aWRlciBzZWNyZXRzXCIsXG4gICAgICAgICAgXCJyYXcgbW9kZWwgb3V0cHV0XCIsXG4gICAgICAgICAgXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXVkaXRFeHBvcnQ6IHtcbiAgICAgICAgYm9keTogYXVkaXRCb2R5LFxuICAgICAgICBmaWxlbmFtZTogXCJzZXJ2ZXItc3VwcGxpZWQtYXVkaXQtbmFtZS5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBmYWlsRmlyc3RQcmV2aWV3OiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb24gPSB7XG4gICAgICAgIGlkOiBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgfTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiLFxuICAgICAgICBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICApO1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShleGVjdXRpb24pLFxuICAgICAgKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoL2NvbXBsZXRlZC9pKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KEVYRUNVVElPTl9JRCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtb3BlcmF0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KG5ldyBVUkwoYXVkaXRSZXF1ZXN0c1swXSkucGF0aG5hbWUpLnRvQmUoXG4gICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgLFxuICAgICk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2UgYXVkaXQgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVIaWRkZW4oKTtcblxuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwic2VydmVyLXN1cHBsaWVkLWF1ZGl0LW5hbWUuanNvblwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KC9jb21wbGV0ZWQvaSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpLFxuICAgICkudG9CZUhpZGRlbigpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgY2FuY2VsbGVkIGV4ZWN1dGlvbiBhdWRpdCBoYW5kb2ZmIHJlZGFjdGVkIGFuZCB0ZXJtaW5hbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhdWRpdFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGNhbmNlbGxlZEV4ZWN1dGlvbiA9IHtcbiAgICAgIC4uLmV4ZWN1dGlvbkZpeHR1cmUsXG4gICAgICBzdGF0dXM6IFwiY2FuY2VsbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJDQU5DRUxMRURcIixcbiAgICAgIGNoZWNrcG9pbnQ6IHtcbiAgICAgICAgc3RhZ2U6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIGRldGFpbDogXCJFeGVjdXRpb24gY2FuY2VsbGVkIGJlZm9yZSBhbnkgY2hhbmdlcyB3ZXJlIGFwcGxpZWQuXCIsXG4gICAgICB9LFxuICAgICAgdGVybWluYWxSZWFzb246IFwiY2FuY2VsX3JlcXVlc3RlZFwiLFxuICAgICAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgfTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIk5PVF9SRUNPUkRFRFwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtcbiAgICAgICAgeyB0eXBlOiBcImNhbmNlbGxlZFwiLCBkZXRhaWw6IFwiQ2FuY2VsbGF0aW9uIGFjY2VwdGVkIGJ5IHRoZSBzZXJ2ZXIuXCIgfSxcbiAgICAgIF0sXG4gICAgICB2YWxpZGF0aW9uczogW10sXG4gICAgICBhZmZlY3RlZEZpbGVzOiBbXSxcbiAgICAgIHJlZGFjdGlvbjoge1xuICAgICAgICBleGNsdWRlZDogW1xuICAgICAgICAgIFwicHJvdmlkZXIgc2VjcmV0c1wiLFxuICAgICAgICAgIFwicmF3IG1vZGVsIG91dHB1dFwiLFxuICAgICAgICAgIFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGF1ZGl0RXhwb3J0OiB7XG4gICAgICAgIGJvZHk6IGF1ZGl0Qm9keSxcbiAgICAgICAgZmlsZW5hbWU6IFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBleGVjdXRpb246IGNhbmNlbGxlZEV4ZWN1dGlvbixcbiAgICAgICAgbWVzc2FnZU91dGNvbWU6IFwiQ0FOQ0VMTEVEXCIsXG4gICAgICAgIGZhaWxGaXJzdFByZXZpZXc6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHtcbiAgICAgICAgaWQ6IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgbWVzc2FnZTogXCJDYW5jZWxsZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICB9O1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCIsXG4gICAgICAgIFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICk7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbiksXG4gICAgICApO1xuICAgIH0pO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiVGVybWluYWwgcmVhc29uOiBjYW5jZWxfcmVxdWVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNhbmNlbFwiIH0pKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiB9KSkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJBcHByb3ZlICYgYXBwbHlcIiB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IC9jb21taXQgdmVyaWZpZWQgY2hhbmdlcy9pIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogL3B1c2ggY29tbWl0dGVkIGNoYW5nZXMvaSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChFWEVDVVRJT05fSUQpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLW9wZXJhdGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlRlcm1pbmFsIHJlYXNvbjogY2FuY2VsX3JlcXVlc3RlZFwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIGF1ZGl0IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpKS50b0JlSGlkZGVuKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgfSk7XG5cbiAgdGVzdChcInVwbG9hZHMgYW4gYXJjaGl2ZSBhbmQgcmVuZGVycyBhIGxpdmUgdGFzayB1cGRhdGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtbGl2ZS10YXNrXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJMaXZlIHVwZGF0ZSByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXJcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmNoaXZlVXBsb2FkOiB7XG4gICAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgICAgb3JpZ2luYWxOYW1lOiBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgfSxcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIC8vIFRoaXMgaXMgYSB2YWxpZCwgZW1wdHkgWklQIGFyY2hpdmUuIEtlZXBpbmcgaXQgaW5saW5lIG1ha2VzIHRoZSBicm93c2VyXG4gICAgLy8gdGVzdCBzZWxmLWNvbnRhaW5lZCB3aGlsZSBzdGlsbCBleGVyY2lzaW5nIEZvcm1EYXRhIGFuZCBtdWx0aXBhcnQgYnl0ZXMuXG4gICAgY29uc3QgdXBsb2FkUmVzdWx0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAoYXBpQmFzZVVybCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZXMgPSBVaW50OEFycmF5LmZyb20oXG4gICAgICAgIGF0b2IoXCJVRXNGQmdBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PVwiKSxcbiAgICAgICAgKGNoYXJhY3RlcikgPT4gY2hhcmFjdGVyLmNoYXJDb2RlQXQoMCksXG4gICAgICApO1xuICAgICAgY29uc3QgYm9keSA9IG5ldyBGb3JtRGF0YSgpO1xuICAgICAgYm9keS5hcHBlbmQoXG4gICAgICAgIFwiYXJjaGl2ZVwiLFxuICAgICAgICBuZXcgQmxvYihbYnl0ZXNdLCB7IHR5cGU6IFwiYXBwbGljYXRpb24vemlwXCIgfSksXG4gICAgICAgIFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICApO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChcbiAgICAgICAgbmV3IFVSTChcIi9hcGkvdXBsb2FkL2FyY2hpdmVcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKSxcbiAgICAgICAgeyBtZXRob2Q6IFwiUE9TVFwiLCBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsIGJvZHkgfSxcbiAgICAgICk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgYm9keTogKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICB9O1xuICAgIH0sIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMID8/IHBhZ2UudXJsKCkpO1xuICAgIGV4cGVjdCh1cGxvYWRSZXN1bHQuc3RhdHVzKS50b0JlKDIwMSk7XG4gICAgZXhwZWN0KHVwbG9hZFJlc3VsdC5ib2R5KS50b0VxdWFsKHtcbiAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgIG9yaWdpbmFsTmFtZTogXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICB9KTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBjb25zdCB0YXNrUm93ID0gcGFnZS5nZXRCeUxhYmVsKFxuICAgICAgXCJFeHBhbmQgdGFzayBWZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlc1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tSb3cpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgdGFza1Jvdy5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSkpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkxpdmUgdXBkYXRlIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclwiLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZWNvdmVycyBhIGxpdmUgdGFzayB1cGRhdGUgYWZ0ZXIgYSB0ZW1wb3Jhcnkgc3RyZWFtIGZhaWx1cmVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIkF1dGhvcml0YXRpdmUgdXBkYXRlIHJlY2VpdmVkIGFmdGVyIHJlY29ubmVjdFwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY29ubmVjdGluZy1vcGVyYXRpb25cIixcbiAgICAgICAgY2hlY2twb2ludFZlcnNpb246IDMsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgbGl2ZSB0YXNrIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgICAgc3RyZWFtUmVxdWVzdHMsXG4gICAgICAgIGZhaWxGaXJzdFN0cmVhbTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGNvbnN0IHRhc2tSb3cgPSBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGxpdmUgdGFzayB1cGRhdGVzXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrUm93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHRhc2tSb3cuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoLCB7XG4gICAgICAgIG1lc3NhZ2U6IFwidGhlIHRhc2sgbG9nIHN0cmVhbSBzaG91bGQgcmVjb25uZWN0IGV4YWN0bHkgb25jZVwiLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9CZShzdHJlYW1SZXF1ZXN0c1sxXSk7XG4gICAgZXhwZWN0KG5ldyBVUkwoc3RyZWFtUmVxdWVzdHNbMV0pLnBhdGhuYW1lKS50b0JlKFxuICAgICAgYC9hcGkvdGFza3MvJHt0YXNrSWR9L2xvZ3Mvc3RyZWFtYCxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwic2hvd3MgYW4gYWN0aW9uYWJsZSB0ZXJtaW5hbCBzdGF0ZSB3aGVuIGxpdmUgdGFzayByZWNvbm5lY3RzIGFyZSBleGhhdXN0ZWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtZXhoYXVzdGVkLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gXCJlMmUtZXhoYXVzdGVkLW9wZXJhdGlvblwiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtZXhoYXVzdGVkLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIlRoZSBvbmx5IGNvbmZpcm1lZCB0YXNrIHVwZGF0ZVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHsgb3BlcmF0aW9uSWQgfSxcbiAgICB9O1xuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IG5vblN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL3Rhc2tzL1wiKSkgcmV0dXJuO1xuICAgICAgaWYgKCFyZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2xvZ3Mvc3RyZWFtXCIpKSBub25TdHJlYW1SZXF1ZXN0cy5wdXNoKHJlcXVlc3QubWV0aG9kKCkpO1xuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIGV4aGF1c3RlZCBsaXZlIHRhc2sgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgICBpbml0aWFsTG9nczogW2xpdmVMb2ddLFxuICAgICAgICBzdHJlYW1SZXF1ZXN0cyxcbiAgICAgICAgZmFpbFN0cmVhbUF0dGVtcHRzOiA2LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBleGhhdXN0ZWQgbGl2ZSB0YXNrIHVwZGF0ZXNcIikuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlRlbXBvcmFyeSBzdHJlYW0gZmFpbHVyZS5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgsIHtcbiAgICAgICAgbWVzc2FnZTogXCJ0aGUgdGFzayBsb2cgc3RyZWFtIHNob3VsZCBleGhhdXN0IGl0cyBib3VuZGVkIHJlY29ubmVjdCBidWRnZXRcIixcbiAgICAgICAgdGltZW91dDogMzVfMDAwLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDYpO1xuICAgIGNvbnN0IGV4aGF1c3RlZCA9IHBhZ2UuZ2V0QnlSb2xlKFwiYWxlcnRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIkxpdmUgdGFzayB1cGRhdGVzIGNvdWxkIG5vdCByZWNvbm5lY3RcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIlJlY29ubmVjdCBhdHRlbXB0cyBhcmUgZXhoYXVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQob3BlcmF0aW9uSWQpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJ0YXNrIGhhcyBub3QgYmVlbiBtYXJrZWQgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBsaXZlIHVwZGF0ZXNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCB0YXNrIGxvZ3NcIiB9KSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IGxpdmUgdXBkYXRlc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KFwiVGhlIG9ubHkgY29uZmlybWVkIHRhc2sgdXBkYXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCkudG9CZSg3KTtcbiAgICBleHBlY3QobmV3IFNldChzdHJlYW1SZXF1ZXN0cykuc2l6ZSkudG9CZSgxKTtcbiAgICBleHBlY3Qobm9uU3RyZWFtUmVxdWVzdHMpLm5vdC50b0NvbnRhaW4oXCJQT1NUXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwicGFnZXMgYW5kIHJlbG9hZHMgdGhlIGZpbHRlcmVkIGV2ZW50IHN0cmVhbSB3aXRob3V0IGxvc2luZyBpdHMgd2luZG93XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGV2ZW50cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDUxIH0sIChfLCBpbmRleCkgPT4gKHtcbiAgICAgIGlkOiBgZTJlLWV2ZW50LSR7aW5kZXh9YCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgdHlwZTogXCJBdWRpdEV2ZW50XCIsXG4gICAgICBzZXZlcml0eTogaW5kZXggPCAyID8gXCJzdWNjZXNzXCIgOiBcImluZm9cIixcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGluZGV4IDwgMiA/IFwicmVsZWFzZS00MlwiIDogbnVsbCxcbiAgICAgIG1lc3NhZ2U6XG4gICAgICAgIGluZGV4IDwgMiA/IGBGaWx0ZXJlZCByZWxlYXNlIGV2ZW50ICR7aW5kZXh9YCA6IGBPbGRlciBldmVudCAke2luZGV4fWAsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKERhdGUuVVRDKDIwMjYsIDAsIDEsIDAsIDAsIDUxIC0gaW5kZXgpKS50b0lTT1N0cmluZygpLFxuICAgIH0pKTtcbiAgICBjb25zdCBldmVudFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAobmV3IFVSTChyZXF1ZXN0LnVybCgpKS5wYXRobmFtZS5lbmRzV2l0aChcIi9hcGkvZXZlbnRzXCIpKVxuICAgICAgICBldmVudFJlcXVlc3RzLnB1c2gocmVxdWVzdC51cmwoKSk7XG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGV2ZW50cyxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA0OVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDUwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBmaXJzdFJlcXVlc3QgPSBuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISk7XG4gICAgZXhwZWN0KGZpcnN0UmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpLnRvQmUoXCI1MFwiKTtcbiAgICBleHBlY3QoZmlyc3RSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMVwiKTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHBhZ2Uud2FpdEZvclJlcXVlc3QoKHJlcXVlc3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCgpKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICB1cmwucGF0aG5hbWUuZW5kc1dpdGgoXCIvYXBpL2V2ZW50c1wiKSAmJlxuICAgICAgICAgIHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSA9PT0gXCIyXCJcbiAgICAgICAgKTtcbiAgICAgIH0pLFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9sZGVyXCIgfSkuY2xpY2soKSxcbiAgICBdKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQYWdlIDIuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNTBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISkuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIyXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJOZXdlclwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUGFnZSAxLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlQbGFjZWhvbGRlcihcIlNlYXJjaCBsb2dzLi4uXCIpLmZpbGwoXCJGaWx0ZXJlZCByZWxlYXNlXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJUb2dnbGUgZXZlbnQgZmlsdGVyc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5sb2NhdG9yKFwic2VsZWN0XCIpLm50aCgxKS5zZWxlY3RPcHRpb24oXCJzdWNjZXNzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgMVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc2VhcmNoPUZpbHRlcmVkXFwrcmVsZWFzZS8pO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NldmVyaXR5PXN1Y2Nlc3MvKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVBsYWNlaG9sZGVyKFwiU2VhcmNoIGxvZ3MuLi5cIikpLnRvSGF2ZVZhbHVlKFxuICAgICAgXCJGaWx0ZXJlZCByZWxlYXNlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiVG9nZ2xlIGV2ZW50IGZpbHRlcnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJzZWxlY3RcIikubnRoKDEpKS50b0hhdmVWYWx1ZShcInN1Y2Nlc3NcIik7XG4gICAgY29uc3QgZmlsdGVyZWRSZXF1ZXN0ID0gbmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKS50b0JlKFwiNTBcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjFcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwic2VhcmNoXCIpKS50b0JlKFwiRmlsdGVyZWQgcmVsZWFzZVwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKSkudG9CZShcInN1Y2Nlc3NcIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZW5kZXJzIGFuIEFyYWJpYyBzb3VyY2UtYmFja2VkIEFJIGFuc3dlciB3aXRob3V0IGludGVybmFsIGRpYWdub3N0aWNzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBjb25zdCBzZW5kQnV0dG9uID0gY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKTtcbiAgICBhd2FpdCBleHBlY3Qoc2VuZEJ1dHRvbikudG9CZUVuYWJsZWQoKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZVByb21pc2UgPSBwYWdlLndhaXRGb3JSZXNwb25zZSgocmVzcG9uc2UpID0+XG4gICAgICByZXNwb25zZS51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiksXG4gICAgKTtcbiAgICBhd2FpdCBzZW5kQnV0dG9uLmNsaWNrKCk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBzdHJlYW1SZXNwb25zZVByb21pc2U7XG4gICAgZXhwZWN0KHN0cmVhbVJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwMCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLnF1ZXN0aW9uLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFnZW50IGFjdGl2aXR5XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUmVhZGluZyBzb3VyY2VcIiwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuc291cmNlLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoL0JlaGF2aW9yIGV2aWRlbmNlIMK3IDEgZXhjZXJwdC9pKS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dCgncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJOT1QgUFJPVkVOXCIpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnQgd2l0aCBhY2NlcHRlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KGAke2ZpeHR1cmUuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChmaXh0dXJlLnNvdXJjZSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgYWNyb3NzIGJyb3dzZXIgYmFjayBhbmQgZm9yd2FyZCBuYXZpZ2F0aW9uIHdpdGggYmxvY2tlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGJsb2NrZWQucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGJsb2NrZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIHdoZW4gc3dpdGNoaW5nIHByb2plY3RzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgICBwcm9qZWN0czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3Qtb25lXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IE9uZVwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC1vbmVcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3QtdHdvXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IFR3b1wiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC10d29cIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDg4LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC10d29cIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoXG4gICAgICAwLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YmxvY2tlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC1vbmVcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSBhY3Jvc3MgcmVwZWF0ZWQgbmF2aWdhdGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2VcbiAgICAgICAgICAuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgICAgLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIH07XG4gICAgY29uc3QgYXNzZXJ0QmxvY2tlZENpdGF0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlXG4gICAgICAgICAgLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChgJHtibG9ja2VkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICB9O1xuICAgIGNvbnN0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgICAvTUlTU0lOR19MSVRFUkFMX01BVENIfHJhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICAgKTtcbiAgICB9O1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJQcm9qZWN0c1wiLCBgJHtEQVNIQk9BUkRfUEFUSH1wcm9qZWN0c2ApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9cHJvamVjdHMkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJFdmVudCBTdHJlYW1cIiwgYCR7REFTSEJPQVJEX1BBVEh9ZXZlbnRzYCk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9ZXZlbnRzJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBvbmx5IHRoZSBzYWZlIGJsb2NrZWQgY2l0YXRpb24gcmVhc29uIGFmdGVyIGNoYXQgcmVsb2FkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBmYWlsZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXcgZXhjZXB0aW9ufHN0YWNrIHRyYWNlfFxcL2hvbWVcXC9ydW5uZXJ8c2VjcmV0fGZpeHR1cmUgZGlhZ25vc3RpYy9pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInByZXNlcnZlcyBvbmUgcGFydGlhbCBhbnN3ZXIgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IGFuZCBtYXJrcyBpdCBpbmNvbXBsZXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsRGlzY29ubmVjdGVkQWlGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGlzY29ubmVjdEFpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGNvbnN0IGFuc3dlciA9IHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhbnN3ZXIubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBmaXh0dXJlLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZXN1bWVzIGEgZmFpbGVkIGFuYWx5c2lzIGFuZCBrZWVwcyB0aGUgZXhlY3V0aW9uIGluY29tcGxldGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgeyBmaXh0dXJlLCBleGVjdXRpb24gfSA9IGluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogZml4dHVyZSxcbiAgICAgIHJlc3VtZUZhaWx1cmU6IHsgZml4dHVyZSwgZXhlY3V0aW9uIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHNlc3Npb25JZCwgZXhlY3V0aW9uSWQsIHByb2plY3RJZCwgcmVzdW1lVG9rZW4sIG1lc3NhZ2UgfSkgPT4ge1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50XyR7cHJvamVjdElkfWAsXG4gICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICApO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl8ke3Byb2plY3RJZH1fJHtzZXNzaW9uSWR9YCxcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICByZXN1bWVUb2tlbixcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHJlc3VtZVRva2VuOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCIsXG4gICAgICAgIG1lc3NhZ2U6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9LFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVzdW1lUmVxdWVzdCA9IHBhZ2Uud2FpdEZvclJlcXVlc3QoXG4gICAgICAocmVxdWVzdCkgPT5cbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIsIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCByZXF1ZXN0Qm9keSA9IEpTT04ucGFyc2UoXG4gICAgICAoYXdhaXQgcmVzdW1lUmVxdWVzdCkucG9zdERhdGEoKSA/PyBcInt9XCIsXG4gICAgKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBleHBlY3QocmVxdWVzdEJvZHkpLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcmVzdW1lVG9rZW46IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIixcbiAgICAgICAgbWVzc2FnZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZhaWxlZCB0byBzZW5kIG1lc3NhZ2VcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlY292ZXJzIGEgbWlzc2luZyB0b2tlbiBhZnRlciBhIHJlYWwgc3RyZWFtIGFib3J0IGFuZCByZXN1bWVzIG9uZSBleGVjdXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgaW50ZXJydXB0ZWRSZXN1bWU6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHBhZ2UuYWRkSW5pdFNjcmlwdCgoKSA9PiB7XG4gICAgICBjb25zdCBuYXRpdmVGZXRjaCA9IHdpbmRvdy5mZXRjaC5iaW5kKHdpbmRvdyk7XG4gICAgICB3aW5kb3cuZmV0Y2ggPSBhc3luYyAoaW5wdXQsIGluaXQpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID1cbiAgICAgICAgICB0eXBlb2YgaW5wdXQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICAgID8gaW5wdXRcbiAgICAgICAgICAgIDogaW5wdXQgaW5zdGFuY2VvZiBSZXF1ZXN0XG4gICAgICAgICAgICAgID8gaW5wdXQudXJsXG4gICAgICAgICAgICAgIDogU3RyaW5nKGlucHV0KTtcbiAgICAgICAgY29uc3QgYm9keSA9IHR5cGVvZiBpbml0Py5ib2R5ID09PSBcInN0cmluZ1wiID8gaW5pdC5ib2R5IDogXCJcIjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgICF1cmwuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpIHx8XG4gICAgICAgICAgYm9keS5pbmNsdWRlcygnXCJleGVjdXRpb25JZFwiJylcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmV0dXJuIG5hdGl2ZUZldGNoKGlucHV0LCBpbml0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbmF0aXZlRmV0Y2goaW5wdXQsIGluaXQpO1xuICAgICAgICBpZiAoIXJlc3BvbnNlLmJvZHkpIHJldHVybiByZXNwb25zZTtcbiAgICAgICAgY29uc3QgcmVhZGVyID0gcmVzcG9uc2UuYm9keS5nZXRSZWFkZXIoKTtcbiAgICAgICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICAgICAgICBjb25zdCBzdHJlYW0gPSBuZXcgUmVhZGFibGVTdHJlYW0oe1xuICAgICAgICAgIGFzeW5jIHN0YXJ0KGNvbnRyb2xsZXIpIHtcbiAgICAgICAgICAgIGxldCBidWZmZXJlZCA9IFwiXCI7XG4gICAgICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgICBjb25zdCB7IGRvbmUsIHZhbHVlIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICAgICAgICAgICAgICBpZiAoZG9uZSkge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJlZCkgY29udHJvbGxlci5lbnF1ZXVlKGVuY29kZXIuZW5jb2RlKGJ1ZmZlcmVkKSk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5jbG9zZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBidWZmZXJlZCArPSBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUodmFsdWUsIHsgc3RyZWFtOiB0cnVlIH0pO1xuICAgICAgICAgICAgICBjb25zdCBtYXJrZXIgPSBidWZmZXJlZC5pbmRleE9mKCdcInR5cGVcIjpcImV4ZWN1dGlvbl9zdGFydGVkXCInKTtcbiAgICAgICAgICAgICAgY29uc3QgZnJhbWVFbmQgPVxuICAgICAgICAgICAgICAgIG1hcmtlciA8IDAgPyAtMSA6IGJ1ZmZlcmVkLmluZGV4T2YoXCJcXG5cXG5cIiwgbWFya2VyKTtcbiAgICAgICAgICAgICAgaWYgKGZyYW1lRW5kID49IDApIHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoXG4gICAgICAgICAgICAgICAgICBlbmNvZGVyLmVuY29kZShidWZmZXJlZC5zbGljZSgwLCBmcmFtZUVuZCArIDIpKSxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZXJyb3IobmV3IFR5cGVFcnJvcihcIm5ldHdvcmsgY29ubmVjdGlvbiByZXNldFwiKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2Uoc3RyZWFtLCB7XG4gICAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgICAgICBoZWFkZXJzOiByZXNwb25zZS5oZWFkZXJzLFxuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpICYmXG4gICAgICAgIHJlcXVlc3QubWV0aG9kKCkgPT09IFwiUE9TVFwiXG4gICAgICApIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cy5wdXNoKFxuICAgICAgICAgICAgcmVxdWVzdC5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgICAgICApO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBJZ25vcmUgcmVxdWVzdHMgd2l0aG91dCBhIEpTT04gYm9keTsgdGhlIGFzc2VydGlvbnMgYmVsb3cgcmVxdWlyZVxuICAgICAgICAgIC8vIGJvdGggam91cm5leSByZXF1ZXN0cyB0byBoYXZlIGEgdmFsaWQgcmVxdWVzdCBlbnZlbG9wZS5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwocmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiRXhlY3V0aW9uIHBhdXNlZCDigJQgcmVhZHkgdG8gcmVzdW1lIGZyb20gaXRzIGR1cmFibGUgY2hlY2twb2ludFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPVxuICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICAgIGNvbnN0IHBvaW50ZXJLZXkgPSBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gcGFnZS5ldmFsdWF0ZSgoa2V5KSA9PiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpLCBzdG9yYWdlS2V5KSlcbiAgICAgIC50b0NvbnRhaW4ocmVjb3ZlcnkuaW5pdGlhbFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoXG4gICAgICAoeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0pID0+IHtcbiAgICAgICAgY29uc3Qgc2F2ZWQgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKHN0b3JhZ2VLZXkpID8/IFwie31cIik7XG4gICAgICAgIGRlbGV0ZSBzYXZlZC5yZXN1bWVUb2tlbjtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oc3RvcmFnZUtleSwgSlNPTi5zdHJpbmdpZnkoc2F2ZWQpKTtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0ocG9pbnRlcktleSwgXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLXNlc3Npb25cIik7XG4gICAgICB9LFxuICAgICAgeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0sXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+XG4gICAgICAgIHBhZ2UuZXZhbHVhdGUoKGtleSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHNhdmVkID0gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpID8/IFwie31cIik7XG4gICAgICAgICAgcmV0dXJuIHNhdmVkLnJlc3VtZVRva2VuO1xuICAgICAgICB9LCBzdG9yYWdlS2V5KSxcbiAgICAgIClcbiAgICAgIC50b0JlKHJlY292ZXJ5LnJlY292ZXJlZFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChyZWNvdmVyeS5maXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXT8uZXhlY3V0aW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0/LnNlc3Npb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1sxXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogcmVjb3ZlcnkuZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiByZWNvdmVyeS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcnkucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChcbiAgICAgIHN0cmVhbVJlcXVlc3RzLm1hcCgocmVxdWVzdCkgPT4gcmVxdWVzdC5leGVjdXRpb25JZCkuZmlsdGVyKEJvb2xlYW4pLFxuICAgICkudG9FcXVhbChbcmVjb3ZlcnkuZml4dHVyZS5leGVjdXRpb25JZF0pO1xuICB9KTtcblxuICB0ZXN0KFwicHJvamVjdHMgZGVsaXZlcnkgcmVjb3Zlcnkgc3RhdGVzIHNhZmVseSBhZnRlciByZWxvYWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHZhbGlkYXRpb24gbmVlZHMgdG8gYmUgcnVuIGFnYWluLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImFiYW5kb25lZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgc2F2ZWQgZGVsaXZlcnkgd29ya3NwYWNlIGlzIG5vIGxvbmdlciBhdmFpbGFibGUsIHNvIHJlY292ZXJ5IGNhbm5vdCBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJTdGFydCBhIG5ldyBkZWxpdmVyeSBmcm9tIHRoZSBjdXJyZW50IHByb2plY3QgcmF0aGVyIHRoYW4gcmV0cnlpbmcgdGhpcyByZWNvdmVyeS5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogXCJXb3Jrc3BhY2UgZXhwaXJlZCBhZnRlciB0aGUgcnVubmVyIHdhcyByZWN5Y2xlZC5cIixcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicmVqZWN0ZWRcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBcIkludGVybmFsIGRpYWdub3N0aWM6IHNob3VsZCBuZXZlciBiZSByZW5kZXJlZFwiLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAzLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWdpb24pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlZ2lvbi5nZXRCeVRleHQoXCJSZWNvdmVyYWJsZVwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJXb3Jrc3BhY2UgdW5hdmFpbGFibGVcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIkFscmVhZHkgZGlzY2FyZGVkXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhlIHNhdmVkIGRlbGl2ZXJ5IHdvcmtzcGFjZSBpcyBubyBsb25nZXIgYXZhaWxhYmxlLCBzbyByZWNvdmVyeSBjYW5ub3QgY29udGludWUuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFxuICAgICAgICBcIlJldGFpbmVkIHJlYXNvbjogV29ya3NwYWNlIGV4cGlyZWQgYWZ0ZXIgdGhlIHJ1bm5lciB3YXMgcmVjeWNsZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgYXZhaWxhYmxlID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgY29uc3QgbWlzc2luZyA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBjb25zdCBkaXNjYXJkZWQgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwicmVjb3ZlcmFibGVcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJkaXNjYXJkZWRcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvXFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC98XFwvd29ya3NwYWNlXFwvfGludGVybmFsIGRpYWdub3N0aWMvaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFJlZ2lvbikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZFJlZ2lvblxuICAgICAgICAubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCJdJylcbiAgICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSxcbiAgICApLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlbG9hZGVkUmVnaW9uXG4gICAgICAgIC5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScpXG4gICAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSksXG4gICAgKS50b0JlRGlzYWJsZWQoKTtcbiAgICBleHBlY3QocmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5yZXF1ZXN0cy5ldmVyeSgodXJsKSA9PiB1cmwuaW5jbHVkZXMoXCJwcm9qZWN0SWQ9ZTJlLXByb2plY3RcIikpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICB0ZXN0KFwiZXhwbGFpbnMgd2hlbiBkZWxpdmVyeSByZWNvdmVyeSBsb3NlcyBhIHJhY2UgYW5kIHJlZnJlc2hlcyBzdGF0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIGFjdGlvblJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdGhlIHJldGFpbmVkIGNoYW5nZXMgbmVlZCByZXZpZXcgYmVmb3JlIHZhbGlkYXRpb24gY2FuIGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5QWN0aW9uOiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgY29kZTogXCJERUxJVkVSWV9BTFJFQURZX0RJU0NBUkRFRFwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGRpYWdub3N0aWM6IFwiRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWwuXCIsXG4gICAgICAgIH0sXG4gICAgICAgIG5leHRPcGVyYXRpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgICAgc3RhdHVzOiBcInJlamVjdGVkXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgb3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3Zlcnkgc3RhdGUgY2hhbmdlZFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoaXMgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aClcbiAgICAgIC50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24pLnRvSGF2ZUF0dHJpYnV0ZShcImRhdGEtcmVjb3Zlcnktc3RhdGVcIiwgXCJkaXNjYXJkZWRcIik7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGV4cGVjdChhd2FpdCByZWdpb24ubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCJdJykuY291bnQoKSkudG9CZSgxKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaCgvRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJleHBsYWlucyB3aGVuIGFuIG9sZCByZWNvdmVyeSBsaW5rIHBvaW50cyB0byBhIGRlbGV0ZWQgb3BlcmF0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgYWN0aW9uUmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA1OjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB0aGUgcmV0YWluZWQgY2hhbmdlcyBuZWVkIHJldmlldyBiZWZvcmUgdmFsaWRhdGlvbiBjYW4gY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlBY3Rpb246IHtcbiAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiBhcyBjb25zdCxcbiAgICAgICAgc3RhdHVzOiA0MDQsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiRGVsaXZlcnkgb3BlcmF0aW9uIG5vdCBmb3VuZFwiLFxuICAgICAgICAgIGNvZGU6IFwiREVMSVZFUllfTk9UX0ZPVU5EXCIsXG4gICAgICAgICAgZGlhZ25vc3RpYzogXCJEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbC5cIixcbiAgICAgICAgfSxcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM6IFtdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyeSBsaW5rIGV4cGlyZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGlzIHJlY292ZXJ5IG9wZXJhdGlvbiBubyBsb25nZXIgZXhpc3RzLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVnaW9uLmNvdW50KCkpLnRvQmUoMCk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL0RlbGl2ZXJ5IG9wZXJhdGlvbiBub3QgZm91bmR8RG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIHJlc3VtZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgYmVmb3JlT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGJlZm9yZU9wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPcGVuIHNlc3Npb25zXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGRyYXdlciA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGNvbnN0IGRyYXdlckJveCA9IGF3YWl0IGRyYXdlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChkcmF3ZXJCb3g/LndpZHRoKS50b0JlTGVzc1RoYW5PckVxdWFsKDM5MCk7XG4gICAgY29uc3QgZHVyaW5nT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGR1cmluZ09wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBzaWRlYmFyXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT3BlbiBzZXNzaW9uc1wiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlbmRlcnMgYSB1c2VyLXZpc2libGUgQVBJIGZhaWx1cmUgc3RhdGVcIiwgYXN5bmMgKHsgcGFnZSB9KSA9PiB7XG4gICAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS9kYXNoYm9hcmRcIiwgKHJvdXRlKSA9PlxuICAgICAgcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiY29udHJvbGxlZCBkYXNoYm9hcmQgb3V0YWdlXCIgfSwgNTAzKSxcbiAgICAgICksXG4gICAgKTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJGYWlsZWQgdG8gbG9hZCBkYXNoYm9hcmRcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5lY3Rpb25cIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xufSk7XG4iXSwibWFwcGluZ3MiOiI7QUFBQSxTQUFTQSxNQUFNLEVBQUVDLElBQUksUUFBbUIsa0JBQWtCO0FBQzFELFNBQVNDLEtBQUssRUFBRUMsU0FBUyxRQUFRLGtCQUFrQjtBQUNuRCxTQUFTQyxPQUFPLFFBQVEsV0FBVztBQUNuQyxTQUNFQyw2QkFBNkIsRUFDN0JDLDRCQUE0QixFQUM1QkMsNkJBQTZCLFFBQ3hCLDBCQUEwQjtBQUVqQyxNQUFNQyxjQUFjLEdBQUcsYUFBYTtBQUNwQyxNQUFNQyxTQUFTLEdBQUc7RUFDaEJDLFNBQVMsRUFBRSxlQUFlO0VBQzFCQyxRQUFRLEVBQUUsaUJBQWlCO0VBQzNCQyxLQUFLLEdBQUFDLHFCQUFBLEdBQ0hDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQyxtQkFBbUIsY0FBQUgscUJBQUEsY0FBQUEscUJBQUEsR0FDL0I7QUFDSixDQUFDO0FBQ0QsTUFBTUksWUFBWSxHQUFHLDBCQUEwQjtBQUMvQyxNQUFNQyx1QkFBdUIsR0FBRyxNQUFPO0FBQ3ZDLE1BQU1DLDJCQUEyQixHQUFHLElBQUs7QUFDekMsTUFBTUMsY0FBYyxHQUFHLDBCQUEwQjtBQUNqRCxNQUFNQyx5QkFBeUIsR0FBRyxDQUNoQyw2QkFBNkIsRUFDN0IsOEJBQThCLEVBQzlCLDhCQUE4QixFQUM5QixNQUFNLENBQ0U7QUFDVixNQUFNQyxtQkFBbUIsR0FDdkIscUZBQXFGLEdBQ3JGLHdGQUF3RixHQUN4RiwwRUFBMEU7QUFDNUUsTUFBTUMsdUJBQXVCLEdBQUcsSUFBSUMsR0FBRyxDQUFDLENBQ3RDLGlCQUFpQixFQUNqQixrQkFBa0IsRUFDbEIsa0JBQWtCLENBQ25CLENBQUM7QUFFRixTQUFTQyxvQkFBb0JBLENBQUEsRUFBdUI7RUFBQSxJQUFBQyxzQkFBQTtFQUNsRCxNQUFNQyxRQUFRLElBQUFELHNCQUFBLEdBQUdaLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDYSwyQkFBMkIsY0FBQUYsc0JBQUEsdUJBQXZDQSxzQkFBQSxDQUF5Q0csSUFBSSxDQUFDLENBQUM7RUFDaEUsSUFBSWYsT0FBTyxDQUFDQyxHQUFHLENBQUNlLDJCQUEyQixLQUFLLEdBQUcsSUFBSSxDQUFDSCxRQUFRLEVBQUU7SUFDaEUsTUFBTSxJQUFJSSxLQUFLLENBQ2IsNEdBQ0YsQ0FBQztFQUNIO0VBQ0EsSUFBSUosUUFBUSxJQUFJLENBQUNKLHVCQUF1QixDQUFDUyxHQUFHLENBQUNMLFFBQVEsQ0FBQyxFQUFFO0lBQ3RELE1BQU0sSUFBSUksS0FBSyxDQUFDLHVDQUF1Q0osUUFBUSxHQUFHLENBQUM7RUFDckU7RUFDQSxPQUFPQSxRQUFRO0FBQ2pCO0FBRUEsU0FBU00sVUFBVUEsQ0FBQSxFQUFXO0VBQUEsSUFBQUMsc0JBQUE7RUFDNUIsTUFBTVAsUUFBUSxHQUFHRixvQkFBb0IsQ0FBQyxDQUFDO0VBQ3ZDLElBQUlFLFFBQVEsS0FBSyxpQkFBaUIsRUFBRTtJQUNsQyxPQUFPLDhOQUE4TjtFQUN2TztFQUNBLElBQUlBLFFBQVEsS0FBSyxrQkFBa0IsRUFBRTtJQUNuQyxPQUFPLDBLQUEwSztFQUNuTDtFQUNBLElBQUlBLFFBQVEsS0FBSyxrQkFBa0IsRUFBRTtJQUNuQyxPQUFPLGlQQUFpUDtFQUMxUDtFQUNBLFFBQUFPLHNCQUFBLEdBQU9wQixPQUFPLENBQUNDLEdBQUcsQ0FBQ29CLHlCQUF5QixjQUFBRCxzQkFBQSxjQUFBQSxzQkFBQSxHQUFJWixtQkFBbUI7QUFDckU7QUFFQSxTQUFTYyxhQUFhQSxDQUFBLEVBQVc7RUFDL0IsTUFBTUMsVUFBVSxHQUFHQyxNQUFNLENBQUN4QixPQUFPLENBQUNDLEdBQUcsQ0FBQ3dCLDZCQUE2QixDQUFDO0VBQ3BFLE9BQU9ELE1BQU0sQ0FBQ0UsUUFBUSxDQUFDSCxVQUFVLENBQUMsSUFBSUEsVUFBVSxHQUFHLENBQUMsR0FDaERBLFVBQVUsR0FDVm5CLHVCQUF1QjtBQUM3QjtBQUVBLFNBQVN1Qix3QkFBd0JBLENBQUEsRUFBYTtFQUFBLElBQUFDLHNCQUFBO0VBQzVDLE1BQU1DLE9BQU8sR0FBRyxFQUFBRCxzQkFBQSxHQUFDNUIsT0FBTyxDQUFDQyxHQUFHLENBQUM2Qiw4QkFBOEIsY0FBQUYsc0JBQUEsY0FBQUEsc0JBQUEsR0FBSSxFQUFFLEVBQzlERyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQ1ZDLEdBQUcsQ0FBRUMsTUFBTSxJQUFLQSxNQUFNLENBQUNsQixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQzlCbUIsTUFBTSxDQUFDQyxPQUFPLENBQUM7RUFDbEIsSUFBSU4sT0FBTyxDQUFDTyxNQUFNLEtBQUssQ0FBQyxFQUFFO0lBQ3hCLE1BQU0sSUFBSW5CLEtBQUssQ0FDYiw4RUFDRixDQUFDO0VBQ0g7RUFDQSxPQUFPWSxPQUFPLENBQUNHLEdBQUcsQ0FBRUMsTUFBTSxJQUFLO0lBQzdCLE1BQU1JLE1BQU0sR0FBRyxJQUFJQyxHQUFHLENBQUNMLE1BQU0sQ0FBQztJQUM5QixJQUNFSSxNQUFNLENBQUNKLE1BQU0sS0FBS0EsTUFBTSxJQUN4QkksTUFBTSxDQUFDRSxRQUFRLEtBQUssR0FBRyxJQUN2QkYsTUFBTSxDQUFDRyxNQUFNLElBQ2JILE1BQU0sQ0FBQ0ksSUFBSSxFQUNYO01BQ0EsTUFBTSxJQUFJeEIsS0FBSyxDQUNiLG1EQUFtRGdCLE1BQU0sRUFDM0QsQ0FBQztJQUNIO0lBQ0EsT0FBT0ksTUFBTSxDQUFDSixNQUFNO0VBQ3RCLENBQUMsQ0FBQztBQUNKO0FBRUEsTUFBTVMsZ0JBQWdCLEdBQUc7RUFDdkJDLGlCQUFpQixFQUFFLDBCQUEwQjtFQUM3Q0MsWUFBWSxFQUFFLENBQUM7RUFDZkMsZUFBZSxFQUFFLENBQUM7RUFDbEJDLGtCQUFrQixFQUFFLENBQUM7RUFDckJDLGVBQWUsRUFBRSxDQUFDO0VBQ2xCQyxtQkFBbUIsRUFBRTtJQUFFQyxPQUFPLEVBQUUsQ0FBQztJQUFFQyxPQUFPLEVBQUU7RUFBRSxDQUFDO0VBQy9DQyxhQUFhLEVBQUUsQ0FDYjtJQUNFQyxTQUFTLEVBQUUsYUFBYTtJQUN4QkMsV0FBVyxFQUFFLGVBQWU7SUFDNUJDLEtBQUssRUFBRSxFQUFFO0lBQ1RDLEtBQUssRUFBRTtFQUNULENBQUMsQ0FDRjtFQUNEQyxZQUFZLEVBQUUsQ0FDWjtJQUNFQyxFQUFFLEVBQUUsV0FBVztJQUNmQyxJQUFJLEVBQUUsWUFBWTtJQUNsQkMsUUFBUSxFQUFFLFNBQVM7SUFDbkJDLE9BQU8sRUFBRSw2QkFBNkI7SUFDdENDLFNBQVMsRUFBRTtFQUNiLENBQUMsQ0FDRjtFQUNEQyxRQUFRLEVBQUU7QUFDWixDQUFDO0FBRUQsTUFBTUMsZ0JBQWdCLEdBQUc7RUFDdkJOLEVBQUUsRUFBRXRELFlBQVk7RUFDaEJpRCxTQUFTLEVBQUUsYUFBYTtFQUN4QlksV0FBVyxFQUFFLGVBQWU7RUFDNUJDLE1BQU0sRUFBRSxXQUFXO0VBQ25CQyxXQUFXLEVBQUUsV0FBVztFQUN4QkMsZUFBZSxFQUFFLFFBQVE7RUFDekJDLGFBQWEsRUFBRSxLQUFLO0VBQ3BCQyxTQUFTLEVBQUUsS0FBSztFQUNoQkMsaUJBQWlCLEVBQUUsQ0FBQztFQUNwQkMsZUFBZSxFQUFFLGlCQUFpQjtFQUNsQ0MsVUFBVSxFQUFFO0lBQ1ZDLEtBQUssRUFBRSxVQUFVO0lBQ2pCQyxNQUFNLEVBQUU7RUFDVixDQUFDO0VBQ0RDLFNBQVMsRUFBRTtJQUFFQSxTQUFTLEVBQUU7RUFBdUMsQ0FBQztFQUNoRUMsU0FBUyxFQUFFLDBCQUEwQjtFQUNyQ0MsV0FBVyxFQUFFLDBCQUEwQjtFQUN2Q0MsU0FBUyxFQUFFLDBCQUEwQjtFQUNyQ0MsU0FBUyxFQUFFO0FBQ2IsQ0FBQztBQUVELFNBQVNDLFlBQVlBLENBQ25CQyxJQUFhLEVBQ2JoQixNQUFNLEdBQUcsR0FBRyxFQUNaaUIsT0FBZ0MsRUFDaEM7RUFDQSxPQUFPO0lBQ0xqQixNQUFNO0lBQ05rQixXQUFXLEVBQUUsa0JBQWtCO0lBQy9CLElBQUlELE9BQU8sR0FBRztNQUFFQTtJQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUMvQkQsSUFBSSxFQUFFRyxJQUFJLENBQUNDLFNBQVMsQ0FBQ0osSUFBSTtFQUMzQixDQUFDO0FBQ0g7QUFFQSxlQUFlSywwQkFBMEJBLENBQUNDLElBQVUsRUFBRTtFQUNwRCxNQUFNQyxRQUFRLEdBQUcsTUFBTUQsSUFBSSxDQUFDRSxRQUFRLENBQUMsT0FBTztJQUMxQ0MsUUFBUSxFQUFFQSxRQUFRLENBQUNDLGVBQWUsQ0FBQ0MsV0FBVztJQUM5Q1gsSUFBSSxFQUFFUyxRQUFRLENBQUNULElBQUksQ0FBQ1csV0FBVztJQUMvQkMsUUFBUSxFQUFFQyxNQUFNLENBQUNDO0VBQ25CLENBQUMsQ0FBQyxDQUFDO0VBQ0g3RyxNQUFNLENBQUNzRyxRQUFRLENBQUNFLFFBQVEsQ0FBQyxDQUFDTSxtQkFBbUIsQ0FBQ1IsUUFBUSxDQUFDSyxRQUFRLEdBQUcsQ0FBQyxDQUFDO0VBQ3BFM0csTUFBTSxDQUFDc0csUUFBUSxDQUFDUCxJQUFJLENBQUMsQ0FBQ2UsbUJBQW1CLENBQUNSLFFBQVEsQ0FBQ0ssUUFBUSxHQUFHLENBQUMsQ0FBQztBQUNsRTtBQUVBLGVBQWVJLG9CQUFvQkEsQ0FBQ1YsSUFBVSxFQUFFO0VBQzlDLE1BQU1yRyxNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxTQUFTLEVBQUU7SUFBRUMsSUFBSSxFQUFFO0VBQWtCLENBQUMsQ0FDdkQsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztFQUNmLE1BQU1sSCxNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxlQUFlLEVBQUU7SUFBRUMsS0FBSyxFQUFFO0VBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7QUFDOUU7QUFFQSxlQUFlRyxxQkFBcUJBLENBQUNoQixJQUFVLEVBQUU7RUFDL0MsTUFBTWlCLFVBQVUsR0FBR3hHLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDd0cseUJBQXlCO0VBQ3hELElBQUksQ0FBQ0QsVUFBVSxFQUFFLE1BQU0sSUFBSXZGLEtBQUssQ0FBQyw0Q0FBNEMsQ0FBQztFQUM5RSxNQUFNeUYsUUFBUSxHQUFHLE1BQU1uQixJQUFJLENBQUNvQixPQUFPLENBQUNDLElBQUksQ0FBQyxHQUFHSixVQUFVLGNBQWMsRUFBRTtJQUNwRUssT0FBTyxFQUFFO0VBQ1gsQ0FBQyxDQUFDO0VBQ0YzSCxNQUFNLENBQUN3SCxRQUFRLENBQUN6QyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM2QyxJQUFJLENBQUMsR0FBRyxDQUFDO0FBQ3JDO0FBYUEsZUFBZUMsa0JBQWtCQSxDQUMvQnhCLElBQVUsRUFDVnlCLFNBa0RDLEVBQ0Q7RUFDQSxNQUFNekIsSUFBSSxDQUFDMEIsS0FBSyxDQUFDLFdBQVcsRUFBRSxNQUFPQSxLQUFLLElBQUs7SUFBQSxJQUFBQyxJQUFBLEVBQUFDLHFCQUFBLEVBQUFDLHNCQUFBLEVBQUFDLHNCQUFBO0lBQzdDLE1BQU1DLEdBQUcsR0FBRyxJQUFJaEYsR0FBRyxDQUFDMkUsS0FBSyxDQUFDTixPQUFPLENBQUMsQ0FBQyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQzFDLE1BQU1DLElBQUksR0FBR0QsR0FBRyxDQUFDL0UsUUFBUSxDQUFDaUYsT0FBTyxDQUFDLHNCQUFzQixFQUFFLEVBQUUsQ0FBQztJQUM3RCxNQUFNQyxRQUFRLEdBQUdULFNBQVMsYUFBVEEsU0FBUyx1QkFBVEEsU0FBUyxDQUFFUyxRQUFRO0lBQ3BDLE1BQU1DLFdBQVcsR0FBR1YsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUVVLFdBQVc7SUFDMUMsTUFBTUMsWUFBWSxHQUFHWCxTQUFTLGFBQVRBLFNBQVMsdUJBQVRBLFNBQVMsQ0FBRVcsWUFBWTtJQUM1QyxNQUFNQyxVQUFVLEdBQUcsQ0FBQ0gsUUFBUSxFQUFFQyxXQUFXLEVBQUVDLFlBQVksQ0FBQyxDQUFDekYsTUFBTSxDQUM1RDJGLE9BQU8sSUFBaUMxRixPQUFPLENBQUMwRixPQUFPLENBQzFELENBQUM7SUFFRCxJQUFJRCxVQUFVLENBQUN4RixNQUFNLEdBQUcsQ0FBQyxJQUFJbUYsSUFBSSxDQUFDTyxRQUFRLENBQUMsdUJBQXVCLENBQUMsRUFBRTtNQUNuRSxNQUFNMUUsU0FBUyxHQUFHa0UsR0FBRyxDQUFDUyxZQUFZLENBQUNDLEdBQUcsQ0FBQyxXQUFXLENBQUM7TUFDbkQsTUFBTUMsZUFBZSxHQUFHTCxVQUFVLENBQUMxRixNQUFNLENBQ3RDMkYsT0FBTyxJQUFLLENBQUNBLE9BQU8sQ0FBQ3pFLFNBQVMsSUFBSXlFLE9BQU8sQ0FBQ3pFLFNBQVMsS0FBS0EsU0FDM0QsQ0FBQztNQUNELE9BQU82RCxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxDQUNWaUQsZUFBZSxDQUFDakcsR0FBRyxDQUFFNkYsT0FBTyxLQUFNO1FBQ2hDcEUsRUFBRSxFQUFFb0UsT0FBTyxDQUFDTSxTQUFTO1FBQ3JCQyxLQUFLLEVBQUVQLE9BQU8sQ0FBQ1EsUUFBUTtRQUN2QnRELFNBQVMsRUFBRTtNQUNiLENBQUMsQ0FBQyxDQUNKLENBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFBSWlDLFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUVzQixhQUFhLElBQUlmLElBQUksQ0FBQ08sUUFBUSxDQUFDLHFCQUFxQixDQUFDLEVBQUU7TUFDcEUsSUFBSVMsV0FBb0MsR0FBRyxDQUFDLENBQUM7TUFDN0MsSUFBSTtRQUNGQSxXQUFXLEdBQUd0QixLQUFLLENBQUNOLE9BQU8sQ0FBQyxDQUFDLENBQUM2QixZQUFZLENBQUMsQ0FBNEI7TUFDekUsQ0FBQyxDQUFDLE1BQU07UUFDTjtNQUFBO01BRUYsSUFDRUQsV0FBVyxDQUFDRSxXQUFXLEtBQUt6QixTQUFTLENBQUNzQixhQUFhLENBQUNULE9BQU8sQ0FBQ1ksV0FBVyxFQUN2RTtRQUNBLE9BQU94QixLQUFLLENBQUNpQixPQUFPLENBQUM7VUFDbkJqRSxNQUFNLEVBQUUsR0FBRztVQUNYa0IsV0FBVyxFQUFFLG1CQUFtQjtVQUNoQ0QsT0FBTyxFQUFFO1lBQUUsZUFBZSxFQUFFO1VBQVcsQ0FBQztVQUN4Q0QsSUFBSSxFQUFFK0IsU0FBUyxDQUFDc0IsYUFBYSxDQUFDVCxPQUFPLENBQUNhO1FBQ3hDLENBQUMsQ0FBQztNQUNKO0lBQ0Y7SUFDQSxJQUFJMUIsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRTJCLGlCQUFpQixJQUFJcEIsSUFBSSxDQUFDTyxRQUFRLENBQUMscUJBQXFCLENBQUMsRUFBRTtNQUN4RSxJQUFJUyxXQUFvQyxHQUFHLENBQUMsQ0FBQztNQUM3QyxJQUFJO1FBQ0ZBLFdBQVcsR0FBR3RCLEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQzZCLFlBQVksQ0FBQyxDQUE0QjtNQUN6RSxDQUFDLENBQUMsTUFBTTtRQUNOO01BQUE7TUFFRixNQUFNO1FBQUVYLE9BQU87UUFBRWU7TUFBa0IsQ0FBQyxHQUFHNUIsU0FBUyxDQUFDMkIsaUJBQWlCO01BQ2xFLElBQUlKLFdBQVcsQ0FBQ0UsV0FBVyxLQUFLWixPQUFPLENBQUNZLFdBQVcsRUFBRTtRQUNuRCxPQUFPeEIsS0FBSyxDQUFDaUIsT0FBTyxDQUFDO1VBQ25CakUsTUFBTSxFQUFFLEdBQUc7VUFDWGtCLFdBQVcsRUFBRSxtQkFBbUI7VUFDaENELE9BQU8sRUFBRTtZQUFFLGVBQWUsRUFBRTtVQUFXLENBQUM7VUFDeENELElBQUksRUFBRTJEO1FBQ1IsQ0FBQyxDQUFDO01BQ0o7TUFDQSxJQUFJLENBQUNMLFdBQVcsQ0FBQ0UsV0FBVyxFQUFFO1FBQzVCLE9BQU94QixLQUFLLENBQUNpQixPQUFPLENBQUM7VUFDbkJqRSxNQUFNLEVBQUUsR0FBRztVQUNYa0IsV0FBVyxFQUFFLG1CQUFtQjtVQUNoQ0QsT0FBTyxFQUFFO1lBQUUsZUFBZSxFQUFFO1VBQVcsQ0FBQztVQUN4QztVQUNBO1VBQ0FELElBQUksRUFBRTRDLE9BQU8sQ0FBQ2E7UUFDaEIsQ0FBQyxDQUFDO01BQ0o7SUFDRjtJQUNBLElBQUlHLGdCQUFvQztJQUN4QyxJQUFJO01BQ0ZBLGdCQUFnQixHQUFJNUIsS0FBSyxDQUFDTixPQUFPLENBQUMsQ0FBQyxDQUFDNkIsWUFBWSxDQUFDLENBQUMsQ0FDL0M1RSxPQUE2QjtJQUNsQyxDQUFDLENBQUMsTUFBTTtNQUNOO0lBQUE7SUFFRixNQUFNa0YsYUFBYSxJQUFBNUIsSUFBQSxHQUNqQlMsWUFBWSxhQUFaQSxZQUFZLGNBQVpBLFlBQVksR0FDWkMsVUFBVSxDQUFDbUIsSUFBSSxDQUNabEIsT0FBTyxJQUNOLE9BQU9nQixnQkFBZ0IsS0FBSyxRQUFRLEtBQ25DQSxnQkFBZ0IsS0FBS2hCLE9BQU8sQ0FBQ1EsUUFBUSxJQUNwQ1EsZ0JBQWdCLENBQUNHLFFBQVEsQ0FBQ25CLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDLENBQ2pELENBQUMsY0FBQW5CLElBQUEsY0FBQUEsSUFBQSxHQUNETyxRQUFRO0lBQ1YsSUFBSXFCLGFBQWEsSUFBSXZCLElBQUksQ0FBQ08sUUFBUSxDQUFDLHFCQUFxQixDQUFDLEVBQ3ZELE9BQU9iLEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQztNQUNuQmpFLE1BQU0sRUFBRSxHQUFHO01BQ1hrQixXQUFXLEVBQUUsbUJBQW1CO01BQ2hDRCxPQUFPLEVBQUU7UUFBRSxlQUFlLEVBQUU7TUFBVyxDQUFDO01BQ3hDRCxJQUFJLEVBQUU2RCxhQUFhLENBQUNKO0lBQ3RCLENBQUMsQ0FBQztJQUNKLE1BQU1PLGNBQWMsR0FBR3JCLFVBQVUsQ0FBQ21CLElBQUksQ0FBRWxCLE9BQU8sSUFDN0NOLElBQUksQ0FBQ08sUUFBUSxDQUFDLGdCQUFnQkQsT0FBTyxDQUFDTSxTQUFTLFdBQVcsQ0FDNUQsQ0FBQztJQUNELElBQUljLGNBQWMsRUFDaEIsT0FBT2hDLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUMsQ0FDWDtNQUNFdkIsRUFBRSxFQUFFLEdBQUd3RixjQUFjLENBQUNkLFNBQVMsZUFBZTtNQUM5Q0EsU0FBUyxFQUFFYyxjQUFjLENBQUNkLFNBQVM7TUFDbkNlLElBQUksRUFBRSxNQUFNO01BQ1pDLE9BQU8sRUFBRUYsY0FBYyxDQUFDWixRQUFRO01BQ2hDdkQsU0FBUyxFQUFFO0lBQ2IsQ0FBQyxFQUNEbUUsY0FBYyxDQUFDckYsT0FBTyxDQUN2QixDQUNILENBQUM7SUFDSCxJQUNFb0QsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRW9DLFdBQVcsSUFDdEI3QixJQUFJLENBQUNPLFFBQVEsQ0FBQyx5Q0FBeUMsQ0FBQyxFQUN4RDtNQUFBLElBQUF1QixxQkFBQTtNQUNBLE9BQU9wQyxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxDQUFDLENBQ1g7UUFDRXZCLEVBQUUsRUFBRSx3QkFBd0I7UUFDNUIwRSxTQUFTLEVBQUUsbUJBQW1CO1FBQzlCZSxJQUFJLEVBQUUsTUFBTTtRQUNaQyxPQUFPLEVBQUUsMkJBQTJCO1FBQ3BDckUsU0FBUyxFQUFFO01BQ2IsQ0FBQyxFQUNEO1FBQ0VyQixFQUFFLEVBQUUsNkJBQTZCO1FBQ2pDMEUsU0FBUyxFQUFFLG1CQUFtQjtRQUM5QmUsSUFBSSxFQUFFLFdBQVc7UUFDakJDLE9BQU8sRUFBRSwyQkFBMkI7UUFDcENWLFdBQVcsRUFBRXRJLFlBQVk7UUFDekJtSixPQUFPLEdBQUFELHFCQUFBLEdBQUVyQyxTQUFTLENBQUNvQyxXQUFXLENBQUNHLGNBQWMsY0FBQUYscUJBQUEsY0FBQUEscUJBQUEsR0FBSSxXQUFXO1FBQzVEdkUsU0FBUyxFQUFFO01BQ2IsQ0FBQyxDQUNGLENBQ0gsQ0FBQztJQUNIO0lBRUEsSUFBSXlDLElBQUksS0FBSyxnQkFBZ0IsRUFDM0IsT0FBT04sS0FBSyxDQUFDaUIsT0FBTyxDQUFDbEQsWUFBWSxDQUFDdEMsZ0JBQWdCLENBQUMsQ0FBQztJQUN0RCxJQUNFc0UsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRW9DLFdBQVcsSUFDdEI3QixJQUFJLEtBQUssc0JBQXNCcEgsWUFBWSxlQUFlLEVBQzFEO01BQ0E2RyxTQUFTLENBQUNvQyxXQUFXLENBQUNJLFFBQVEsQ0FBQ0MsSUFBSSxDQUFDeEMsS0FBSyxDQUFDTixPQUFPLENBQUMsQ0FBQyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQzFELElBQ0VOLFNBQVMsQ0FBQ29DLFdBQVcsQ0FBQ00sZ0JBQWdCLElBQ3RDMUMsU0FBUyxDQUFDb0MsV0FBVyxDQUFDSSxRQUFRLENBQUNwSCxNQUFNLEtBQUssQ0FBQyxFQUMzQztRQUNBLE9BQU82RSxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxDQUNWO1VBQUUyRSxLQUFLLEVBQUU7UUFBcUMsQ0FBQyxFQUMvQyxHQUNGLENBQ0YsQ0FBQztNQUNIO01BQ0EsT0FBTzFDLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUNnQyxTQUFTLENBQUNvQyxXQUFXLENBQUNuRSxJQUFJLEVBQUUsR0FBRyxFQUFFO1FBQzVDLHFCQUFxQixFQUFFLHlCQUF5QitCLFNBQVMsQ0FBQ29DLFdBQVcsQ0FBQ1EsUUFBUTtNQUNoRixDQUFDLENBQ0gsQ0FBQztJQUNIO0lBQ0EsSUFBSTVDLFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUU2QyxhQUFhLElBQUl0QyxJQUFJLEtBQUsscUJBQXFCLEVBQUU7TUFBQSxJQUFBdUMscUJBQUE7TUFDOUQsTUFBTTNFLFdBQVcsSUFBQTJFLHFCQUFBLEdBQUc3QyxLQUFLLENBQUNOLE9BQU8sQ0FBQyxDQUFDLENBQUN6QixPQUFPLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxjQUFBNEUscUJBQUEsY0FBQUEscUJBQUEsR0FBSSxFQUFFO01BQ25FLElBQUksQ0FBQzNFLFdBQVcsQ0FBQzRFLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFO1FBQ25ELE9BQU85QyxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxDQUFDO1VBQUUyRSxLQUFLLEVBQUU7UUFBcUMsQ0FBQyxFQUFFLEdBQUcsQ0FDbkUsQ0FBQztNQUNIO01BQ0EsTUFBTTFFLElBQUksR0FBR2dDLEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQ3FELGNBQWMsQ0FBQyxDQUFDO01BQzdDLElBQUksRUFBQy9FLElBQUksYUFBSkEsSUFBSSxlQUFKQSxJQUFJLENBQUUrRCxRQUFRLENBQUNpQixNQUFNLENBQUNDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLEdBQUU7UUFDekQsT0FBT2pELEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7VUFBRTJFLEtBQUssRUFBRTtRQUF3QyxDQUFDLEVBQUUsR0FBRyxDQUN0RSxDQUFDO01BQ0g7TUFDQSxPQUFPMUMsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FDVjtRQUNFbUYsUUFBUSxFQUFFbkQsU0FBUyxDQUFDNkMsYUFBYSxDQUFDTSxRQUFRO1FBQzFDQyxZQUFZLEVBQUVwRCxTQUFTLENBQUM2QyxhQUFhLENBQUNPO01BQ3hDLENBQUMsRUFDRCxHQUFHLEVBQ0g7UUFDRSw2QkFBNkIsRUFBRSxJQUFJOUgsR0FBRyxDQUFDaUQsSUFBSSxDQUFDK0IsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDckYsTUFBTTtRQUN6RCxrQ0FBa0MsRUFBRTtNQUN0QyxDQUNGLENBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFBSStFLFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUVxRCxRQUFRLElBQUk5QyxJQUFJLEtBQUssWUFBWSxFQUFFO01BQ2hELE9BQU9OLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUMsQ0FDWDtRQUNFdkIsRUFBRSxFQUFFdUQsU0FBUyxDQUFDcUQsUUFBUSxDQUFDNUcsRUFBRTtRQUN6QkwsU0FBUyxFQUFFNEQsU0FBUyxDQUFDcUQsUUFBUSxDQUFDakgsU0FBUztRQUN2Q2dGLEtBQUssRUFBRXBCLFNBQVMsQ0FBQ3FELFFBQVEsQ0FBQ2pDLEtBQUs7UUFDL0JrQyxXQUFXLEVBQUUsK0NBQStDO1FBQzVEckcsTUFBTSxFQUFFLFNBQVM7UUFDakJzRyxLQUFLLEVBQUUsV0FBVztRQUNsQkMsWUFBWSxFQUFFLEVBQUU7UUFDaEJDLFVBQVUsRUFBRSxDQUFDO1FBQ2JDLFVBQVUsRUFBRSxDQUFDO1FBQ2I1RixTQUFTLEVBQUUsMEJBQTBCO1FBQ3JDQyxTQUFTLEVBQUU7TUFDYixDQUFDLENBQ0YsQ0FDSCxDQUFDO0lBQ0g7SUFDQSxJQUNFaUMsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRXFELFFBQVEsSUFDbkI5QyxJQUFJLEtBQUssY0FBY1AsU0FBUyxDQUFDcUQsUUFBUSxDQUFDNUcsRUFBRSxPQUFPLEVBQ25EO01BQUEsSUFBQWtILHFCQUFBO01BQ0EsT0FBTzFELEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQ2xELFlBQVksRUFBQTJGLHFCQUFBLEdBQUMzRCxTQUFTLENBQUNxRCxRQUFRLENBQUNPLFdBQVcsY0FBQUQscUJBQUEsY0FBQUEscUJBQUEsR0FBSSxFQUFFLENBQUMsQ0FBQztJQUMxRTtJQUNBLElBQ0UzRCxTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFcUQsUUFBUSxJQUNuQjlDLElBQUksS0FBSyxjQUFjUCxTQUFTLENBQUNxRCxRQUFRLENBQUM1RyxFQUFFLGNBQWMsRUFDMUQ7TUFDQSxNQUFNb0gsY0FBYyxHQUFHN0QsU0FBUyxDQUFDcUQsUUFBUSxDQUFDUSxjQUFjO01BQ3hEQSxjQUFjLGFBQWRBLGNBQWMsZUFBZEEsY0FBYyxDQUFFcEIsSUFBSSxDQUFDeEMsS0FBSyxDQUFDTixPQUFPLENBQUMsQ0FBQyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQzNDLElBQ0dOLFNBQVMsQ0FBQ3FELFFBQVEsQ0FBQ1MsZUFBZSxJQUFJLENBQUFELGNBQWMsYUFBZEEsY0FBYyx1QkFBZEEsY0FBYyxDQUFFekksTUFBTSxNQUFLLENBQUMsSUFDbEU0RSxTQUFTLENBQUNxRCxRQUFRLENBQUNVLGtCQUFrQixJQUNwQ0YsY0FBYyxJQUNkQSxjQUFjLENBQUN6SSxNQUFNLElBQUk0RSxTQUFTLENBQUNxRCxRQUFRLENBQUNVLGtCQUFtQixFQUNqRTtRQUNBO1FBQ0E7UUFDQSxPQUFPOUQsS0FBSyxDQUFDK0QsS0FBSyxDQUFDLGlCQUFpQixDQUFDO01BQ3ZDO01BQ0EsT0FBTy9ELEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQztRQUNuQmpFLE1BQU0sRUFBRSxHQUFHO1FBQ1hrQixXQUFXLEVBQUUsbUJBQW1CO1FBQ2hDRCxPQUFPLEVBQUU7VUFDUCxlQUFlLEVBQUUsVUFBVTtVQUMzQiw2QkFBNkIsRUFBRSxJQUFJNUMsR0FBRyxDQUFDaUQsSUFBSSxDQUFDK0IsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDckYsTUFBTTtVQUN6RCxrQ0FBa0MsRUFBRTtRQUN0QyxDQUFDO1FBQ0RnRCxJQUFJLEVBQUUscUJBQXFCRyxJQUFJLENBQUNDLFNBQVMsQ0FBQzJCLFNBQVMsQ0FBQ3FELFFBQVEsQ0FBQ1ksR0FBRyxDQUFDO01BQ25FLENBQUMsQ0FBQztJQUNKO0lBQ0EsSUFBSTFELElBQUksS0FBSyxlQUFlLEVBQUU7TUFBQSxJQUFBMkQsbUJBQUE7TUFDNUIsT0FBT2pFLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLEVBQUFrRyxtQkFBQSxHQUNWbEUsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUVtRSxRQUFRLGNBQUFELG1CQUFBLGNBQUFBLG1CQUFBLEdBQUksQ0FDckI7UUFDRXpILEVBQUUsRUFBRSxhQUFhO1FBQ2pCMEMsSUFBSSxFQUFFLGVBQWU7UUFDckJpRixRQUFRLEVBQUUsWUFBWTtRQUN0QkMsU0FBUyxFQUFFLE9BQU87UUFDbEJwSCxNQUFNLEVBQUUsUUFBUTtRQUNoQnFILFFBQVEsRUFBRSxtQkFBbUI7UUFDN0JDLFlBQVksRUFBRTtNQUNoQixDQUFDLENBRUwsQ0FDRixDQUFDO0lBQ0g7SUFDQSxJQUNFdkUsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRXdFLGdCQUFnQixJQUMzQmpFLElBQUksS0FBSyw4QkFBOEIsRUFDdkM7TUFDQVAsU0FBUyxDQUFDd0UsZ0JBQWdCLENBQUNoQyxRQUFRLENBQUNDLElBQUksQ0FBQ3hDLEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQztNQUMvRCxPQUFPTCxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxDQUFDO1FBQUV5RyxVQUFVLEVBQUV6RSxTQUFTLENBQUN3RSxnQkFBZ0IsQ0FBQ0M7TUFBVyxDQUFDLENBQ3BFLENBQUM7SUFDSDtJQUNBLElBQ0V6RSxTQUFTLGFBQVRBLFNBQVMsZ0JBQUFHLHFCQUFBLEdBQVRILFNBQVMsQ0FBRXdFLGdCQUFnQixjQUFBckUscUJBQUEsZUFBM0JBLHFCQUFBLENBQTZCdUUsY0FBYyxJQUMzQ25FLElBQUksS0FDRixvQkFBb0JQLFNBQVMsQ0FBQ3dFLGdCQUFnQixDQUFDRSxjQUFjLENBQUNDLFVBQVUsSUFBSTNFLFNBQVMsQ0FBQ3dFLGdCQUFnQixDQUFDRSxjQUFjLENBQUNFLE1BQU0sRUFBRSxFQUNoSTtNQUFBLElBQUFDLHNCQUFBLEVBQUFDLHNCQUFBO01BQ0EsQ0FBQUQsc0JBQUEsR0FBQTdFLFNBQVMsQ0FBQ3dFLGdCQUFnQixDQUFDTyxjQUFjLGNBQUFGLHNCQUFBLGVBQXpDQSxzQkFBQSxDQUEyQ3BDLElBQUksQ0FBQ3hDLEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQztNQUN0RSxJQUFJTixTQUFTLENBQUN3RSxnQkFBZ0IsQ0FBQ0UsY0FBYyxDQUFDTSxjQUFjLEVBQUU7UUFDNURoRixTQUFTLENBQUN3RSxnQkFBZ0IsQ0FBQ0MsVUFBVSxHQUNuQ3pFLFNBQVMsQ0FBQ3dFLGdCQUFnQixDQUFDRSxjQUFjLENBQUNNLGNBQWM7TUFDNUQ7TUFDQSxPQUFPL0UsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FDVmdDLFNBQVMsQ0FBQ3dFLGdCQUFnQixDQUFDRSxjQUFjLENBQUNoRixRQUFRLEdBQUFvRixzQkFBQSxHQUNsRDlFLFNBQVMsQ0FBQ3dFLGdCQUFnQixDQUFDRSxjQUFjLENBQUN6SCxNQUFNLGNBQUE2SCxzQkFBQSxjQUFBQSxzQkFBQSxHQUFJLEdBQ3RELENBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFBSXZFLElBQUksS0FBSyxhQUFhLEVBQUU7TUFBQSxJQUFBMEUsaUJBQUEsRUFBQUMscUJBQUE7TUFDMUIsTUFBTUMsTUFBTSxJQUFBRixpQkFBQSxHQUFHakYsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUVtRixNQUFNLGNBQUFGLGlCQUFBLGNBQUFBLGlCQUFBLEdBQUl2SixnQkFBZ0IsQ0FBQ2MsWUFBWTtNQUNqRSxNQUFNaEIsTUFBTSxJQUFBMEoscUJBQUEsR0FBRzVFLEdBQUcsQ0FBQ1MsWUFBWSxDQUFDQyxHQUFHLENBQUMsUUFBUSxDQUFDLGNBQUFrRSxxQkFBQSx1QkFBOUJBLHFCQUFBLENBQWdDRSxXQUFXLENBQUMsQ0FBQztNQUM1RCxNQUFNQyxjQUFjLEdBQUdGLE1BQU0sQ0FBQ2pLLE1BQU0sQ0FBRW9LLEtBQUssSUFBSztRQUM5QyxNQUFNbEosU0FBUyxHQUFHa0UsR0FBRyxDQUFDUyxZQUFZLENBQUNDLEdBQUcsQ0FBQyxXQUFXLENBQUM7UUFDbkQsTUFBTXJFLFFBQVEsR0FBRzJELEdBQUcsQ0FBQ1MsWUFBWSxDQUFDQyxHQUFHLENBQUMsVUFBVSxDQUFDO1FBQ2pELE1BQU11RSxhQUFhLEdBQUdqRixHQUFHLENBQUNTLFlBQVksQ0FBQ0MsR0FBRyxDQUFDLGVBQWUsQ0FBQztRQUMzRCxPQUNFLENBQUMsQ0FBQzVFLFNBQVMsSUFBSWtKLEtBQUssQ0FBQ2xKLFNBQVMsS0FBS0EsU0FBUyxNQUMzQyxDQUFDTyxRQUFRLElBQUkySSxLQUFLLENBQUMzSSxRQUFRLEtBQUtBLFFBQVEsQ0FBQyxLQUN6QyxDQUFDNEksYUFBYSxJQUFJRCxLQUFLLENBQUNDLGFBQWEsS0FBS0EsYUFBYSxDQUFDLEtBQ3hELENBQUMvSixNQUFNLElBQ04sQ0FBQzhKLEtBQUssQ0FBQzFJLE9BQU8sRUFBRTBJLEtBQUssQ0FBQzVJLElBQUksRUFBRTRJLEtBQUssQ0FBQ0MsYUFBYSxDQUFDLENBQzdDckssTUFBTSxDQUFFc0ssS0FBSyxJQUFzQixPQUFPQSxLQUFLLEtBQUssUUFBUSxDQUFDLENBQzdEQyxJQUFJLENBQUVELEtBQUssSUFBS0EsS0FBSyxDQUFDSixXQUFXLENBQUMsQ0FBQyxDQUFDcEQsUUFBUSxDQUFDeEcsTUFBTSxDQUFDLENBQUMsQ0FBQztNQUUvRCxDQUFDLENBQUM7TUFDRixNQUFNa0ssS0FBSyxHQUFHbEwsTUFBTSxDQUFDOEYsR0FBRyxDQUFDUyxZQUFZLENBQUNDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUU7TUFDekQsTUFBTXpDLElBQUksR0FBRy9ELE1BQU0sQ0FBQzhGLEdBQUcsQ0FBQ1MsWUFBWSxDQUFDQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDO01BQ3RELE9BQU9mLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7UUFDWG1ILE1BQU0sRUFBRUUsY0FBYyxDQUFDTSxLQUFLLENBQUMsQ0FBQ3BILElBQUksR0FBRyxDQUFDLElBQUltSCxLQUFLLEVBQUVuSCxJQUFJLEdBQUdtSCxLQUFLLENBQUM7UUFDOURFLEtBQUssRUFBRVAsY0FBYyxDQUFDaks7TUFDeEIsQ0FBQyxDQUNILENBQUM7SUFDSDtJQUNBLElBQ0U0RSxTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFc0IsYUFBYSxJQUN4QmYsSUFBSSxLQUNGLHNCQUFzQlAsU0FBUyxDQUFDc0IsYUFBYSxDQUFDVCxPQUFPLENBQUNZLFdBQVcsRUFBRSxFQUNyRTtNQUNBLE9BQU94QixLQUFLLENBQUNpQixPQUFPLENBQUNsRCxZQUFZLENBQUNnQyxTQUFTLENBQUNzQixhQUFhLENBQUN1RSxTQUFTLENBQUMsQ0FBQztJQUN2RTtJQUNBLElBQ0U3RixTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFMkIsaUJBQWlCLElBQzVCcEIsSUFBSSxLQUNGLHNCQUFzQlAsU0FBUyxDQUFDMkIsaUJBQWlCLENBQUNkLE9BQU8sQ0FBQ1ksV0FBVyxFQUFFLEVBQ3pFO01BQ0EsT0FBT3hCLEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQ2xELFlBQVksQ0FBQ2dDLFNBQVMsQ0FBQzJCLGlCQUFpQixDQUFDa0UsU0FBUyxDQUFDLENBQUM7SUFDM0U7SUFDQSxJQUNFN0YsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRTJCLGlCQUFpQixJQUM1QnBCLElBQUksS0FDRixzQkFBc0JQLFNBQVMsQ0FBQzJCLGlCQUFpQixDQUFDZCxPQUFPLENBQUNZLFdBQVcsb0JBQW9CLEVBQzNGO01BQ0EsT0FBT3hCLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7UUFDWHlELFdBQVcsRUFBRXpCLFNBQVMsQ0FBQzJCLGlCQUFpQixDQUFDZCxPQUFPLENBQUNZLFdBQVc7UUFDNURxRSxXQUFXLEVBQUU5RixTQUFTLENBQUMyQixpQkFBaUIsQ0FBQ29FO01BQzNDLENBQUMsQ0FDSCxDQUFDO0lBQ0g7SUFDQSxJQUFJeEYsSUFBSSxLQUFLLHNCQUFzQnBILFlBQVksRUFBRSxFQUMvQyxPQUFPOEcsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksRUFBQW9DLHNCQUFBLEdBQUNKLFNBQVMsYUFBVEEsU0FBUyxnQkFBQUssc0JBQUEsR0FBVEwsU0FBUyxDQUFFb0MsV0FBVyxjQUFBL0Isc0JBQUEsdUJBQXRCQSxzQkFBQSxDQUF3QndGLFNBQVMsY0FBQXpGLHNCQUFBLGNBQUFBLHNCQUFBLEdBQUlyRCxnQkFBZ0IsQ0FDcEUsQ0FBQztJQUNILElBQUl3RCxJQUFJLEtBQUsseUJBQXlCLEVBQ3BDLE9BQU9OLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7TUFBRUQsU0FBUyxFQUFFLDBCQUEwQjtNQUFFaUksVUFBVSxFQUFFO0lBQUcsQ0FBQyxDQUN4RSxDQUFDOztJQUVIO0lBQ0E7SUFDQSxJQUFJekYsSUFBSSxDQUFDd0MsVUFBVSxDQUFDLFVBQVUsQ0FBQyxFQUM3QixPQUFPOUMsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FBQztNQUFFMkUsS0FBSyxFQUFFO0lBQTZCLENBQUMsRUFBRSxHQUFHLENBQzNELENBQUM7SUFFSCxPQUFPMUMsS0FBSyxDQUFDZ0csUUFBUSxDQUFDLENBQUM7RUFDekIsQ0FBQyxDQUFDO0FBQ0o7QUFFQSxlQUFlQyxzQkFBc0JBLENBQ25DM0gsSUFBVSxFQUNWNEgsT0FLQyxFQUNEO0VBQUEsSUFBQUMsa0JBQUEsRUFBQUMsaUJBQUE7RUFDQSxNQUFNbEYsU0FBUyxJQUFBaUYsa0JBQUEsR0FBR0QsT0FBTyxhQUFQQSxPQUFPLHVCQUFQQSxPQUFPLENBQUVoRixTQUFTLGNBQUFpRixrQkFBQSxjQUFBQSxrQkFBQSxHQUFJLHVCQUF1QjtFQUMvRCxNQUFNRSxTQUFTLEdBQUcsdUJBQXVCO0VBQ3pDLE1BQU1DLE1BQU0sR0FBRyx3QkFBd0I7RUFDdkMsTUFBTUMsT0FBTyxHQUFHLENBQUFMLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFSyxPQUFPLE1BQUssSUFBSTtFQUN6QyxNQUFNbkYsUUFBUSxJQUFBZ0YsaUJBQUEsR0FDWkYsT0FBTyxhQUFQQSxPQUFPLHVCQUFQQSxPQUFPLENBQUU5RSxRQUFRLGNBQUFnRixpQkFBQSxjQUFBQSxpQkFBQSxHQUNqQixxRUFBcUU7RUFDdkUsTUFBTUksTUFBTSxHQUNWLG9IQUFvSDtFQUN0SCxNQUFNQyxRQUFRLEdBQUcsQ0FDZjtJQUNFSCxNQUFNO0lBQ04sSUFBSUMsT0FBTyxHQUNQO01BQ0VHLE9BQU8sRUFBRSxrQ0FBa0M7TUFDM0NDLGFBQWEsRUFBRSxLQUFLO01BQ3BCQyxhQUFhLEVBQUUsZ0JBQWdCO01BQy9CQyxjQUFjLEVBQUUsU0FBUztNQUN6QkMsY0FBYyxFQUFFO0lBQ2xCLENBQUMsR0FDRDtNQUNFSixPQUFPLEVBQUUsMERBQTBEO01BQ25FSyxVQUFVLEVBQUU7UUFBRUMsU0FBUyxFQUFFLEVBQUU7UUFBRUMsT0FBTyxFQUFFO01BQUcsQ0FBQztNQUMxQ04sYUFBYSxFQUFFLElBQUk7TUFDbkJDLGFBQWEsRUFBRSxpQkFBaUI7TUFDaENDLGNBQWMsRUFBRSxVQUFVO01BQzFCQyxjQUFjLEVBQUU7SUFDbEIsQ0FBQztFQUNQLENBQUMsQ0FDRjtFQUNELE1BQU1JLFNBQVMsR0FBRyxDQUNoQjtJQUNFQyxJQUFJLEVBQUUsV0FBVztJQUNqQkMsSUFBSSxFQUFFLFdBQVc7SUFDakJDLElBQUksRUFBRTtNQUFFL0csSUFBSSxFQUFFZ0c7SUFBTyxDQUFDO0lBQ3RCZ0IsTUFBTSxFQUFFLEtBQUs7SUFDYkMsVUFBVSxFQUFFO0VBQ2QsQ0FBQyxFQUNEO0lBQ0VKLElBQUksRUFBRSxhQUFhO0lBQ25CQyxJQUFJLEVBQUUsV0FBVztJQUNqQmQsTUFBTTtJQUNOZ0IsTUFBTSxFQUFFLEtBQUs7SUFDYkMsVUFBVSxFQUFFO0VBQ2QsQ0FBQyxFQUNEO0lBQ0VKLElBQUksRUFBRSxvQkFBb0I7SUFDMUJLLElBQUksRUFBRSx1QkFBdUI7SUFDN0JDLFVBQVUsRUFBRSxJQUFJO0lBQ2hCQyxVQUFVLEVBQUUsRUFBRTtJQUNkQyxpQkFBaUIsRUFBRSxDQUFDO0lBQ3BCQyxxQkFBcUIsRUFBRSxDQUFDO0lBQ3hCQyxrQkFBa0IsRUFBRSxDQUFDdkIsTUFBTSxDQUFDO0lBQzVCd0IscUJBQXFCLEVBQUUsQ0FBQ3hCLE1BQU0sQ0FBQztJQUMvQnlCLGFBQWEsRUFBRSx5QkFBeUI7SUFDeENDLGFBQWEsRUFBRSxDQUFDLGdCQUFnQixFQUFFLGtCQUFrQixDQUFDO0lBQ3JEQyxXQUFXLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQztJQUMvQkMsb0JBQW9CLEVBQUUsa0JBQWtCO0lBQ3hDQyxlQUFlLEVBQUU7RUFDbkIsQ0FBQyxDQUNGO0VBQ0QsTUFBTUMsVUFBVSxHQUFHO0lBQ2pCakIsSUFBSSxFQUFFLHdCQUF3QjtJQUM5QlgsTUFBTSxFQUFFO01BQ05BLE1BQU07TUFDTkMsUUFBUTtNQUNSNEIsVUFBVSxFQUFFLENBQUM7TUFDYkMsV0FBVyxFQUFFLENBQUNoQyxNQUFNLENBQUM7TUFDckJpQyxRQUFRLEVBQUU7UUFDUkMsZUFBZSxFQUFFLENBQUMsa0JBQWtCLENBQUM7UUFDckNDLGNBQWMsRUFBRSxDQUFDLGtCQUFrQixDQUFDO1FBQ3BDQyxhQUFhLEVBQUUsRUFBRTtRQUNqQkMsUUFBUSxFQUFFO01BQ1o7SUFDRjtFQUNGLENBQUM7RUFDRCxNQUFNaE0sT0FBTyxHQUFHO0lBQ2RILEVBQUUsRUFBRTZKLFNBQVM7SUFDYm5GLFNBQVM7SUFDVGUsSUFBSSxFQUFFLFdBQVc7SUFDakJDLE9BQU8sRUFBRSxHQUFHc0UsTUFBTSxzQ0FBc0M7SUFDeERvQyxhQUFhLEVBQUUsZ0JBQWdCO0lBQy9CQyxPQUFPLEVBQUUsQ0FBQ3ZDLE1BQU0sQ0FBQztJQUNqQlksU0FBUyxFQUFFL0ksSUFBSSxDQUFDQyxTQUFTLENBQUM4SSxTQUFTLENBQUM7SUFDcEM0QixnQkFBZ0IsRUFBRXJDLFFBQVE7SUFDMUIyQixVQUFVO0lBQ1Z2SyxTQUFTLEVBQUU7RUFDYixDQUFDO0VBQ0QsTUFBTWtMLEdBQUcsR0FBSTFELEtBQThCLElBQ3pDLFNBQVNsSCxJQUFJLENBQUNDLFNBQVMsQ0FBQ2lILEtBQUssQ0FBQyxNQUFNO0VBQ3RDLE1BQU01RCxVQUFVLEdBQUcsQ0FDakJzSCxHQUFHLENBQUM7SUFBRXRNLElBQUksRUFBRSxpQkFBaUI7SUFBRXlFO0VBQVUsQ0FBQyxDQUFDLEVBQzNDNkgsR0FBRyxDQUFDO0lBQ0Z0TSxJQUFJLEVBQUUsbUJBQW1CO0lBQ3pCK0UsV0FBVyxFQUFFLGVBQWU7SUFDNUJ4RSxNQUFNLEVBQUUsU0FBUztJQUNqQkksU0FBUyxFQUFFO0VBQ2IsQ0FBQyxDQUFDLEVBQ0YyTCxHQUFHLENBQUM7SUFBRXRNLElBQUksRUFBRSxPQUFPO0lBQUVlLEtBQUssRUFBRTtFQUFtQixDQUFDLENBQUMsRUFDakR1TCxHQUFHLENBQUM7SUFBRXRNLElBQUksRUFBRSxPQUFPO0lBQUVlLEtBQUssRUFBRTtFQUFnQixDQUFDLENBQUMsRUFDOUN1TCxHQUFHLENBQUM7SUFDRnRNLElBQUksRUFBRSxXQUFXO0lBQ2pCMkssSUFBSSxFQUFFLFdBQVc7SUFDakJDLElBQUksRUFBRTtNQUFFL0csSUFBSSxFQUFFZ0c7SUFBTyxDQUFDO0lBQ3RCZ0IsTUFBTSxFQUFFLEtBQUs7SUFDYkMsVUFBVSxFQUFFO0VBQ2QsQ0FBQyxDQUFDLEVBQ0Z3QixHQUFHLENBQUM7SUFDRnRNLElBQUksRUFBRSxhQUFhO0lBQ25CMkssSUFBSSxFQUFFLFdBQVc7SUFDakJkLE1BQU07SUFDTmdCLE1BQU0sRUFBRSxLQUFLO0lBQ2JDLFVBQVUsRUFBRTtFQUNkLENBQUMsQ0FBQyxFQUNGd0IsR0FBRyxDQUFDO0lBQ0Z0TSxJQUFJLEVBQUUsb0JBQW9CO0lBQzFCK0ssSUFBSSxFQUFFLHVCQUF1QjtJQUM3QkMsVUFBVSxFQUFFLElBQUk7SUFDaEJDLFVBQVUsRUFBRSxFQUFFO0lBQ2RDLGlCQUFpQixFQUFFLENBQUM7SUFDcEJDLHFCQUFxQixFQUFFLENBQUM7SUFDeEJDLGtCQUFrQixFQUFFLENBQUN2QixNQUFNLENBQUM7SUFDNUJ3QixxQkFBcUIsRUFBRSxDQUFDeEIsTUFBTSxDQUFDO0lBQy9CeUIsYUFBYSxFQUFFLHlCQUF5QjtJQUN4Q0MsYUFBYSxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsa0JBQWtCLENBQUM7SUFDckRDLFdBQVcsRUFBRSxDQUFDLGdCQUFnQixDQUFDO0lBQy9CQyxvQkFBb0IsRUFBRSxrQkFBa0I7SUFDeENDLGVBQWUsRUFBRTtFQUNuQixDQUFDLENBQUMsRUFDRlksR0FBRyxDQUFDO0lBQUV0TSxJQUFJLEVBQUUsT0FBTztJQUFFdU0sS0FBSyxFQUFFeEM7RUFBTyxDQUFDLENBQUMsRUFDckN1QyxHQUFHLENBQUM7SUFDRnRNLElBQUksRUFBRSxNQUFNO0lBQ1p5RSxTQUFTO0lBQ1R2RSxPQUFPO0lBQ1BrTSxPQUFPLEVBQUUsQ0FBQ3ZDLE1BQU0sQ0FBQztJQUNqQlksU0FBUyxFQUFFL0ksSUFBSSxDQUFDQyxTQUFTLENBQUM4SSxTQUFTLENBQUM7SUFDcEM0QixnQkFBZ0IsRUFBRXJDLFFBQVE7SUFDMUIyQixVQUFVO0lBQ1ZhLGNBQWMsRUFBRTtFQUNsQixDQUFDLENBQUMsQ0FDSCxDQUFDQyxJQUFJLENBQUMsRUFBRSxDQUFDO0VBRVYsT0FBTztJQUNMOUgsUUFBUTtJQUNSb0YsTUFBTTtJQUNORixNQUFNO0lBQ05wRixTQUFTO0lBQ1QvRSxTQUFTLEVBQUUrSixPQUFPLGFBQVBBLE9BQU8sdUJBQVBBLE9BQU8sQ0FBRS9KLFNBQVM7SUFDN0JzRixVQUFVO0lBQ1Y5RTtFQUNGLENBQUM7QUFDSDtBQUVBLFNBQVN3TSx5QkFBeUJBLENBQUEsRUFBb0I7RUFDcEQsTUFBTWpJLFNBQVMsR0FBRywwQkFBMEI7RUFDNUMsTUFBTW1GLFNBQVMsR0FBRywwQkFBMEI7RUFDNUMsTUFBTUMsTUFBTSxHQUFHLGdDQUFnQztFQUMvQyxNQUFNbEYsUUFBUSxHQUFHLHVEQUF1RDtFQUN4RSxNQUFNb0YsTUFBTSxHQUNWLHFHQUFxRztFQUN2RyxNQUFNNEMsY0FBYyxHQUFHLHVCQUF1QjtFQUM5QyxNQUFNbEMsU0FBUyxHQUFHLENBQ2hCO0lBQ0VDLElBQUksRUFBRSxXQUFXO0lBQ2pCQyxJQUFJLEVBQUUsV0FBVztJQUNqQkMsSUFBSSxFQUFFO01BQUUvRyxJQUFJLEVBQUVnRztJQUFPLENBQUM7SUFDdEJnQixNQUFNLEVBQUU7RUFDVixDQUFDLEVBQ0Q7SUFDRUgsSUFBSSxFQUFFLGFBQWE7SUFDbkJDLElBQUksRUFBRSxXQUFXO0lBQ2pCZCxNQUFNO0lBQ04rQyxVQUFVLEVBQUUsUUFBUTtJQUNwQkQsY0FBYztJQUNkRSxhQUFhLEVBQUU7RUFDakIsQ0FBQyxFQUNEO0lBQ0VuQyxJQUFJLEVBQUUsTUFBTTtJQUNab0MsVUFBVSxFQUFFLGNBQWM7SUFDMUJDLFVBQVUsRUFBRSxDQUFDO0lBQ2JDLGFBQWEsRUFBRSxDQUFDO0lBQ2hCQyxTQUFTLEVBQUUsQ0FBQztJQUNaQyxpQkFBaUIsRUFBRSxDQUFDO0lBQ3BCQyxhQUFhLEVBQUUsQ0FBQztJQUNoQkMsZ0JBQWdCLEVBQUUsS0FBSztJQUN2QkMsZUFBZSxFQUFFLENBQUNWLGNBQWM7RUFDbEMsQ0FBQyxDQUNGO0VBQ0QsTUFBTXpNLE9BQU8sR0FBRztJQUNkSCxFQUFFLEVBQUU2SixTQUFTO0lBQ2JuRixTQUFTO0lBQ1RlLElBQUksRUFBRSxXQUFXO0lBQ2pCQyxPQUFPLEVBQUVzRSxNQUFNO0lBQ2ZVLFNBQVMsRUFBRS9JLElBQUksQ0FBQ0MsU0FBUyxDQUFDOEksU0FBUyxDQUFDO0lBQ3BDckosU0FBUyxFQUFFO0VBQ2IsQ0FBQztFQUNELE1BQU1rTCxHQUFHLEdBQUkxRCxLQUE4QixJQUN6QyxTQUFTbEgsSUFBSSxDQUFDQyxTQUFTLENBQUNpSCxLQUFLLENBQUMsTUFBTTtFQUN0QyxNQUFNNUQsVUFBVSxHQUFHLENBQ2pCc0gsR0FBRyxDQUFDO0lBQUV0TSxJQUFJLEVBQUUsaUJBQWlCO0lBQUV5RTtFQUFVLENBQUMsQ0FBQyxFQUMzQzZILEdBQUcsQ0FBQztJQUNGdE0sSUFBSSxFQUFFLG1CQUFtQjtJQUN6QitFLFdBQVcsRUFBRSw0QkFBNEI7SUFDekN4RSxNQUFNLEVBQUUsU0FBUztJQUNqQkksU0FBUyxFQUFFO0VBQ2IsQ0FBQyxDQUFDLEVBQ0YyTCxHQUFHLENBQUM7SUFDRnRNLElBQUksRUFBRSxXQUFXO0lBQ2pCMkssSUFBSSxFQUFFLFdBQVc7SUFDakJDLElBQUksRUFBRTtNQUFFL0csSUFBSSxFQUFFZ0c7SUFBTyxDQUFDO0lBQ3RCZ0IsTUFBTSxFQUFFO0VBQ1YsQ0FBQyxDQUFDLEVBQ0Z5QixHQUFHLENBQUM7SUFDRnRNLElBQUksRUFBRSxhQUFhO0lBQ25CMkssSUFBSSxFQUFFLFdBQVc7SUFDakJkLE1BQU07SUFDTitDLFVBQVUsRUFBRSxRQUFRO0lBQ3BCRCxjQUFjO0lBQ2RFLGFBQWEsRUFBRTtFQUNqQixDQUFDLENBQUMsRUFDRlAsR0FBRyxDQUFDO0lBQUV0TSxJQUFJLEVBQUUsT0FBTztJQUFFdU0sS0FBSyxFQUFFeEM7RUFBTyxDQUFDLENBQUMsRUFDckN1QyxHQUFHLENBQUM7SUFDRnRNLElBQUksRUFBRSxNQUFNO0lBQ1p5RSxTQUFTO0lBQ1R2RSxPQUFPO0lBQ1B1SyxTQUFTLEVBQUUvSSxJQUFJLENBQUNDLFNBQVMsQ0FBQzhJLFNBQVMsQ0FBQztJQUNwQytCLGNBQWMsRUFBRTtFQUNsQixDQUFDLENBQUMsQ0FDSCxDQUFDQyxJQUFJLENBQUMsRUFBRSxDQUFDO0VBRVYsT0FBTztJQUNMOUgsUUFBUTtJQUNSb0YsTUFBTTtJQUNORixNQUFNO0lBQ05wRixTQUFTO0lBQ1RPLFVBQVU7SUFDVjlFO0VBQ0YsQ0FBQztBQUNIO0FBRUEsU0FBU29OLDRCQUE0QkEsQ0FBQSxFQUFvQjtFQUN2RCxNQUFNN0ksU0FBUyxHQUFHLDZCQUE2QjtFQUMvQyxNQUFNTSxXQUFXLEdBQUcsK0JBQStCO0VBQ25ELE1BQU1KLFFBQVEsR0FDWixtRUFBbUU7RUFDckUsTUFBTW9GLE1BQU0sR0FDViwrRUFBK0U7RUFDakYsTUFBTTRDLGNBQWMsR0FBRyw0QkFBNEI7RUFDbkQsTUFBTWxDLFNBQVMsR0FBRyxDQUNoQjtJQUNFQyxJQUFJLEVBQUUsTUFBTTtJQUNab0MsVUFBVSxFQUFFLGtCQUFrQjtJQUM5QkMsVUFBVSxFQUFFLENBQUM7SUFDYkMsYUFBYSxFQUFFLENBQUM7SUFDaEJDLFNBQVMsRUFBRSxDQUFDO0lBQ1pDLGlCQUFpQixFQUFFLENBQUM7SUFDcEJDLGFBQWEsRUFBRSxDQUFDO0lBQ2hCQyxnQkFBZ0IsRUFBRSxLQUFLO0lBQ3ZCQyxlQUFlLEVBQUUsQ0FBQ1YsY0FBYyxDQUFDO0lBQ2pDWSxpQkFBaUIsRUFBRSxDQUNqQix3REFBd0Q7RUFFNUQsQ0FBQyxDQUNGO0VBQ0QsTUFBTXJOLE9BQU8sR0FBRztJQUNkSCxFQUFFLEVBQUUsNkJBQTZCO0lBQ2pDMEUsU0FBUztJQUNUZSxJQUFJLEVBQUUsV0FBVztJQUNqQkMsT0FBTyxFQUFFc0UsTUFBTTtJQUNmVSxTQUFTLEVBQUUvSSxJQUFJLENBQUNDLFNBQVMsQ0FBQzhJLFNBQVMsQ0FBQztJQUNwQzdFLE9BQU8sRUFBRSxRQUFRO0lBQ2pCNEgsU0FBUyxFQUFFYixjQUFjO0lBQ3pCYyxZQUFZLEVBQUUsOENBQThDO0lBQzVEMUksV0FBVztJQUNYM0QsU0FBUyxFQUFFO0VBQ2IsQ0FBQztFQUNELE1BQU1rTCxHQUFHLEdBQUkxRCxLQUE4QixJQUN6QyxTQUFTbEgsSUFBSSxDQUFDQyxTQUFTLENBQUNpSCxLQUFLLENBQUMsTUFBTTtFQUN0QyxNQUFNNUQsVUFBVSxHQUFHLENBQ2pCc0gsR0FBRyxDQUFDO0lBQUV0TSxJQUFJLEVBQUUsaUJBQWlCO0lBQUV5RTtFQUFVLENBQUMsQ0FBQyxFQUMzQzZILEdBQUcsQ0FBQztJQUNGdE0sSUFBSSxFQUFFLG1CQUFtQjtJQUN6QitFLFdBQVc7SUFDWHhFLE1BQU0sRUFBRSxTQUFTO0lBQ2pCSSxTQUFTLEVBQUU7RUFDYixDQUFDLENBQUMsRUFDRjJMLEdBQUcsQ0FBQztJQUFFdE0sSUFBSSxFQUFFLE9BQU87SUFBRWUsS0FBSyxFQUFFO0VBQWdCLENBQUMsQ0FBQyxFQUM5Q3VMLEdBQUcsQ0FBQztJQUFFdE0sSUFBSSxFQUFFLE9BQU87SUFBRXVNLEtBQUssRUFBRXhDO0VBQU8sQ0FBQyxDQUFDO0VBQ3JDO0VBQ0E7RUFDQXVDLEdBQUcsQ0FBQztJQUFFdE0sSUFBSSxFQUFFO0VBQWUsQ0FBQyxDQUFDLEVBQzdCc00sR0FBRyxDQUFDO0lBQ0Z0TSxJQUFJLEVBQUUsTUFBTTtJQUNaeUUsU0FBUztJQUNUTSxXQUFXO0lBQ1g3RSxPQUFPO0lBQ1BzTSxjQUFjLEVBQUU7RUFDbEIsQ0FBQyxDQUFDLENBQ0gsQ0FBQ0MsSUFBSSxDQUFDLEVBQUUsQ0FBQztFQUVWLE9BQU87SUFDTDlILFFBQVE7SUFDUm9GLE1BQU07SUFDTkYsTUFBTSxFQUFFLFVBQVU7SUFDbEJwRixTQUFTO0lBQ1RNLFdBQVc7SUFDWEMsVUFBVTtJQUNWOUU7RUFDRixDQUFDO0FBQ0g7QUFFQSxTQUFTd04sb0NBQW9DQSxDQUFBLEVBQUc7RUFDOUMsTUFBTWpKLFNBQVMsR0FBRyxzQ0FBc0M7RUFDeEQsTUFBTU0sV0FBVyxHQUFHLHdDQUF3QztFQUM1RCxNQUFNcUUsV0FBVyxHQUFHLDJDQUEyQztFQUMvRCxNQUFNekUsUUFBUSxHQUFHLCtDQUErQztFQUNoRSxNQUFNb0YsTUFBTSxHQUNWLGtHQUFrRztFQUNwRyxNQUFNNEMsY0FBYyxHQUFHLGtCQUFrQjtFQUN6QyxNQUFNTCxHQUFHLEdBQUkxRCxLQUE4QixJQUN6QyxTQUFTbEgsSUFBSSxDQUFDQyxTQUFTLENBQUNpSCxLQUFLLENBQUMsTUFBTTtFQUN0QyxNQUFNNUQsVUFBVSxHQUFHLENBQ2pCc0gsR0FBRyxDQUFDO0lBQUV0TSxJQUFJLEVBQUUsaUJBQWlCO0lBQUV5RTtFQUFVLENBQUMsQ0FBQyxFQUMzQzZILEdBQUcsQ0FBQztJQUNGdE0sSUFBSSxFQUFFLG1CQUFtQjtJQUN6QitFLFdBQVc7SUFDWHhFLE1BQU0sRUFBRSxTQUFTO0lBQ2pCSSxTQUFTLEVBQUUsSUFBSTtJQUNmeUk7RUFDRixDQUFDLENBQUMsRUFDRmtELEdBQUcsQ0FBQztJQUNGdE0sSUFBSSxFQUFFLE9BQU87SUFDYitFLFdBQVc7SUFDWGdHLElBQUksRUFBRTRCLGNBQWM7SUFDcEJ6TSxPQUFPLEVBQUU7RUFDWCxDQUFDLENBQUMsQ0FDSCxDQUFDdU0sSUFBSSxDQUFDLEVBQUUsQ0FBQztFQUNWLE1BQU10SSxPQUF3QixHQUFHO0lBQy9CUSxRQUFRO0lBQ1JvRixNQUFNO0lBQ05GLE1BQU0sRUFBRSw4QkFBOEI7SUFDdENwRixTQUFTO0lBQ1RNLFdBQVc7SUFDWEMsVUFBVTtJQUNWOUUsT0FBTyxFQUFFO01BQ1BILEVBQUUsRUFBRSxzQ0FBc0M7TUFDMUMwRSxTQUFTO01BQ1RlLElBQUksRUFBRSxXQUFXO01BQ2pCQyxPQUFPLEVBQUVzRSxNQUFNO01BQ2ZuRSxPQUFPLEVBQUUsUUFBUTtNQUNqQmIsV0FBVztNQUNYeUksU0FBUyxFQUFFYixjQUFjO01BQ3pCYyxZQUFZLEVBQUUseUNBQXlDO01BQ3ZEck0sU0FBUyxFQUFFO0lBQ2I7RUFDRixDQUFDO0VBRUQsT0FBTztJQUNMK0MsT0FBTztJQUNQZ0YsU0FBUyxFQUFFO01BQ1RwSixFQUFFLEVBQUVnRixXQUFXO01BQ2ZyRixTQUFTLEVBQUUsYUFBYTtNQUN4QlksV0FBVyxFQUFFLHdDQUF3QztNQUNyRG1FLFNBQVM7TUFDVGxFLE1BQU0sRUFBRSxRQUFRO01BQ2hCQyxXQUFXLEVBQUUsUUFBUTtNQUNyQkMsZUFBZSxFQUFFLFlBQVk7TUFDN0JDLGFBQWEsRUFBRSxJQUFJO01BQ25CQyxTQUFTLEVBQUUsSUFBSTtNQUNmQyxpQkFBaUIsRUFBRSxDQUFDO01BQ3BCRSxVQUFVLEVBQUU7UUFDVkMsS0FBSyxFQUFFLGdCQUFnQjtRQUN2QkMsTUFBTSxFQUFFO01BQ1YsQ0FBQztNQUNEQyxTQUFTLEVBQUU7UUFBRUEsU0FBUyxFQUFFMEQ7TUFBUyxDQUFDO01BQ2xDc0IsS0FBSyxFQUFFLHlDQUF5QztNQUNoRC9FLFNBQVMsRUFBRSwwQkFBMEI7TUFDckNFLFNBQVMsRUFBRSwwQkFBMEI7TUFDckNDLFNBQVMsRUFBRTtJQUNiO0VBQ0YsQ0FBQztBQUNIO0FBRUEsU0FBU3NNLCtCQUErQkEsQ0FBQSxFQUFHO0VBQ3pDLE1BQU1sSixTQUFTLEdBQUcsZ0NBQWdDO0VBQ2xELE1BQU1NLFdBQVcsR0FBRyxrQ0FBa0M7RUFDdEQsTUFBTTZJLFlBQVksR0FBRywrQkFBK0I7RUFDcEQsTUFBTXZFLGNBQWMsR0FBRyxpQ0FBaUM7RUFDeEQsTUFBTTFFLFFBQVEsR0FBRyw2Q0FBNkM7RUFDOUQsTUFBTWtKLGFBQWEsR0FDakIsZ0VBQWdFO0VBQ2xFLE1BQU05RCxNQUFNLEdBQ1YsbUVBQW1FO0VBQ3JFLE1BQU03SixPQUFPLEdBQUc7SUFDZEgsRUFBRSxFQUFFLGdDQUFnQztJQUNwQzBFLFNBQVM7SUFDVGUsSUFBSSxFQUFFLFdBQVc7SUFDakJDLE9BQU8sRUFBRXNFLE1BQU07SUFDZmhGLFdBQVc7SUFDWGEsT0FBTyxFQUFFLFdBQVc7SUFDcEJ4RSxTQUFTLEVBQUU7RUFDYixDQUFDO0VBQ0QsTUFBTWtMLEdBQUcsR0FBSTFELEtBQThCLElBQ3pDLFNBQVNsSCxJQUFJLENBQUNDLFNBQVMsQ0FBQ2lILEtBQUssQ0FBQyxNQUFNO0VBQ3RDLE1BQU16RSxPQUF3QixHQUFHO0lBQy9CUSxRQUFRO0lBQ1JvRixNQUFNO0lBQ05GLE1BQU0sRUFBRSxnQkFBZ0I7SUFDeEJwRixTQUFTO0lBQ1RNLFdBQVc7SUFDWEMsVUFBVSxFQUFFLENBQ1ZzSCxHQUFHLENBQUM7TUFBRXRNLElBQUksRUFBRSxpQkFBaUI7TUFBRXlFO0lBQVUsQ0FBQyxDQUFDLEVBQzNDNkgsR0FBRyxDQUFDO01BQ0Z0TSxJQUFJLEVBQUUsbUJBQW1CO01BQ3pCK0UsV0FBVztNQUNYeEUsTUFBTSxFQUFFLFNBQVM7TUFDakJJLFNBQVMsRUFBRSxJQUFJO01BQ2Z5SSxXQUFXLEVBQUV3RTtJQUNmLENBQUMsQ0FBQyxFQUNGdEIsR0FBRyxDQUFDO01BQUV0TSxJQUFJLEVBQUUsT0FBTztNQUFFZSxLQUFLLEVBQUU7SUFBZ0IsQ0FBQyxDQUFDLEVBQzlDdUwsR0FBRyxDQUFDO01BQUV0TSxJQUFJLEVBQUUsT0FBTztNQUFFdU0sS0FBSyxFQUFFc0I7SUFBYyxDQUFDLENBQUMsQ0FDN0MsQ0FBQ3BCLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDVnZNO0VBQ0YsQ0FBQztFQUNELE9BQU87SUFDTGlFLE9BQU87SUFDUHlKLFlBQVk7SUFDWnZFLGNBQWM7SUFDZG5FLGlCQUFpQixFQUFFLENBQ2pCb0gsR0FBRyxDQUFDO01BQUV0TSxJQUFJLEVBQUUsaUJBQWlCO01BQUV5RTtJQUFVLENBQUMsQ0FBQyxFQUMzQzZILEdBQUcsQ0FBQztNQUNGdE0sSUFBSSxFQUFFLG1CQUFtQjtNQUN6QitFLFdBQVc7TUFDWHhFLE1BQU0sRUFBRSxTQUFTO01BQ2pCSSxTQUFTLEVBQUUsSUFBSTtNQUNmeUksV0FBVyxFQUFFQztJQUNmLENBQUMsQ0FBQyxFQUNGaUQsR0FBRyxDQUFDO01BQUV0TSxJQUFJLEVBQUUsT0FBTztNQUFFZSxLQUFLLEVBQUU7SUFBc0IsQ0FBQyxDQUFDLEVBQ3BEdUwsR0FBRyxDQUFDO01BQUV0TSxJQUFJLEVBQUUsT0FBTztNQUFFdU0sS0FBSyxFQUFFeEM7SUFBTyxDQUFDLENBQUMsRUFDckN1QyxHQUFHLENBQUM7TUFDRnRNLElBQUksRUFBRSxNQUFNO01BQ1p5RSxTQUFTO01BQ1RNLFdBQVc7TUFDWDdFLE9BQU87TUFDUHNNLGNBQWMsRUFBRTtJQUNsQixDQUFDLENBQUMsQ0FDSCxDQUFDQyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ1Z0RCxTQUFTLEVBQUU7TUFDVHBKLEVBQUUsRUFBRWdGLFdBQVc7TUFDZnJGLFNBQVMsRUFBRSxhQUFhO01BQ3hCWSxXQUFXLEVBQUUsa0NBQWtDO01BQy9DbUUsU0FBUztNQUNUbEUsTUFBTSxFQUFFLFFBQVE7TUFDaEJDLFdBQVcsRUFBRSxRQUFRO01BQ3JCRyxTQUFTLEVBQUUsSUFBSTtNQUNmQyxpQkFBaUIsRUFBRSxDQUFDO01BQ3BCRSxVQUFVLEVBQUU7UUFDVkMsS0FBSyxFQUFFLGVBQWU7UUFDdEJDLE1BQU0sRUFDSjtNQUNKLENBQUM7TUFDREMsU0FBUyxFQUFFO1FBQUVBLFNBQVMsRUFBRTBEO01BQVMsQ0FBQztNQUNsQ3pELFNBQVMsRUFBRSwwQkFBMEI7TUFDckNFLFNBQVMsRUFBRSwwQkFBMEI7TUFDckNDLFNBQVMsRUFBRTtJQUNiO0VBQ0YsQ0FBQztBQUNIO0FBRUEsZUFBZXlNLHNCQUFzQkEsQ0FBQ2pNLElBQVUsRUFBRTtFQUNoRCxNQUFNa00sU0FBUyxHQUFHelIsT0FBTyxDQUFDQyxHQUFHLENBQUN5UixnQkFBZ0I7RUFDOUMsSUFBSSxDQUFDRCxTQUFTLEVBQUU7SUFDZCxNQUFNLElBQUl4USxLQUFLLENBQ2IsK0VBQ0YsQ0FBQztFQUNIO0VBRUEsTUFBTWlFLE9BQU8sR0FBRztJQUNkeU0sYUFBYSxFQUFFLFVBQVVGLFNBQVMsRUFBRTtJQUNwQyxjQUFjLEVBQUU7RUFDbEIsQ0FBQztFQUNELE1BQU1HLFlBQVksR0FBRyxNQUFNck0sSUFBSSxDQUFDb0IsT0FBTyxDQUFDcUIsR0FBRyxDQUN6QyxnREFBZ0Q2SixrQkFBa0IsQ0FBQ2xTLFNBQVMsQ0FBQ0csS0FBSyxDQUFDLEVBQUUsRUFDckY7SUFBRW9GO0VBQVEsQ0FDWixDQUFDO0VBQ0QsSUFBSTRNLE1BQU0sR0FBR3RTLDRCQUE0QixDQUFDLE1BQU1vUyxZQUFZLENBQUNHLElBQUksQ0FBQyxDQUFDLENBQUM7RUFFcEUsSUFBSSxDQUFDRCxNQUFNLEVBQUU7SUFDWCxNQUFNRSxlQUFlLEdBQUcsTUFBTXpNLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUM3QyxnQ0FBZ0MsRUFDaEM7TUFDRTFCLE9BQU87TUFDUCtNLElBQUksRUFBRTtRQUNKQyxhQUFhLEVBQUUsQ0FBQ3ZTLFNBQVMsQ0FBQ0csS0FBSyxDQUFDO1FBQ2hDcVMsVUFBVSxFQUFFeFMsU0FBUyxDQUFDQyxTQUFTO1FBQy9Cd1MsU0FBUyxFQUFFelMsU0FBUyxDQUFDRSxRQUFRO1FBQzdCd1Msb0JBQW9CLEVBQUUsSUFBSTtRQUMxQkMseUJBQXlCLEVBQUU7TUFDN0I7SUFDRixDQUNGLENBQUM7SUFDRFIsTUFBTSxHQUFHclMsNkJBQTZCLENBQUMsTUFBTXVTLGVBQWUsQ0FBQ0QsSUFBSSxDQUFDLENBQUMsQ0FBQztFQUN0RTtFQUVBLElBQUksQ0FBQ0QsTUFBTSxFQUFFO0lBQ1gsTUFBTSxJQUFJN1EsS0FBSyxDQUNiLDJEQUNGLENBQUM7RUFDSDtFQUVBLE1BQU1zUixhQUFhLEdBQUcsTUFBTWhOLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUMzQyx5Q0FBeUMsRUFDekM7SUFBRTFCLE9BQU87SUFBRStNLElBQUksRUFBRTtNQUFFTyxPQUFPLEVBQUVWO0lBQU87RUFBRSxDQUN2QyxDQUFDO0VBQ0QsTUFBTVcsS0FBSyxHQUFHbFQsNkJBQTZCLENBQUMsTUFBTWdULGFBQWEsQ0FBQ1IsSUFBSSxDQUFDLENBQUMsQ0FBQztFQUV2RSxPQUFPLEdBQUcsSUFBSXpQLEdBQUcsQ0FBQzVDLGNBQWMsRUFBRTZGLElBQUksQ0FBQytCLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQ29MLFFBQVEsQ0FBQyxDQUFDLDBCQUEwQmIsa0JBQWtCLENBQUNZLEtBQUssQ0FBQyxFQUFFO0FBQy9HO0FBRUEsZUFBZUUsa0JBQWtCQSxDQUFDcE4sSUFBVSxFQUFFO0VBQUEsSUFBQXFOLHFCQUFBO0VBQzVDLE1BQU1yTixJQUFJLENBQUNzTixJQUFJLENBQUNuVCxjQUFjLENBQUM7RUFDL0IsTUFBTVIsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsTUFBTSxFQUFFO0lBQUVDLElBQUksRUFBRSxTQUFTO0lBQUVHLEtBQUssRUFBRTtFQUFLLENBQUMsQ0FDekQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztFQUVmLE1BQU0wTSxNQUFNLElBQUFGLHFCQUFBLEdBQ1ZHLFVBQVUsQ0FBQ0MsZUFBZSxjQUFBSixxQkFBQSxjQUFBQSxxQkFBQSxHQUMxQkcsVUFBVSxDQUFDRSxvQ0FBb0M7RUFDakQsSUFBSSxDQUFDSCxNQUFNLEVBQUU7SUFDWCxJQUFJOVMsT0FBTyxDQUFDQyxHQUFHLENBQUNpVCxpQ0FBaUMsS0FBSyxHQUFHLEVBQUU7TUFDekQsTUFBTSxJQUFJalMsS0FBSyxDQUNiLG9IQUNGLENBQUM7SUFDSDtJQUNBLE1BQU1zRSxJQUFJLENBQUNzTixJQUFJLENBQUMsTUFBTXJCLHNCQUFzQixDQUFDak0sSUFBSSxDQUFDLENBQUM7SUFDbkQsTUFBTXJHLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDNE4sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBRzFULGNBQWMsQ0FBQzJULFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEdBQUcsQ0FDeEQsQ0FBQztJQUNEO0VBQ0Y7RUFDQSxNQUFNQyxTQUFTLEdBQUcsTUFBTVIsTUFBTSxDQUFDO0lBQzdCLEdBQUduVCxTQUFTO0lBQ1o0VCxHQUFHLEVBQUUsR0FBRztJQUNSQyxRQUFRLEVBQUU5VDtFQUNaLENBQUMsQ0FBQztFQUNGLE1BQU02RixJQUFJLENBQUNzTixJQUFJLENBQUNTLFNBQVMsQ0FBQztFQUMxQixNQUFNcFUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUM0TixTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHMVQsY0FBYyxDQUFDMlQsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUN4RCxDQUFDO0FBQ0g7QUFFQSxlQUFlSSxjQUFjQSxDQUFDbE8sSUFBVSxFQUFFbU8sS0FBYSxFQUFFbk0sSUFBWSxFQUFFO0VBQ3JFLE1BQU1oQyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxNQUFNLEVBQUU7SUFBRUMsSUFBSSxFQUFFdU4sS0FBSztJQUFFcE4sS0FBSyxFQUFFO0VBQUssQ0FBQyxDQUFDLENBQUNxTixLQUFLLENBQUMsQ0FBQztFQUNsRSxNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUM0TixTQUFTLENBQUMsSUFBSUMsTUFBTSxDQUFDLEdBQUc3TCxJQUFJLENBQUM4TCxVQUFVLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUM3RTtBQUVBLFNBQVNPLE1BQU1BLENBQUNyTyxJQUFVLEVBQUVnQyxJQUFZLEVBQVU7RUFDaEQsTUFBTXNNLFVBQVUsR0FBRzdULE9BQU8sQ0FBQ0MsR0FBRyxDQUFDNlQsMEJBQTBCO0VBQ3pELE9BQU8sSUFBSXhSLEdBQUcsQ0FBQ2lGLElBQUksRUFBRXNNLFVBQVUsR0FBR0EsVUFBVSxHQUFHdE8sSUFBSSxDQUFDK0IsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDb0wsUUFBUSxDQUFDLENBQUM7QUFDdkU7QUFFQSxlQUFlcUIsV0FBV0EsQ0FDeEJ4TyxJQUFVLEVBQ1ZnQyxJQUFZLEVBQ1o0RixPQUErRCxFQUNwQjtFQUFBLElBQUE2RyxlQUFBO0VBQzNDLE9BQU96TyxJQUFJLENBQUNFLFFBQVEsQ0FDbEIsT0FBTztJQUFFNkIsR0FBRztJQUFFMk0sTUFBTTtJQUFFaFAsSUFBSTtJQUFFNEI7RUFBUSxDQUFDLEtBQUs7SUFDeEMsTUFBTUgsUUFBUSxHQUFHLE1BQU13TixLQUFLLENBQUM1TSxHQUFHLEVBQUU7TUFDaEMyTSxNQUFNO01BQ05FLFdBQVcsRUFBRSxTQUFTO01BQ3RCalAsT0FBTyxFQUNMRCxJQUFJLEtBQUttUCxTQUFTLEdBQ2RBLFNBQVMsR0FDVDtRQUFFLGNBQWMsRUFBRTtNQUFtQixDQUFDO01BQzVDblAsSUFBSSxFQUFFQSxJQUFJLEtBQUttUCxTQUFTLEdBQUdBLFNBQVMsR0FBR2hQLElBQUksQ0FBQ0MsU0FBUyxDQUFDSixJQUFJLENBQUM7TUFDM0RvUCxNQUFNLEVBQUV4TixPQUFPLEdBQUd5TixXQUFXLENBQUN6TixPQUFPLENBQUNBLE9BQU8sQ0FBQyxHQUFHdU47SUFDbkQsQ0FBQyxDQUFDO0lBQ0YsT0FBTztNQUFFblEsTUFBTSxFQUFFeUMsUUFBUSxDQUFDekMsTUFBTTtNQUFFZ0IsSUFBSSxFQUFFLE1BQU15QixRQUFRLENBQUM2TixJQUFJLENBQUM7SUFBRSxDQUFDO0VBQ2pFLENBQUMsRUFDRDtJQUNFak4sR0FBRyxFQUFFc00sTUFBTSxDQUFDck8sSUFBSSxFQUFFZ0MsSUFBSSxDQUFDO0lBQ3ZCME0sTUFBTSxHQUFBRCxlQUFBLEdBQUU3RyxPQUFPLGFBQVBBLE9BQU8sdUJBQVBBLE9BQU8sQ0FBRThHLE1BQU0sY0FBQUQsZUFBQSxjQUFBQSxlQUFBLEdBQUksS0FBSztJQUNoQy9PLElBQUksRUFBRWtJLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFbEksSUFBSTtJQUNuQjRCLE9BQU8sRUFBRXNHLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFdEc7RUFDcEIsQ0FDRixDQUFDO0FBQ0g7QUFTQSxNQUFNMk4seUJBQTZDLEdBQUcsRUFBRTtBQUV4RCxTQUFTQyxvQkFBb0JBLENBQUEsRUFBdUI7RUFDbEQsT0FBT3pVLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDeVUscUNBQXFDO0FBQzFEO0FBRUEsU0FBU0MscUJBQXFCQSxDQUM1QnpQLE9BQStCLEVBQ1A7RUFDeEIsT0FBTzBQLE1BQU0sQ0FBQ0MsV0FBVyxDQUN2QnRVLHlCQUF5QixDQUFDdVUsT0FBTyxDQUFFM08sSUFBSSxJQUNyQ2pCLE9BQU8sQ0FBQ2lCLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQ0EsSUFBSSxFQUFFakIsT0FBTyxDQUFDaUIsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQzVDLENBQ0YsQ0FBQztBQUNIO0FBRUEsZUFBZTRPLHNCQUFzQkEsQ0FBQSxFQUFHO0VBQ3RDLE1BQU1DLFVBQVUsR0FBR1Asb0JBQW9CLENBQUMsQ0FBQztFQUN6QyxJQUFJLENBQUNPLFVBQVUsRUFBRTtFQUNqQixNQUFNNVYsS0FBSyxDQUFDRSxPQUFPLENBQUMwVixVQUFVLENBQUMsRUFBRTtJQUFFQyxTQUFTLEVBQUU7RUFBSyxDQUFDLENBQUM7RUFDckQsTUFBTTVWLFNBQVMsQ0FDYjJWLFVBQVUsRUFDVixHQUFHNVAsSUFBSSxDQUFDQyxTQUFTLENBQUM7SUFBRTZQLFdBQVcsRUFBRVY7RUFBMEIsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUMxRSxNQUNGLENBQUM7QUFDSDtBQUVBLGVBQWVXLHFCQUFxQkEsQ0FBQzVQLElBQVUsRUFBRXRELE1BQWMsRUFBRTtFQUMvRCxNQUFNNFIsVUFBVSxHQUFHN1QsT0FBTyxDQUFDQyxHQUFHLENBQUM2VCwwQkFBMEI7RUFDekQsSUFBSSxDQUFDRCxVQUFVLEVBQUU7SUFDZixNQUFNLElBQUk1UyxLQUFLLENBQ2IsMkRBQ0YsQ0FBQztFQUNIO0VBQ0EsTUFBTW1VLFNBQVMsR0FBRyxJQUFJOVMsR0FBRyxDQUFDLGNBQWMsRUFBRXVSLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUM7RUFDaEUsTUFBTTJDLFdBQVcsR0FBRyxJQUFJL1MsR0FBRyxDQUFDLGNBQWMsRUFBRXVSLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUM7RUFDbEUsTUFBTTRDLGFBQWEsR0FBRztJQUFFQyxNQUFNLEVBQUV0VDtFQUFPLENBQUM7RUFFeEMsTUFBTWlULFdBQStCLEdBQUcsRUFBRTtFQUMxQyxNQUFNTSxLQUFLLEdBQUcsTUFBQUEsQ0FDWmpMLEtBQWdDLEVBQ2hDNUQsT0FBOEQsRUFDOUQ4TyxTQUVrQixLQUNmO0lBQ0gsSUFBSTtNQUNGLE1BQU0vTyxRQUFRLEdBQUcsTUFBTUMsT0FBTyxDQUFDLENBQUM7TUFDaEN1TyxXQUFXLENBQUN6TCxJQUFJLENBQUM7UUFDZnhILE1BQU07UUFDTnNJLEtBQUs7UUFDTHRHLE1BQU0sRUFBRXlDLFFBQVEsQ0FBQ3pDLE1BQU0sQ0FBQyxDQUFDO1FBQ3pCaUIsT0FBTyxFQUFFeVAscUJBQXFCLENBQUNqTyxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQztNQUNuRCxDQUFDLENBQUM7TUFDRnNQLHlCQUF5QixDQUFDL0ssSUFBSSxDQUFDeUwsV0FBVyxDQUFDUSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUUsQ0FBQztNQUNuRCxNQUFNRCxTQUFTLENBQUMvTyxRQUFRLENBQUM7SUFDM0IsQ0FBQyxDQUFDLE9BQU9pRCxLQUFLLEVBQUU7TUFDZCxNQUFNZ00sT0FBTyxHQUFHVCxXQUFXLENBQUNRLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUNsQyxJQUFJLENBQUFDLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFcEwsS0FBSyxNQUFLQSxLQUFLLEVBQUU7UUFDNUIySyxXQUFXLENBQUN6TCxJQUFJLENBQUM7VUFBRXhILE1BQU07VUFBRXNJO1FBQU0sQ0FBQyxDQUFDO01BQ3JDO01BQ0EySyxXQUFXLENBQUNRLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFFL0wsS0FBSyxHQUFHLHFCQUFxQjtNQUNqRCxNQUFNb0wsc0JBQXNCLENBQUMsQ0FBQztNQUM5QixNQUFNcEwsS0FBSztJQUNiO0VBQ0YsQ0FBQztFQUVELE1BQU02TCxLQUFLLENBQ1QsS0FBSyxFQUNMLE1BQU1qUSxJQUFJLENBQUNvQixPQUFPLENBQUNxQixHQUFHLENBQUNvTixTQUFTLEVBQUU7SUFBRWxRLE9BQU8sRUFBRW9RO0VBQWMsQ0FBQyxDQUFDLEVBQzdELE1BQU81TyxRQUFRLElBQUs7SUFDbEJ4SCxNQUFNLENBQUN3SCxRQUFRLENBQUN6QyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUdoQyxNQUFNLDBCQUEwQixDQUFDLENBQUM2RSxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ3hFNUgsTUFBTSxDQUFDd0gsUUFBUSxDQUFDeEIsT0FBTyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLENBQUM0QixJQUFJLENBQUM3RSxNQUFNLENBQUM7SUFDdEUvQyxNQUFNLENBQUN3SCxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsQ0FBQzRCLElBQUksQ0FDakUsTUFDRixDQUFDO0VBQ0gsQ0FDRixDQUFDO0VBQ0QsTUFBTTBPLEtBQUssQ0FDVCxXQUFXLEVBQ1gsTUFDRWpRLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ3VOLEtBQUssQ0FBQ21CLFdBQVcsRUFBRTtJQUM5QnBCLE1BQU0sRUFBRSxTQUFTO0lBQ2pCL08sT0FBTyxFQUFFO01BQ1AsR0FBR29RLGFBQWE7TUFDaEIsK0JBQStCLEVBQUUsTUFBTTtNQUN2QyxnQ0FBZ0MsRUFBRTtJQUNwQztFQUNGLENBQUMsQ0FBQyxFQUNKLE1BQU81TyxRQUFRLElBQUs7SUFBQSxJQUFBa1AscUJBQUEsRUFBQUMsc0JBQUE7SUFDbEIzVyxNQUFNLENBQUN3SCxRQUFRLENBQUN6QyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUdoQyxNQUFNLDRCQUE0QixDQUFDLENBQUM2RSxJQUFJLENBQ25FLEdBQ0YsQ0FBQztJQUNENUgsTUFBTSxDQUFDd0gsUUFBUSxDQUFDeEIsT0FBTyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLENBQUM0QixJQUFJLENBQUM3RSxNQUFNLENBQUM7SUFDdEUvQyxNQUFNLENBQ0p3SCxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLEVBQ3RELEdBQUdqRCxNQUFNLGlDQUNYLENBQUMsQ0FBQzZFLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDZDVILE1BQU0sRUFBQTBXLHFCQUFBLEdBQ0psUCxRQUFRLENBQ0x4QixPQUFPLENBQUMsQ0FBQyxDQUNULDhCQUE4QixDQUFDLGNBQUEwUSxxQkFBQSx1QkFGbENBLHFCQUFBLENBRW9DN1QsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUMzQ0MsR0FBRyxDQUFFaVMsTUFBTSxJQUFLQSxNQUFNLENBQUNsVCxJQUFJLENBQUMsQ0FBQyxDQUFDK1UsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUMvQyxHQUFHN1QsTUFBTSw2QkFDWCxDQUFDLENBQUM4VCxTQUFTLENBQUMsTUFBTSxDQUFDO0lBQ25CN1csTUFBTSxFQUFBMlcsc0JBQUEsR0FDSm5QLFFBQVEsQ0FDTHhCLE9BQU8sQ0FBQyxDQUFDLENBQ1QsOEJBQThCLENBQUMsY0FBQTJRLHNCQUFBLHVCQUZsQ0Esc0JBQUEsQ0FFb0M5VCxLQUFLLENBQUMsR0FBRyxDQUFDLENBQzNDQyxHQUFHLENBQUVnVSxNQUFNLElBQUtBLE1BQU0sQ0FBQ2pWLElBQUksQ0FBQyxDQUFDLENBQUNxTCxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQy9DLEdBQUduSyxNQUFNLDZCQUNYLENBQUMsQ0FBQzhULFNBQVMsQ0FBQyxjQUFjLENBQUM7RUFDN0IsQ0FDRixDQUFDO0VBQ0QsTUFBTVAsS0FBSyxDQUNULFVBQVUsRUFDVixNQUNFalEsSUFBSSxDQUFDb0IsT0FBTyxDQUFDQyxJQUFJLENBQUN5TyxXQUFXLEVBQUU7SUFDN0JuUSxPQUFPLEVBQUU7TUFBRSxHQUFHb1EsYUFBYTtNQUFFLGNBQWMsRUFBRTtJQUFtQixDQUFDO0lBQ2pFckQsSUFBSSxFQUFFO01BQUVyTyxPQUFPLEVBQUU7SUFBa0I7RUFDckMsQ0FBQyxDQUFDLEVBQ0osTUFBTzhDLFFBQVEsSUFBSztJQUNsQnhILE1BQU0sQ0FDSndILFFBQVEsQ0FBQ3pDLE1BQU0sQ0FBQyxDQUFDLEVBQ2pCLEdBQUdoQyxNQUFNLHFEQUNYLENBQUMsQ0FBQ2dVLEdBQUcsQ0FBQ25QLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDZjVILE1BQU0sQ0FBQ3dILFFBQVEsQ0FBQ3hCLE9BQU8sQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDNEIsSUFBSSxDQUFDN0UsTUFBTSxDQUFDO0lBQ3RFL0MsTUFBTSxDQUFDd0gsUUFBUSxDQUFDeEIsT0FBTyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLENBQUM0QixJQUFJLENBQ2pFLE1BQ0YsQ0FBQztFQUNILENBQ0YsQ0FBQztFQUNELE1BQU1pTyxzQkFBc0IsQ0FBQyxDQUFDO0FBQ2hDO0FBRUEsZUFBZW1CLDJCQUEyQkEsQ0FBQzNRLElBQVUsRUFBRTtFQUNyRCxNQUFNc08sVUFBVSxHQUFHN1QsT0FBTyxDQUFDQyxHQUFHLENBQUM2VCwwQkFBMEI7RUFDekQsSUFBSSxDQUFDRCxVQUFVLEVBQ2IsTUFBTSxJQUFJNVMsS0FBSyxDQUNiLDJEQUNGLENBQUM7RUFDSCxNQUFNb1UsV0FBVyxHQUFHLElBQUkvUyxHQUFHLENBQUMsY0FBYyxFQUFFdVIsVUFBVSxDQUFDLENBQUNuQixRQUFRLENBQUMsQ0FBQztFQUNsRSxNQUFNeUQsU0FBUyxHQUFHLElBQUk3VCxHQUFHLENBQUMscUJBQXFCLEVBQUV1UixVQUFVLENBQUMsQ0FBQ25CLFFBQVEsQ0FBQyxDQUFDO0VBQ3ZFLE1BQU0wRCxhQUFhLEdBQUcsSUFBSTlULEdBQUcsQ0FBQyxxQkFBcUIsRUFBRXVSLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUM7RUFDM0UsTUFBTTJELFVBQTRCLEdBQUc7SUFDbkNwVSxNQUFNLEVBQUUzQixjQUFjO0lBQ3RCaUssS0FBSyxFQUFFO0VBQ1QsQ0FBQztFQUNEaUsseUJBQXlCLENBQUMvSyxJQUFJLENBQUM0TSxVQUFVLENBQUM7RUFDMUMsSUFBSTtJQUNGLE1BQU0zUCxRQUFRLEdBQUcsTUFBTW5CLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDeU8sV0FBVyxFQUFFO01BQ3BEblEsT0FBTyxFQUFFO1FBQ1BxUSxNQUFNLEVBQUVqVixjQUFjO1FBQ3RCLGNBQWMsRUFBRTtNQUNsQixDQUFDO01BQ0QyUixJQUFJLEVBQUU7UUFBRXJPLE9BQU8sRUFBRTtNQUEwQjtJQUM3QyxDQUFDLENBQUM7SUFDRnlTLFVBQVUsQ0FBQ3BTLE1BQU0sR0FBR3lDLFFBQVEsQ0FBQ3pDLE1BQU0sQ0FBQyxDQUFDO0lBQ3JDb1MsVUFBVSxDQUFDblIsT0FBTyxHQUFHeVAscUJBQXFCLENBQUNqTyxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDO0lBQzlEaEcsTUFBTSxDQUFDd0gsUUFBUSxDQUFDekMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDNkMsSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUNuQzVILE1BQU0sQ0FBQ3dILFFBQVEsQ0FBQ3hCLE9BQU8sQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDb1IsYUFBYSxDQUFDLENBQUM7SUFDekVwWCxNQUFNLENBQ0p3SCxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUN2RCxDQUFDLENBQUNvUixhQUFhLENBQUMsQ0FBQztJQUVqQixNQUFNQyxhQUFhLEdBQUcsTUFBTWhSLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDdVAsU0FBUyxFQUFFO01BQ3ZEalIsT0FBTyxFQUFFO1FBQUVxUSxNQUFNLEVBQUVqVjtNQUFlLENBQUM7TUFDbkNrVyxTQUFTLEVBQUU7UUFDVEMsT0FBTyxFQUFFO1VBQ1B0USxJQUFJLEVBQUUsK0JBQStCO1VBQ3JDdVEsUUFBUSxFQUFFLGlCQUFpQjtVQUMzQkMsTUFBTSxFQUFFMU0sTUFBTSxDQUFDQyxJQUFJLENBQUMsZ0JBQWdCO1FBQ3RDO01BQ0Y7SUFDRixDQUFDLENBQUM7SUFDRmhMLE1BQU0sQ0FBQ3FYLGFBQWEsQ0FBQ3RTLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQzZDLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDeEM1SCxNQUFNLENBQ0pxWCxhQUFhLENBQUNyUixPQUFPLENBQUMsQ0FBQyxDQUFDLDZCQUE2QixDQUN2RCxDQUFDLENBQUNvUixhQUFhLENBQUMsQ0FBQztJQUVqQixNQUFNTSxpQkFBaUIsR0FBRyxNQUFNclIsSUFBSSxDQUFDb0IsT0FBTyxDQUFDQyxJQUFJLENBQUN3UCxhQUFhLEVBQUU7TUFDL0RsUixPQUFPLEVBQUU7UUFDUHFRLE1BQU0sRUFBRWpWLGNBQWM7UUFDdEIsY0FBYyxFQUFFO01BQ2xCLENBQUM7TUFDRDJSLElBQUksRUFBRSxDQUFDO0lBQ1QsQ0FBQyxDQUFDO0lBQ0YvUyxNQUFNLENBQUMwWCxpQkFBaUIsQ0FBQzNTLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQzZDLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDNUM1SCxNQUFNLENBQ0owWCxpQkFBaUIsQ0FBQzFSLE9BQU8sQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQzNELENBQUMsQ0FBQ29SLGFBQWEsQ0FBQyxDQUFDO0VBQ25CLENBQUMsQ0FBQyxPQUFPM00sS0FBSyxFQUFFO0lBQ2QwTSxVQUFVLENBQUMxTSxLQUFLLEdBQUcsK0JBQStCO0lBQ2xELE1BQU1vTCxzQkFBc0IsQ0FBQyxDQUFDO0lBQzlCLE1BQU1wTCxLQUFLO0VBQ2I7RUFDQSxNQUFNb0wsc0JBQXNCLENBQUMsQ0FBQztBQUNoQztBQUVBLFNBQVM4QixRQUFRQSxDQUFDNVIsSUFBWSxFQUFrQztFQUM5RCxPQUFPQSxJQUFJLENBQUNsRCxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMrUyxPQUFPLENBQUVnQyxLQUFLLElBQUs7SUFBQSxJQUFBQyxpQkFBQTtJQUM1QyxNQUFNOUUsSUFBSSxJQUFBOEUsaUJBQUEsR0FBR0QsS0FBSyxDQUNmL1UsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUNYZ0gsSUFBSSxDQUFFaU8sSUFBSSxJQUFLQSxJQUFJLENBQUNqTixVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsY0FBQWdOLGlCQUFBLHVCQUYvQkEsaUJBQUEsQ0FHVHBLLEtBQUssQ0FBQyxRQUFRLENBQUN2SyxNQUFNLENBQUM7SUFDMUIsSUFBSSxDQUFDNlAsSUFBSSxFQUFFLE9BQU8sRUFBRTtJQUNwQixJQUFJO01BQ0YsTUFBTXpGLEtBQUssR0FBR3BILElBQUksQ0FBQzZSLEtBQUssQ0FBQ2hGLElBQUksQ0FBWTtNQUN6QyxPQUFPekYsS0FBSyxJQUFJLE9BQU9BLEtBQUssS0FBSyxRQUFRLEdBQ3JDLENBQUNBLEtBQUssQ0FBNEIsR0FDbEMsRUFBRTtJQUNSLENBQUMsQ0FBQyxNQUFNO01BQ04sT0FBTyxFQUFFO0lBQ1g7RUFDRixDQUFDLENBQUM7QUFDSjtBQUVBLGVBQWUwSyxRQUFRQSxDQUNyQjNSLElBQVUsRUFDVmdDLElBQVksRUFDa0I7RUFDOUIsTUFBTWIsUUFBUSxHQUFHLE1BQU1xTixXQUFXLENBQUN4TyxJQUFJLEVBQUVnQyxJQUFJLENBQUM7RUFDOUMsSUFBSWIsUUFBUSxDQUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBSXlDLFFBQVEsQ0FBQ3pDLE1BQU0sSUFBSSxHQUFHLEVBQUU7SUFDbkQsTUFBTSxJQUFJaEQsS0FBSyxDQUNiLG9DQUFvQ3NHLElBQUksS0FBS2IsUUFBUSxDQUFDekMsTUFBTSxHQUM5RCxDQUFDO0VBQ0g7RUFDQSxPQUFPbUIsSUFBSSxDQUFDNlIsS0FBSyxDQUFDdlEsUUFBUSxDQUFDekIsSUFBSSxDQUFDO0FBQ2xDO0FBRUEsZUFBZWtTLFNBQVNBLENBQ3RCNVIsSUFBVSxFQUNWZ0MsSUFBWSxFQUN5QjtFQUNyQyxNQUFNYixRQUFRLEdBQUcsTUFBTXFOLFdBQVcsQ0FBQ3hPLElBQUksRUFBRWdDLElBQUksQ0FBQztFQUM5QyxJQUFJYixRQUFRLENBQUN6QyxNQUFNLEtBQUssR0FBRyxFQUFFLE9BQU8sRUFBRTtFQUN0QyxJQUFJeUMsUUFBUSxDQUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBSXlDLFFBQVEsQ0FBQ3pDLE1BQU0sSUFBSSxHQUFHLEVBQUU7SUFDbkQsTUFBTSxJQUFJaEQsS0FBSyxDQUNiLG9DQUFvQ3NHLElBQUksS0FBS2IsUUFBUSxDQUFDekMsTUFBTSxHQUM5RCxDQUFDO0VBQ0g7RUFDQSxNQUFNdUksS0FBSyxHQUFHcEgsSUFBSSxDQUFDNlIsS0FBSyxDQUFDdlEsUUFBUSxDQUFDekIsSUFBSSxDQUFDO0VBQ3ZDLE9BQU9tUyxLQUFLLENBQUNDLE9BQU8sQ0FBQzdLLEtBQUssQ0FBQyxHQUFHQSxLQUFLLEdBQUcsRUFBRTtBQUMxQztBQUVBLGVBQWU4SyxrQkFBa0JBLENBQy9CL1IsSUFBVSxFQUNWZ0MsSUFBWSxFQUM4QjtFQUMxQyxNQUFNYixRQUFRLEdBQUcsTUFBTXFOLFdBQVcsQ0FBQ3hPLElBQUksRUFBRWdDLElBQUksQ0FBQztFQUM5QyxJQUFJYixRQUFRLENBQUN6QyxNQUFNLEtBQUssR0FBRyxFQUFFLE9BQU9tUSxTQUFTO0VBQzdDLElBQUkxTixRQUFRLENBQUN6QyxNQUFNLEdBQUcsR0FBRyxJQUFJeUMsUUFBUSxDQUFDekMsTUFBTSxJQUFJLEdBQUcsRUFBRTtJQUNuRCxNQUFNLElBQUloRCxLQUFLLENBQ2Isb0NBQW9Dc0csSUFBSSxLQUFLYixRQUFRLENBQUN6QyxNQUFNLEdBQzlELENBQUM7RUFDSDtFQUNBLE1BQU11SSxLQUFLLEdBQUdwSCxJQUFJLENBQUM2UixLQUFLLENBQUN2USxRQUFRLENBQUN6QixJQUFJLENBQUM7RUFDdkMsT0FBT3VILEtBQUssSUFBSSxPQUFPQSxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUM0SyxLQUFLLENBQUNDLE9BQU8sQ0FBQzdLLEtBQUssQ0FBQyxHQUM3REEsS0FBSyxHQUNONEgsU0FBUztBQUNmO0FBRUFqVixJQUFJLENBQUNvWSxRQUFRLENBQUMseUNBQXlDLEVBQUUsTUFBTTtFQUM3RHBZLElBQUksQ0FBQywrREFBK0QsRUFBRSxPQUFPO0lBQzNFb0c7RUFDRixDQUFDLEtBQUs7SUFBQSxJQUFBaVMscUJBQUEsRUFBQUMscUJBQUEsRUFBQUMscUJBQUEsRUFBQUMsZUFBQSxFQUFBQyxnQkFBQSxFQUFBQyxzQkFBQTtJQUNKO0lBQ0E7SUFDQTFZLElBQUksQ0FBQzJZLFVBQVUsQ0FBQ3hXLGFBQWEsQ0FBQyxDQUFDLEdBQUdqQiwyQkFBMkIsQ0FBQztJQUM5RGxCLElBQUksQ0FBQzRZLElBQUksQ0FDUC9YLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDK1gsMkJBQTJCLEtBQUssR0FBRyxFQUMvQywwQ0FDRixDQUFDO0lBQ0QsSUFBSWhZLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDZ1ksNkJBQTZCLEtBQUssR0FBRyxFQUFFO01BQ3JELE1BQU0sSUFBSWhYLEtBQUssQ0FDYiwwRkFDRixDQUFDO0lBQ0g7SUFDQSxNQUFNaVgsZ0JBQWdCLEdBQUd2WCxvQkFBb0IsQ0FBQyxDQUFDO0lBQy9DLE1BQU15QyxTQUFTLEdBQUdwRCxPQUFPLENBQUNDLEdBQUcsQ0FBQ2tZLDZCQUE2QjtJQUMzRCxJQUFJLENBQUMvVSxTQUFTLEVBQ1osTUFBTSxJQUFJbkMsS0FBSyxDQUNiLDBFQUNGLENBQUM7SUFFSCxNQUFNMFIsa0JBQWtCLENBQUNwTixJQUFJLENBQUM7SUFDOUIsTUFBTTZTLGNBQWMsR0FBRyxNQUFNckUsV0FBVyxDQUFDeE8sSUFBSSxFQUFFLHFCQUFxQixFQUFFO01BQ3BFME8sTUFBTSxFQUFFLE1BQU07TUFDZHBOLE9BQU8sRUFBRXZGLGFBQWEsQ0FBQyxDQUFDO01BQ3hCMkQsSUFBSSxFQUFFO1FBQ0o3QixTQUFTO1FBQ1JRLE9BQU8sRUFBRXpDLFVBQVUsQ0FBQyxDQUFDO1FBQ3RCa1gsY0FBYyxFQUFFLGtCQUFrQkMsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQztNQUM5QztJQUNGLENBQUMsQ0FBQztJQUNGLElBQUlILGNBQWMsQ0FBQ25VLE1BQU0sR0FBRyxHQUFHLElBQUltVSxjQUFjLENBQUNuVSxNQUFNLElBQUksR0FBRyxFQUFFO01BQy9ELE1BQU0sSUFBSWhELEtBQUssQ0FDYiwwQ0FBMENtWCxjQUFjLENBQUNuVSxNQUFNLElBQ2pFLENBQUM7SUFDSDtJQUNBLE1BQU11VSxTQUFTLEdBQUczQixRQUFRLENBQUN1QixjQUFjLENBQUNuVCxJQUFJLENBQUM7SUFDL0MsTUFBTXdULE9BQU8sR0FBR0QsU0FBUyxDQUFDelAsSUFBSSxDQUMzQnVELEtBQUssSUFBS0EsS0FBSyxDQUFDNUksSUFBSSxLQUFLLG1CQUM1QixDQUFDO0lBQ0QsTUFBTStFLFdBQVcsR0FDZixRQUFPZ1EsT0FBTyxhQUFQQSxPQUFPLHVCQUFQQSxPQUFPLENBQUVoUSxXQUFXLE1BQUssUUFBUSxHQUNwQ2dRLE9BQU8sQ0FBQ2hRLFdBQVcsR0FDbkIyTCxTQUFTO0lBQ2YsSUFBSSxDQUFDM0wsV0FBVyxFQUNkLE1BQU0sSUFBSXhILEtBQUssQ0FBQyxzREFBc0QsQ0FBQztJQUV6RSxJQUFJNEwsU0FBOEIsR0FBRyxDQUFDLENBQUM7SUFDdkMsTUFBTTZMLFFBQVEsR0FBR0osSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQyxHQUFHalgsYUFBYSxDQUFDLENBQUM7SUFDN0MsT0FBT2dYLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBR0csUUFBUSxFQUFFO01BQzVCN0wsU0FBUyxHQUFHLE1BQU1xSyxRQUFRLENBQUMzUixJQUFJLEVBQUUsc0JBQXNCa0QsV0FBVyxFQUFFLENBQUM7TUFDckUsSUFDRSxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsV0FBVyxDQUFDLENBQUNPLFFBQVEsQ0FBQzJQLE1BQU0sQ0FBQzlMLFNBQVMsQ0FBQzVJLE1BQU0sQ0FBQyxDQUFDLEVBRXZFO01BQ0YsTUFBTSxJQUFJMlUsT0FBTyxDQUFFQyxPQUFPLElBQUtmLFVBQVUsQ0FBQ2UsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQzFEO0lBQ0EsSUFDRSxDQUFDLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQzdQLFFBQVEsQ0FBQzJQLE1BQU0sQ0FBQzlMLFNBQVMsQ0FBQzVJLE1BQU0sQ0FBQyxDQUFDLEVBQ3hFO01BQ0EsTUFBTSxJQUFJaEQsS0FBSyxDQUNiLHdFQUNGLENBQUM7SUFDSDtJQUVBLE1BQU1rSCxTQUFTLEdBQUd3USxNQUFNLENBQUM5TCxTQUFTLENBQUMxRSxTQUFTLENBQUM7SUFDN0MsTUFBTTJRLFFBQVEsR0FBRyxNQUFNM0IsU0FBUyxDQUM5QjVSLElBQUksRUFDSixnQkFBZ0I0QyxTQUFTLFdBQzNCLENBQUM7SUFDRCxNQUFNZ0UsTUFBTSxHQUFHLE1BQU1nTCxTQUFTLENBQzVCNVIsSUFBSSxFQUNKLHlCQUF5QnNNLGtCQUFrQixDQUFDek8sU0FBUyxDQUFDLGtCQUFrQnlPLGtCQUFrQixDQUFDOEcsTUFBTSxFQUFBbkIscUJBQUEsR0FBQzNLLFNBQVMsQ0FBQzdJLFdBQVcsY0FBQXdULHFCQUFBLGNBQUFBLHFCQUFBLEdBQUksRUFBRSxDQUFDLENBQUMsRUFDakksQ0FBQztJQUNELE1BQU11QixRQUFRLEdBQUcsTUFBTXpCLGtCQUFrQixDQUN2Qy9SLElBQUksRUFDSixnQkFBZ0I0QyxTQUFTLG1CQUMzQixDQUFDO0lBQ0QsTUFBTTZRLE1BQU0sR0FBRyxNQUFNOUIsUUFBUSxDQUFDM1IsSUFBSSxFQUFFLGlCQUFpQm5DLFNBQVMsVUFBVSxDQUFDO0lBQ3pFLE1BQU02VixjQUFjLEdBQUcsTUFBTS9CLFFBQVEsQ0FBQzNSLElBQUksRUFBRSx5QkFBeUIsQ0FBQztJQUN0RSxNQUFNMlQsY0FBYyxHQUFHLE1BQU1oQyxRQUFRLENBQUMzUixJQUFJLEVBQUUsZ0JBQWdCLENBQUM7SUFDN0QsTUFBTWYsVUFBVSxHQUNkcUksU0FBUyxDQUFDckksVUFBVSxJQUFJLE9BQU9xSSxTQUFTLENBQUNySSxVQUFVLEtBQUssUUFBUSxHQUMzRHFJLFNBQVMsQ0FBQ3JJLFVBQVUsR0FDckIsQ0FBQyxDQUFDO0lBQ1IsTUFBTTJVLFdBQVcsR0FBRy9CLEtBQUssQ0FBQ0MsT0FBTyxDQUFDN1MsVUFBVSxDQUFDMlUsV0FBVyxDQUFDLEdBQ3JEM1UsVUFBVSxDQUFDMlUsV0FBVyxHQUN0QixFQUFFO0lBQ04sTUFBTUMsVUFBVSxHQUFHRCxXQUFXLENBQUNqWCxNQUFNLENBQ2xDbVgsSUFBSSxJQUFLLENBQUFBLElBQUksYUFBSkEsSUFBSSx1QkFBSkEsSUFBSSxDQUFFakwsSUFBSSxNQUFLLFlBQzNCLENBQUM7SUFDRCxNQUFNN0osZUFBZSxHQUNuQixPQUFPc0ksU0FBUyxDQUFDdEksZUFBZSxLQUFLLFFBQVEsR0FDekNzSSxTQUFTLENBQUN0SSxlQUFlLEdBQ3pCNlAsU0FBUztJQUNmLE1BQU1rRixhQUFhLEdBQUdGLFVBQVUsQ0FDN0JwWCxHQUFHLENBQUVxWCxJQUFJO01BQUEsSUFBQUUscUJBQUEsRUFBQUMsZ0JBQUE7TUFBQSxRQUFBRCxxQkFBQSxHQUFLRixJQUFJLGFBQUpBLElBQUksZ0JBQUFHLGdCQUFBLEdBQUpILElBQUksQ0FBRUQsVUFBVSxjQUFBSSxnQkFBQSx1QkFBaEJBLGdCQUFBLENBQWtCRixhQUFhLGNBQUFDLHFCQUFBLGNBQUFBLHFCQUFBLEdBQUlGLElBQUksYUFBSkEsSUFBSSx1QkFBSkEsSUFBSSxDQUFFQyxhQUFhO0lBQUEsRUFBQyxDQUNyRXZRLElBQUksQ0FBRXlELEtBQUssSUFBc0IsT0FBT0EsS0FBSyxLQUFLLFFBQVEsSUFBSUEsS0FBSyxDQUFDcEssTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNsRixNQUFNcVgsaUJBQWlCLEdBQ3JCLE9BQU81TSxTQUFTLENBQUM0TSxpQkFBaUIsS0FBSyxRQUFRLEdBQzNDNU0sU0FBUyxDQUFDNE0saUJBQWlCLEdBQzNCSCxhQUFhLEdBQ1gsYUFBYUEsYUFBYSxFQUFFLEdBQzVCLGFBQWEvVSxlQUFlLGFBQWZBLGVBQWUsY0FBZkEsZUFBZSxHQUFJLFNBQVMsRUFBRTtJQUNuRCxJQUFJLENBQUNBLGVBQWUsRUFBRTtNQUNwQixNQUFNLElBQUl0RCxLQUFLLENBQUMsd0RBQXdELENBQUM7SUFDM0U7SUFDQSxJQUNFakIsT0FBTyxDQUFDQyxHQUFHLENBQUNlLDJCQUEyQixLQUFLLEdBQUcsS0FDOUMsQ0FBQ3lZLGlCQUFpQixJQUFJLENBQUNsVixlQUFlLENBQUMsRUFDeEM7TUFDQSxNQUFNLElBQUl0RCxLQUFLLENBQUMsd0VBQXdFLENBQUM7SUFDM0Y7SUFDQSxNQUFNeVksYUFBYSxHQUFHUCxXQUFXLENBQUNRLE1BQU0sQ0FDdEMsQ0FBQ0MsS0FBSyxFQUFFUCxJQUFJLEtBQUtPLEtBQUssSUFBSXBZLE1BQU0sQ0FBQzZYLElBQUksYUFBSkEsSUFBSSx1QkFBSkEsSUFBSSxDQUFFeEsscUJBQXFCLENBQUMsSUFBSSxDQUFDLENBQUMsRUFDbkUsQ0FDRixDQUFDO0lBQ0QsTUFBTWdMLGFBQWEsR0FBR2xCLE1BQU0sRUFBQWxCLHFCQUFBLEdBQzFCNUssU0FBUyxDQUFDM0ksV0FBVyxjQUFBdVQscUJBQUEsY0FBQUEscUJBQUEsR0FBSTVLLFNBQVMsQ0FBQzVJLE1BQ3JDLENBQUMsQ0FBQzZSLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWdFLGFBQWEsR0FBRyxJQUFJcFosR0FBRyxDQUFDLENBQzVCLFdBQVcsRUFDWCxrQkFBa0IsRUFDbEIsU0FBUyxFQUNULFdBQVcsRUFDWCxRQUFRLENBQ1QsQ0FBQztJQUNGLElBQ0V3WCxnQkFBZ0IsS0FBSyxrQkFBa0IsSUFDdkM0QixhQUFhLENBQUM1WSxHQUFHLENBQUMyWSxhQUFhLENBQUMsSUFDaEMsQ0FBQ1AsYUFBYSxFQUNkO01BQ0EsTUFBTSxJQUFJclksS0FBSyxDQUNiLGtGQUNGLENBQUM7SUFDSDtJQUNBLE1BQU04WSxjQUFjLEdBQUc7TUFDckJDLE9BQU8sRUFBRTdOLE1BQU0sQ0FBQ00sSUFBSSxDQUFFSCxLQUFLLElBQUssQ0FBQUEsS0FBSyxhQUFMQSxLQUFLLHVCQUFMQSxLQUFLLENBQUU1SSxJQUFJLE1BQUssa0JBQWtCLENBQUM7TUFDbkV1VyxTQUFTLEVBQUU5TixNQUFNLENBQUNNLElBQUksQ0FBRUgsS0FBSyxJQUFLLENBQUFBLEtBQUssYUFBTEEsS0FBSyx1QkFBTEEsS0FBSyxDQUFFNUksSUFBSSxNQUFLLGtCQUFrQixDQUFDO01BQ3JFd1csTUFBTSxFQUFFL04sTUFBTSxDQUFDTSxJQUFJLENBQUVILEtBQUssSUFBSyxDQUFBQSxLQUFLLGFBQUxBLEtBQUssdUJBQUxBLEtBQUssQ0FBRTVJLElBQUksTUFBSyxXQUFXO0lBQzVELENBQUM7SUFDRCxJQUNFd1UsZ0JBQWdCLEtBQUssa0JBQWtCLElBQ3ZDNEIsYUFBYSxDQUFDNVksR0FBRyxDQUFDMlksYUFBYSxDQUFDLElBQ2hDLENBQUNqRixNQUFNLENBQUN1RixNQUFNLENBQUNKLGNBQWMsQ0FBQyxDQUFDSyxLQUFLLENBQUNqWSxPQUFPLENBQUMsRUFDN0M7TUFDQSxNQUFNLElBQUlsQixLQUFLLENBQ2Isc0dBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFDRTZZLGFBQWEsQ0FBQzVZLEdBQUcsQ0FBQzJZLGFBQWEsQ0FBQyxLQUMvQkgsYUFBYSxHQUFHLENBQUMsSUFBSU4sVUFBVSxDQUFDaFgsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUM1QztNQUNBLE1BQU0sSUFBSW5CLEtBQUssQ0FDYixrQ0FBa0M0WSxhQUFhLDRDQUE0QyxHQUN6RixhQUFhSCxhQUFhLGdCQUFnQk4sVUFBVSxDQUFDaFgsTUFBTSxJQUMvRCxDQUFDO0lBQ0g7SUFDQSxNQUFNaVksT0FBTyxHQUFHO01BQ2RqWCxTQUFTO01BQ1QrRSxTQUFTO01BQ1RuRSxXQUFXLEVBQUU2SSxTQUFTLENBQUM3SSxXQUFXO01BQ2xDc1csaUJBQWlCLEdBQUE1QyxxQkFBQSxJQUFBQyxlQUFBLEdBQ2ZxQixNQUFNLENBQUN1QixPQUFPLGNBQUE1QyxlQUFBLGdCQUFBQSxlQUFBLEdBQWRBLGVBQUEsQ0FBaUIsQ0FBQyxDQUFDLGNBQUFBLGVBQUEsdUJBQW5CQSxlQUFBLENBQXFCNkMsU0FBUyxjQUFBOUMscUJBQUEsY0FBQUEscUJBQUEsSUFBQUUsZ0JBQUEsR0FDOUJvQixNQUFNLENBQUN1QixPQUFPLGNBQUEzQyxnQkFBQSxnQkFBQUEsZ0JBQUEsR0FBZEEsZ0JBQUEsQ0FBaUIsQ0FBQyxDQUFDLGNBQUFBLGdCQUFBLGdCQUFBQSxnQkFBQSxHQUFuQkEsZ0JBQUEsQ0FBcUJuVixJQUFJLGNBQUFtVixnQkFBQSx1QkFBekJBLGdCQUFBLENBQTJCakwsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUM7TUFDekNwSSxlQUFlO01BQ2ZrVixpQkFBaUI7TUFDakJnQixpQkFBaUIsRUFBRWxXLGVBQWU7TUFDbEMyVCxnQkFBZ0I7TUFDaEI2QixjQUFjO01BQ2RXLGdCQUFnQixFQUFFO1FBQ2hCMVcsV0FBVyxFQUFFNkksU0FBUyxDQUFDN0ksV0FBVztRQUNsQzJXLFFBQVEsRUFBRXBXLGVBQWU7UUFDekJOLE1BQU0sRUFBRTRJLFNBQVMsQ0FBQzVJLE1BQU07UUFDeEI0VjtNQUNGLENBQUM7TUFDRGUsY0FBYyxFQUNaZixhQUFhLEtBQUssUUFBUSxJQUFJQSxhQUFhLEtBQUssU0FBUyxJQUFJQSxhQUFhLEtBQUssWUFBWSxHQUN2RjtRQUNFN1YsV0FBVyxFQUFFNkksU0FBUyxDQUFDN0ksV0FBVztRQUNsQzJXLFFBQVEsRUFBRXBXLGVBQWU7UUFDekJtUCxLQUFLLEVBQUU7TUFDVCxDQUFDLEdBQ0RVLFNBQVM7TUFDZnlGLGFBQWE7TUFDYmhOLFNBQVMsRUFBRTtRQUNUcEosRUFBRSxFQUFFb0osU0FBUyxDQUFDcEosRUFBRTtRQUNoQkwsU0FBUyxFQUFFeUosU0FBUyxDQUFDekosU0FBUztRQUM5QitFLFNBQVMsRUFBRTBFLFNBQVMsQ0FBQzFFLFNBQVM7UUFDOUJuRSxXQUFXLEVBQUU2SSxTQUFTLENBQUM3SSxXQUFXO1FBQ2xDQyxNQUFNLEVBQUU0SSxTQUFTLENBQUM1SSxNQUFNO1FBQ3hCQyxXQUFXLEVBQUUySSxTQUFTLENBQUMzSTtNQUN6QixDQUFDO01BQ0Q0VSxRQUFRLEVBQUVBLFFBQVEsQ0FBQzlXLEdBQUcsQ0FDcEIsQ0FBQztRQUNDeUIsRUFBRTtRQUNGMEUsU0FBUyxFQUFFMFMsY0FBYztRQUN6QjNSLElBQUk7UUFDSlQsV0FBVyxFQUFFcVMsZ0JBQWdCO1FBQzdCeFI7TUFDRixDQUFDLE1BQU07UUFDTDdGLEVBQUU7UUFDRjBFLFNBQVMsRUFBRTBTLGNBQWM7UUFDekIzUixJQUFJO1FBQ0pULFdBQVcsRUFBRXFTLGdCQUFnQjtRQUM3QnhSO01BQ0YsQ0FBQyxDQUNILENBQUM7TUFDRGtQLFNBQVMsRUFBRUEsU0FBUyxDQUFDeFcsR0FBRyxDQUN0QixDQUFDO1FBQ0MwQixJQUFJO1FBQ0orRSxXQUFXLEVBQUVzUyxjQUFjO1FBQzNCNVMsU0FBUyxFQUFFNlMsWUFBWTtRQUN2QjFSLE9BQU87UUFDUG1GO01BQ0YsQ0FBQyxNQUFNO1FBQ0wvSyxJQUFJO1FBQ0orRSxXQUFXLEVBQUVzUyxjQUFjO1FBQzNCNVMsU0FBUyxFQUFFNlMsWUFBWTtRQUN2QjFSLE9BQU87UUFDUG1GO01BQ0YsQ0FBQyxDQUNILENBQUM7TUFDRHdNLFdBQVcsRUFBRSxDQUNYO1FBQ0VDLFFBQVEsRUFBRTFXLFVBQVUsQ0FBQzBXLFFBQVE7UUFDN0J6VyxLQUFLLEVBQUVELFVBQVUsQ0FBQ0MsS0FBSztRQUN2Qk0sU0FBUyxFQUFFUCxVQUFVLENBQUNPO01BQ3hCLENBQUMsQ0FDRjtNQUNEMlUsYUFBYTtNQUNieUIsU0FBUyxFQUFFcEMsUUFBUSxHQUNmLENBQ0U7UUFDRXRWLEVBQUUsRUFBRXNWLFFBQVEsQ0FBQ3RWLEVBQUU7UUFDZmtYLFFBQVEsRUFBRTVCLFFBQVEsQ0FBQzRCLFFBQVE7UUFDM0IxVyxNQUFNLEVBQUU4VSxRQUFRLENBQUM5VTtNQUNuQixDQUFDLENBQ0YsR0FDRCxFQUFFO01BQ05tVixVQUFVLEVBQUVBLFVBQVUsQ0FBQ3BYLEdBQUcsQ0FBRXFYLElBQUk7UUFBQSxJQUFBK0IscUJBQUEsRUFBQUMsaUJBQUEsRUFBQUMscUJBQUEsRUFBQUMsaUJBQUE7UUFBQSxPQUFNO1VBQ3BDdFgsTUFBTSxHQUFBbVgscUJBQUEsSUFBQUMsaUJBQUEsR0FBRWhDLElBQUksQ0FBQ0QsVUFBVSxjQUFBaUMsaUJBQUEsdUJBQWZBLGlCQUFBLENBQWlCcFgsTUFBTSxjQUFBbVgscUJBQUEsY0FBQUEscUJBQUEsR0FBSS9CLElBQUksQ0FBQ3BWLE1BQU07VUFDOUN1WCxPQUFPLEdBQUFGLHFCQUFBLElBQUFDLGlCQUFBLEdBQUVsQyxJQUFJLENBQUNELFVBQVUsY0FBQW1DLGlCQUFBLHVCQUFmQSxpQkFBQSxDQUFpQkMsT0FBTyxjQUFBRixxQkFBQSxjQUFBQSxxQkFBQSxHQUFJakMsSUFBSSxDQUFDb0M7UUFDNUMsQ0FBQztNQUFBLENBQUMsQ0FBQztNQUNIdFAsTUFBTSxFQUFFQSxNQUFNLENBQUNuSyxHQUFHLENBQUMsQ0FBQztRQUFFMEIsSUFBSTtRQUFFQyxRQUFRO1FBQUU0STtNQUFjLENBQUMsTUFBTTtRQUN6RDdJLElBQUk7UUFDSkMsUUFBUTtRQUNSNEk7TUFDRixDQUFDLENBQUMsQ0FBQztNQUNIbVAsU0FBUyxFQUFFekMsY0FBYztNQUN6QkMsY0FBYyxFQUFFO1FBQ2R0VyxZQUFZLEVBQUVzVyxjQUFjLENBQUN0VyxZQUFZO1FBQ3pDQyxlQUFlLEVBQUVxVyxjQUFjLENBQUNyVztNQUNsQztJQUNGLENBQUM7SUFDRCxNQUFNbVMsVUFBVSxJQUFBNkMsc0JBQUEsR0FDZDdYLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDMGIsOEJBQThCLGNBQUE5RCxzQkFBQSxjQUFBQSxzQkFBQSxHQUMxQyw4REFBOEQ7SUFDaEUsTUFBTXpZLEtBQUssQ0FBQ0UsT0FBTyxDQUFDMFYsVUFBVSxDQUFDLEVBQUU7TUFBRUMsU0FBUyxFQUFFO0lBQUssQ0FBQyxDQUFDO0lBQ3JELE1BQU01VixTQUFTLENBQ2IyVixVQUFVLEVBQ1YsR0FBRzVQLElBQUksQ0FBQ0MsU0FBUyxDQUFDZ1YsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUN2QyxNQUNGLENBQUM7RUFDSCxDQUFDLENBQUM7RUFFRmxiLElBQUksQ0FBQyw0REFBNEQsRUFBRSxPQUFPO0lBQ3hFb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLENBQUM7SUFDOUIsTUFBTW9OLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLEtBQUssTUFBTXRELE1BQU0sSUFBSU4sd0JBQXdCLENBQUMsQ0FBQyxFQUFFO01BQy9DLE1BQU13VCxxQkFBcUIsQ0FBQzVQLElBQUksRUFBRXRELE1BQU0sQ0FBQztJQUMzQztJQUNBLE1BQU1pVSwyQkFBMkIsQ0FBQzNRLElBQUksQ0FBQztJQUV2QyxNQUFNckcsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFrQixDQUFDLENBQ3ZELENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZUFBZSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDakQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxlQUFlLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUNzVixLQUFLLENBQUMsQ0FDekQsQ0FBQyxDQUFDeFYsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsNkJBQTZCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUMvRCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTXFOLGNBQWMsQ0FBQ2xPLElBQUksRUFBRSxVQUFVLEVBQUUsR0FBRzdGLGNBQWMsVUFBVSxDQUFDO0lBQ25FLE1BQU1SLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFNBQVMsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBVyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUMzRSxNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZUFBZSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDakQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU1xTixjQUFjLENBQUNsTyxJQUFJLEVBQUUsY0FBYyxFQUFFLEdBQUc3RixjQUFjLFFBQVEsQ0FBQztJQUNyRSxNQUFNUixNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxTQUFTLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWUsQ0FBQyxDQUNwRCxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDZCQUE2QixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDL0QsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU1xTixjQUFjLENBQUNsTyxJQUFJLEVBQUUsY0FBYyxFQUFFLEdBQUc3RixjQUFjLElBQUksQ0FBQztJQUNqRSxNQUFNUixNQUFNLENBQUNxRyxJQUFJLENBQUMsQ0FBQzBRLEdBQUcsQ0FBQzlDLFNBQVMsQ0FBQyxTQUFTLENBQUM7SUFDM0MsTUFBTWpVLE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUNSLCtEQUNGLENBQUMsQ0FDQXVWLEtBQUssQ0FBQyxDQUNYLENBQUMsQ0FBQ3hWLFdBQVcsQ0FBQyxDQUFDO0lBRWYsTUFBTXFOLGNBQWMsQ0FDbEJsTyxJQUFJLEVBQ0osaUJBQWlCLEVBQ2pCLEdBQUc3RixjQUFjLGlCQUNuQixDQUFDO0lBQ0QsTUFBTVIsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQyxDQUFDLENBQ3JFLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFFZixNQUFNYixJQUFJLENBQUNzTixJQUFJLENBQUMsR0FBR25ULGNBQWMsMkJBQTJCUyxZQUFZLEVBQUUsQ0FBQztJQUMzRSxNQUFNakIsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUM0TixTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FDUixHQUFHMVQsY0FBYyxDQUFDMlQsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsNEJBQzFDLENBQ0YsQ0FBQztJQUNELE1BQU1uVSxNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxTQUFTLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW1CLENBQUMsQ0FDeEQsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyx1Q0FBdUMsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ3pFLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDc1YsS0FBSyxDQUFDLENBQ2xELENBQUMsQ0FBQ3hWLFdBQVcsQ0FBQyxDQUFDO0VBQ2pCLENBQUMsQ0FBQztFQUVGakgsSUFBSSxDQUFDLHlGQUF5RixFQUFFLE9BQU87SUFDckcwYyxPQUFPO0lBQ1B0VztFQUNGLENBQUMsS0FBSztJQUNKcEcsSUFBSSxDQUFDNFksSUFBSSxDQUNQLENBQUMvWCxPQUFPLENBQUNDLEdBQUcsQ0FBQ3dHLHlCQUF5QixFQUN0Qyw0RUFDRixDQUFDO0lBQ0R0SCxJQUFJLENBQUMyWSxVQUFVLENBQUMsS0FBTSxDQUFDO0lBRXZCLE1BQU1nRSxhQUFhLEdBQUcsTUFBTUQsT0FBTyxDQUFDRSxVQUFVLENBQUMsQ0FBQztJQUNoRCxNQUFNQyxVQUFVLEdBQUcsTUFBTUYsYUFBYSxDQUFDRyxPQUFPLENBQUMsQ0FBQztJQUNoRCxJQUFJO01BQ0YsTUFBTXJELE9BQU8sQ0FBQ3NELEdBQUcsQ0FBQyxDQUFDdkosa0JBQWtCLENBQUNwTixJQUFJLENBQUMsRUFBRW9OLGtCQUFrQixDQUFDcUosVUFBVSxDQUFDLENBQUMsQ0FBQztNQUM3RSxNQUFNcEQsT0FBTyxDQUFDc0QsR0FBRyxDQUFDLENBQ2hCM1csSUFBSSxDQUFDc04sSUFBSSxDQUFDblQsY0FBYyxDQUFDLEVBQ3pCc2MsVUFBVSxDQUFDbkosSUFBSSxDQUFDLEdBQUduVCxjQUFjLElBQUksQ0FBQyxDQUN2QyxDQUFDO01BQ0YsTUFBTXVHLG9CQUFvQixDQUFDVixJQUFJLENBQUM7TUFDaEMsTUFBTXJHLE1BQU0sQ0FBQzhjLFVBQVUsQ0FBQ0csT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDUCxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUN4VixXQUFXLENBQUMsQ0FBQzs7TUFFbEU7TUFDQTtNQUNBO01BQ0EsTUFBTWdXLHVCQUF1QixHQUFHO1FBQzlCLEdBQUcxWixnQkFBZ0I7UUFDbkJDLGlCQUFpQixFQUFFLDBCQUEwQjtRQUM3Q1EsYUFBYSxFQUFFLENBQUM7VUFBRSxHQUFHVCxnQkFBZ0IsQ0FBQ1MsYUFBYSxDQUFDLENBQUMsQ0FBQztVQUFFRSxXQUFXLEVBQUUsb0JBQW9CO1VBQUVDLEtBQUssRUFBRTtRQUFHLENBQUMsQ0FBQztRQUN2R1QsZUFBZSxFQUFFLENBQUM7UUFDbEJHLG1CQUFtQixFQUFFO1VBQUVDLE9BQU8sRUFBRSxDQUFDO1VBQUVDLE9BQU8sRUFBRTtRQUFFO01BQ2hELENBQUM7TUFDRCxJQUFJbVosWUFBWSxHQUFHLENBQUM7TUFDcEIsSUFBSUMsb0JBQWlDO01BQ3JDLE1BQU1DLHFCQUFxQixHQUFHLElBQUkzRCxPQUFPLENBQVFDLE9BQU8sSUFBSztRQUMzRHlELG9CQUFvQixHQUFHekQsT0FBTztNQUNoQyxDQUFDLENBQUM7TUFDRixNQUFNdFQsSUFBSSxDQUFDMEIsS0FBSyxDQUFDLGtCQUFrQixFQUFFLE1BQU9BLEtBQUssSUFBSztRQUNwRG9WLFlBQVksSUFBSSxDQUFDO1FBQ2pCLElBQUlBLFlBQVksS0FBSyxDQUFDLEVBQUUsT0FBT3BWLEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQ2xELFlBQVksQ0FBQ29YLHVCQUF1QixDQUFDLENBQUM7UUFDbkYsTUFBTUcscUJBQXFCO1FBQzNCLE9BQU90VixLQUFLLENBQUNpQixPQUFPLENBQUNsRCxZQUFZLENBQUN0QyxnQkFBZ0IsQ0FBQyxDQUFDO01BQ3RELENBQUMsQ0FBQztNQUNGLE1BQU02QyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7UUFBRUMsSUFBSSxFQUFFO01BQWlCLENBQUMsQ0FBQyxDQUFDd04sS0FBSyxDQUFDLENBQUM7TUFDbEUsTUFBTXpVLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLG9CQUFvQixFQUFFO1FBQUVDLEtBQUssRUFBRTtNQUFLLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO01BQ2pGLE1BQU1sSCxNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxJQUFJLEVBQUU7UUFBRUMsS0FBSyxFQUFFO01BQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7TUFDakUsTUFBTW9XLFlBQVksR0FBR2pYLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtRQUFFQyxJQUFJLEVBQUU7TUFBaUIsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztNQUNqRixNQUFNelUsTUFBTSxDQUFDdWQsSUFBSSxDQUFDLE1BQU1KLFlBQVksQ0FBQyxDQUFDdlYsSUFBSSxDQUFDLENBQUMsQ0FBQztNQUM3Q3dWLG9CQUFvQixDQUFDLENBQUM7TUFDdEIsTUFBTUUsWUFBWTtNQUNsQixNQUFNdlcsb0JBQW9CLENBQUNWLElBQUksQ0FBQztNQUNoQyxNQUFNckcsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsb0JBQW9CLEVBQUU7UUFBRUMsS0FBSyxFQUFFO01BQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7TUFDakYsTUFBTWxILE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLElBQUksRUFBRTtRQUFFQyxLQUFLLEVBQUU7TUFBSyxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztNQUNqRSxNQUFNbEgsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQUVDLEtBQUssRUFBRTtNQUFLLENBQUMsQ0FBQyxDQUFDc1YsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDeFYsV0FBVyxDQUFDLENBQUM7O01BRXhFO01BQ0E7TUFDQTtNQUNBLElBQUlzVyxnQkFBZ0IsR0FBRyxDQUFDO01BQ3hCLE1BQU1WLFVBQVUsQ0FBQ25KLElBQUksQ0FBQ25ULGNBQWMsQ0FBQztNQUNyQyxNQUFNdUcsb0JBQW9CLENBQUMrVixVQUFVLENBQUM7TUFDdEMsTUFBTUEsVUFBVSxDQUFDL1UsS0FBSyxDQUFDLGtCQUFrQixFQUFFLE1BQU9BLEtBQUssSUFBSztRQUMxRHlWLGdCQUFnQixJQUFJLENBQUM7UUFDckI7UUFDQTtRQUNBLElBQUlBLGdCQUFnQixJQUFJLENBQUMsRUFBRTtVQUN6QixPQUFPelYsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FBQztZQUFFMkUsS0FBSyxFQUFFO1VBQW9DLENBQUMsRUFBRSxHQUFHLENBQ2xFLENBQUM7UUFDSDtRQUNBLE9BQU8xQyxLQUFLLENBQUNnRyxRQUFRLENBQUMsQ0FBQztNQUN6QixDQUFDLENBQUM7TUFDRixNQUFNK08sVUFBVSxDQUFDVyxNQUFNLENBQUMsQ0FBQztNQUN6QixNQUFNemQsTUFBTSxDQUNWOGMsVUFBVSxDQUFDOVYsU0FBUyxDQUFDLFNBQVMsRUFBRTtRQUFFQyxJQUFJLEVBQUU7TUFBMkIsQ0FBQyxDQUN0RSxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO01BQ2YsTUFBTWxILE1BQU0sQ0FDVjhjLFVBQVUsQ0FBQzlWLFNBQVMsQ0FBQyxRQUFRLEVBQUU7UUFBRUMsSUFBSSxFQUFFO01BQW1CLENBQUMsQ0FDN0QsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztNQUNmLE1BQU00VixVQUFVLENBQUNZLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQztNQUM1QyxNQUFNWixVQUFVLENBQUM5VixTQUFTLENBQUMsUUFBUSxFQUFFO1FBQUVDLElBQUksRUFBRTtNQUFtQixDQUFDLENBQUMsQ0FBQ3dOLEtBQUssQ0FBQyxDQUFDO01BQzFFLE1BQU0xTixvQkFBb0IsQ0FBQytWLFVBQVUsQ0FBQztNQUV0QyxNQUFNelYscUJBQXFCLENBQUNoQixJQUFJLENBQUM7TUFDakMsTUFBTXFULE9BQU8sQ0FBQ3NELEdBQUcsQ0FBQyxDQUFDM1csSUFBSSxDQUFDb1gsTUFBTSxDQUFDLENBQUMsRUFBRVgsVUFBVSxDQUFDVyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7TUFDdkQsTUFBTTFXLG9CQUFvQixDQUFDVixJQUFJLENBQUM7TUFDaEMsTUFBTVUsb0JBQW9CLENBQUMrVixVQUFVLENBQUM7TUFFdEMsTUFBTXpXLElBQUksQ0FBQ29YLE1BQU0sQ0FBQyxDQUFDO01BQ25CLE1BQU0xVyxvQkFBb0IsQ0FBQ1YsSUFBSSxDQUFDO01BQ2hDLE1BQU1yRyxNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7UUFBRUMsSUFBSSxFQUFFO01BQW1CLENBQUMsQ0FDdkQsQ0FBQyxDQUFDMFcsV0FBVyxDQUFDLENBQUMsQ0FBQztNQUNoQixNQUFNdlgsMEJBQTBCLENBQUNDLElBQUksQ0FBQztJQUN4QyxDQUFDLFNBQVM7TUFDUixNQUFNdVcsYUFBYSxDQUFDZ0IsS0FBSyxDQUFDLENBQUM7SUFDN0I7RUFDRixDQUFDLENBQUM7RUFFRjNkLElBQUksQ0FBQyxrRkFBa0YsRUFBRSxPQUFPO0lBQzlGb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNd1gsYUFBdUIsR0FBRyxFQUFFO0lBQ2xDLE1BQU1DLFNBQVMsR0FBRztNQUNoQkMsTUFBTSxFQUFFLGtDQUFrQztNQUMxQ0MsVUFBVSxFQUFFLDBCQUEwQjtNQUN0Q3JRLFNBQVMsRUFBRTtRQUNUcEosRUFBRSxFQUFFdEQsWUFBWTtRQUNoQmlELFNBQVMsRUFBRSxhQUFhO1FBQ3hCK0UsU0FBUyxFQUFFLG1CQUFtQjtRQUM5Qm5FLFdBQVcsRUFBRUQsZ0JBQWdCLENBQUNDLFdBQVc7UUFDekNDLE1BQU0sRUFBRSxXQUFXO1FBQ25CNFYsYUFBYSxFQUFFLFdBQVc7UUFDMUJjLFFBQVEsRUFBRSxpQkFBaUI7UUFDM0J3QyxLQUFLLEVBQUU7VUFBRUMsUUFBUSxFQUFFLEtBQUs7VUFBRUMsT0FBTyxFQUFFO1FBQVM7TUFDOUMsQ0FBQztNQUNEQyxRQUFRLEVBQUUsRUFBRTtNQUNaQyxXQUFXLEVBQUUsQ0FBQztRQUFFdFosTUFBTSxFQUFFLFFBQVE7UUFBRXVYLE9BQU8sRUFBRTtNQUFlLENBQUMsQ0FBQztNQUM1RGdDLGFBQWEsRUFBRSxDQUFDLGdCQUFnQixDQUFDO01BQ2pDQyxTQUFTLEVBQUU7UUFDVEMsUUFBUSxFQUFFLENBQ1Isa0JBQWtCLEVBQ2xCLGtCQUFrQixFQUNsQix1QkFBdUI7TUFFM0I7SUFDRixDQUFDO0lBQ0QsTUFBTTNXLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQzdCNkQsV0FBVyxFQUFFO1FBQ1huRSxJQUFJLEVBQUUrWCxTQUFTO1FBQ2ZwVCxRQUFRLEVBQUUsaUNBQWlDO1FBQzNDSixRQUFRLEVBQUV1VCxhQUFhO1FBQ3ZCclQsZ0JBQWdCLEVBQUU7TUFDcEI7SUFDRixDQUFDLENBQUM7SUFDRixNQUFNaUosa0JBQWtCLENBQUNwTixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDRSxRQUFRLENBQUMsTUFBTTtNQUN4QixNQUFNb0gsU0FBUyxHQUFHO1FBQ2hCcEosRUFBRSxFQUFFLDBCQUEwQjtRQUM5QkwsU0FBUyxFQUFFLGFBQWE7UUFDeEIrRSxTQUFTLEVBQUUsbUJBQW1CO1FBQzlCdkUsT0FBTyxFQUFFO01BQ1gsQ0FBQztNQUNEK1osWUFBWSxDQUFDQyxPQUFPLENBQ2xCLHNDQUFzQyxFQUN0QyxtQkFDRixDQUFDO01BQ0RELFlBQVksQ0FBQ0MsT0FBTyxDQUNsQixnREFBZ0QsRUFDaER4WSxJQUFJLENBQUNDLFNBQVMsQ0FBQ3dILFNBQVMsQ0FDMUIsQ0FBQztJQUNILENBQUMsQ0FBQztJQUNGLE1BQU10SCxJQUFJLENBQUNzTixJQUFJLENBQUMsR0FBR25ULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU15ZCxLQUFLLEdBQUc1WCxJQUFJLENBQUNzWSxVQUFVLENBQUMsdUJBQXVCLENBQUM7SUFDdEQsTUFBTTNlLE1BQU0sQ0FBQ2llLEtBQUssQ0FBQyxDQUFDL1csV0FBVyxDQUFDLENBQUM7SUFDakMsTUFBTWxILE1BQU0sQ0FBQ2llLEtBQUssQ0FBQyxDQUFDVyxhQUFhLENBQUMsWUFBWSxDQUFDO0lBQy9DLE1BQU01ZSxNQUFNLENBQUNpZSxLQUFLLENBQUMsQ0FBQ1csYUFBYSxDQUFDLDJCQUEyQixDQUFDO0lBRTlELE1BQU1YLEtBQUssQ0FBQ2pYLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDd04sS0FBSyxDQUFDLENBQUM7SUFDbEUsTUFBTW9LLE9BQU8sR0FBR3hZLElBQUksQ0FBQ3NZLFVBQVUsQ0FBQyx3QkFBd0IsQ0FBQztJQUN6RCxNQUFNM2UsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUMzWCxXQUFXLENBQUMsQ0FBQztJQUNuQyxNQUFNbEgsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyx1Q0FBdUMsQ0FBQztJQUM1RSxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyw2QkFBNkIsQ0FBQztJQUNsRSxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDN1gsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDbEZsSCxNQUFNLENBQUM2ZCxhQUFhLENBQUMsQ0FBQ2lCLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFFckMsTUFBTUQsT0FBTyxDQUFDN1gsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZ0IsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUNwRSxNQUFNelUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQztJQUN2RCxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQztJQUN2RCxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyx1QkFBdUIsQ0FBQztJQUM1RCxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQzNkLFlBQVksQ0FBQztJQUNqRCxNQUFNakIsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyxlQUFlLENBQUM7SUFDcEQsTUFBTTVlLE1BQU0sQ0FBQzZlLE9BQU8sQ0FBQyxDQUFDRCxhQUFhLENBQUMsaUJBQWlCLENBQUM7SUFDdEQ1ZSxNQUFNLENBQUM2ZCxhQUFhLENBQUMsQ0FBQ2lCLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFDckM5ZSxNQUFNLENBQUMsSUFBSW9ELEdBQUcsQ0FBQ3lhLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDeGEsUUFBUSxDQUFDLENBQUN1RSxJQUFJLENBQzdDLHNCQUFzQjNHLFlBQVksZUFDcEMsQ0FBQztJQUVELE1BQU00ZCxPQUFPLENBQUM3WCxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFzQixDQUFDLENBQUMsQ0FBQ3dOLEtBQUssQ0FBQyxDQUFDO0lBQzFFLE1BQU16VSxNQUFNLENBQUM2ZSxPQUFPLENBQUMsQ0FBQ0UsVUFBVSxDQUFDLENBQUM7SUFFbEMsTUFBTUMsZUFBZSxHQUFHM1ksSUFBSSxDQUFDNFksWUFBWSxDQUFDLFVBQVUsQ0FBQztJQUNyRCxNQUFNaEIsS0FBSyxDQUFDalgsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZSxDQUFDLENBQUMsQ0FBQ3dOLEtBQUssQ0FBQyxDQUFDO0lBQ2pFLE1BQU15SyxRQUFRLEdBQUcsTUFBTUYsZUFBZTtJQUN0Q2hmLE1BQU0sQ0FBQ2tmLFFBQVEsQ0FBQ0MsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLENBQUN2WCxJQUFJLENBQUMsaUNBQWlDLENBQUM7SUFDNUU1SCxNQUFNLENBQUM2ZCxhQUFhLENBQUMsQ0FBQ2lCLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFFckMsTUFBTXpZLElBQUksQ0FBQ29YLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU0yQixhQUFhLEdBQUcvWSxJQUFJLENBQUNzWSxVQUFVLENBQUMsdUJBQXVCLENBQUM7SUFDOUQsTUFBTTNlLE1BQU0sQ0FBQ29mLGFBQWEsQ0FBQyxDQUFDbFksV0FBVyxDQUFDLENBQUM7SUFDekMsTUFBTWxILE1BQU0sQ0FBQ29mLGFBQWEsQ0FBQyxDQUFDUixhQUFhLENBQUMsWUFBWSxDQUFDO0lBQ3ZELE1BQU01ZSxNQUFNLENBQUNvZixhQUFhLENBQUMsQ0FBQ1IsYUFBYSxDQUFDLG9DQUFvQyxDQUFDO0lBQy9FLE1BQU01ZSxNQUFNLENBQUNvZixhQUFhLENBQUMsQ0FBQ1IsYUFBYSxDQUFDLDJCQUEyQixDQUFDO0lBQ3RFLE1BQU01ZSxNQUFNLENBQ1ZxRyxJQUFJLENBQUNzWSxVQUFVLENBQUMsd0JBQXdCLENBQzFDLENBQUMsQ0FBQ0ksVUFBVSxDQUFDLENBQUM7SUFDZC9lLE1BQU0sQ0FBQzZkLGFBQWEsQ0FBQyxDQUFDaUIsWUFBWSxDQUFDLENBQUMsQ0FBQztFQUN2QyxDQUFDLENBQUM7RUFFRjdlLElBQUksQ0FBQyxtRUFBbUUsRUFBRSxPQUFPO0lBQy9Fb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNd1gsYUFBdUIsR0FBRyxFQUFFO0lBQ2xDLE1BQU13QixrQkFBa0IsR0FBRztNQUN6QixHQUFHeGEsZ0JBQWdCO01BQ25CRSxNQUFNLEVBQUUsV0FBVztNQUNuQkMsV0FBVyxFQUFFLFdBQVc7TUFDeEJNLFVBQVUsRUFBRTtRQUNWQyxLQUFLLEVBQUUsV0FBVztRQUNsQkMsTUFBTSxFQUFFO01BQ1YsQ0FBQztNQUNEOFosY0FBYyxFQUFFLGtCQUFrQjtNQUNsQzNaLFdBQVcsRUFBRSwwQkFBMEI7TUFDdkNFLFNBQVMsRUFBRTtJQUNiLENBQUM7SUFDRCxNQUFNaVksU0FBUyxHQUFHO01BQ2hCQyxNQUFNLEVBQUUsa0NBQWtDO01BQzFDQyxVQUFVLEVBQUUsMEJBQTBCO01BQ3RDclEsU0FBUyxFQUFFO1FBQ1RwSixFQUFFLEVBQUV0RCxZQUFZO1FBQ2hCaUQsU0FBUyxFQUFFLGFBQWE7UUFDeEIrRSxTQUFTLEVBQUUsbUJBQW1CO1FBQzlCbkUsV0FBVyxFQUFFRCxnQkFBZ0IsQ0FBQ0MsV0FBVztRQUN6Q0MsTUFBTSxFQUFFLFdBQVc7UUFDbkI0VixhQUFhLEVBQUUsV0FBVztRQUMxQmMsUUFBUSxFQUFFLGlCQUFpQjtRQUMzQndDLEtBQUssRUFBRTtVQUFFQyxRQUFRLEVBQUUsS0FBSztVQUFFQyxPQUFPLEVBQUU7UUFBZTtNQUNwRCxDQUFDO01BQ0RDLFFBQVEsRUFBRSxDQUNSO1FBQUU1WixJQUFJLEVBQUUsV0FBVztRQUFFZ0IsTUFBTSxFQUFFO01BQXVDLENBQUMsQ0FDdEU7TUFDRDZZLFdBQVcsRUFBRSxFQUFFO01BQ2ZDLGFBQWEsRUFBRSxFQUFFO01BQ2pCQyxTQUFTLEVBQUU7UUFDVEMsUUFBUSxFQUFFLENBQ1Isa0JBQWtCLEVBQ2xCLGtCQUFrQixFQUNsQix1QkFBdUI7TUFFM0I7SUFDRixDQUFDO0lBQ0QsTUFBTTNXLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQzdCNkQsV0FBVyxFQUFFO1FBQ1huRSxJQUFJLEVBQUUrWCxTQUFTO1FBQ2ZwVCxRQUFRLEVBQUUsNkJBQTZCO1FBQ3ZDSixRQUFRLEVBQUV1VCxhQUFhO1FBQ3ZCbFEsU0FBUyxFQUFFMFIsa0JBQWtCO1FBQzdCaFYsY0FBYyxFQUFFLFdBQVc7UUFDM0JHLGdCQUFnQixFQUFFO01BQ3BCO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsTUFBTWlKLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ0UsUUFBUSxDQUFDLE1BQU07TUFDeEIsTUFBTW9ILFNBQVMsR0FBRztRQUNoQnBKLEVBQUUsRUFBRSwwQkFBMEI7UUFDOUJMLFNBQVMsRUFBRSxhQUFhO1FBQ3hCK0UsU0FBUyxFQUFFLG1CQUFtQjtRQUM5QnZFLE9BQU8sRUFBRTtNQUNYLENBQUM7TUFDRCtaLFlBQVksQ0FBQ0MsT0FBTyxDQUNsQixzQ0FBc0MsRUFDdEMsbUJBQ0YsQ0FBQztNQUNERCxZQUFZLENBQUNDLE9BQU8sQ0FDbEIsZ0RBQWdELEVBQ2hEeFksSUFBSSxDQUFDQyxTQUFTLENBQUN3SCxTQUFTLENBQzFCLENBQUM7SUFDSCxDQUFDLENBQUM7SUFDRixNQUFNdEgsSUFBSSxDQUFDc04sSUFBSSxDQUFDLEdBQUduVCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNeWQsS0FBSyxHQUFHNVgsSUFBSSxDQUFDc1ksVUFBVSxDQUFDLHVCQUF1QixDQUFDO0lBQ3RELE1BQU0zZSxNQUFNLENBQUNpZSxLQUFLLENBQUMsQ0FBQy9XLFdBQVcsQ0FBQyxDQUFDO0lBQ2pDLE1BQU1sSCxNQUFNLENBQUNpZSxLQUFLLENBQUMsQ0FBQ1csYUFBYSxDQUFDLFdBQVcsQ0FBQztJQUM5QyxNQUFNNWUsTUFBTSxDQUFDaWUsS0FBSyxDQUFDLENBQUNXLGFBQWEsQ0FBQyxvQ0FBb0MsQ0FBQztJQUN2RSxNQUFNNWUsTUFBTSxDQUFDaWUsS0FBSyxDQUFDLENBQUNXLGFBQWEsQ0FBQywyQkFBMkIsQ0FBQztJQUM5RCxNQUFNNWUsTUFBTSxDQUFDaWUsS0FBSyxDQUFDLENBQUNXLGFBQWEsQ0FBQyxtQ0FBbUMsQ0FBQztJQUN0RSxNQUFNNWUsTUFBTSxDQUFDaWUsS0FBSyxDQUFDalgsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBUyxDQUFDLENBQUMsQ0FBQyxDQUFDMFcsV0FBVyxDQUFDLENBQUMsQ0FBQztJQUMxRSxNQUFNM2QsTUFBTSxDQUFDaWUsS0FBSyxDQUFDalgsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBUyxDQUFDLENBQUMsQ0FBQyxDQUFDMFcsV0FBVyxDQUFDLENBQUMsQ0FBQztJQUMxRSxNQUFNM2QsTUFBTSxDQUNWaWUsS0FBSyxDQUFDalgsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBa0IsQ0FBQyxDQUN2RCxDQUFDLENBQUMwVyxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQ2hCLE1BQU0zZCxNQUFNLENBQ1ZpZSxLQUFLLENBQUNqWCxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUEyQixDQUFDLENBQ2hFLENBQUMsQ0FBQzBXLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFDaEIsTUFBTTNkLE1BQU0sQ0FDVmllLEtBQUssQ0FBQ2pYLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQTBCLENBQUMsQ0FDL0QsQ0FBQyxDQUFDMFcsV0FBVyxDQUFDLENBQUMsQ0FBQztJQUVoQixNQUFNTSxLQUFLLENBQUNqWCxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQixDQUFDLENBQUMsQ0FBQ3dOLEtBQUssQ0FBQyxDQUFDO0lBQ2xFLE1BQU1vSyxPQUFPLEdBQUd4WSxJQUFJLENBQUNzWSxVQUFVLENBQUMsd0JBQXdCLENBQUM7SUFDekQsTUFBTTNlLE1BQU0sQ0FBQzZlLE9BQU8sQ0FBQyxDQUFDM1gsV0FBVyxDQUFDLENBQUM7SUFDbkMsTUFBTWxILE1BQU0sQ0FBQzZlLE9BQU8sQ0FBQyxDQUFDRCxhQUFhLENBQUMsdUNBQXVDLENBQUM7SUFDNUUsTUFBTTVlLE1BQU0sQ0FBQzZlLE9BQU8sQ0FBQyxDQUFDRCxhQUFhLENBQUMsNkJBQTZCLENBQUM7SUFDbEUsTUFBTTVlLE1BQU0sQ0FBQzZlLE9BQU8sQ0FBQzdYLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBQ2xGbEgsTUFBTSxDQUFDNmQsYUFBYSxDQUFDLENBQUNpQixZQUFZLENBQUMsQ0FBQyxDQUFDO0lBRXJDLE1BQU1ELE9BQU8sQ0FBQzdYLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDd04sS0FBSyxDQUFDLENBQUM7SUFDcEUsTUFBTXpVLE1BQU0sQ0FBQzZlLE9BQU8sQ0FBQyxDQUFDRCxhQUFhLENBQUMsV0FBVyxDQUFDO0lBQ2hELE1BQU01ZSxNQUFNLENBQUM2ZSxPQUFPLENBQUMsQ0FBQ0QsYUFBYSxDQUFDM2QsWUFBWSxDQUFDO0lBQ2pELE1BQU1qQixNQUFNLENBQUM2ZSxPQUFPLENBQUMsQ0FBQ0QsYUFBYSxDQUFDLGVBQWUsQ0FBQztJQUNwRCxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQztJQUN0RCxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQztJQUN2RCxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQztJQUN2RCxNQUFNNWUsTUFBTSxDQUFDNmUsT0FBTyxDQUFDLENBQUNELGFBQWEsQ0FBQyx1QkFBdUIsQ0FBQztJQUM1RCxNQUFNNWUsTUFBTSxDQUFDaWUsS0FBSyxDQUFDLENBQUNXLGFBQWEsQ0FBQyxXQUFXLENBQUM7SUFDOUMsTUFBTTVlLE1BQU0sQ0FBQ2llLEtBQUssQ0FBQyxDQUFDVyxhQUFhLENBQUMsMkJBQTJCLENBQUM7SUFDOUQsTUFBTTVlLE1BQU0sQ0FBQ2llLEtBQUssQ0FBQyxDQUFDVyxhQUFhLENBQUMsbUNBQW1DLENBQUM7SUFDdEU1ZSxNQUFNLENBQUM2ZCxhQUFhLENBQUMsQ0FBQ2lCLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFFckMsTUFBTUQsT0FBTyxDQUFDN1gsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBc0IsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUMxRSxNQUFNdUssZUFBZSxHQUFHM1ksSUFBSSxDQUFDNFksWUFBWSxDQUFDLFVBQVUsQ0FBQztJQUNyRCxNQUFNaEIsS0FBSyxDQUFDalgsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZSxDQUFDLENBQUMsQ0FBQ3dOLEtBQUssQ0FBQyxDQUFDO0lBQ2pFLE1BQU15SyxRQUFRLEdBQUcsTUFBTUYsZUFBZTtJQUN0Q2hmLE1BQU0sQ0FBQ2tmLFFBQVEsQ0FBQ0MsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLENBQUN2WCxJQUFJLENBQUMsNkJBQTZCLENBQUM7SUFDeEU1SCxNQUFNLENBQUM2ZCxhQUFhLENBQUMsQ0FBQ2lCLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFFckMsTUFBTXpZLElBQUksQ0FBQ29YLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU0yQixhQUFhLEdBQUcvWSxJQUFJLENBQUNzWSxVQUFVLENBQUMsdUJBQXVCLENBQUM7SUFDOUQsTUFBTTNlLE1BQU0sQ0FBQ29mLGFBQWEsQ0FBQyxDQUFDbFksV0FBVyxDQUFDLENBQUM7SUFDekMsTUFBTWxILE1BQU0sQ0FBQ29mLGFBQWEsQ0FBQyxDQUFDUixhQUFhLENBQUMsV0FBVyxDQUFDO0lBQ3RELE1BQU01ZSxNQUFNLENBQUNvZixhQUFhLENBQUMsQ0FBQ1IsYUFBYSxDQUFDLDJCQUEyQixDQUFDO0lBQ3RFLE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxVQUFVLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDSSxVQUFVLENBQUMsQ0FBQztJQUNwRS9lLE1BQU0sQ0FBQzZkLGFBQWEsQ0FBQyxDQUFDaUIsWUFBWSxDQUFDLENBQUMsQ0FBQztFQUN2QyxDQUFDLENBQUM7RUFFRjdlLElBQUksQ0FBQyxtREFBbUQsRUFBRSxPQUFPO0lBQy9Eb0c7RUFDRixDQUFDLEtBQUs7SUFBQSxJQUFBa1osc0JBQUE7SUFDSixNQUFNQyxNQUFNLEdBQUcsZUFBZTtJQUM5QixNQUFNQyxPQUFPLEdBQUc7TUFDZGxiLEVBQUUsRUFBRSxjQUFjO01BQ2xCaWIsTUFBTTtNQUNORSxLQUFLLEVBQUUsTUFBTTtNQUNiaGIsT0FBTyxFQUFFLHNDQUFzQztNQUMvQ0MsU0FBUyxFQUFFO0lBQ2IsQ0FBQztJQUNELE1BQU1rRCxrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QnNFLGFBQWEsRUFBRTtRQUNiTSxRQUFRLEVBQUUsWUFBWTtRQUN0QkMsWUFBWSxFQUFFO01BQ2hCLENBQUM7TUFDREMsUUFBUSxFQUFFO1FBQ1I1RyxFQUFFLEVBQUVpYixNQUFNO1FBQ1Z0VyxLQUFLLEVBQUUsK0JBQStCO1FBQ3RDaEYsU0FBUyxFQUFFLGFBQWE7UUFDeEI2SCxHQUFHLEVBQUUwVDtNQUNQO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsTUFBTWhNLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDOztJQUU5QjtJQUNBO0lBQ0EsTUFBTXNaLFlBQVksR0FBRyxNQUFNdFosSUFBSSxDQUFDRSxRQUFRLENBQUMsTUFBT29PLFVBQVUsSUFBSztNQUM3RCxNQUFNaUwsS0FBSyxHQUFHQyxVQUFVLENBQUM3VSxJQUFJLENBQzNCOFUsSUFBSSxDQUFDLGtDQUFrQyxDQUFDLEVBQ3ZDQyxTQUFTLElBQUtBLFNBQVMsQ0FBQ0MsVUFBVSxDQUFDLENBQUMsQ0FDdkMsQ0FBQztNQUNELE1BQU1qYSxJQUFJLEdBQUcsSUFBSWthLFFBQVEsQ0FBQyxDQUFDO01BQzNCbGEsSUFBSSxDQUFDbWEsTUFBTSxDQUNULFNBQVMsRUFDVCxJQUFJQyxJQUFJLENBQUMsQ0FBQ1AsS0FBSyxDQUFDLEVBQUU7UUFBRXBiLElBQUksRUFBRTtNQUFrQixDQUFDLENBQUMsRUFDOUMsdUJBQ0YsQ0FBQztNQUNELE1BQU1nRCxRQUFRLEdBQUcsTUFBTXdOLEtBQUssQ0FDMUIsSUFBSTVSLEdBQUcsQ0FBQyxxQkFBcUIsRUFBRXVSLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUMsRUFDckQ7UUFBRXVCLE1BQU0sRUFBRSxNQUFNO1FBQUVFLFdBQVcsRUFBRSxTQUFTO1FBQUVsUDtNQUFLLENBQ2pELENBQUM7TUFDRCxPQUFPO1FBQ0xoQixNQUFNLEVBQUV5QyxRQUFRLENBQUN6QyxNQUFNO1FBQ3ZCZ0IsSUFBSSxFQUFHLE1BQU15QixRQUFRLENBQUNxTCxJQUFJLENBQUM7TUFDN0IsQ0FBQztJQUNILENBQUMsR0FBQTBNLHNCQUFBLEdBQUV6ZSxPQUFPLENBQUNDLEdBQUcsQ0FBQzZULDBCQUEwQixjQUFBMkssc0JBQUEsY0FBQUEsc0JBQUEsR0FBSWxaLElBQUksQ0FBQytCLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDeERwSSxNQUFNLENBQUMyZixZQUFZLENBQUM1YSxNQUFNLENBQUMsQ0FBQzZDLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDckM1SCxNQUFNLENBQUMyZixZQUFZLENBQUM1WixJQUFJLENBQUMsQ0FBQ3FhLE9BQU8sQ0FBQztNQUNoQ25WLFFBQVEsRUFBRSxZQUFZO01BQ3RCQyxZQUFZLEVBQUU7SUFDaEIsQ0FBQyxDQUFDO0lBRUYsTUFBTXFKLGNBQWMsQ0FBQ2xPLElBQUksRUFBRSxPQUFPLEVBQUUsR0FBRzdGLGNBQWMsT0FBTyxDQUFDO0lBQzdELE1BQU02ZixPQUFPLEdBQUdoYSxJQUFJLENBQUNzWSxVQUFVLENBQzdCLDJDQUNGLENBQUM7SUFDRCxNQUFNM2UsTUFBTSxDQUFDcWdCLE9BQU8sQ0FBQyxDQUFDblosV0FBVyxDQUFDLENBQUM7SUFDbkMsTUFBTW1aLE9BQU8sQ0FBQzVMLEtBQUssQ0FBQyxDQUFDO0lBQ3JCLE1BQU1wTyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQU8sQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUN4RCxNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMyWCxhQUFhLENBQ3hFLHNDQUNGLENBQUM7RUFDSCxDQUFDLENBQUM7RUFFRjNlLElBQUksQ0FBQyw4REFBOEQsRUFBRSxPQUFPO0lBQzFFb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNbVosTUFBTSxHQUFHLDRCQUE0QjtJQUMzQyxNQUFNQyxPQUFPLEdBQUc7TUFDZGxiLEVBQUUsRUFBRSwyQkFBMkI7TUFDL0JpYixNQUFNO01BQ05FLEtBQUssRUFBRSxNQUFNO01BQ2JoYixPQUFPLEVBQUUsK0NBQStDO01BQ3hEQyxTQUFTLEVBQUUsMEJBQTBCO01BQ3JDMmIsUUFBUSxFQUFFO1FBQ1J4YixXQUFXLEVBQUUsNEJBQTRCO1FBQ3pDTSxpQkFBaUIsRUFBRTtNQUNyQjtJQUNGLENBQUM7SUFDRCxNQUFNdUcsY0FBd0IsR0FBRyxFQUFFO0lBQ25DLE1BQU05RCxrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QjhFLFFBQVEsRUFBRTtRQUNSNUcsRUFBRSxFQUFFaWIsTUFBTTtRQUNWdFcsS0FBSyxFQUFFLDJCQUEyQjtRQUNsQ2hGLFNBQVMsRUFBRSxhQUFhO1FBQ3hCNkgsR0FBRyxFQUFFMFQsT0FBTztRQUNaOVQsY0FBYztRQUNkQyxlQUFlLEVBQUU7TUFDbkI7SUFDRixDQUFDLENBQUM7SUFDRixNQUFNNkgsa0JBQWtCLENBQUNwTixJQUFJLENBQUM7SUFFOUIsTUFBTWtPLGNBQWMsQ0FBQ2xPLElBQUksRUFBRSxPQUFPLEVBQUUsR0FBRzdGLGNBQWMsT0FBTyxDQUFDO0lBQzdELE1BQU02ZixPQUFPLEdBQUdoYSxJQUFJLENBQUNzWSxVQUFVLENBQUMsdUNBQXVDLENBQUM7SUFDeEUsTUFBTTNlLE1BQU0sQ0FBQ3FnQixPQUFPLENBQUMsQ0FBQ25aLFdBQVcsQ0FBQyxDQUFDO0lBQ25DLE1BQU1tWixPQUFPLENBQUM1TCxLQUFLLENBQUMsQ0FBQztJQUNyQixNQUFNcE8sSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFPLENBQUMsQ0FBQyxDQUFDd04sS0FBSyxDQUFDLENBQUM7SUFFeEQsTUFBTThMLFFBQVEsR0FBR2xhLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBVyxDQUFDLENBQUM7SUFDL0QsTUFBTWpILE1BQU0sQ0FBQ3VnQixRQUFRLENBQUMsQ0FBQzNCLGFBQWEsQ0FBQ2EsT0FBTyxDQUFDL2EsT0FBTyxDQUFDO0lBQ3JELE1BQU0xRSxNQUFNLENBQ1R1ZCxJQUFJLENBQUMsTUFBTTVSLGNBQWMsQ0FBQ3pJLE1BQU0sRUFBRTtNQUNqQ3dCLE9BQU8sRUFBRTtJQUNYLENBQUMsQ0FBQyxDQUNEa0QsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNWNUgsTUFBTSxDQUFDMkwsY0FBYyxDQUFDLENBQUNtVCxZQUFZLENBQUMsQ0FBQyxDQUFDO0lBQ3RDOWUsTUFBTSxDQUFDMkwsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMvRCxJQUFJLENBQUMrRCxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDakQzTCxNQUFNLENBQUMsSUFBSW9ELEdBQUcsQ0FBQ3VJLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDdEksUUFBUSxDQUFDLENBQUN1RSxJQUFJLENBQzlDLGNBQWM0WCxNQUFNLGNBQ3RCLENBQUM7SUFDRCxNQUFNeGYsTUFBTSxDQUNWdWdCLFFBQVEsQ0FBQ3RELE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQ2phLE1BQU0sQ0FBQztNQUFFd2QsT0FBTyxFQUFFZixPQUFPLENBQUMvYTtJQUFRLENBQUMsQ0FDakUsQ0FBQyxDQUFDaVosV0FBVyxDQUFDLENBQUMsQ0FBQztFQUNsQixDQUFDLENBQUM7RUFFRjFkLElBQUksQ0FBQyw0RUFBNEUsRUFBRSxPQUFPO0lBQ3hGb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNbVosTUFBTSxHQUFHLHlCQUF5QjtJQUN4QyxNQUFNMWEsV0FBVyxHQUFHLHlCQUF5QjtJQUM3QyxNQUFNMmEsT0FBTyxHQUFHO01BQ2RsYixFQUFFLEVBQUUsd0JBQXdCO01BQzVCaWIsTUFBTTtNQUNORSxLQUFLLEVBQUUsTUFBTTtNQUNiaGIsT0FBTyxFQUFFLGdDQUFnQztNQUN6Q0MsU0FBUyxFQUFFLDBCQUEwQjtNQUNyQzJiLFFBQVEsRUFBRTtRQUFFeGI7TUFBWTtJQUMxQixDQUFDO0lBQ0QsTUFBTTZHLGNBQXdCLEdBQUcsRUFBRTtJQUNuQyxNQUFNOFUsaUJBQTJCLEdBQUcsRUFBRTtJQUN0Q3BhLElBQUksQ0FBQ3FhLEVBQUUsQ0FBQyxTQUFTLEVBQUdqWixPQUFPLElBQUs7TUFDOUIsSUFBSSxDQUFDQSxPQUFPLENBQUNXLEdBQUcsQ0FBQyxDQUFDLENBQUMwQixRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUU7TUFDNUMsSUFBSSxDQUFDckMsT0FBTyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDMEIsUUFBUSxDQUFDLGNBQWMsQ0FBQyxFQUFFMlcsaUJBQWlCLENBQUNsVyxJQUFJLENBQUM5QyxPQUFPLENBQUNzTixNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ3ZGLENBQUMsQ0FBQztJQUNGLE1BQU1sTixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QjhFLFFBQVEsRUFBRTtRQUNSNUcsRUFBRSxFQUFFaWIsTUFBTTtRQUNWdFcsS0FBSyxFQUFFLHFDQUFxQztRQUM1Q2hGLFNBQVMsRUFBRSxhQUFhO1FBQ3hCNkgsR0FBRyxFQUFFMFQsT0FBTztRQUNaL1QsV0FBVyxFQUFFLENBQUMrVCxPQUFPLENBQUM7UUFDdEI5VCxjQUFjO1FBQ2RFLGtCQUFrQixFQUFFO01BQ3RCO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsTUFBTTRILGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBRTlCLE1BQU1rTyxjQUFjLENBQUNsTyxJQUFJLEVBQUUsT0FBTyxFQUFFLEdBQUc3RixjQUFjLE9BQU8sQ0FBQztJQUM3RCxNQUFNNkYsSUFBSSxDQUFDc1ksVUFBVSxDQUFDLGlEQUFpRCxDQUFDLENBQUNsSyxLQUFLLENBQUMsQ0FBQztJQUNoRixNQUFNcE8sSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFPLENBQUMsQ0FBQyxDQUFDd04sS0FBSyxDQUFDLENBQUM7SUFFeEQsTUFBTThMLFFBQVEsR0FBR2xhLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBVyxDQUFDLENBQUM7SUFDL0QsTUFBTWpILE1BQU0sQ0FBQ3VnQixRQUFRLENBQUMsQ0FBQzNCLGFBQWEsQ0FBQ2EsT0FBTyxDQUFDL2EsT0FBTyxDQUFDO0lBQ3JELE1BQU0xRSxNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQywyQkFBMkIsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUN6RixNQUFNbEgsTUFBTSxDQUNUdWQsSUFBSSxDQUFDLE1BQU01UixjQUFjLENBQUN6SSxNQUFNLEVBQUU7TUFDakN3QixPQUFPLEVBQUUsaUVBQWlFO01BQzFFaUQsT0FBTyxFQUFFO0lBQ1gsQ0FBQyxDQUFDLENBQ0RDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDVixNQUFNK1ksU0FBUyxHQUFHdGEsSUFBSSxDQUFDVyxTQUFTLENBQUMsT0FBTyxDQUFDO0lBQ3pDLE1BQU1oSCxNQUFNLENBQUMyZ0IsU0FBUyxDQUFDLENBQUMvQixhQUFhLENBQUMsdUNBQXVDLENBQUM7SUFDOUUsTUFBTTVlLE1BQU0sQ0FBQzJnQixTQUFTLENBQUMsQ0FBQy9CLGFBQWEsQ0FBQyxrQ0FBa0MsQ0FBQztJQUN6RSxNQUFNNWUsTUFBTSxDQUFDMmdCLFNBQVMsQ0FBQyxDQUFDL0IsYUFBYSxDQUFDOVosV0FBVyxDQUFDO0lBQ2xELE1BQU05RSxNQUFNLENBQUMyZ0IsU0FBUyxDQUFDLENBQUMvQixhQUFhLENBQUMsaUNBQWlDLENBQUM7SUFDeEUsTUFBTTVlLE1BQU0sQ0FBQzJnQixTQUFTLENBQUMzWixTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUN6RixNQUFNbEgsTUFBTSxDQUFDMmdCLFNBQVMsQ0FBQzNaLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBRXhGLE1BQU15WixTQUFTLENBQUMzWixTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFxQixDQUFDLENBQUMsQ0FBQ3dOLEtBQUssQ0FBQyxDQUFDO0lBQzNFLE1BQU16VSxNQUFNLENBQUN1Z0IsUUFBUSxDQUFDLENBQUMzQixhQUFhLENBQUMsZ0NBQWdDLENBQUM7SUFDdEUsTUFBTTVlLE1BQU0sQ0FBQ3VkLElBQUksQ0FBQyxNQUFNNVIsY0FBYyxDQUFDekksTUFBTSxDQUFDLENBQUMwRSxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ3RENUgsTUFBTSxDQUFDLElBQUl3QixHQUFHLENBQUNtSyxjQUFjLENBQUMsQ0FBQ2lWLElBQUksQ0FBQyxDQUFDaFosSUFBSSxDQUFDLENBQUMsQ0FBQztJQUM1QzVILE1BQU0sQ0FBQ3lnQixpQkFBaUIsQ0FBQyxDQUFDMUosR0FBRyxDQUFDRixTQUFTLENBQUMsTUFBTSxDQUFDO0lBQy9DLE1BQU03VyxNQUFNLENBQ1Z1Z0IsUUFBUSxDQUFDdEQsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDamEsTUFBTSxDQUFDO01BQUV3ZCxPQUFPLEVBQUVmLE9BQU8sQ0FBQy9hO0lBQVEsQ0FBQyxDQUNqRSxDQUFDLENBQUNpWixXQUFXLENBQUMsQ0FBQyxDQUFDO0VBQ2xCLENBQUMsQ0FBQztFQUVGMWQsSUFBSSxDQUFDLHVFQUF1RSxFQUFFLE9BQU87SUFDbkZvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU00RyxNQUFNLEdBQUdpTCxLQUFLLENBQUNsTixJQUFJLENBQUM7TUFBRTlILE1BQU0sRUFBRTtJQUFHLENBQUMsRUFBRSxDQUFDMmQsQ0FBQyxFQUFFQyxLQUFLLE1BQU07TUFDdkR2YyxFQUFFLEVBQUUsYUFBYXVjLEtBQUssRUFBRTtNQUN4QjVjLFNBQVMsRUFBRSxhQUFhO01BQ3hCTSxJQUFJLEVBQUUsWUFBWTtNQUNsQkMsUUFBUSxFQUFFcWMsS0FBSyxHQUFHLENBQUMsR0FBRyxTQUFTLEdBQUcsTUFBTTtNQUN4Q3pULGFBQWEsRUFBRXlULEtBQUssR0FBRyxDQUFDLEdBQUcsWUFBWSxHQUFHLElBQUk7TUFDOUNwYyxPQUFPLEVBQ0xvYyxLQUFLLEdBQUcsQ0FBQyxHQUFHLDBCQUEwQkEsS0FBSyxFQUFFLEdBQUcsZUFBZUEsS0FBSyxFQUFFO01BQ3hFbmMsU0FBUyxFQUFFLElBQUl5VSxJQUFJLENBQUNBLElBQUksQ0FBQzJILEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsR0FBR0QsS0FBSyxDQUFDLENBQUMsQ0FBQ0UsV0FBVyxDQUFDO0lBQzFFLENBQUMsQ0FBQyxDQUFDO0lBQ0gsTUFBTUMsYUFBdUIsR0FBRyxFQUFFO0lBQ2xDNWEsSUFBSSxDQUFDcWEsRUFBRSxDQUFDLFNBQVMsRUFBR2paLE9BQU8sSUFBSztNQUM5QixJQUFJLElBQUlyRSxHQUFHLENBQUNxRSxPQUFPLENBQUNXLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQy9FLFFBQVEsQ0FBQ3VGLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFDekRxWSxhQUFhLENBQUMxVyxJQUFJLENBQUM5QyxPQUFPLENBQUNXLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDckMsQ0FBQyxDQUFDO0lBQ0YsTUFBTVAsa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFDN0I0RyxNQUFNO01BQ05oQixRQUFRLEVBQUUsQ0FDUjtRQUNFMUgsRUFBRSxFQUFFLGFBQWE7UUFDakIwQyxJQUFJLEVBQUUsZUFBZTtRQUNyQmlGLFFBQVEsRUFBRSxZQUFZO1FBQ3RCQyxTQUFTLEVBQUUsT0FBTztRQUNsQnBILE1BQU0sRUFBRSxRQUFRO1FBQ2hCcUgsUUFBUSxFQUFFLG1CQUFtQjtRQUM3QkMsWUFBWSxFQUFFO01BQ2hCLENBQUM7SUFFTCxDQUFDLENBQUM7SUFDRixNQUFNb0gsa0JBQWtCLENBQUNwTixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDc04sSUFBSSxDQUFDLEdBQUduVCxjQUFjLFFBQVEsQ0FBQztJQUUxQyxNQUFNUixNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ2xELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZ0JBQWdCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUNsRCxDQUFDLENBQUMyUCxHQUFHLENBQUM3UCxXQUFXLENBQUMsQ0FBQztJQUNuQixNQUFNZ2EsWUFBWSxHQUFHLElBQUk5ZCxHQUFHLENBQUM2ZCxhQUFhLENBQUN6SyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUUsQ0FBQztJQUNuRHhXLE1BQU0sQ0FBQ2toQixZQUFZLENBQUNyWSxZQUFZLENBQUNDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDbEIsSUFBSSxDQUFDLElBQUksQ0FBQztJQUN6RDVILE1BQU0sQ0FBQ2toQixZQUFZLENBQUNyWSxZQUFZLENBQUNDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDbEIsSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUV2RCxNQUFNOFIsT0FBTyxDQUFDc0QsR0FBRyxDQUFDLENBQ2hCM1csSUFBSSxDQUFDOGEsY0FBYyxDQUFFMVosT0FBTyxJQUFLO01BQy9CLE1BQU1XLEdBQUcsR0FBRyxJQUFJaEYsR0FBRyxDQUFDcUUsT0FBTyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQ2xDLE9BQ0VBLEdBQUcsQ0FBQy9FLFFBQVEsQ0FBQ3VGLFFBQVEsQ0FBQyxhQUFhLENBQUMsSUFDcENSLEdBQUcsQ0FBQ1MsWUFBWSxDQUFDQyxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssR0FBRztJQUV4QyxDQUFDLENBQUMsRUFDRnpDLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBUSxDQUFDLENBQUMsQ0FBQ3dOLEtBQUssQ0FBQyxDQUFDLENBQ3BELENBQUM7SUFDRixNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ3ZFLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ2xELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsMEJBQTBCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUM1RCxDQUFDLENBQUMyUCxHQUFHLENBQUM3UCxXQUFXLENBQUMsQ0FBQztJQUNuQmxILE1BQU0sQ0FBQyxJQUFJb0QsR0FBRyxDQUFDNmQsYUFBYSxDQUFDekssRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFFLENBQUMsQ0FBQzNOLFlBQVksQ0FBQ0MsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUNsQixJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ3pFLE1BQU12QixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQVEsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUN6RCxNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ3ZFLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQywwQkFBMEIsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQzVELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFFZixNQUFNYixJQUFJLENBQUMrYSxnQkFBZ0IsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDQyxJQUFJLENBQUMsa0JBQWtCLENBQUM7SUFDdEUsTUFBTWhiLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBdUIsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUN4RSxNQUFNcE8sSUFBSSxDQUFDNFcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDcUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxZQUFZLENBQUMsU0FBUyxDQUFDO0lBQzNELE1BQU12aEIsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsMEJBQTBCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUM1RCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGVBQWUsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ2pELENBQUMsQ0FBQzJQLEdBQUcsQ0FBQzdQLFdBQVcsQ0FBQyxDQUFDO0lBQ25CLE1BQU1sSCxNQUFNLENBQUNxRyxJQUFJLENBQUMsQ0FBQzROLFNBQVMsQ0FBQywwQkFBMEIsQ0FBQztJQUN4RCxNQUFNalUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUM0TixTQUFTLENBQUMsa0JBQWtCLENBQUM7SUFFaEQsTUFBTTVOLElBQUksQ0FBQ29YLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU16ZCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQywwQkFBMEIsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQzVELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZUFBZSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDakQsQ0FBQyxDQUFDMlAsR0FBRyxDQUFDN1AsV0FBVyxDQUFDLENBQUM7SUFDbkIsTUFBTWxILE1BQU0sQ0FBQ3FHLElBQUksQ0FBQythLGdCQUFnQixDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQ0ksV0FBVyxDQUMvRCxrQkFDRixDQUFDO0lBQ0QsTUFBTW5iLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBdUIsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUN4RSxNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDcUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUNFLFdBQVcsQ0FBQyxTQUFTLENBQUM7SUFDbEUsTUFBTUMsZUFBZSxHQUFHLElBQUlyZSxHQUFHLENBQUM2ZCxhQUFhLENBQUN6SyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUUsQ0FBQztJQUN0RHhXLE1BQU0sQ0FBQ3loQixlQUFlLENBQUM1WSxZQUFZLENBQUNDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDbEIsSUFBSSxDQUFDLElBQUksQ0FBQztJQUM1RDVILE1BQU0sQ0FBQ3loQixlQUFlLENBQUM1WSxZQUFZLENBQUNDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDbEIsSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUMxRDVILE1BQU0sQ0FBQ3loQixlQUFlLENBQUM1WSxZQUFZLENBQUNDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDbEIsSUFBSSxDQUFDLGtCQUFrQixDQUFDO0lBQzNFNUgsTUFBTSxDQUFDeWhCLGVBQWUsQ0FBQzVZLFlBQVksQ0FBQ0MsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUNsQixJQUFJLENBQUMsU0FBUyxDQUFDO0VBQ3RFLENBQUMsQ0FBQztFQUVGM0gsSUFBSSxDQUFDLHdFQUF3RSxFQUFFLE9BQU87SUFDcEZvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1zQyxPQUFPLEdBQUcsTUFBTXFGLHNCQUFzQixDQUFDM0gsSUFBSSxDQUFDO0lBQ2xELE1BQU13QixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUFFa0MsUUFBUSxFQUFFSTtJQUFRLENBQUMsQ0FBQztJQUNyRCxNQUFNOEssa0JBQWtCLENBQUNwTixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDc04sSUFBSSxDQUFDLEdBQUduVCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNa2hCLFFBQVEsR0FBR3JiLElBQUksQ0FBQzRXLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQ1AsS0FBSyxDQUFDLENBQUM7SUFDakQsTUFBTTFjLE1BQU0sQ0FBQzBoQixRQUFRLENBQUMsQ0FBQ3hhLFdBQVcsQ0FBQyxDQUFDO0lBQ3BDLE1BQU13YSxRQUFRLENBQUNMLElBQUksQ0FBQzFZLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQ3JDLE1BQU13WSxVQUFVLEdBQUdELFFBQVEsQ0FBQ3pFLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQ2pXLFNBQVMsQ0FBQyxRQUFRLENBQUM7SUFDbkUsTUFBTWhILE1BQU0sQ0FBQzJoQixVQUFVLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDdEMsTUFBTUMscUJBQXFCLEdBQUd4YixJQUFJLENBQUN5YixlQUFlLENBQUV0YSxRQUFRLElBQzFEQSxRQUFRLENBQUNZLEdBQUcsQ0FBQyxDQUFDLENBQUMwQixRQUFRLENBQUMscUJBQXFCLENBQy9DLENBQUM7SUFDRCxNQUFNNlgsVUFBVSxDQUFDbE4sS0FBSyxDQUFDLENBQUM7SUFDeEIsTUFBTXlFLGNBQWMsR0FBRyxNQUFNMkkscUJBQXFCO0lBQ2xEN2hCLE1BQU0sQ0FBQ2taLGNBQWMsQ0FBQ25VLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQzZDLElBQUksQ0FBQyxHQUFHLENBQUM7SUFFekMsTUFBTTVILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDd0IsT0FBTyxDQUFDUSxRQUFRLEVBQUU7TUFBRS9CLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQ3pELENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDd0IsT0FBTyxDQUFDNEYsTUFBTSxFQUFFO01BQUVuSCxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUN2RCxDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQ25ELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNYixJQUFJLENBQUM0VyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUNqYSxNQUFNLENBQUM7TUFBRXdkLE9BQU8sRUFBRTtJQUFpQixDQUFDLENBQUMsQ0FBQy9MLEtBQUssQ0FBQyxDQUFDO0lBQzNFLE1BQU16VSxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQ25ELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUMwRixNQUFNLEVBQUU7TUFBRWpILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQ3ZELENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGdDQUFnQyxDQUFDLENBQUM0YSxJQUFJLENBQUMsQ0FDeEQsQ0FBQyxDQUFDN2EsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUNEYyxTQUFTLENBQUMsMERBQTBELEVBQUU7TUFDckVDLEtBQUssRUFBRTtJQUNULENBQUMsQ0FBQyxDQUNEMmEsSUFBSSxDQUFDLENBQ1YsQ0FBQyxDQUFDN2EsV0FBVyxDQUFDLENBQUM7SUFFZixNQUFNOGEsV0FBVyxHQUFHLE1BQU0zYixJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNnRixTQUFTLENBQUMsQ0FBQztJQUMxRGppQixNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNqTCxHQUFHLENBQUNGLFNBQVMsQ0FBQyxXQUFXLENBQUM7SUFDOUM3VyxNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNqTCxHQUFHLENBQUNGLFNBQVMsQ0FBQywyQkFBMkIsQ0FBQztJQUM5RDdXLE1BQU0sQ0FBQ2dpQixXQUFXLENBQUMsQ0FBQ25MLFNBQVMsQ0FBQyxZQUFZLENBQUM7RUFDN0MsQ0FBQyxDQUFDO0VBRUY1VyxJQUFJLENBQUMsaUZBQWlGLEVBQUUsT0FBTztJQUM3Rm9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTUEsSUFBSSxDQUFDNmIsZUFBZSxDQUFDO01BQUVDLEtBQUssRUFBRSxHQUFHO01BQUVDLE1BQU0sRUFBRTtJQUFJLENBQUMsQ0FBQztJQUN2RCxNQUFNelosT0FBTyxHQUFHLE1BQU1xRixzQkFBc0IsQ0FBQzNILElBQUksQ0FBQztJQUNsRCxNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWtDLFFBQVEsRUFBRUk7SUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTThLLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTWtoQixRQUFRLEdBQUdyYixJQUFJLENBQUM0VyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNQLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU1nRixRQUFRLENBQUNMLElBQUksQ0FBQzFZLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQ3JDLE1BQU11WSxRQUFRLENBQUN6RSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNqVyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUN5TixLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNelUsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUM0RixNQUFNLEVBQUU7TUFBRW5ILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQ3ZELENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLEdBQUd3QixPQUFPLENBQUMwRixNQUFNLEtBQUssRUFBRTtNQUFFakgsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQ25EMmEsSUFBSSxDQUFDLENBQ1YsQ0FBQyxDQUFDN2EsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNYixJQUFJLENBQ1A0VyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQ2xCamEsTUFBTSxDQUFDO01BQUV3ZCxPQUFPLEVBQUU7SUFBaUIsQ0FBQyxDQUFDLENBQ3JDdUIsSUFBSSxDQUFDLENBQUMsQ0FDTnROLEtBQUssQ0FBQyxDQUFDO0lBQ1YsTUFBTXpVLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQzRXLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDMkIsYUFBYSxDQUFDLGdCQUFnQixDQUFDO0lBQ2xFLE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQzJCLGFBQWEsQ0FBQ2pXLE9BQU8sQ0FBQzBGLE1BQU0sQ0FBQztJQUNoRSxNQUFNck8sTUFBTSxDQUFDcUcsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMyQixhQUFhLENBQzlDLGlDQUNGLENBQUM7SUFDRCxNQUFNeFksMEJBQTBCLENBQUNDLElBQUksQ0FBQztJQUV0QyxNQUFNMmIsV0FBVyxHQUFHLE1BQU0zYixJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNnRixTQUFTLENBQUMsQ0FBQztJQUMxRGppQixNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNqTCxHQUFHLENBQUNzTCxPQUFPLENBQzdCLDJGQUNGLENBQUM7RUFDSCxDQUFDLENBQUM7RUFFRnBpQixJQUFJLENBQUMsNEZBQTRGLEVBQUUsT0FBTztJQUN4R29HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTWljLFFBQVEsR0FBRyxNQUFNdFUsc0JBQXNCLENBQUMzSCxJQUFJLEVBQUU7TUFDbEQ0QyxTQUFTLEVBQUUsOEJBQThCO01BQ3pDRSxRQUFRLEVBQUU7SUFDWixDQUFDLENBQUM7SUFDRixNQUFNbUYsT0FBTyxHQUFHLE1BQU1OLHNCQUFzQixDQUFDM0gsSUFBSSxFQUFFO01BQ2pEaUksT0FBTyxFQUFFLElBQUk7TUFDYnJGLFNBQVMsRUFBRSw2QkFBNkI7TUFDeENFLFFBQVEsRUFBRTtJQUNaLENBQUMsQ0FBQztJQUNGLE1BQU10QixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QmtDLFFBQVEsRUFBRStaLFFBQVE7TUFDbEI5WixXQUFXLEVBQUU4RjtJQUNmLENBQUMsQ0FBQztJQUNGLE1BQU1tRixrQkFBa0IsQ0FBQ3BOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNzTixJQUFJLENBQUMsR0FBR25ULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1raEIsUUFBUSxHQUFHcmIsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDUCxLQUFLLENBQUMsQ0FBQztJQUNqRCxNQUFNZ0YsUUFBUSxDQUFDTCxJQUFJLENBQUMvUyxPQUFPLENBQUNuRixRQUFRLENBQUM7SUFDckMsTUFBTXVZLFFBQVEsQ0FBQ3pFLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQ2pXLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQ3lOLEtBQUssQ0FBQyxDQUFDO0lBRTlELE1BQU16VSxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQ21ILE9BQU8sQ0FBQ0MsTUFBTSxFQUFFO01BQUVuSCxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUN2RCxDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1iLElBQUksQ0FDUDRXLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FDbEJqYSxNQUFNLENBQUM7TUFBRXdkLE9BQU8sRUFBRTtJQUFpQixDQUFDLENBQUMsQ0FDckN1QixJQUFJLENBQUMsQ0FBQyxDQUNOdE4sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMyQixhQUFhLENBQUMsZ0JBQWdCLENBQUM7SUFDbEUsTUFBTW9ELFdBQVcsR0FBRyxNQUFNM2IsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDZ0YsU0FBUyxDQUFDLENBQUM7SUFDMURqaUIsTUFBTSxDQUFDZ2lCLFdBQVcsQ0FBQyxDQUFDakwsR0FBRyxDQUFDc0wsT0FBTyxDQUM3QiwyRkFDRixDQUFDO0VBQ0gsQ0FBQyxDQUFDO0VBRUZwaUIsSUFBSSxDQUFDLG1EQUFtRCxFQUFFLE9BQU87SUFDL0RvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1pYyxRQUFRLEdBQUcsTUFBTXRVLHNCQUFzQixDQUFDM0gsSUFBSSxFQUFFO01BQ2xENEMsU0FBUyxFQUFFLDhCQUE4QjtNQUN6Q0UsUUFBUSxFQUFFO0lBQ1osQ0FBQyxDQUFDO0lBQ0YsTUFBTW1GLE9BQU8sR0FBRyxNQUFNTixzQkFBc0IsQ0FBQzNILElBQUksRUFBRTtNQUNqRGlJLE9BQU8sRUFBRSxJQUFJO01BQ2JyRixTQUFTLEVBQUUsNkJBQTZCO01BQ3hDRSxRQUFRLEVBQUU7SUFDWixDQUFDLENBQUM7SUFDRixNQUFNdEIsa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFDN0JrQyxRQUFRLEVBQUUrWixRQUFRO01BQ2xCOVosV0FBVyxFQUFFOEYsT0FBTztNQUNwQnJDLFFBQVEsRUFBRSxDQUNSO1FBQ0UxSCxFQUFFLEVBQUUsaUJBQWlCO1FBQ3JCMEMsSUFBSSxFQUFFLHNCQUFzQjtRQUM1QmlGLFFBQVEsRUFBRSxZQUFZO1FBQ3RCQyxTQUFTLEVBQUUsT0FBTztRQUNsQnBILE1BQU0sRUFBRSxRQUFRO1FBQ2hCcUgsUUFBUSxFQUFFLHlCQUF5QjtRQUNuQ0MsWUFBWSxFQUFFO01BQ2hCLENBQUMsRUFDRDtRQUNFOUgsRUFBRSxFQUFFLGlCQUFpQjtRQUNyQjBDLElBQUksRUFBRSxzQkFBc0I7UUFDNUJpRixRQUFRLEVBQUUsWUFBWTtRQUN0QkMsU0FBUyxFQUFFLE9BQU87UUFDbEJwSCxNQUFNLEVBQUUsUUFBUTtRQUNoQnFILFFBQVEsRUFBRSx5QkFBeUI7UUFDbkNDLFlBQVksRUFBRTtNQUNoQixDQUFDO0lBRUwsQ0FBQyxDQUFDO0lBQ0YsTUFBTW9ILGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTTZGLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUVxYixRQUFRLENBQUNuWixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDN0RxTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU16VSxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQ21iLFFBQVEsQ0FBQy9ULE1BQU0sRUFBRTtNQUFFbkgsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMyYSxJQUFJLENBQUMsQ0FDeEQsQ0FBQyxDQUFDN2EsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsR0FBR21iLFFBQVEsQ0FBQ2pVLE1BQU0sS0FBSyxFQUFFO01BQUVqSCxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUNqRSxDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxpQ0FBaUMsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUMxRSxDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU1iLElBQUksQ0FBQ1csU0FBUyxDQUFDLFVBQVUsQ0FBQyxDQUFDdWEsWUFBWSxDQUFDLGlCQUFpQixDQUFDO0lBQ2hFLE1BQU12aEIsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRXFILE9BQU8sQ0FBQ25GLFFBQVE7TUFBRS9CLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDbEUsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQ21iLFFBQVEsQ0FBQy9ULE1BQU0sRUFBRTtNQUFFbkgsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ3VXLFdBQVcsQ0FDeEUsQ0FDRixDQUFDO0lBQ0QsTUFBTXRYLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUVxSCxPQUFPLENBQUNuRixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDNURxTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU16VSxNQUFNLENBQ1ZxRyxJQUFJLENBQ0RjLFNBQVMsQ0FBQyw2Q0FBNkMsRUFBRTtNQUN4REMsS0FBSyxFQUFFO0lBQ1QsQ0FBQyxDQUFDLENBQ0QyYSxJQUFJLENBQUMsQ0FDVixDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxHQUFHbUgsT0FBTyxDQUFDRCxNQUFNLEtBQUssRUFBRTtNQUFFakgsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUN6RCxDQUFDLENBQUN1VyxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQ2hCLE1BQU0zZCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxpQ0FBaUMsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ25FLENBQUMsQ0FBQ3VXLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFFaEIsTUFBTXRYLElBQUksQ0FBQ1csU0FBUyxDQUFDLFVBQVUsQ0FBQyxDQUFDdWEsWUFBWSxDQUFDLGlCQUFpQixDQUFDO0lBQ2hFLE1BQU1sYixJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFcWIsUUFBUSxDQUFDblosUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzdEcU4sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNelUsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsR0FBR21iLFFBQVEsQ0FBQ2pVLE1BQU0sS0FBSyxFQUFFO01BQUVqSCxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUNqRSxDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxpQ0FBaUMsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUMxRSxDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyw2Q0FBNkMsRUFBRTtNQUM1REMsS0FBSyxFQUFFO0lBQ1QsQ0FBQyxDQUNILENBQUMsQ0FBQ3VXLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFFaEIsTUFBTXFFLFdBQVcsR0FBRyxNQUFNM2IsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDZ0YsU0FBUyxDQUFDLENBQUM7SUFDMURqaUIsTUFBTSxDQUFDZ2lCLFdBQVcsQ0FBQyxDQUFDakwsR0FBRyxDQUFDc0wsT0FBTyxDQUM3QiwyRkFDRixDQUFDO0VBQ0gsQ0FBQyxDQUFDO0VBRUZwaUIsSUFBSSxDQUFDLHNEQUFzRCxFQUFFLE9BQU87SUFDbEVvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1pYyxRQUFRLEdBQUcsTUFBTXRVLHNCQUFzQixDQUFDM0gsSUFBSSxFQUFFO01BQ2xENEMsU0FBUyxFQUFFLDhCQUE4QjtNQUN6Q0UsUUFBUSxFQUFFO0lBQ1osQ0FBQyxDQUFDO0lBQ0YsTUFBTW1GLE9BQU8sR0FBRyxNQUFNTixzQkFBc0IsQ0FBQzNILElBQUksRUFBRTtNQUNqRGlJLE9BQU8sRUFBRSxJQUFJO01BQ2JyRixTQUFTLEVBQUUsNkJBQTZCO01BQ3hDRSxRQUFRLEVBQUU7SUFDWixDQUFDLENBQUM7SUFDRixNQUFNdEIsa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFDN0JrQyxRQUFRLEVBQUUrWixRQUFRO01BQ2xCOVosV0FBVyxFQUFFOEY7SUFDZixDQUFDLENBQUM7SUFDRixNQUFNbUYsa0JBQWtCLENBQUNwTixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDc04sSUFBSSxDQUFDLEdBQUduVCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNK2hCLHNCQUFzQixHQUFHLE1BQUFBLENBQUEsS0FBWTtNQUN6QyxNQUFNdmlCLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDbWIsUUFBUSxDQUFDL1QsTUFBTSxFQUFFO1FBQUVuSCxLQUFLLEVBQUU7TUFBSyxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUN4RCxDQUFDLENBQUM3YSxXQUFXLENBQUMsQ0FBQztNQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxHQUFHbWIsUUFBUSxDQUFDalUsTUFBTSxLQUFLLEVBQUU7UUFBRWpILEtBQUssRUFBRTtNQUFNLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQ2pFLENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO01BQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLGlDQUFpQyxFQUFFO1FBQUVDLEtBQUssRUFBRTtNQUFLLENBQUMsQ0FBQyxDQUM3RDJhLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO01BQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDZDQUE2QyxFQUFFO1FBQzVEQyxLQUFLLEVBQUU7TUFDVCxDQUFDLENBQ0gsQ0FBQyxDQUFDdVcsV0FBVyxDQUFDLENBQUMsQ0FBQztJQUNsQixDQUFDO0lBQ0QsTUFBTTZFLHFCQUFxQixHQUFHLE1BQUFBLENBQUEsS0FBWTtNQUN4QyxNQUFNeGlCLE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLDZDQUE2QyxFQUFFO1FBQ3hEQyxLQUFLLEVBQUU7TUFDVCxDQUFDLENBQUMsQ0FDRDJhLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO01BQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLEdBQUdtSCxPQUFPLENBQUNELE1BQU0sS0FBSyxFQUFFO1FBQUVqSCxLQUFLLEVBQUU7TUFBTSxDQUFDLENBQ3pELENBQUMsQ0FBQ3VXLFdBQVcsQ0FBQyxDQUFDLENBQUM7TUFDaEIsTUFBTTNkLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGlDQUFpQyxFQUFFO1FBQUVDLEtBQUssRUFBRTtNQUFLLENBQUMsQ0FDbkUsQ0FBQyxDQUFDdVcsV0FBVyxDQUFDLENBQUMsQ0FBQztJQUNsQixDQUFDO0lBQ0QsTUFBTThFLCtCQUErQixHQUFHLE1BQUFBLENBQUEsS0FBWTtNQUNsRCxNQUFNVCxXQUFXLEdBQUcsTUFBTTNiLElBQUksQ0FBQzRXLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQ2dGLFNBQVMsQ0FBQyxDQUFDO01BQzFEamlCLE1BQU0sQ0FBQ2dpQixXQUFXLENBQUMsQ0FBQ2pMLEdBQUcsQ0FBQ3NMLE9BQU8sQ0FDN0IsaUhBQ0YsQ0FBQztJQUNILENBQUM7SUFFRCxNQUFNaGMsSUFBSSxDQUNQVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRXFiLFFBQVEsQ0FBQ25aLFFBQVE7TUFBRS9CLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUM3RHFOLEtBQUssQ0FBQyxDQUFDO0lBQ1YsTUFBTThOLHNCQUFzQixDQUFDLENBQUM7SUFFOUIsTUFBTWhPLGNBQWMsQ0FBQ2xPLElBQUksRUFBRSxVQUFVLEVBQUUsR0FBRzdGLGNBQWMsVUFBVSxDQUFDO0lBQ25FLE1BQU02RixJQUFJLENBQUNxYyxNQUFNLENBQUMsQ0FBQztJQUNuQixNQUFNMWlCLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDNE4sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBRzFULGNBQWMsQ0FBQzJULFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FDMUQsQ0FBQztJQUNELE1BQU05TixJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFcWIsUUFBUSxDQUFDblosUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzdEcU4sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNOE4sc0JBQXNCLENBQUMsQ0FBQztJQUM5QixNQUFNRSwrQkFBK0IsQ0FBQyxDQUFDO0lBRXZDLE1BQU1wYyxJQUFJLENBQUNzYyxTQUFTLENBQUMsQ0FBQztJQUN0QixNQUFNM2lCLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDNE4sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBRzFULGNBQWMsQ0FBQzJULFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLFdBQVcsQ0FDaEUsQ0FBQztJQUNELE1BQU05TixJQUFJLENBQUNxYyxNQUFNLENBQUMsQ0FBQztJQUNuQixNQUFNMWlCLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDNE4sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBRzFULGNBQWMsQ0FBQzJULFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FDMUQsQ0FBQztJQUNELE1BQU05TixJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFcWIsUUFBUSxDQUFDblosUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzdEcU4sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNOE4sc0JBQXNCLENBQUMsQ0FBQztJQUU5QixNQUFNbGMsSUFBSSxDQUNQVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRXFILE9BQU8sQ0FBQ25GLFFBQVE7TUFBRS9CLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUM1RHFOLEtBQUssQ0FBQyxDQUFDO0lBQ1YsTUFBTStOLHFCQUFxQixDQUFDLENBQUM7SUFFN0IsTUFBTWpPLGNBQWMsQ0FBQ2xPLElBQUksRUFBRSxjQUFjLEVBQUUsR0FBRzdGLGNBQWMsUUFBUSxDQUFDO0lBQ3JFLE1BQU02RixJQUFJLENBQUNxYyxNQUFNLENBQUMsQ0FBQztJQUNuQixNQUFNMWlCLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDNE4sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBRzFULGNBQWMsQ0FBQzJULFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FDMUQsQ0FBQztJQUNELE1BQU05TixJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFcUgsT0FBTyxDQUFDbkYsUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzVEcU4sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNK04scUJBQXFCLENBQUMsQ0FBQztJQUM3QixNQUFNQywrQkFBK0IsQ0FBQyxDQUFDO0lBRXZDLE1BQU1wYyxJQUFJLENBQUNzYyxTQUFTLENBQUMsQ0FBQztJQUN0QixNQUFNM2lCLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDNE4sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBRzFULGNBQWMsQ0FBQzJULFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FDOUQsQ0FBQztJQUNELE1BQU05TixJQUFJLENBQUNxYyxNQUFNLENBQUMsQ0FBQztJQUNuQixNQUFNMWlCLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDNE4sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBRzFULGNBQWMsQ0FBQzJULFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FDMUQsQ0FBQztJQUNELE1BQU05TixJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFcUgsT0FBTyxDQUFDbkYsUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzVEcU4sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNK04scUJBQXFCLENBQUMsQ0FBQztJQUM3QixNQUFNQywrQkFBK0IsQ0FBQyxDQUFDO0VBQ3pDLENBQUMsQ0FBQztFQUVGeGlCLElBQUksQ0FBQywrREFBK0QsRUFBRSxPQUFPO0lBQzNFb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNc0MsT0FBTyxHQUFHdUkseUJBQXlCLENBQUMsQ0FBQztJQUMzQyxNQUFNckosa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWtDLFFBQVEsRUFBRUk7SUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTThLLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTWtoQixRQUFRLEdBQUdyYixJQUFJLENBQUM0VyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNQLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU1nRixRQUFRLENBQUNMLElBQUksQ0FBQzFZLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQ3JDLE1BQU11WSxRQUFRLENBQUN6RSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNqVyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUN5TixLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNelUsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUM0RixNQUFNLEVBQUU7TUFBRW5ILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQ3ZELENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLHFEQUFxRCxFQUFFO01BQ2hFQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQUMsQ0FDRDJhLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWIsSUFBSSxDQUNQNFcsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUNsQmphLE1BQU0sQ0FBQztNQUFFd2QsT0FBTyxFQUFFO0lBQWlCLENBQUMsQ0FBQyxDQUNyQ3VCLElBQUksQ0FBQyxDQUFDLENBQ050TixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU16VSxNQUFNLENBQUNxRyxJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQzJCLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQztJQUNsRSxNQUFNNWUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMyQixhQUFhLENBQzlDLGdDQUNGLENBQUM7SUFDRCxNQUFNNWUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMyQixhQUFhLENBQUMsYUFBYSxDQUFDO0lBQy9ELE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQzJCLGFBQWEsQ0FBQyx1QkFBdUIsQ0FBQztJQUN6RSxNQUFNb0QsV0FBVyxHQUFHLE1BQU0zYixJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNnRixTQUFTLENBQUMsQ0FBQztJQUMxRGppQixNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNqTCxHQUFHLENBQUNGLFNBQVMsQ0FBQyxXQUFXLENBQUM7SUFDOUM3VyxNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNuTCxTQUFTLENBQUMsMkJBQTJCLENBQUM7SUFDMUQ3VyxNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNuTCxTQUFTLENBQUMsNENBQTRDLENBQUM7RUFDN0UsQ0FBQyxDQUFDO0VBRUY1VyxJQUFJLENBQUMsaUVBQWlFLEVBQUUsT0FBTztJQUM3RW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTUEsSUFBSSxDQUFDNmIsZUFBZSxDQUFDO01BQUVDLEtBQUssRUFBRSxHQUFHO01BQUVDLE1BQU0sRUFBRTtJQUFJLENBQUMsQ0FBQztJQUN2RCxNQUFNelosT0FBTyxHQUFHdUkseUJBQXlCLENBQUMsQ0FBQztJQUMzQyxNQUFNckosa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWtDLFFBQVEsRUFBRUk7SUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTThLLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTWtoQixRQUFRLEdBQUdyYixJQUFJLENBQUM0VyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNQLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU1nRixRQUFRLENBQUNMLElBQUksQ0FBQzFZLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQ3JDLE1BQU11WSxRQUFRLENBQUN6RSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNqVyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUN5TixLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNelUsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUM0RixNQUFNLEVBQUU7TUFBRW5ILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQ3ZELENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLHFEQUFxRCxFQUFFO01BQ2hFQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQUMsQ0FDRDJhLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWIsSUFBSSxDQUNQNFcsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUNsQmphLE1BQU0sQ0FBQztNQUFFd2QsT0FBTyxFQUFFO0lBQWlCLENBQUMsQ0FBQyxDQUNyQ3VCLElBQUksQ0FBQyxDQUFDLENBQ050TixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU16VSxNQUFNLENBQUNxRyxJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQzJCLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQztJQUNsRSxNQUFNNWUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMyQixhQUFhLENBQzlDLGdDQUNGLENBQUM7SUFDRCxNQUFNNWUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMyQixhQUFhLENBQUMsYUFBYSxDQUFDO0lBQy9ELE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQzJCLGFBQWEsQ0FBQyx1QkFBdUIsQ0FBQztJQUN6RSxNQUFNb0QsV0FBVyxHQUFHLE1BQU0zYixJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNnRixTQUFTLENBQUMsQ0FBQztJQUMxRGppQixNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNqTCxHQUFHLENBQUNzTCxPQUFPLENBQzdCLHFFQUNGLENBQUM7SUFFRCxNQUFNamMsMEJBQTBCLENBQUNDLElBQUksQ0FBQztFQUN4QyxDQUFDLENBQUM7RUFFRnBHLElBQUksQ0FBQyxrRkFBa0YsRUFBRSxPQUFPO0lBQzlGb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNc0MsT0FBTyxHQUFHbUosNEJBQTRCLENBQUMsQ0FBQztJQUM5QyxNQUFNakssa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRW9DLFlBQVksRUFBRUU7SUFBUSxDQUFDLENBQUM7SUFDekQsTUFBTThLLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTWtoQixRQUFRLEdBQUdyYixJQUFJLENBQUM0VyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNQLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU1nRixRQUFRLENBQUNMLElBQUksQ0FBQzFZLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQ3JDLE1BQU11WSxRQUFRLENBQUN6RSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNqVyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUN5TixLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNbEcsTUFBTSxHQUFHbEksSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUM0RixNQUFNLEVBQUU7TUFBRW5ILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQztJQUM5RCxNQUFNcEgsTUFBTSxDQUFDdU8sTUFBTSxDQUFDd1QsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDN2EsV0FBVyxDQUFDLENBQUM7SUFDekMsTUFBTWxILE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGFBQWEsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUMzRSxNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsa0JBQWtCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMyYSxJQUFJLENBQUMsQ0FDNUQsQ0FBQyxDQUFDN2EsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsMkJBQTJCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMyYSxJQUFJLENBQUMsQ0FDckUsQ0FBQyxDQUFDN2EsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsd0RBQXdELEVBQUU7TUFDdkVDLEtBQUssRUFBRTtJQUNULENBQUMsQ0FDSCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBRWYsTUFBTWIsSUFBSSxDQUFDb1gsTUFBTSxDQUFDLENBQUM7SUFDbkIsTUFBTXBYLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUUwQixPQUFPLENBQUNRLFFBQVE7TUFBRS9CLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUM1RHFOLEtBQUssQ0FBQyxDQUFDO0lBRVYsTUFBTXpVLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDd0IsT0FBTyxDQUFDNEYsTUFBTSxFQUFFO01BQUVuSCxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQzJhLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2xGLE1BQU1sSCxNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxhQUFhLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDM0UsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGtCQUFrQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQzVELENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDJCQUEyQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDMmEsSUFBSSxDQUFDLENBQ3JFLENBQUMsQ0FBQzdhLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLHdEQUF3RCxFQUFFO01BQ3ZFQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQ0gsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztFQUNqQixDQUFDLENBQUM7RUFFRmpILElBQUksQ0FBQyw4REFBOEQsRUFBRSxPQUFPO0lBQzFFb0c7RUFDRixDQUFDLEtBQUs7SUFBQSxJQUFBdWMscUJBQUE7SUFDSixNQUFNO01BQUVqYSxPQUFPO01BQUVnRjtJQUFVLENBQUMsR0FBR3VFLG9DQUFvQyxDQUFDLENBQUM7SUFDckUsTUFBTXJLLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQzdCa0MsUUFBUSxFQUFFSSxPQUFPO01BQ2pCUyxhQUFhLEVBQUU7UUFBRVQsT0FBTztRQUFFZ0Y7TUFBVTtJQUN0QyxDQUFDLENBQUM7SUFDRixNQUFNOEYsa0JBQWtCLENBQUNwTixJQUFJLENBQUM7SUFFOUIsTUFBTUEsSUFBSSxDQUFDRSxRQUFRLENBQ2pCLENBQUM7TUFBRTBDLFNBQVM7TUFBRU0sV0FBVztNQUFFckYsU0FBUztNQUFFMEosV0FBVztNQUFFbEo7SUFBUSxDQUFDLEtBQUs7TUFDL0QrWixZQUFZLENBQUNDLE9BQU8sQ0FDbEIsNEJBQTRCeGEsU0FBUyxFQUFFLEVBQ3ZDK0UsU0FDRixDQUFDO01BQ0R3VixZQUFZLENBQUNDLE9BQU8sQ0FDbEIsb0JBQW9CeGEsU0FBUyxJQUFJK0UsU0FBUyxFQUFFLEVBQzVDL0MsSUFBSSxDQUFDQyxTQUFTLENBQUM7UUFDYjVCLEVBQUUsRUFBRWdGLFdBQVc7UUFDZnJGLFNBQVM7UUFDVCtFLFNBQVM7UUFDVDJFLFdBQVc7UUFDWGxKO01BQ0YsQ0FBQyxDQUNILENBQUM7SUFDSCxDQUFDLEVBQ0Q7TUFDRXVFLFNBQVMsRUFBRU4sT0FBTyxDQUFDTSxTQUFTO01BQzVCTSxXQUFXLEVBQUVaLE9BQU8sQ0FBQ1ksV0FBVztNQUNoQ3JGLFNBQVMsRUFBRSxhQUFhO01BQ3hCMEosV0FBVyxFQUFFLDJDQUEyQztNQUN4RGxKLE9BQU8sRUFBRWlFLE9BQU8sQ0FBQ1E7SUFDbkIsQ0FDRixDQUFDO0lBQ0QsTUFBTTlDLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTVIsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMseUNBQXlDLENBQzFELENBQUMsQ0FBQ0QsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNMmIsYUFBYSxHQUFHeGMsSUFBSSxDQUFDOGEsY0FBYyxDQUN0QzFaLE9BQU8sSUFDTkEsT0FBTyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDMEIsUUFBUSxDQUFDLHFCQUFxQixDQUFDLElBQzdDckMsT0FBTyxDQUFDc04sTUFBTSxDQUFDLENBQUMsS0FBSyxNQUN6QixDQUFDO0lBQ0QsTUFBTTFPLElBQUksQ0FDUHNZLFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQyxDQUNuQzNYLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFLFFBQVE7TUFBRUcsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQ3BEcU4sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNcEwsV0FBVyxHQUFHbkQsSUFBSSxDQUFDNlIsS0FBSyxFQUFBNksscUJBQUEsR0FDNUIsQ0FBQyxNQUFNQyxhQUFhLEVBQUVDLFFBQVEsQ0FBQyxDQUFDLGNBQUFGLHFCQUFBLGNBQUFBLHFCQUFBLEdBQUksSUFDdEMsQ0FBNEI7SUFDNUI1aUIsTUFBTSxDQUFDcUosV0FBVyxDQUFDLENBQUMrVyxPQUFPLENBQ3pCcGdCLE1BQU0sQ0FBQytpQixnQkFBZ0IsQ0FBQztNQUN0QjdlLFNBQVMsRUFBRSxhQUFhO01BQ3hCK0UsU0FBUyxFQUFFTixPQUFPLENBQUNNLFNBQVM7TUFDNUJNLFdBQVcsRUFBRVosT0FBTyxDQUFDWSxXQUFXO01BQ2hDcUUsV0FBVyxFQUFFLDJDQUEyQztNQUN4RGxKLE9BQU8sRUFBRWlFLE9BQU8sQ0FBQ1E7SUFDbkIsQ0FBQyxDQUNILENBQUM7SUFFRCxNQUFNbkosTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsd0JBQXdCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUMxRCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLHlDQUF5QyxDQUMxRCxDQUFDLENBQUNELFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTThhLFdBQVcsR0FBRyxNQUFNM2IsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDZ0YsU0FBUyxDQUFDLENBQUM7SUFDMURqaUIsTUFBTSxDQUFDZ2lCLFdBQVcsQ0FBQyxDQUFDakwsR0FBRyxDQUFDRixTQUFTLENBQUMsV0FBVyxDQUFDO0lBQzlDN1csTUFBTSxDQUFDZ2lCLFdBQVcsQ0FBQyxDQUFDakwsR0FBRyxDQUFDRixTQUFTLENBQUMsMkJBQTJCLENBQUM7SUFDOUQ3VyxNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNuTCxTQUFTLENBQUMseUNBQXlDLENBQUM7RUFDMUUsQ0FBQyxDQUFDO0VBRUY1VyxJQUFJLENBQUMsOEVBQThFLEVBQUUsT0FBTztJQUMxRm9HO0VBQ0YsQ0FBQyxLQUFLO0lBQUEsSUFBQTJjLGdCQUFBLEVBQUFDLGlCQUFBO0lBQ0osTUFBTUMsUUFBUSxHQUFHL1EsK0JBQStCLENBQUMsQ0FBQztJQUNsRCxNQUFNdEssa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRW9ELGlCQUFpQixFQUFFeVo7SUFBUyxDQUFDLENBQUM7SUFDL0QsTUFBTTdjLElBQUksQ0FBQzhjLGFBQWEsQ0FBQyxNQUFNO01BQzdCLE1BQU1DLFdBQVcsR0FBR3hjLE1BQU0sQ0FBQ29PLEtBQUssQ0FBQ3FPLElBQUksQ0FBQ3pjLE1BQU0sQ0FBQztNQUM3Q0EsTUFBTSxDQUFDb08sS0FBSyxHQUFHLE9BQU9zTyxLQUFLLEVBQUVDLElBQUksS0FBSztRQUNwQyxNQUFNbmIsR0FBRyxHQUNQLE9BQU9rYixLQUFLLEtBQUssUUFBUSxHQUNyQkEsS0FBSyxHQUNMQSxLQUFLLFlBQVlFLE9BQU8sR0FDdEJGLEtBQUssQ0FBQ2xiLEdBQUcsR0FDVHFSLE1BQU0sQ0FBQzZKLEtBQUssQ0FBQztRQUNyQixNQUFNdmQsSUFBSSxHQUFHLFFBQU93ZCxJQUFJLGFBQUpBLElBQUksdUJBQUpBLElBQUksQ0FBRXhkLElBQUksTUFBSyxRQUFRLEdBQUd3ZCxJQUFJLENBQUN4ZCxJQUFJLEdBQUcsRUFBRTtRQUM1RCxJQUNFLENBQUNxQyxHQUFHLENBQUMwQixRQUFRLENBQUMscUJBQXFCLENBQUMsSUFDcEMvRCxJQUFJLENBQUMrRCxRQUFRLENBQUMsZUFBZSxDQUFDLEVBQzlCO1VBQ0EsT0FBT3NaLFdBQVcsQ0FBQ0UsS0FBSyxFQUFFQyxJQUFJLENBQUM7UUFDakM7UUFFQSxNQUFNL2IsUUFBUSxHQUFHLE1BQU00YixXQUFXLENBQUNFLEtBQUssRUFBRUMsSUFBSSxDQUFDO1FBQy9DLElBQUksQ0FBQy9iLFFBQVEsQ0FBQ3pCLElBQUksRUFBRSxPQUFPeUIsUUFBUTtRQUNuQyxNQUFNaWMsTUFBTSxHQUFHamMsUUFBUSxDQUFDekIsSUFBSSxDQUFDMmQsU0FBUyxDQUFDLENBQUM7UUFDeEMsTUFBTUMsT0FBTyxHQUFHLElBQUlDLFdBQVcsQ0FBQyxDQUFDO1FBQ2pDLE1BQU1DLE1BQU0sR0FBRyxJQUFJQyxjQUFjLENBQUM7VUFDaEMsTUFBTUMsS0FBS0EsQ0FBQ0MsVUFBVSxFQUFFO1lBQ3RCLElBQUlDLFFBQVEsR0FBRyxFQUFFO1lBQ2pCLE9BQU8sSUFBSSxFQUFFO2NBQ1gsTUFBTTtnQkFBRUMsSUFBSTtnQkFBRTVXO2NBQU0sQ0FBQyxHQUFHLE1BQU1tVyxNQUFNLENBQUNVLElBQUksQ0FBQyxDQUFDO2NBQzNDLElBQUlELElBQUksRUFBRTtnQkFDUixJQUFJRCxRQUFRLEVBQUVELFVBQVUsQ0FBQ0ksT0FBTyxDQUFDVCxPQUFPLENBQUNVLE1BQU0sQ0FBQ0osUUFBUSxDQUFDLENBQUM7Z0JBQzFERCxVQUFVLENBQUNwRyxLQUFLLENBQUMsQ0FBQztnQkFDbEI7Y0FDRjtjQUNBcUcsUUFBUSxJQUFJLElBQUlLLFdBQVcsQ0FBQyxDQUFDLENBQUNDLE1BQU0sQ0FBQ2pYLEtBQUssRUFBRTtnQkFBRXVXLE1BQU0sRUFBRTtjQUFLLENBQUMsQ0FBQztjQUM3RCxNQUFNVyxNQUFNLEdBQUdQLFFBQVEsQ0FBQ1EsT0FBTyxDQUFDLDRCQUE0QixDQUFDO2NBQzdELE1BQU1DLFFBQVEsR0FDWkYsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBR1AsUUFBUSxDQUFDUSxPQUFPLENBQUMsTUFBTSxFQUFFRCxNQUFNLENBQUM7Y0FDcEQsSUFBSUUsUUFBUSxJQUFJLENBQUMsRUFBRTtnQkFDakJWLFVBQVUsQ0FBQ0ksT0FBTyxDQUNoQlQsT0FBTyxDQUFDVSxNQUFNLENBQUNKLFFBQVEsQ0FBQ3hXLEtBQUssQ0FBQyxDQUFDLEVBQUVpWCxRQUFRLEdBQUcsQ0FBQyxDQUFDLENBQ2hELENBQUM7Z0JBQ0RWLFVBQVUsQ0FBQ3ZaLEtBQUssQ0FBQyxJQUFJa2EsU0FBUyxDQUFDLDBCQUEwQixDQUFDLENBQUM7Z0JBQzNEO2NBQ0Y7WUFDRjtVQUNGO1FBQ0YsQ0FBQyxDQUFDO1FBQ0YsT0FBTyxJQUFJQyxRQUFRLENBQUNmLE1BQU0sRUFBRTtVQUMxQjllLE1BQU0sRUFBRXlDLFFBQVEsQ0FBQ3pDLE1BQU07VUFDdkI4ZixVQUFVLEVBQUVyZCxRQUFRLENBQUNxZCxVQUFVO1VBQy9CN2UsT0FBTyxFQUFFd0IsUUFBUSxDQUFDeEI7UUFDcEIsQ0FBQyxDQUFDO01BQ0osQ0FBQztJQUNILENBQUMsQ0FBQztJQUNGLE1BQU15TixrQkFBa0IsQ0FBQ3BOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNzTixJQUFJLENBQUMsR0FBR25ULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1tTCxjQUE4QyxHQUFHLEVBQUU7SUFDekR0RixJQUFJLENBQUNxYSxFQUFFLENBQUMsU0FBUyxFQUFHalosT0FBTyxJQUFLO01BQzlCLElBQ0VBLE9BQU8sQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQzBCLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxJQUM3Q3JDLE9BQU8sQ0FBQ3NOLE1BQU0sQ0FBQyxDQUFDLEtBQUssTUFBTSxFQUMzQjtRQUNBLElBQUk7VUFDRnBKLGNBQWMsQ0FBQ3BCLElBQUksQ0FDakI5QyxPQUFPLENBQUM2QixZQUFZLENBQUMsQ0FDdkIsQ0FBQztRQUNILENBQUMsQ0FBQyxNQUFNO1VBQ047VUFDQTtRQUFBO01BRUo7SUFDRixDQUFDLENBQUM7SUFFRixNQUFNb1ksUUFBUSxHQUFHcmIsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDUCxLQUFLLENBQUMsQ0FBQztJQUNqRCxNQUFNZ0YsUUFBUSxDQUFDTCxJQUFJLENBQUM2QixRQUFRLENBQUN2YSxPQUFPLENBQUNRLFFBQVEsQ0FBQztJQUM5QyxNQUFNdVksUUFBUSxDQUFDekUsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDalcsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDeU4sS0FBSyxDQUFDLENBQUM7SUFFOUQsTUFBTXpVLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUNaLGdFQUFnRSxFQUNoRTtNQUNFQyxLQUFLLEVBQUU7SUFDVCxDQUNGLENBQ0YsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU00ZCxVQUFVLEdBQ2QsNkRBQTZEO0lBQy9ELE1BQU1DLFVBQVUsR0FBRyxzQ0FBc0M7SUFDekQsTUFBTS9rQixNQUFNLENBQ1R1ZCxJQUFJLENBQUMsTUFBTWxYLElBQUksQ0FBQ0UsUUFBUSxDQUFFeWUsR0FBRyxJQUFLdkcsWUFBWSxDQUFDd0csT0FBTyxDQUFDRCxHQUFHLENBQUMsRUFBRUYsVUFBVSxDQUFDLENBQUMsQ0FDekVqTyxTQUFTLENBQUNxTSxRQUFRLENBQUM5USxZQUFZLENBQUM7SUFFbkMsTUFBTS9MLElBQUksQ0FBQ0UsUUFBUSxDQUNqQixDQUFDO01BQUV1ZSxVQUFVO01BQUVDO0lBQVcsQ0FBQyxLQUFLO01BQUEsSUFBQUcscUJBQUE7TUFDOUIsTUFBTUMsS0FBSyxHQUFHamYsSUFBSSxDQUFDNlIsS0FBSyxFQUFBbU4scUJBQUEsR0FBQ3pHLFlBQVksQ0FBQ3dHLE9BQU8sQ0FBQ0gsVUFBVSxDQUFDLGNBQUFJLHFCQUFBLGNBQUFBLHFCQUFBLEdBQUksSUFBSSxDQUFDO01BQ2xFLE9BQU9DLEtBQUssQ0FBQ3ZYLFdBQVc7TUFDeEI2USxZQUFZLENBQUNDLE9BQU8sQ0FBQ29HLFVBQVUsRUFBRTVlLElBQUksQ0FBQ0MsU0FBUyxDQUFDZ2YsS0FBSyxDQUFDLENBQUM7TUFDdkQxRyxZQUFZLENBQUNDLE9BQU8sQ0FBQ3FHLFVBQVUsRUFBRSxnQ0FBZ0MsQ0FBQztJQUNwRSxDQUFDLEVBQ0Q7TUFBRUQsVUFBVTtNQUFFQztJQUFXLENBQzNCLENBQUM7SUFDRCxNQUFNMWUsSUFBSSxDQUFDb1gsTUFBTSxDQUFDLENBQUM7SUFFbkIsTUFBTXpkLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLHlDQUF5QyxFQUFFO01BQ3hEQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQ0gsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1R1ZCxJQUFJLENBQUMsTUFDSmxYLElBQUksQ0FBQ0UsUUFBUSxDQUFFeWUsR0FBRyxJQUFLO01BQUEsSUFBQUksc0JBQUE7TUFDckIsTUFBTUQsS0FBSyxHQUFHamYsSUFBSSxDQUFDNlIsS0FBSyxFQUFBcU4sc0JBQUEsR0FBQzNHLFlBQVksQ0FBQ3dHLE9BQU8sQ0FBQ0QsR0FBRyxDQUFDLGNBQUFJLHNCQUFBLGNBQUFBLHNCQUFBLEdBQUksSUFBSSxDQUFDO01BQzNELE9BQU9ELEtBQUssQ0FBQ3ZYLFdBQVc7SUFDMUIsQ0FBQyxFQUFFa1gsVUFBVSxDQUNmLENBQUMsQ0FDQWxkLElBQUksQ0FBQ3NiLFFBQVEsQ0FBQ3JWLGNBQWMsQ0FBQztJQUVoQyxNQUFNeEgsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRSxRQUFRO01BQUVHLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDcU4sS0FBSyxDQUFDLENBQUM7SUFDdkUsTUFBTXpVLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDK2IsUUFBUSxDQUFDdmEsT0FBTyxDQUFDNEYsTUFBTSxFQUFFO01BQUVuSCxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ3pELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUFDdWQsSUFBSSxDQUFDLE1BQU01UixjQUFjLENBQUN6SSxNQUFNLENBQUMsQ0FBQzBFLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDdEQ1SCxNQUFNLENBQUMyTCxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ3lVLE9BQU8sQ0FDL0JwZ0IsTUFBTSxDQUFDK2lCLGdCQUFnQixDQUFDO01BQ3RCN2UsU0FBUyxFQUFFLGFBQWE7TUFDeEJRLE9BQU8sRUFBRXdlLFFBQVEsQ0FBQ3ZhLE9BQU8sQ0FBQ1E7SUFDNUIsQ0FBQyxDQUNILENBQUM7SUFDRG5KLE1BQU0sRUFBQWdqQixnQkFBQSxHQUFDclgsY0FBYyxDQUFDLENBQUMsQ0FBQyxjQUFBcVgsZ0JBQUEsdUJBQWpCQSxnQkFBQSxDQUFtQnpaLFdBQVcsQ0FBQyxDQUFDNk4sYUFBYSxDQUFDLENBQUM7SUFDdERwWCxNQUFNLEVBQUFpakIsaUJBQUEsR0FBQ3RYLGNBQWMsQ0FBQyxDQUFDLENBQUMsY0FBQXNYLGlCQUFBLHVCQUFqQkEsaUJBQUEsQ0FBbUJoYSxTQUFTLENBQUMsQ0FBQ21PLGFBQWEsQ0FBQyxDQUFDO0lBQ3BEcFgsTUFBTSxDQUFDMkwsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUN5VSxPQUFPLENBQy9CcGdCLE1BQU0sQ0FBQytpQixnQkFBZ0IsQ0FBQztNQUN0QjdlLFNBQVMsRUFBRSxhQUFhO01BQ3hCK0UsU0FBUyxFQUFFaWEsUUFBUSxDQUFDdmEsT0FBTyxDQUFDTSxTQUFTO01BQ3JDTSxXQUFXLEVBQUUyWixRQUFRLENBQUN2YSxPQUFPLENBQUNZLFdBQVc7TUFDekNxRSxXQUFXLEVBQUVzVixRQUFRLENBQUNyVixjQUFjO01BQ3BDbkosT0FBTyxFQUFFd2UsUUFBUSxDQUFDdmEsT0FBTyxDQUFDUTtJQUM1QixDQUFDLENBQ0gsQ0FBQztJQUNEbkosTUFBTSxDQUNKMkwsY0FBYyxDQUFDN0ksR0FBRyxDQUFFMkUsT0FBTyxJQUFLQSxPQUFPLENBQUM4QixXQUFXLENBQUMsQ0FBQ3ZHLE1BQU0sQ0FBQ0MsT0FBTyxDQUNyRSxDQUFDLENBQUNtZCxPQUFPLENBQUMsQ0FBQzhDLFFBQVEsQ0FBQ3ZhLE9BQU8sQ0FBQ1ksV0FBVyxDQUFDLENBQUM7RUFDM0MsQ0FBQyxDQUFDO0VBRUZ0SixJQUFJLENBQUMsdURBQXVELEVBQUUsT0FBTztJQUNuRW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTTZjLFFBQVEsR0FBRztNQUNmNVksUUFBUSxFQUFFLEVBQWM7TUFDeEJpQyxVQUFVLEVBQUUsQ0FDVjtRQUNFRSxVQUFVLEVBQUUsaUNBQWlDO1FBQzdDM0gsV0FBVyxFQUFFLGtDQUFrQztRQUMvQ21FLFNBQVMsRUFBRSxnQ0FBZ0M7UUFDM0NvYyxTQUFTLEVBQUUsU0FBUztRQUNwQnRnQixNQUFNLEVBQUUsU0FBUztRQUNqQmEsU0FBUyxFQUFFLDBCQUEwQjtRQUNyQzBmLGFBQWEsRUFBRSxhQUFhO1FBQzVCQyxtQkFBbUIsRUFDakIsZ0VBQWdFO1FBQ2xFQyxVQUFVLEVBQ1Isc0dBQXNHO1FBQ3hHQyxjQUFjLEVBQUUsSUFBSTtRQUNwQkMsa0JBQWtCLEVBQUUsQ0FBQztVQUFFcEosT0FBTyxFQUFFLHFCQUFxQjtVQUFFdlgsTUFBTSxFQUFFO1FBQVMsQ0FBQyxDQUFDO1FBQzFFNGdCLGtCQUFrQixFQUFFLElBQUk7UUFDeEJDLFdBQVcsRUFBRTtNQUNmLENBQUMsRUFDRDtRQUNFblosVUFBVSxFQUFFLCtCQUErQjtRQUMzQzNILFdBQVcsRUFBRSxnQ0FBZ0M7UUFDN0NtRSxTQUFTLEVBQUUsOEJBQThCO1FBQ3pDb2MsU0FBUyxFQUFFLFdBQVc7UUFDdEJ0Z0IsTUFBTSxFQUFFLFNBQVM7UUFDakJhLFNBQVMsRUFBRSwwQkFBMEI7UUFDckMwZixhQUFhLEVBQUUsbUJBQW1CO1FBQ2xDQyxtQkFBbUIsRUFDakIsbUZBQW1GO1FBQ3JGQyxVQUFVLEVBQ1IsbUZBQW1GO1FBQ3JGQyxjQUFjLEVBQUUsa0RBQWtEO1FBQ2xFQyxrQkFBa0IsRUFBRSxJQUFJO1FBQ3hCQyxrQkFBa0IsRUFBRSxLQUFLO1FBQ3pCQyxXQUFXLEVBQUU7TUFDZixDQUFDLEVBQ0Q7UUFDRW5aLFVBQVUsRUFBRSxpQ0FBaUM7UUFDN0MzSCxXQUFXLEVBQUUsa0NBQWtDO1FBQy9DbUUsU0FBUyxFQUFFLGdDQUFnQztRQUMzQ29jLFNBQVMsRUFBRSxXQUFXO1FBQ3RCdGdCLE1BQU0sRUFBRSxVQUFVO1FBQ2xCYSxTQUFTLEVBQUUsMEJBQTBCO1FBQ3JDMGYsYUFBYSxFQUFFLFdBQVc7UUFDMUJDLG1CQUFtQixFQUFFLCtDQUErQztRQUNwRUMsVUFBVSxFQUFFLHdCQUF3QjtRQUNwQ0MsY0FBYyxFQUFFLCtDQUErQztRQUMvREMsa0JBQWtCLEVBQUUsSUFBSTtRQUN4QkMsa0JBQWtCLEVBQUUsS0FBSztRQUN6QkMsV0FBVyxFQUFFO01BQ2YsQ0FBQztJQUVMLENBQUM7SUFDRCxNQUFNL2Qsa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWlHLGdCQUFnQixFQUFFNFc7SUFBUyxDQUFDLENBQUM7SUFDOUQsTUFBTXpQLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTXFsQixNQUFNLEdBQUd4ZixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFDdENDLElBQUksRUFBRTtJQUNSLENBQUMsQ0FBQztJQUNGLE1BQU1qSCxNQUFNLENBQUM2bEIsTUFBTSxDQUFDLENBQUMzZSxXQUFXLENBQUMsQ0FBQztJQUNsQyxNQUFNbEgsTUFBTSxDQUFDNmxCLE1BQU0sQ0FBQzFlLFNBQVMsQ0FBQyxhQUFhLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDNUUsTUFBTWxILE1BQU0sQ0FDVjZsQixNQUFNLENBQUMxZSxTQUFTLENBQUMsdUJBQXVCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUMzRCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVjZsQixNQUFNLENBQUMxZSxTQUFTLENBQUMsbUJBQW1CLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUN2RCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVjZsQixNQUFNLENBQUMxZSxTQUFTLENBQ2QsbUZBQW1GLEVBQ25GO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQ2hCLENBQ0YsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1Y2bEIsTUFBTSxDQUFDMWUsU0FBUyxDQUFDLCtDQUErQyxFQUFFO01BQ2hFQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQ0gsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1Y2bEIsTUFBTSxDQUFDMWUsU0FBUyxDQUNkLG1FQUFtRSxFQUNuRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUNoQixDQUNGLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFFZixNQUFNNGUsU0FBUyxHQUFHRCxNQUFNLENBQUM1SSxPQUFPLENBQzlCLHdEQUNGLENBQUM7SUFDRCxNQUFNOEksT0FBTyxHQUFHRixNQUFNLENBQUM1SSxPQUFPLENBQzVCLHNEQUNGLENBQUM7SUFDRCxNQUFNK0ksU0FBUyxHQUFHSCxNQUFNLENBQUM1SSxPQUFPLENBQzlCLHdEQUNGLENBQUM7SUFDRCxNQUFNamQsTUFBTSxDQUFDOGxCLFNBQVMsQ0FBQyxDQUFDRyxlQUFlLENBQ3JDLHFCQUFxQixFQUNyQixhQUNGLENBQUM7SUFDRCxNQUFNam1CLE1BQU0sQ0FBQytsQixPQUFPLENBQUMsQ0FBQ0UsZUFBZSxDQUNuQyxxQkFBcUIsRUFDckIsbUJBQ0YsQ0FBQztJQUNELE1BQU1qbUIsTUFBTSxDQUFDZ21CLFNBQVMsQ0FBQyxDQUFDQyxlQUFlLENBQ3JDLHFCQUFxQixFQUNyQixXQUNGLENBQUM7SUFDRCxNQUFNam1CLE1BQU0sQ0FBQzhsQixTQUFTLENBQUM5ZSxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFDMmEsV0FBVyxDQUFDLENBQUM7SUFDeEYsTUFBTTVoQixNQUFNLENBQUM4bEIsU0FBUyxDQUFDOWUsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQzJhLFdBQVcsQ0FBQyxDQUFDO0lBQ3hGLE1BQU01aEIsTUFBTSxDQUFDK2xCLE9BQU8sQ0FBQy9lLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUNpZixZQUFZLENBQUMsQ0FBQztJQUN2RixNQUFNbG1CLE1BQU0sQ0FBQytsQixPQUFPLENBQUMvZSxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFDaWYsWUFBWSxDQUFDLENBQUM7SUFDdkYsTUFBTWxtQixNQUFNLENBQUNnbUIsU0FBUyxDQUFDaGYsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQ2lmLFlBQVksQ0FBQyxDQUFDO0lBQ3pGLE1BQU1sbUIsTUFBTSxDQUFDZ21CLFNBQVMsQ0FBQ2hmLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUNpZixZQUFZLENBQUMsQ0FBQztJQUV6RixNQUFNbEUsV0FBVyxHQUFHLE1BQU0zYixJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNnRixTQUFTLENBQUMsQ0FBQztJQUMxRGppQixNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNqTCxHQUFHLENBQUNzTCxPQUFPLENBQzdCLDJEQUNGLENBQUM7SUFDRCxNQUFNamMsMEJBQTBCLENBQUNDLElBQUksQ0FBQztJQUV0QyxNQUFNQSxJQUFJLENBQUNvWCxNQUFNLENBQUMsQ0FBQztJQUNuQixNQUFNMEksY0FBYyxHQUFHOWYsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQzlDQyxJQUFJLEVBQUU7SUFDUixDQUFDLENBQUM7SUFDRixNQUFNakgsTUFBTSxDQUFDbW1CLGNBQWMsQ0FBQyxDQUFDamYsV0FBVyxDQUFDLENBQUM7SUFDMUMsTUFBTWxILE1BQU0sQ0FDVm1tQixjQUFjLENBQ1hsSixPQUFPLENBQUMsc0RBQXNELENBQUMsQ0FDL0RqVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQ3RELENBQUMsQ0FBQ2lmLFlBQVksQ0FBQyxDQUFDO0lBQ2hCLE1BQU1sbUIsTUFBTSxDQUNWbW1CLGNBQWMsQ0FDWGxKLE9BQU8sQ0FBQyx3REFBd0QsQ0FBQyxDQUNqRWpXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FDdEQsQ0FBQyxDQUFDaWYsWUFBWSxDQUFDLENBQUM7SUFDaEJsbUIsTUFBTSxDQUFDa2pCLFFBQVEsQ0FBQzVZLFFBQVEsQ0FBQ3BILE1BQU0sQ0FBQyxDQUFDa2pCLHNCQUFzQixDQUFDLENBQUMsQ0FBQztJQUMxRHBtQixNQUFNLENBQUNrakIsUUFBUSxDQUFDNVksUUFBUSxDQUFDNFEsS0FBSyxDQUFFOVMsR0FBRyxJQUFLQSxHQUFHLENBQUMwQixRQUFRLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxDQUFDLENBQUNsQyxJQUFJLENBQUMsSUFBSSxDQUFDO0VBQzVGLENBQUMsQ0FBQztFQUVGM0gsSUFBSSxDQUFDLGtFQUFrRSxFQUFFLE9BQU87SUFDOUVvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU02YyxRQUFRLEdBQUc7TUFDZjVZLFFBQVEsRUFBRSxFQUFjO01BQ3hCdUMsY0FBYyxFQUFFLEVBQWM7TUFDOUJOLFVBQVUsRUFBRSxDQUNWO1FBQ0VFLFVBQVUsRUFBRSw0QkFBNEI7UUFDeEMzSCxXQUFXLEVBQUUsNkJBQTZCO1FBQzFDbUUsU0FBUyxFQUFFLDJCQUEyQjtRQUN0Q29jLFNBQVMsRUFBRSxTQUFTO1FBQ3BCdGdCLE1BQU0sRUFBRSxTQUFTO1FBQ2pCYSxTQUFTLEVBQUUsMEJBQTBCO1FBQ3JDMGYsYUFBYSxFQUFFLGFBQWE7UUFDNUJDLG1CQUFtQixFQUNqQiwrRkFBK0Y7UUFDakdDLFVBQVUsRUFDUixzR0FBc0c7UUFDeEdDLGNBQWMsRUFBRSxJQUFJO1FBQ3BCQyxrQkFBa0IsRUFBRSxDQUFDO1VBQUVwSixPQUFPLEVBQUUscUJBQXFCO1VBQUV2WCxNQUFNLEVBQUU7UUFBUyxDQUFDLENBQUM7UUFDMUU0Z0Isa0JBQWtCLEVBQUUsSUFBSTtRQUN4QkMsV0FBVyxFQUFFO01BQ2YsQ0FBQyxDQUNGO01BQ0RwWixjQUFjLEVBQUU7UUFDZEMsVUFBVSxFQUFFLDRCQUE0QjtRQUN4Q0MsTUFBTSxFQUFFLG1CQUE0QjtRQUNwQ2xGLFFBQVEsRUFBRTtVQUNSaUQsS0FBSyxFQUFFLCtDQUErQztVQUN0RDhFLElBQUksRUFBRSw0QkFBNEI7VUFDbEM4VixTQUFTLEVBQUUsV0FBVztVQUN0QkMsYUFBYSxFQUFFLFdBQVc7VUFDMUJFLFVBQVUsRUFBRSx3QkFBd0I7VUFDcENyTyxVQUFVLEVBQUU7UUFDZCxDQUFDO1FBQ0RySyxjQUFjLEVBQUUsQ0FDZDtVQUNFTCxVQUFVLEVBQUUsNEJBQTRCO1VBQ3hDM0gsV0FBVyxFQUFFLDZCQUE2QjtVQUMxQ21FLFNBQVMsRUFBRSwyQkFBMkI7VUFDdENvYyxTQUFTLEVBQUUsV0FBVztVQUN0QnRnQixNQUFNLEVBQUUsVUFBVTtVQUNsQmEsU0FBUyxFQUFFLDBCQUEwQjtVQUNyQzBmLGFBQWEsRUFBRSxXQUFXO1VBQzFCQyxtQkFBbUIsRUFBRSwrQ0FBK0M7VUFDcEVDLFVBQVUsRUFBRSx3QkFBd0I7VUFDcENDLGNBQWMsRUFBRSxJQUFJO1VBQ3BCQyxrQkFBa0IsRUFBRSxJQUFJO1VBQ3hCQyxrQkFBa0IsRUFBRSxLQUFLO1VBQ3pCQyxXQUFXLEVBQUU7UUFDZixDQUFDO01BRUw7SUFDRixDQUFDO0lBQ0QsTUFBTS9kLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQUVpRyxnQkFBZ0IsRUFBRTRXO0lBQVMsQ0FBQyxDQUFDO0lBQzlELE1BQU16UCxrQkFBa0IsQ0FBQ3BOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNzTixJQUFJLENBQUMsR0FBR25ULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1xbEIsTUFBTSxHQUFHeGYsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQ3RDQyxJQUFJLEVBQUU7SUFDUixDQUFDLENBQUM7SUFDRixNQUFNb2YsU0FBUyxHQUFHUixNQUFNLENBQUM1SSxPQUFPLENBQzlCLG1EQUNGLENBQUM7SUFDRCxNQUFNamQsTUFBTSxDQUFDcW1CLFNBQVMsQ0FBQ3JmLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUMyYSxXQUFXLENBQUMsQ0FBQztJQUN4RixNQUFNeUUsU0FBUyxDQUFDcmYsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBb0IsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUUxRSxNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsd0JBQXdCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDckYsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUNaLHVFQUF1RSxFQUN2RTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUNoQixDQUNGLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNUdWQsSUFBSSxDQUFDLE1BQU0yRixRQUFRLENBQUM1WSxRQUFRLENBQUNwSCxNQUFNLENBQUMsQ0FDcENrakIsc0JBQXNCLENBQUMsQ0FBQyxDQUFDO0lBQzVCLE1BQU1wbUIsTUFBTSxDQUFDcW1CLFNBQVMsQ0FBQyxDQUFDSixlQUFlLENBQUMscUJBQXFCLEVBQUUsV0FBVyxDQUFDO0lBQzNFam1CLE1BQU0sQ0FBQ2tqQixRQUFRLENBQUNyVyxjQUFjLENBQUMsQ0FBQ2lTLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFDL0M5ZSxNQUFNLENBQUNrakIsUUFBUSxDQUFDclcsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUNnSyxTQUFTLENBQzFDLCtEQUNGLENBQUM7SUFDRDdXLE1BQU0sQ0FBQyxNQUFNNmxCLE1BQU0sQ0FBQzVJLE9BQU8sQ0FBQyxtREFBbUQsQ0FBQyxDQUFDdkMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDOVMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNqRyxNQUFNb2EsV0FBVyxHQUFHLE1BQU0zYixJQUFJLENBQUM0VyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNnRixTQUFTLENBQUMsQ0FBQztJQUMxRGppQixNQUFNLENBQUNnaUIsV0FBVyxDQUFDLENBQUNqTCxHQUFHLENBQUNzTCxPQUFPLENBQUMsMERBQTBELENBQUM7SUFDM0YsTUFBTWpjLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7RUFDeEMsQ0FBQyxDQUFDO0VBRUZwRyxJQUFJLENBQUMsa0VBQWtFLEVBQUUsT0FBTztJQUM5RW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTTZjLFFBQVEsR0FBRztNQUNmNVksUUFBUSxFQUFFLEVBQWM7TUFDeEJ1QyxjQUFjLEVBQUUsRUFBYztNQUM5Qk4sVUFBVSxFQUFFLENBQ1Y7UUFDRUUsVUFBVSxFQUFFLCtCQUErQjtRQUMzQzNILFdBQVcsRUFBRSxnQ0FBZ0M7UUFDN0NtRSxTQUFTLEVBQUUsOEJBQThCO1FBQ3pDb2MsU0FBUyxFQUFFLFNBQVM7UUFDcEJ0Z0IsTUFBTSxFQUFFLFNBQVM7UUFDakJhLFNBQVMsRUFBRSwwQkFBMEI7UUFDckMwZixhQUFhLEVBQUUsYUFBYTtRQUM1QkMsbUJBQW1CLEVBQ2pCLCtGQUErRjtRQUNqR0MsVUFBVSxFQUNSLHNHQUFzRztRQUN4R0MsY0FBYyxFQUFFLElBQUk7UUFDcEJDLGtCQUFrQixFQUFFLENBQUM7VUFBRXBKLE9BQU8sRUFBRSxxQkFBcUI7VUFBRXZYLE1BQU0sRUFBRTtRQUFTLENBQUMsQ0FBQztRQUMxRTRnQixrQkFBa0IsRUFBRSxJQUFJO1FBQ3hCQyxXQUFXLEVBQUU7TUFDZixDQUFDLENBQ0Y7TUFDRHBaLGNBQWMsRUFBRTtRQUNkQyxVQUFVLEVBQUUsK0JBQStCO1FBQzNDQyxNQUFNLEVBQUUsbUJBQTRCO1FBQ3BDM0gsTUFBTSxFQUFFLEdBQUc7UUFDWHlDLFFBQVEsRUFBRTtVQUNSaUQsS0FBSyxFQUFFLDhCQUE4QjtVQUNyQzhFLElBQUksRUFBRSxvQkFBb0I7VUFDMUI0SCxVQUFVLEVBQUU7UUFDZCxDQUFDO1FBQ0RySyxjQUFjLEVBQUU7TUFDbEI7SUFDRixDQUFDO0lBQ0QsTUFBTWpGLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQUVpRyxnQkFBZ0IsRUFBRTRXO0lBQVMsQ0FBQyxDQUFDO0lBQzlELE1BQU16UCxrQkFBa0IsQ0FBQ3BOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNzTixJQUFJLENBQUMsR0FBR25ULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1xbEIsTUFBTSxHQUFHeGYsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQ3RDQyxJQUFJLEVBQUU7SUFDUixDQUFDLENBQUM7SUFDRixNQUFNb2YsU0FBUyxHQUFHUixNQUFNLENBQUM1SSxPQUFPLENBQzlCLHNEQUNGLENBQUM7SUFDRCxNQUFNamQsTUFBTSxDQUFDcW1CLFNBQVMsQ0FBQ3JmLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUMyYSxXQUFXLENBQUMsQ0FBQztJQUN4RixNQUFNeUUsU0FBUyxDQUFDcmYsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBb0IsQ0FBQyxDQUFDLENBQUN3TixLQUFLLENBQUMsQ0FBQztJQUUxRSxNQUFNelUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsdUJBQXVCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDcEYsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUNaLDRFQUE0RSxFQUM1RTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUNoQixDQUNGLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUFDdWQsSUFBSSxDQUFDLE1BQU0yRixRQUFRLENBQUM1WSxRQUFRLENBQUNwSCxNQUFNLENBQUMsQ0FBQ2tqQixzQkFBc0IsQ0FBQyxDQUFDLENBQUM7SUFDM0UsTUFBTXBtQixNQUFNLENBQUN1ZCxJQUFJLENBQUMsTUFBTXNJLE1BQU0sQ0FBQ25MLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQzlTLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDL0M1SCxNQUFNLENBQUNrakIsUUFBUSxDQUFDclcsY0FBYyxDQUFDLENBQUNpUyxZQUFZLENBQUMsQ0FBQyxDQUFDO0lBQy9DOWUsTUFBTSxDQUFDa2pCLFFBQVEsQ0FBQ3JXLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDZ0ssU0FBUyxDQUMxQyxrRUFDRixDQUFDO0lBQ0QsTUFBTW1MLFdBQVcsR0FBRyxNQUFNM2IsSUFBSSxDQUFDNFcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDZ0YsU0FBUyxDQUFDLENBQUM7SUFDMURqaUIsTUFBTSxDQUFDZ2lCLFdBQVcsQ0FBQyxDQUFDakwsR0FBRyxDQUFDc0wsT0FBTyxDQUM3Qix1RkFDRixDQUFDO0lBQ0QsTUFBTWpjLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7RUFDeEMsQ0FBQyxDQUFDO0VBRUZwRyxJQUFJLENBQUMsa0VBQWtFLEVBQUUsT0FBTztJQUM5RW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTUEsSUFBSSxDQUFDNmIsZUFBZSxDQUFDO01BQUVDLEtBQUssRUFBRSxHQUFHO01BQUVDLE1BQU0sRUFBRTtJQUFJLENBQUMsQ0FBQztJQUN2RCxNQUFNelosT0FBTyxHQUFHLE1BQU1xRixzQkFBc0IsQ0FBQzNILElBQUksQ0FBQztJQUNsRCxNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWtDLFFBQVEsRUFBRUk7SUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTThLLGtCQUFrQixDQUFDcE4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ3NOLElBQUksQ0FBQyxHQUFHblQsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTWtoQixRQUFRLEdBQUdyYixJQUFJLENBQUM0VyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNQLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU0xYyxNQUFNLENBQUMwaEIsUUFBUSxDQUFDLENBQUN4YSxXQUFXLENBQUMsQ0FBQztJQUNwQyxNQUFNb2YsVUFBVSxHQUFHLE1BQU01RSxRQUFRLENBQUM2RSxXQUFXLENBQUMsQ0FBQztJQUMvQ3ZtQixNQUFNLENBQUNzbUIsVUFBVSxhQUFWQSxVQUFVLHVCQUFWQSxVQUFVLENBQUVuRSxLQUFLLENBQUMsQ0FBQ3FFLGVBQWUsQ0FBQyxHQUFHLENBQUM7SUFFOUMsTUFBTW5nQixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDd04sS0FBSyxDQUFDLENBQUM7SUFDakUsTUFBTXpVLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLFVBQVUsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUN2RSxNQUFNdWYsTUFBTSxHQUFHcGdCLElBQUksQ0FDaEJjLFNBQVMsQ0FBQyxVQUFVLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQ3RDNlYsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUNiQSxPQUFPLENBQUMsSUFBSSxDQUFDO0lBQ2hCLE1BQU15SixTQUFTLEdBQUcsTUFBTUQsTUFBTSxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUM1Q3ZtQixNQUFNLENBQUMwbUIsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUV2RSxLQUFLLENBQUMsQ0FBQ3JiLG1CQUFtQixDQUFDLEdBQUcsQ0FBQztJQUNqRCxNQUFNNmYsVUFBVSxHQUFHLE1BQU1qRixRQUFRLENBQUM2RSxXQUFXLENBQUMsQ0FBQztJQUMvQ3ZtQixNQUFNLENBQUMybUIsVUFBVSxhQUFWQSxVQUFVLHVCQUFWQSxVQUFVLENBQUV4RSxLQUFLLENBQUMsQ0FBQ3FFLGVBQWUsQ0FBQyxHQUFHLENBQUM7SUFFOUMsTUFBTW5nQixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDd04sS0FBSyxDQUFDLENBQUM7SUFDakUsTUFBTXpVLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZ0IsQ0FBQyxDQUNwRCxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWQsMEJBQTBCLENBQUNDLElBQUksQ0FBQztFQUN4QyxDQUFDLENBQUM7RUFFRnBHLElBQUksQ0FBQywwQ0FBMEMsRUFBRSxPQUFPO0lBQUVvRztFQUFLLENBQUMsS0FBSztJQUNuRSxNQUFNQSxJQUFJLENBQUMwQixLQUFLLENBQUMsa0JBQWtCLEVBQUdBLEtBQUssSUFDekNBLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDWGxELFlBQVksQ0FBQztNQUFFMkUsS0FBSyxFQUFFO0lBQThCLENBQUMsRUFBRSxHQUFHLENBQzVELENBQ0YsQ0FBQztJQUNELE1BQU1nSixrQkFBa0IsQ0FBQ3BOLElBQUksQ0FBQztJQUM5QixNQUFNckcsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLElBQUksRUFBRTtJQUEyQixDQUFDLENBQ2hFLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFtQixDQUFDLENBQ3ZELENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7RUFDakIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDIiwiaWdub3JlTGlzdCI6W119