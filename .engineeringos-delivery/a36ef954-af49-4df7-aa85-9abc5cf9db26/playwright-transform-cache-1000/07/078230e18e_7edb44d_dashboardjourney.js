// 6779825c72ff3761e8467524724a35987cf26d4a
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
    return "Please conduct the bounded delivery proof campaign on this disposable project. Exercise apply, commit, and push only when each current operation, project revision, candidate identity, and candidate-bound evidence match. Report every terminal receipt.";
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
    const hasConfiguredAiFixture = aiFixtures.length > 0 || Boolean((overrides === null || overrides === void 0 ? void 0 : overrides.resumeFailure) || (overrides === null || overrides === void 0 ? void 0 : overrides.interruptedResume));
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
    if (path === "/api/tasks") {
      var _overrides$recoveryTa;
      return route.fulfill(jsonResponse((_overrides$recoveryTa = overrides === null || overrides === void 0 ? void 0 : overrides.recoveryTasks) !== null && _overrides$recoveryTa !== void 0 ? _overrides$recoveryTa : overrides !== null && overrides !== void 0 && overrides.liveTask ? [{
        id: overrides.liveTask.id,
        projectId: overrides.liveTask.projectId,
        title: overrides.liveTask.title,
        description: "A task used to verify live dashboard updates.",
        status: "running",
        priority: "p1",
        relatedFiles: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z"
      }] : []));
    }
    if (path === "/api/workflows") {
      var _overrides$recoveryWo;
      return route.fulfill(jsonResponse((_overrides$recoveryWo = overrides === null || overrides === void 0 ? void 0 : overrides.recoveryWorkflows) !== null && _overrides$recoveryWo !== void 0 ? _overrides$recoveryWo : []));
    }
    const workflowExecutionsMatch = path.match(/^\/api\/workflows\/([^/]+)\/executions$/);
    if (workflowExecutionsMatch) {
      var _overrides$recoveryWo2, _overrides$recoveryWo3;
      return route.fulfill(jsonResponse((_overrides$recoveryWo2 = overrides === null || overrides === void 0 || (_overrides$recoveryWo3 = overrides.recoveryWorkflowExecutions) === null || _overrides$recoveryWo3 === void 0 ? void 0 : _overrides$recoveryWo3[workflowExecutionsMatch[1]]) !== null && _overrides$recoveryWo2 !== void 0 ? _overrides$recoveryWo2 : []));
    }
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
    if (hasConfiguredAiFixture && path === "/api/ai/active-provider") {
      return route.fulfill(jsonResponse({
        provider: "openrouter",
        configured: true
      }));
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
  test("opens failed task and workflow details with redacted recovery guidance", async ({
    page
  }) => {
    const rawDiagnostic = "provider diagnostic: upstream returned raw response";
    const rawCredential = "sk-e2e-browser-credential-secret";
    const supportReferences = {
      authentication_failed: "support-task-auth-32",
      quota_exhausted: "support-task-quota-32",
      provider_outage: "support-workflow-outage-32"
    };
    const recoveryTasks = [{
      id: "e2e-auth-failed-task",
      projectId: "e2e-project",
      title: "Recover authentication failure",
      description: "The provider authentication test task failed.",
      status: "failed",
      priority: "p1",
      relatedFiles: ["src/provider.ts"],
      retryCount: 1,
      maxRetries: 2,
      agentResponse: JSON.stringify({
        kind: "AI_TASK_EXECUTION_RECEIPT",
        terminalStatus: "FAILED",
        availabilityState: "authentication_failed",
        correlationId: supportReferences.authentication_failed,
        operatorAction: "Replace the provider API key with a valid key, then retry.",
        provider: "openrouter",
        model: "secret-model-name",
        terminalReason: rawDiagnostic,
        operationId: rawCredential
      }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z"
    }, {
      id: "e2e-quota-failed-task",
      projectId: "e2e-project",
      title: "Recover quota exhaustion",
      description: "The provider quota test task failed.",
      status: "failed",
      priority: "p1",
      retryCount: 0,
      maxRetries: 2,
      agentResponse: JSON.stringify({
        kind: "AI_TASK_EXECUTION_RECEIPT",
        terminalStatus: "FAILED",
        availabilityState: "quota_exhausted",
        correlationId: supportReferences.quota_exhausted,
        provider: "openrouter",
        model: "secret-model-name",
        terminalReason: rawDiagnostic,
        operationId: rawCredential
      }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z"
    }];
    const workflowId = "e2e-outage-workflow";
    await installApiFixtures(page, {
      recoveryTasks,
      recoveryWorkflows: [{
        id: workflowId,
        projectId: "e2e-project",
        name: "Recover provider outage",
        description: "A pipeline used to verify outage recovery guidance.",
        status: "failed",
        phases: [{
          name: "build",
          steps: ["compile"]
        }, {
          name: "test",
          steps: ["verify"]
        }],
        currentPhase: "test",
        executionCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z"
      }],
      recoveryWorkflowExecutions: {
        [workflowId]: [{
          id: "e2e-outage-execution",
          workflowId,
          status: "failed",
          currentPhase: "test",
          completedPhases: ["build"],
          startedAt: "2026-01-01T00:00:00.000Z",
          errorMessage: rawDiagnostic,
          recovery: {
            availabilityState: "provider_outage",
            correlationId: supportReferences.provider_outage,
            operatorAction: "Retry in a moment; configure another provider if the issue persists.",
            diagnostic: rawCredential
          }
        }]
      }
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    await expect(page.getByLabel("Expand task Recover authentication failure")).toBeVisible();
    await page.getByLabel("Expand task Recover authentication failure").click();
    const taskDetails = page.locator("#task-details-e2e-auth-failed-task");
    await expect(taskDetails).toContainText("Provider authentication failed");
    await expect(taskDetails).toContainText("Replace the provider API key with a valid key, then retry.");
    await expect(taskDetails).toContainText(`Support reference: ${supportReferences.authentication_failed}`);
    await page.getByLabel("Expand task Recover quota exhaustion").click();
    await expect(page.getByText("Provider quota is exhausted")).toBeVisible();
    await expect(page.getByText(`Support reference: ${supportReferences.quota_exhausted}`)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Expand task Recover authentication failure")).toBeVisible();
    await page.getByLabel("Expand task Recover authentication failure").click();
    const reloadedAuthDetails = page.locator("#task-details-e2e-auth-failed-task");
    await expect(reloadedAuthDetails).toContainText("Provider authentication failed");
    await expect(reloadedAuthDetails).toContainText("Replace the provider API key with a valid key, then retry.");
    await expect(reloadedAuthDetails).toContainText(`Support reference: ${supportReferences.authentication_failed}`);
    await page.getByLabel("Expand task Recover quota exhaustion").click();
    await expect(page.getByText("Provider quota is exhausted")).toBeVisible();
    await expect(page.getByText(`Support reference: ${supportReferences.quota_exhausted}`)).toBeVisible();
    const reloadedTaskText = await page.locator("body").innerText();
    expect(reloadedTaskText).not.toContain(rawDiagnostic);
    expect(reloadedTaskText).not.toContain(rawCredential);
    expect(reloadedTaskText).not.toMatch(/secret-model-name|\/home\/runner|\/tmp\//i);
    await openNavigation(page, "Workflows", `${DASHBOARD_PATH}workflows`);
    await expect(page.getByText("Recover provider outage")).toBeVisible();
    await page.getByRole("button", {
      name: "Execution history"
    }).click();
    const execution = page.getByText("failed · no successful completion").locator("..").locator("..");
    await expect(execution).toContainText("The provider is temporarily unavailable");
    await expect(execution).toContainText("Retry in a moment; configure another provider if the issue persists.");
    await expect(execution).toContainText(`Support reference: ${supportReferences.provider_outage}`);
    await page.reload();
    await expect(page.getByText("Recover provider outage")).toBeVisible();
    await page.getByRole("button", {
      name: "Execution history"
    }).click();
    const reloadedExecution = page.getByText("failed · no successful completion").locator("..").locator("..");
    await expect(reloadedExecution).toContainText("The provider is temporarily unavailable");
    await expect(reloadedExecution).toContainText("Retry in a moment; configure another provider if the issue persists.");
    await expect(reloadedExecution).toContainText(`Support reference: ${supportReferences.provider_outage}`);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(rawDiagnostic);
    expect(visibleText).not.toContain(rawCredential);
    expect(visibleText).not.toMatch(/secret-model-name|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiSE9TVElMRV9PUklHSU4iLCJPUklHSU5fRElBR05PU1RJQ19IRUFERVJTIiwiREVGQVVMVF9MSVZFX1BST01QVCIsIkxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TIiwiU2V0IiwibGl2ZUNhbXBhaWduU2NlbmFyaW8iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIyIiwic2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8iLCJ0cmltIiwiREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOIiwiRXJyb3IiLCJoYXMiLCJsaXZlUHJvbXB0IiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSMyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQiLCJsaXZlVGltZW91dE1zIiwiY29uZmlndXJlZCIsIk51bWJlciIsIkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TIiwiaXNGaW5pdGUiLCJhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI0Iiwib3JpZ2lucyIsIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyIsInNwbGl0IiwibWFwIiwib3JpZ2luIiwiZmlsdGVyIiwiQm9vbGVhbiIsImxlbmd0aCIsInBhcnNlZCIsIlVSTCIsInBhdGhuYW1lIiwic2VhcmNoIiwiaGFzaCIsImRhc2hib2FyZEZpeHR1cmUiLCJmcmVzaG5lc3NSZXZpc2lvbiIsInByb2plY3RDb3VudCIsImFjdGl2ZVRhc2tDb3VudCIsImNvbXBsZXRlZFRhc2tDb3VudCIsImZhaWxlZFRhc2tDb3VudCIsInRhc2tTdGF0dXNCcmVha2Rvd24iLCJwZW5kaW5nIiwicnVubmluZyIsInByb2plY3RTY29yZXMiLCJwcm9qZWN0SWQiLCJwcm9qZWN0TmFtZSIsInNjb3JlIiwidHJlbmQiLCJyZWNlbnRFdmVudHMiLCJpZCIsInR5cGUiLCJzZXZlcml0eSIsIm1lc3NhZ2UiLCJ0aW1lc3RhbXAiLCJ0b3BSdWxlcyIsImV4ZWN1dGlvbkZpeHR1cmUiLCJvcGVyYXRpb25JZCIsInN0YXR1cyIsImZsaWdodFN0YXRlIiwiZXZpZGVuY2VWZXJkaWN0IiwicHJvb2ZSZXF1aXJlZCIsInJlc3VtYWJsZSIsImNoZWNrcG9pbnRWZXJzaW9uIiwicHJvamVjdFJldmlzaW9uIiwiY2hlY2twb2ludCIsInN0YWdlIiwiZGV0YWlsIiwib2JqZWN0aXZlIiwic3RhcnRlZEF0IiwiY29tcGxldGVkQXQiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJqc29uUmVzcG9uc2UiLCJib2R5IiwiaGVhZGVycyIsImNvbnRlbnRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93IiwicGFnZSIsIm92ZXJmbG93IiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImRvY3VtZW50RWxlbWVudCIsInNjcm9sbFdpZHRoIiwidmlld3BvcnQiLCJ3aW5kb3ciLCJpbm5lcldpZHRoIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsImV4cGVjdERhc2hib2FyZFJlYWR5IiwiZ2V0QnlSb2xlIiwibmFtZSIsInRvQmVWaXNpYmxlIiwiZ2V0QnlUZXh0IiwiZXhhY3QiLCJyZXN0YXJ0QXBpRm9yQ2FtcGFpZ24iLCJjb250cm9sVXJsIiwiREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCIsInJlc3BvbnNlIiwicmVxdWVzdCIsInBvc3QiLCJ0aW1lb3V0IiwidG9CZSIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX3JlZiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZSIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjIiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IzIiwidXJsIiwicGF0aCIsInJlcGxhY2UiLCJhcmFiaWNBaSIsImFsdGVybmF0ZUFpIiwiZGlzY29ubmVjdEFpIiwiYWlGaXh0dXJlcyIsImZpeHR1cmUiLCJoYXNDb25maWd1cmVkQWlGaXh0dXJlIiwicmVzdW1lRmFpbHVyZSIsImludGVycnVwdGVkUmVzdW1lIiwiZW5kc1dpdGgiLCJzZWFyY2hQYXJhbXMiLCJnZXQiLCJwcm9qZWN0U2Vzc2lvbnMiLCJmdWxmaWxsIiwic2Vzc2lvbklkIiwidGl0bGUiLCJxdWVzdGlvbiIsInJlcXVlc3RCb2R5IiwicG9zdERhdGFKU09OIiwiZXhlY3V0aW9uSWQiLCJzdHJlYW1Cb2R5IiwicmVzdW1lZFN0cmVhbUJvZHkiLCJyZXF1ZXN0ZWRNZXNzYWdlIiwic3RyZWFtRml4dHVyZSIsImZpbmQiLCJpbmNsdWRlcyIsIm1lc3NhZ2VGaXh0dXJlIiwicm9sZSIsImNvbnRlbnQiLCJhdWRpdEV4cG9ydCIsIl9vdmVycmlkZXMkYXVkaXRFeHBvciIsIm91dGNvbWUiLCJtZXNzYWdlT3V0Y29tZSIsIl9vdmVycmlkZXMkcmVjb3ZlcnlUYSIsInJlY292ZXJ5VGFza3MiLCJsaXZlVGFzayIsImRlc2NyaXB0aW9uIiwicHJpb3JpdHkiLCJyZWxhdGVkRmlsZXMiLCJyZXRyeUNvdW50IiwibWF4UmV0cmllcyIsIl9vdmVycmlkZXMkcmVjb3ZlcnlXbyIsInJlY292ZXJ5V29ya2Zsb3dzIiwid29ya2Zsb3dFeGVjdXRpb25zTWF0Y2giLCJtYXRjaCIsIl9vdmVycmlkZXMkcmVjb3ZlcnlXbzIiLCJfb3ZlcnJpZGVzJHJlY292ZXJ5V28zIiwicmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnMiLCJyZXF1ZXN0cyIsInB1c2giLCJmYWlsRmlyc3RQcmV2aWV3IiwiZXJyb3IiLCJmaWxlbmFtZSIsImFyY2hpdmVVcGxvYWQiLCJfcm91dGUkcmVxdWVzdCRoZWFkZXIiLCJzdGFydHNXaXRoIiwicG9zdERhdGFCdWZmZXIiLCJCdWZmZXIiLCJmcm9tIiwidXBsb2FkSWQiLCJvcmlnaW5hbE5hbWUiLCJwaGFzZSIsIl9vdmVycmlkZXMkbGl2ZVRhc2skaSIsImluaXRpYWxMb2dzIiwic3RyZWFtUmVxdWVzdHMiLCJmYWlsRmlyc3RTdHJlYW0iLCJmYWlsU3RyZWFtQXR0ZW1wdHMiLCJhYm9ydCIsImxvZyIsIl9vdmVycmlkZXMkcHJvamVjdHMiLCJwcm9qZWN0cyIsImxhbmd1YWdlIiwiZnJhbWV3b3JrIiwicm9vdFBhdGgiLCJxdWFsaXR5U2NvcmUiLCJwcm92aWRlciIsImRlbGl2ZXJ5UmVjb3ZlcnkiLCJvcGVyYXRpb25zIiwicmVjb3ZlcnlBY3Rpb24iLCJwcm9wb3NhbElkIiwiYWN0aW9uIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlMiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZTMiLCJhY3Rpb25SZXF1ZXN0cyIsIm5leHRPcGVyYXRpb25zIiwiX292ZXJyaWRlcyRldmVudHMiLCJfdXJsJHNlYXJjaFBhcmFtcyRnZXQiLCJldmVudHMiLCJ0b0xvd2VyQ2FzZSIsImZpbHRlcmVkRXZlbnRzIiwiZXZlbnQiLCJjb3JyZWxhdGlvbklkIiwidmFsdWUiLCJzb21lIiwibGltaXQiLCJzbGljZSIsInRvdGFsIiwiZXhlY3V0aW9uIiwicmVzdW1lVG9rZW4iLCJyZWNvdmVyZWRUb2tlbiIsImV4ZWN1dGlvbnMiLCJjb250aW51ZSIsImluc3RhbGxBcmFiaWNBaUZpeHR1cmUiLCJvcHRpb25zIiwiX29wdGlvbnMkc2Vzc2lvbklkIiwiX29wdGlvbnMkcXVlc3Rpb24iLCJtZXNzYWdlSWQiLCJzb3VyY2UiLCJibG9ja2VkIiwiYW5zd2VyIiwiZXZpZGVuY2UiLCJleGNlcnB0Iiwic3VwcG9ydHNDbGFpbSIsImV2aWRlbmNlQ2xhc3MiLCJjaXRhdGlvblN0YXR1cyIsImNpdGF0aW9uUmVhc29uIiwic291cmNlU3BhbiIsInN0YXJ0TGluZSIsImVuZExpbmUiLCJ0b29sVHJhY2UiLCJraW5kIiwidG9vbCIsImFyZ3MiLCJjYWNoZWQiLCJwcmVmZXRjaGVkIiwiY29kZSIsImNvbnNpc3RlbnQiLCJ2aW9sYXRpb25zIiwiZXZpZGVuY2VGaWxlQ291bnQiLCJhY2NlcHRlZEV2aWRlbmNlQ291bnQiLCJjb21wbGV0ZWRSZWFkRmlsZXMiLCJhY2NlcHRlZEV2aWRlbmNlRmlsZXMiLCJvYmplY3RpdmVUeXBlIiwicmVxdWlyZWRFZGdlcyIsInByb3ZlbkVkZ2VzIiwiY29tcGxldGlvbkdhdGVSZXN1bHQiLCJmaW5hbEFuc3dlclR5cGUiLCJ0YXNrUmVzdWx0IiwiY29uZmlkZW5jZSIsInNvdXJjZVNjb3BlIiwiY292ZXJhZ2UiLCJyZXF1ZXN0ZWRGaWVsZHMiLCJhbnN3ZXJlZEZpZWxkcyIsIm1pc3NpbmdGaWVsZHMiLCJjb21wbGV0ZSIsIm9wZXJhdGlvbk1vZGUiLCJzb3VyY2VzIiwiYmVoYXZpb3JFdmlkZW5jZSIsInNzZSIsImRlbHRhIiwicGVuZGluZ0NoYW5nZXMiLCJqb2luIiwiaW5zdGFsbFRvb2xGYWlsdXJlRml4dHVyZSIsImRpYWdub3N0aWNDb2RlIiwicmVzdWx0S2luZCIsInJlc3VsdFN1bW1hcnkiLCJzdG9wUmVhc29uIiwiaXRlcmF0aW9ucyIsIm1heEl0ZXJhdGlvbnMiLCJ0b29sQ2FsbHMiLCJwcmVmZXRjaFRvb2xDYWxscyIsImxvb3BUb29sQ2FsbHMiLCJzeW50aGVzaXNTdGFydGVkIiwiZGlhZ25vc3RpY0NvZGVzIiwiaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSIsImRpYWdub3N0aWNEZXRhaWxzIiwiZXJyb3JDb2RlIiwiZXJyb3JNZXNzYWdlIiwiaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlIiwiaW5zdGFsbEludGVycnVwdGVkUmVzdW1lRml4dHVyZSIsImluaXRpYWxUb2tlbiIsInBhcnRpYWxBbnN3ZXIiLCJjcmVhdGVSZWxlYXNlU2lnbkluVXJsIiwic2VjcmV0S2V5IiwiQ0xFUktfU0VDUkVUX0tFWSIsIkF1dGhvcml6YXRpb24iLCJ1c2VyUmVzcG9uc2UiLCJlbmNvZGVVUklDb21wb25lbnQiLCJ1c2VySWQiLCJqc29uIiwiY3JlYXRlZFJlc3BvbnNlIiwiZGF0YSIsImVtYWlsX2FkZHJlc3MiLCJmaXJzdF9uYW1lIiwibGFzdF9uYW1lIiwic2tpcF9wYXNzd29yZF9jaGVja3MiLCJza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50IiwidG9rZW5SZXNwb25zZSIsInVzZXJfaWQiLCJ0b2tlbiIsInRvU3RyaW5nIiwicHJvZ3JhbW1hdGljU2lnbkluIiwiX2dsb2JhbFRoaXMkc2lnbkluQ2xlIiwiZ290byIsImhlbHBlciIsImdsb2JhbFRoaXMiLCJzaWduSW5DbGVya1VzZXIiLCJfX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX18iLCJSVU5fQ09OVFJPTExFRF9SRUxFQVNFX1ZBTElEQVRJT04iLCJ0b0hhdmVVUkwiLCJSZWdFeHAiLCJyZXBsYWNlQWxsIiwic2lnbkluVXJsIiwidHRsIiwiYmFzZVBhdGgiLCJvcGVuTmF2aWdhdGlvbiIsImxhYmVsIiwiY2xpY2siLCJhcGlVcmwiLCJhcGlCYXNlVXJsIiwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwiLCJsaXZlUmVxdWVzdCIsIl9vcHRpb25zJG1ldGhvZCIsIm1ldGhvZCIsImZldGNoIiwiY3JlZGVudGlhbHMiLCJ1bmRlZmluZWQiLCJzaWduYWwiLCJBYm9ydFNpZ25hbCIsInRleHQiLCJyZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIiwib3JpZ2luRGlhZ25vc3RpY1BhdGgiLCJEQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIIiwicmVsZXZhbnRPcmlnaW5IZWFkZXJzIiwiT2JqZWN0IiwiZnJvbUVudHJpZXMiLCJmbGF0TWFwIiwid3JpdGVPcmlnaW5EaWFnbm9zdGljcyIsIm91dHB1dFBhdGgiLCJyZWN1cnNpdmUiLCJkaWFnbm9zdGljcyIsImV4cGVjdE9yaWdpbkNhblVzZUFwaSIsImhlYWx0aFVybCIsIm11dGF0aW9uVXJsIiwiY29tbW9uSGVhZGVycyIsIk9yaWdpbiIsImNoZWNrIiwiYXNzZXJ0aW9uIiwiYXQiLCJjdXJyZW50IiwiX3Jlc3BvbnNlJGhlYWRlcnMkYWNjIiwiX3Jlc3BvbnNlJGhlYWRlcnMkYWNjMiIsInRvVXBwZXJDYXNlIiwidG9Db250YWluIiwiaGVhZGVyIiwibm90IiwiZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkIiwidXBsb2FkVXJsIiwibGl2ZVVwZGF0ZVVybCIsImRpYWdub3N0aWMiLCJ0b0JlVW5kZWZpbmVkIiwiaG9zdGlsZVVwbG9hZCIsIm11bHRpcGFydCIsImFyY2hpdmUiLCJtaW1lVHlwZSIsImJ1ZmZlciIsImhvc3RpbGVMaXZlVXBkYXRlIiwicGFyc2VTc2UiLCJjaHVuayIsIl9jaHVuayRzcGxpdCRmaW5kIiwibGluZSIsInBhcnNlIiwibGl2ZUpzb24iLCJsaXZlQXJyYXkiLCJBcnJheSIsImlzQXJyYXkiLCJsaXZlT3B0aW9uYWxSZWNvcmQiLCJkZXNjcmliZSIsIl9leGVjdXRpb24kb3BlcmF0aW9uSSIsIl9leGVjdXRpb24kZmxpZ2h0U3RhdCIsIl9naXRMb2ckY29tbWl0cyQwJHNobyIsIl9naXRMb2ckY29tbWl0cyIsIl9naXRMb2ckY29tbWl0czIiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI1Iiwic2V0VGltZW91dCIsInNraXAiLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIiLCJEQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSIsImNhbXBhaWduU2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCIsInN0cmVhbVJlc3BvbnNlIiwiaWRlbXBvdGVuY3lLZXkiLCJEYXRlIiwibm93Iiwic3NlRXZlbnRzIiwic3RhcnRlZCIsImRlYWRsaW5lIiwiU3RyaW5nIiwiUHJvbWlzZSIsInJlc29sdmUiLCJtZXNzYWdlcyIsInByb3Bvc2FsIiwiZ2l0TG9nIiwibWlzc2lvbkNvbnRyb2wiLCJkYXNoYm9hcmRTdGF0ZSIsInJlY2VudFN0ZXBzIiwidmFsaWRhdGlvbiIsInN0ZXAiLCJjYW5kaWRhdGVIYXNoIiwiX3N0ZXAkdmFsaWRhdGlvbiRjYW5kIiwiX3N0ZXAkdmFsaWRhdGlvbiIsImNhbmRpZGF0ZUlkZW50aXR5IiwiZXZpZGVuY2VDb3VudCIsInJlZHVjZSIsImNvdW50IiwidGVybWluYWxTdGF0ZSIsInN1Y2Nlc3NTdGF0ZXMiLCJkZWxpdmVyeVN0YWdlcyIsImFwcGxpZWQiLCJjb21taXR0ZWQiLCJwdXNoZWQiLCJ2YWx1ZXMiLCJldmVyeSIsImNhcHR1cmUiLCJ3b3Jrc3BhY2VSZXZpc2lvbiIsImNvbW1pdHMiLCJzaG9ydEhhc2giLCJjYW5kaWRhdGVSZXZpc2lvbiIsImN1cnJlbnRPcGVyYXRpb24iLCJyZXZpc2lvbiIsInJldGFpbmVkUmVzdWx0IiwibWVzc2FnZVNlc3Npb24iLCJtZXNzYWdlRXhlY3V0aW9uIiwiZXZlbnRFeGVjdXRpb24iLCJldmVudFNlc3Npb24iLCJjaGVja3BvaW50cyIsInNlcXVlbmNlIiwicHJvcG9zYWxzIiwiX3N0ZXAkdmFsaWRhdGlvbiRzdGF0IiwiX3N0ZXAkdmFsaWRhdGlvbjIiLCJfc3RlcCR2YWxpZGF0aW9uJHByb2YiLCJfc3RlcCR2YWxpZGF0aW9uMyIsInByb2ZpbGUiLCJ2YWxpZGF0aW9uUHJvZmlsZSIsImRhc2hib2FyZCIsIkRBU0hCT0FSRF9FMkVfTElWRV9SRVBPUlRfUEFUSCIsImZpcnN0IiwicmF3RGlhZ25vc3RpYyIsInJhd0NyZWRlbnRpYWwiLCJzdXBwb3J0UmVmZXJlbmNlcyIsImF1dGhlbnRpY2F0aW9uX2ZhaWxlZCIsInF1b3RhX2V4aGF1c3RlZCIsInByb3ZpZGVyX291dGFnZSIsImFnZW50UmVzcG9uc2UiLCJ0ZXJtaW5hbFN0YXR1cyIsImF2YWlsYWJpbGl0eVN0YXRlIiwib3BlcmF0b3JBY3Rpb24iLCJtb2RlbCIsInRlcm1pbmFsUmVhc29uIiwid29ya2Zsb3dJZCIsInBoYXNlcyIsInN0ZXBzIiwiY3VycmVudFBoYXNlIiwiZXhlY3V0aW9uQ291bnQiLCJjb21wbGV0ZWRQaGFzZXMiLCJyZWNvdmVyeSIsImdldEJ5TGFiZWwiLCJ0YXNrRGV0YWlscyIsImxvY2F0b3IiLCJ0b0NvbnRhaW5UZXh0IiwicmVsb2FkIiwicmVsb2FkZWRBdXRoRGV0YWlscyIsInJlbG9hZGVkVGFza1RleHQiLCJpbm5lclRleHQiLCJ0b01hdGNoIiwicmVsb2FkZWRFeGVjdXRpb24iLCJ2aXNpYmxlVGV4dCIsImJyb3dzZXIiLCJzZWNvbmRDb250ZXh0IiwibmV3Q29udGV4dCIsInNlY29uZFBhZ2UiLCJuZXdQYWdlIiwiYWxsIiwiY3VycmVudERhc2hib2FyZEZpeHR1cmUiLCJyZWZyZXNoQ291bnQiLCJyZWxlYXNlU3RhbGVSZXNwb25zZSIsInN0YWxlUmVzcG9uc2VSZWxlYXNlZCIsInN0YWxlUmVmcmVzaCIsInBvbGwiLCJyZWNvbm5lY3RBdHRlbXB0IiwidW5yb3V0ZSIsInRvSGF2ZUNvdW50IiwiY2xvc2UiLCJhdWRpdFJlcXVlc3RzIiwiYXVkaXRCb2R5IiwiZm9ybWF0IiwiZXhwb3J0ZWRBdCIsInByb29mIiwicmVxdWlyZWQiLCJ2ZXJkaWN0IiwidGltZWxpbmUiLCJ2YWxpZGF0aW9ucyIsImFmZmVjdGVkRmlsZXMiLCJyZWRhY3Rpb24iLCJleGNsdWRlZCIsImxvY2FsU3RvcmFnZSIsInNldEl0ZW0iLCJwcmV2aWV3IiwidG9IYXZlTGVuZ3RoIiwidG9CZUhpZGRlbiIsImRvd25sb2FkUHJvbWlzZSIsIndhaXRGb3JFdmVudCIsImRvd25sb2FkIiwic3VnZ2VzdGVkRmlsZW5hbWUiLCJyZWxvYWRlZFByb29mIiwiY2FuY2VsbGVkRXhlY3V0aW9uIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSNiIsInRhc2tJZCIsImxpdmVMb2ciLCJsZXZlbCIsInVwbG9hZFJlc3VsdCIsImJ5dGVzIiwiVWludDhBcnJheSIsImF0b2IiLCJjaGFyYWN0ZXIiLCJjaGFyQ29kZUF0IiwiRm9ybURhdGEiLCJhcHBlbmQiLCJCbG9iIiwidG9FcXVhbCIsInRhc2tSb3ciLCJtZXRhZGF0YSIsImFjdGl2aXR5IiwiaGFzVGV4dCIsIm5vblN0cmVhbVJlcXVlc3RzIiwib24iLCJleGhhdXN0ZWQiLCJzaXplIiwiXyIsImluZGV4IiwiVVRDIiwidG9JU09TdHJpbmciLCJldmVudFJlcXVlc3RzIiwiZmlyc3RSZXF1ZXN0Iiwid2FpdEZvclJlcXVlc3QiLCJnZXRCeVBsYWNlaG9sZGVyIiwiZmlsbCIsIm50aCIsInNlbGVjdE9wdGlvbiIsInRvSGF2ZVZhbHVlIiwiZmlsdGVyZWRSZXF1ZXN0IiwiY29tcG9zZXIiLCJzZW5kQnV0dG9uIiwidG9CZUVuYWJsZWQiLCJzdHJlYW1SZXNwb25zZVByb21pc2UiLCJ3YWl0Rm9yUmVzcG9uc2UiLCJsYXN0Iiwic2V0Vmlld3BvcnRTaXplIiwid2lkdGgiLCJoZWlnaHQiLCJhY2NlcHRlZCIsImFzc2VydEFjY2VwdGVkQ2l0YXRpb24iLCJhc3NlcnRCbG9ja2VkQ2l0YXRpb24iLCJhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzIiwiZ29CYWNrIiwiZ29Gb3J3YXJkIiwiX2F3YWl0JHJlc3VtZVJlcXVlc3QkIiwicmVzdW1lUmVxdWVzdCIsInBvc3REYXRhIiwib2JqZWN0Q29udGFpbmluZyIsIl9zdHJlYW1SZXF1ZXN0cyQiLCJfc3RyZWFtUmVxdWVzdHMkMiIsImFkZEluaXRTY3JpcHQiLCJuYXRpdmVGZXRjaCIsImJpbmQiLCJpbnB1dCIsImluaXQiLCJSZXF1ZXN0IiwicmVhZGVyIiwiZ2V0UmVhZGVyIiwiZW5jb2RlciIsIlRleHRFbmNvZGVyIiwic3RyZWFtIiwiUmVhZGFibGVTdHJlYW0iLCJzdGFydCIsImNvbnRyb2xsZXIiLCJidWZmZXJlZCIsImRvbmUiLCJyZWFkIiwiZW5xdWV1ZSIsImVuY29kZSIsIlRleHREZWNvZGVyIiwiZGVjb2RlIiwibWFya2VyIiwiaW5kZXhPZiIsImZyYW1lRW5kIiwiVHlwZUVycm9yIiwiUmVzcG9uc2UiLCJzdGF0dXNUZXh0Iiwic3RvcmFnZUtleSIsInBvaW50ZXJLZXkiLCJrZXkiLCJnZXRJdGVtIiwiX2xvY2FsU3RvcmFnZSRnZXRJdGVtIiwic2F2ZWQiLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0yIiwibGlmZWN5Y2xlIiwicmVjb3ZlcnlTdGF0ZSIsIm9wZXJhdG9yRXhwbGFuYXRpb24iLCJuZXh0QWN0aW9uIiwiY29uZmxpY3RSZWFzb24iLCJ2YWxpZGF0aW9uRXZpZGVuY2UiLCJ3b3Jrc3BhY2VBdmFpbGFibGUiLCJjaGFuZ2VDb3VudCIsInJlZ2lvbiIsImF2YWlsYWJsZSIsIm1pc3NpbmciLCJkaXNjYXJkZWQiLCJ0b0hhdmVBdHRyaWJ1dGUiLCJ0b0JlRGlzYWJsZWQiLCJyZWxvYWRlZFJlZ2lvbiIsInRvQmVHcmVhdGVyVGhhbk9yRXF1YWwiLCJvcGVyYXRpb24iLCJiZWZvcmVPcGVuIiwiYm91bmRpbmdCb3giLCJ0b0JlR3JlYXRlclRoYW4iLCJkcmF3ZXIiLCJkcmF3ZXJCb3giLCJkdXJpbmdPcGVuIl0sInNvdXJjZXMiOlsiZGFzaGJvYXJkLmpvdXJuZXkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZXhwZWN0LCB0ZXN0LCB0eXBlIFBhZ2UgfSBmcm9tIFwiQHBsYXl3cmlnaHQvdGVzdFwiO1xuaW1wb3J0IHsgbWtkaXIsIHdyaXRlRmlsZSB9IGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHtcbiAgcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UsXG4gIHBhcnNlQ2xlcmtVc2VyTG9va3VwUmVzcG9uc2UsXG4gIHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlLFxufSBmcm9tIFwiLi4vc3JjL2xpYi9jbGVyay1oYW5kb2ZmXCI7XG5cbmNvbnN0IERBU0hCT0FSRF9QQVRIID0gXCIvZGFzaGJvYXJkL1wiO1xuY29uc3QgVEVTVF9VU0VSID0ge1xuICBmaXJzdE5hbWU6IFwiRW5naW5lZXJpbmdPU1wiLFxuICBsYXN0TmFtZTogXCJEYXNoYm9hcmQgU21va2VcIixcbiAgZW1haWw6XG4gICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9FTUFJTCA/P1xuICAgIFwiZW5naW5lZXJpbmdvcy1kYXNoYm9hcmQtc21va2VAZXhhbXBsZS5jb21cIixcbn07XG5jb25zdCBFWEVDVVRJT05fSUQgPSBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiO1xuY29uc3QgREVGQVVMVF9MSVZFX1RJTUVPVVRfTVMgPSAxMjBfMDAwO1xuY29uc3QgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TID0gNV8wMDA7XG5jb25zdCBIT1NUSUxFX09SSUdJTiA9IFwiaHR0cHM6Ly9hdHRhY2tlci5leGFtcGxlXCI7XG5jb25zdCBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTID0gW1xuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIixcbiAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzXCIsXG4gIFwidmFyeVwiLFxuXSBhcyBjb25zdDtcbmNvbnN0IERFRkFVTFRfTElWRV9QUk9NUFQgPVxuICBcIlBlcmZvcm0gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IG9mIHRoaXMgZGlzcG9zYWJsZSBwcm9qZWN0IHVzaW5nIHJlYWQtb25seSB0b29scy4gXCIgK1xuICBcIlByb2R1Y2UgYXQgbGVhc3Qgb25lIGFjY2VwdGVkIGV2aWRlbmNlIGl0ZW0gYW5kIG9uZSB2YWxpZGF0aW9uIGNoZWNrcG9pbnQsIGFuZCBkbyBub3QgXCIgK1xuICBcInJlcG9ydCBDT01QTEVURUQgdW5sZXNzIGJvdGggYXJlIHByZXNlbnQuIFJlcG9ydCBvbmx5IHZlcmlmaWVkIGV2aWRlbmNlLlwiO1xuY29uc3QgTElWRV9DQU1QQUlHTl9TQ0VOQVJJT1MgPSBuZXcgU2V0KFtcbiAgXCJwcm92aWRlci1vdXRhZ2VcIixcbiAgXCJtYWxmb3JtZWQtb3V0cHV0XCIsXG4gIFwiZGVsaXZlcnktc3VjY2Vzc1wiLFxuXSk7XG5cbmZ1bmN0aW9uIGxpdmVDYW1wYWlnblNjZW5hcmlvKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHNjZW5hcmlvID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1NDRU5BUklPPy50cmltKCk7XG4gIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfQ0FNUEFJR04gPT09IFwiMVwiICYmICFzY2VuYXJpbykge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiTGl2ZSBjYW1wYWlnbiByZXF1aXJlcyBEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU89cHJvdmlkZXItb3V0YWdlLCBtYWxmb3JtZWQtb3V0cHV0LCBvciBkZWxpdmVyeS1zdWNjZXNzLlwiLFxuICAgICk7XG4gIH1cbiAgaWYgKHNjZW5hcmlvICYmICFMSVZFX0NBTVBBSUdOX1NDRU5BUklPUy5oYXMoc2NlbmFyaW8pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsaXZlIGNhbXBhaWduIHNjZW5hcmlvOiAke3NjZW5hcmlvfS5gKTtcbiAgfVxuICByZXR1cm4gc2NlbmFyaW87XG59XG5cbmZ1bmN0aW9uIGxpdmVQcm9tcHQoKTogc3RyaW5nIHtcbiAgY29uc3Qgc2NlbmFyaW8gPSBsaXZlQ2FtcGFpZ25TY2VuYXJpbygpO1xuICBpZiAoc2NlbmFyaW8gPT09IFwicHJvdmlkZXItb3V0YWdlXCIpIHtcbiAgICByZXR1cm4gXCJSdW4gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IGFuZCByZXBvcnQgdGhlIE9wZW5Sb3V0ZXIgcmF0ZS1saW1pdC9wcm92aWRlci1leGhhdXN0aW9uIG91dGFnZSBhcyBhIGZhaWxlZCBvciBpbmNvbXBsZXRlIG9wZXJhdGlvbi4gRG8gbm90IHVzZSBwcmlvciBhbmFseXNpcyBhcyBhIGN1cnJlbnQgYW5zd2VyOyBpbmNsdWRlIHRoZSBjdXJyZW50IG9wZXJhdGlvbiBhbmQgcmV2aXNpb24uXCI7XG4gIH1cbiAgaWYgKHNjZW5hcmlvID09PSBcIm1hbGZvcm1lZC1vdXRwdXRcIikge1xuICAgIHJldHVybiBcIlJ1biBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgYW5kIHRyZWF0IG1hbGZvcm1lZCBwcm92aWRlciBvdXRwdXQgYXMgZmFpbGVkIG9yIGluY29tcGxldGUuIERvIG5vdCBjbGFpbSBzdWNjZXNzLCBhcHBseSwgY29tbWl0LCBvciBwdXNoIHdpdGhvdXQgY2FuZGlkYXRlLWJvdW5kIGV2aWRlbmNlLlwiO1xuICB9XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJkZWxpdmVyeS1zdWNjZXNzXCIpIHtcbiAgICByZXR1cm4gXCJQbGVhc2UgY29uZHVjdCB0aGUgYm91bmRlZCBkZWxpdmVyeSBwcm9vZiBjYW1wYWlnbiBvbiB0aGlzIGRpc3Bvc2FibGUgcHJvamVjdC4gRXhlcmNpc2UgYXBwbHksIGNvbW1pdCwgYW5kIHB1c2ggb25seSB3aGVuIGVhY2ggY3VycmVudCBvcGVyYXRpb24sIHByb2plY3QgcmV2aXNpb24sIGNhbmRpZGF0ZSBpZGVudGl0eSwgYW5kIGNhbmRpZGF0ZS1ib3VuZCBldmlkZW5jZSBtYXRjaC4gUmVwb3J0IGV2ZXJ5IHRlcm1pbmFsIHJlY2VpcHQuXCI7XG4gIH1cbiAgcmV0dXJuIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQgPz8gREVGQVVMVF9MSVZFX1BST01QVDtcbn1cblxuZnVuY3Rpb24gbGl2ZVRpbWVvdXRNcygpOiBudW1iZXIge1xuICBjb25zdCBjb25maWd1cmVkID0gTnVtYmVyKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TKTtcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkKSAmJiBjb25maWd1cmVkID4gMFxuICAgID8gY29uZmlndXJlZFxuICAgIDogREVGQVVMVF9MSVZFX1RJTUVPVVRfTVM7XG59XG5cbmZ1bmN0aW9uIGFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG9yaWdpbnMgPSAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TID8/IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKG9yaWdpbikgPT4gb3JpZ2luLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAob3JpZ2lucy5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyBtdXN0IGNvbnRhaW4gZXZlcnkgYXBwcm92ZWQgZGFzaGJvYXJkIG9yaWdpbi5cIixcbiAgICApO1xuICB9XG4gIHJldHVybiBvcmlnaW5zLm1hcCgob3JpZ2luKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChvcmlnaW4pO1xuICAgIGlmIChcbiAgICAgIHBhcnNlZC5vcmlnaW4gIT09IG9yaWdpbiB8fFxuICAgICAgcGFyc2VkLnBhdGhuYW1lICE9PSBcIi9cIiB8fFxuICAgICAgcGFyc2VkLnNlYXJjaCB8fFxuICAgICAgcGFyc2VkLmhhc2hcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYERhc2hib2FyZCBqb3VybmV5IG9yaWdpbiBtdXN0IGJlIGEgYmFyZSBvcmlnaW46ICR7b3JpZ2lufWAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkLm9yaWdpbjtcbiAgfSk7XG59XG5cbmNvbnN0IGRhc2hib2FyZEZpeHR1cmUgPSB7XG4gIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICBwcm9qZWN0Q291bnQ6IDEsXG4gIGFjdGl2ZVRhc2tDb3VudDogMCxcbiAgY29tcGxldGVkVGFza0NvdW50OiAyLFxuICBmYWlsZWRUYXNrQ291bnQ6IDAsXG4gIHRhc2tTdGF0dXNCcmVha2Rvd246IHsgcGVuZGluZzogMCwgcnVubmluZzogMCB9LFxuICBwcm9qZWN0U2NvcmVzOiBbXG4gICAge1xuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBwcm9qZWN0TmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICBzY29yZTogOTIsXG4gICAgICB0cmVuZDogXCJzdGFibGVcIixcbiAgICB9LFxuICBdLFxuICByZWNlbnRFdmVudHM6IFtcbiAgICB7XG4gICAgICBpZDogXCJlMmUtZXZlbnRcIixcbiAgICAgIHR5cGU6IFwiU21va2VDaGVja1wiLFxuICAgICAgc2V2ZXJpdHk6IFwic3VjY2Vzc1wiLFxuICAgICAgbWVzc2FnZTogXCJEYXNoYm9hcmQgQVBJIGZpeHR1cmUgcmVhZHlcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICB9LFxuICBdLFxuICB0b3BSdWxlczogW10sXG59O1xuXG5jb25zdCBleGVjdXRpb25GaXh0dXJlID0ge1xuICBpZDogRVhFQ1VUSU9OX0lELFxuICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgb3BlcmF0aW9uSWQ6IFwiZTJlLW9wZXJhdGlvblwiLFxuICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gIGZsaWdodFN0YXRlOiBcIkNPTVBMRVRFRFwiLFxuICBldmlkZW5jZVZlcmRpY3Q6IFwiUFJPVkVOXCIsXG4gIHByb29mUmVxdWlyZWQ6IGZhbHNlLFxuICByZXN1bWFibGU6IGZhbHNlLFxuICBjaGVja3BvaW50VmVyc2lvbjogMSxcbiAgcHJvamVjdFJldmlzaW9uOiBcImUyZS1yZXZpc2lvbi00MlwiLFxuICBjaGVja3BvaW50OiB7XG4gICAgc3RhZ2U6IFwiY29tcGxldGVcIixcbiAgICBkZXRhaWw6IFwiQ29udHJvbGxlZCBicm93c2VyIGZpeHR1cmUgY29tcGxldGVkLlwiLFxuICB9LFxuICBvYmplY3RpdmU6IHsgb2JqZWN0aXZlOiBcIlZlcmlmeSB0aGUgZGFzaGJvYXJkIGJyb3dzZXIgam91cm5leVwiIH0sXG4gIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxufTtcblxuZnVuY3Rpb24ganNvblJlc3BvbnNlKFxuICBib2R5OiB1bmtub3duLFxuICBzdGF0dXMgPSAyMDAsXG4gIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuKSB7XG4gIHJldHVybiB7XG4gICAgc3RhdHVzLFxuICAgIGNvbnRlbnRUeXBlOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAuLi4oaGVhZGVycyA/IHsgaGVhZGVycyB9IDoge30pLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IG92ZXJmbG93ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiAoe1xuICAgIGRvY3VtZW50OiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsV2lkdGgsXG4gICAgYm9keTogZG9jdW1lbnQuYm9keS5zY3JvbGxXaWR0aCxcbiAgICB2aWV3cG9ydDogd2luZG93LmlubmVyV2lkdGgsXG4gIH0pKTtcbiAgZXhwZWN0KG92ZXJmbG93LmRvY3VtZW50KS50b0JlTGVzc1RoYW5PckVxdWFsKG92ZXJmbG93LnZpZXdwb3J0ICsgMSk7XG4gIGV4cGVjdChvdmVyZmxvdy5ib2R5KS50b0JlTGVzc1RoYW5PckVxdWFsKG92ZXJmbG93LnZpZXdwb3J0ICsgMSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2U6IFBhZ2UpIHtcbiAgYXdhaXQgZXhwZWN0KFxuICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiU3lzdGVtIE92ZXJ2aWV3XCIgfSksXG4gICkudG9CZVZpc2libGUoKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiU1lTVEVNIE9OTElORVwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZTogUGFnZSkge1xuICBjb25zdCBjb250cm9sVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTDtcbiAgaWYgKCFjb250cm9sVXJsKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXNoYm9hcmQgY2FtcGFpZ24gY29udHJvbCBVUkwgaXMgbWlzc2luZy5cIik7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoYCR7Y29udHJvbFVybH0vcmVzdGFydC1hcGlgLCB7XG4gICAgdGltZW91dDogMTVfMDAwLFxuICB9KTtcbiAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwNCk7XG59XG5cbnR5cGUgQXJhYmljQWlGaXh0dXJlID0ge1xuICBxdWVzdGlvbjogc3RyaW5nO1xuICBhbnN3ZXI6IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG4gIHNlc3Npb25JZDogc3RyaW5nO1xuICBleGVjdXRpb25JZD86IHN0cmluZztcbiAgcHJvamVjdElkPzogc3RyaW5nO1xuICBzdHJlYW1Cb2R5OiBzdHJpbmc7XG4gIG1lc3NhZ2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufTtcblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFwaUZpeHR1cmVzKFxuICBwYWdlOiBQYWdlLFxuICBvdmVycmlkZXM/OiB7XG4gICAgYXJhYmljQWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgYWx0ZXJuYXRlQWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgZGlzY29ubmVjdEFpPzogQXJhYmljQWlGaXh0dXJlO1xuICAgIHJlc3VtZUZhaWx1cmU/OiB7XG4gICAgICBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgICBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIH07XG4gICAgaW50ZXJydXB0ZWRSZXN1bWU/OiB7XG4gICAgICBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgICBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgcmVjb3ZlcmVkVG9rZW46IHN0cmluZztcbiAgICAgIHJlc3VtZWRTdHJlYW1Cb2R5OiBzdHJpbmc7XG4gICAgfTtcbiAgICBkZWxpdmVyeVJlY292ZXJ5Pzoge1xuICAgICAgb3BlcmF0aW9uczogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgcmVxdWVzdHM6IHN0cmluZ1tdO1xuICAgICAgYWN0aW9uUmVxdWVzdHM/OiBzdHJpbmdbXTtcbiAgICAgIHJlY292ZXJ5QWN0aW9uPzoge1xuICAgICAgICBwcm9wb3NhbElkOiBzdHJpbmc7XG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIHwgXCJkaXNjYXJkXCI7XG4gICAgICAgIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgc3RhdHVzPzogbnVtYmVyO1xuICAgICAgICBuZXh0T3BlcmF0aW9ucz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIH07XG4gICAgfTtcbiAgICBwcm9qZWN0cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICBldmVudHM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgYXJjaGl2ZVVwbG9hZD86IHtcbiAgICAgIHVwbG9hZElkOiBzdHJpbmc7XG4gICAgICBvcmlnaW5hbE5hbWU6IHN0cmluZztcbiAgICB9O1xuICAgIGF1ZGl0RXhwb3J0Pzoge1xuICAgICAgYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBmaWxlbmFtZTogc3RyaW5nO1xuICAgICAgcmVxdWVzdHM6IHN0cmluZ1tdO1xuICAgICAgZXhlY3V0aW9uPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBtZXNzYWdlT3V0Y29tZT86IHN0cmluZztcbiAgICAgIGZhaWxGaXJzdFByZXZpZXc/OiBib29sZWFuO1xuICAgIH07XG4gICAgbGl2ZVRhc2s/OiB7XG4gICAgICBpZDogc3RyaW5nO1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIHByb2plY3RJZDogc3RyaW5nO1xuICAgICAgbG9nOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIGluaXRpYWxMb2dzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgc3RyZWFtUmVxdWVzdHM/OiBzdHJpbmdbXTtcbiAgICAgIGZhaWxGaXJzdFN0cmVhbT86IGJvb2xlYW47XG4gICAgICBmYWlsU3RyZWFtQXR0ZW1wdHM/OiBudW1iZXI7XG4gICAgfTtcbiAgICByZWNvdmVyeVRhc2tzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIHJlY292ZXJ5V29ya2Zsb3dzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIHJlY292ZXJ5V29ya2Zsb3dFeGVjdXRpb25zPzogUmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+PjtcbiAgfSxcbikge1xuICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpLyoqXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICBjb25zdCBwYXRoID0gdXJsLnBhdGhuYW1lLnJlcGxhY2UoL15cXC9kYXNoYm9hcmQoPz1cXC98JCkvLCBcIlwiKTtcbiAgICBjb25zdCBhcmFiaWNBaSA9IG92ZXJyaWRlcz8uYXJhYmljQWk7XG4gICAgY29uc3QgYWx0ZXJuYXRlQWkgPSBvdmVycmlkZXM/LmFsdGVybmF0ZUFpO1xuICAgIGNvbnN0IGRpc2Nvbm5lY3RBaSA9IG92ZXJyaWRlcz8uZGlzY29ubmVjdEFpO1xuICAgIGNvbnN0IGFpRml4dHVyZXMgPSBbYXJhYmljQWksIGFsdGVybmF0ZUFpLCBkaXNjb25uZWN0QWldLmZpbHRlcihcbiAgICAgIChmaXh0dXJlKTogZml4dHVyZSBpcyBBcmFiaWNBaUZpeHR1cmUgPT4gQm9vbGVhbihmaXh0dXJlKSxcbiAgICApO1xuICAgIGNvbnN0IGhhc0NvbmZpZ3VyZWRBaUZpeHR1cmUgPVxuICAgICAgYWlGaXh0dXJlcy5sZW5ndGggPiAwIHx8XG4gICAgICBCb29sZWFuKG92ZXJyaWRlcz8ucmVzdW1lRmFpbHVyZSB8fCBvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lKTtcblxuICAgIGlmIChhaUZpeHR1cmVzLmxlbmd0aCA+IDAgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zZXNzaW9uc1wiKSkge1xuICAgICAgY29uc3QgcHJvamVjdElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwcm9qZWN0SWRcIik7XG4gICAgICBjb25zdCBwcm9qZWN0U2Vzc2lvbnMgPSBhaUZpeHR1cmVzLmZpbHRlcihcbiAgICAgICAgKGZpeHR1cmUpID0+ICFmaXh0dXJlLnByb2plY3RJZCB8fCBmaXh0dXJlLnByb2plY3RJZCA9PT0gcHJvamVjdElkLFxuICAgICAgKTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgcHJvamVjdFNlc3Npb25zLm1hcCgoZml4dHVyZSkgPT4gKHtcbiAgICAgICAgICAgIGlkOiBmaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgICAgIHRpdGxlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpIHtcbiAgICAgIGxldCByZXF1ZXN0Qm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3RCb2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBub3JtYWwgcHJvdmlkZXItZnJlZSBmYWxsYmFjayBiZWxvdyBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICAgIH1cbiAgICAgIGlmIChcbiAgICAgICAgcmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQgPT09IG92ZXJyaWRlcy5yZXN1bWVGYWlsdXJlLmZpeHR1cmUuZXhlY3V0aW9uSWRcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICBib2R5OiBvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSkge1xuICAgICAgbGV0IHJlcXVlc3RCb2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVxdWVzdEJvZHkgPSByb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIG5vcm1hbCBwcm92aWRlci1mcmVlIGZhbGxiYWNrIGJlbG93IGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgICAgfVxuICAgICAgY29uc3QgeyBmaXh0dXJlLCByZXN1bWVkU3RyZWFtQm9keSB9ID0gb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lO1xuICAgICAgaWYgKHJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkID09PSBmaXh0dXJlLmV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIGJvZHk6IHJlc3VtZWRTdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghcmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHN0b3AgYWZ0ZXIgdGhlIGR1cmFibGUgZXhlY3V0aW9uIGlkZW50aXR5LiBUaGVcbiAgICAgICAgICAvLyBqb3VybmV5IHdyYXBzIHRoaXMgcmVzcG9uc2UgaW4gYSBicm93c2VyLWxldmVsIHN0cmVhbSBlcnJvci5cbiAgICAgICAgICBib2R5OiBmaXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBsZXQgcmVxdWVzdGVkTWVzc2FnZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICByZXF1ZXN0ZWRNZXNzYWdlID0gKHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgLm1lc3NhZ2UgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVGhlIGRlZmF1bHQgcHJvdmlkZXItdW5hdmFpbGFibGUgcmVzcG9uc2UgaGFuZGxlcyBtYWxmb3JtZWQgcmVxdWVzdHMuXG4gICAgfVxuICAgIGNvbnN0IHN0cmVhbUZpeHR1cmUgPVxuICAgICAgZGlzY29ubmVjdEFpID8/XG4gICAgICBhaUZpeHR1cmVzLmZpbmQoXG4gICAgICAgIChmaXh0dXJlKSA9PlxuICAgICAgICAgIHR5cGVvZiByZXF1ZXN0ZWRNZXNzYWdlID09PSBcInN0cmluZ1wiICYmXG4gICAgICAgICAgKHJlcXVlc3RlZE1lc3NhZ2UgPT09IGZpeHR1cmUucXVlc3Rpb24gfHxcbiAgICAgICAgICAgIHJlcXVlc3RlZE1lc3NhZ2UuaW5jbHVkZXMoZml4dHVyZS5xdWVzdGlvbikpLFxuICAgICAgKSA/P1xuICAgICAgYXJhYmljQWk7XG4gICAgaWYgKHN0cmVhbUZpeHR1cmUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgYm9keTogc3RyZWFtRml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgfSk7XG4gICAgY29uc3QgbWVzc2FnZUZpeHR1cmUgPSBhaUZpeHR1cmVzLmZpbmQoKGZpeHR1cmUpID0+XG4gICAgICBwYXRoLmVuZHNXaXRoKGAvYXBpL2FpL2NoYXQvJHtmaXh0dXJlLnNlc3Npb25JZH0vbWVzc2FnZXNgKSxcbiAgICApO1xuICAgIGlmIChtZXNzYWdlRml4dHVyZSlcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBgJHttZXNzYWdlRml4dHVyZS5zZXNzaW9uSWR9LXVzZXItbWVzc2FnZWAsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VGaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICAgICAgY29udGVudDogbWVzc2FnZUZpeHR1cmUucXVlc3Rpb24sXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXNzYWdlRml4dHVyZS5tZXNzYWdlLFxuICAgICAgICBdKSxcbiAgICAgICk7XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5hdWRpdEV4cG9ydCAmJlxuICAgICAgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9lMmUtYXVkaXQtc2Vzc2lvbi9tZXNzYWdlc1wiKVxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IFwiZTJlLWF1ZGl0LXVzZXItbWVzc2FnZVwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IFwiZTJlLWF1ZGl0LWFzc2lzdGFudC1tZXNzYWdlXCIsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICAgICAgICBjb250ZW50OiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgICAgICAgIGV4ZWN1dGlvbklkOiBFWEVDVVRJT05fSUQsXG4gICAgICAgICAgICBvdXRjb21lOiBvdmVycmlkZXMuYXVkaXRFeHBvcnQubWVzc2FnZU91dGNvbWUgPz8gXCJTVUNDRUVERURcIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICBdKSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9kYXNoYm9hcmRcIilcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShkYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS90YXNrc1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIG92ZXJyaWRlcz8ucmVjb3ZlcnlUYXNrcyA/P1xuICAgICAgICAgICAgKG92ZXJyaWRlcz8ubGl2ZVRhc2tcbiAgICAgICAgICAgICAgPyBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBvdmVycmlkZXMubGl2ZVRhc2suaWQsXG4gICAgICAgICAgICAgICAgICAgIHByb2plY3RJZDogb3ZlcnJpZGVzLmxpdmVUYXNrLnByb2plY3RJZCxcbiAgICAgICAgICAgICAgICAgICAgdGl0bGU6IG92ZXJyaWRlcy5saXZlVGFzay50aXRsZSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQSB0YXNrIHVzZWQgdG8gdmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXMuXCIsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgICAgICAgICAgICAgIHJlbGF0ZWRGaWxlczogW10sXG4gICAgICAgICAgICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgICAgICAgICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICAgICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDEuMDAwWlwiLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgIDogW10pLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS93b3JrZmxvd3NcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXM/LnJlY292ZXJ5V29ya2Zsb3dzID8/IFtdKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IHdvcmtmbG93RXhlY3V0aW9uc01hdGNoID0gcGF0aC5tYXRjaChcbiAgICAgIC9eXFwvYXBpXFwvd29ya2Zsb3dzXFwvKFteL10rKVxcL2V4ZWN1dGlvbnMkLyxcbiAgICApO1xuICAgIGlmICh3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXM/LnJlY292ZXJ5V29ya2Zsb3dFeGVjdXRpb25zPy5bd29ya2Zsb3dFeGVjdXRpb25zTWF0Y2hbMV1dID8/XG4gICAgICAgICAgICBbXSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGggPT09IGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9L2F1ZGl0LWV4cG9ydGBcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5yZXF1ZXN0cy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICBpZiAoXG4gICAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5mYWlsRmlyc3RQcmV2aWV3ICYmXG4gICAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5yZXF1ZXN0cy5sZW5ndGggPT09IDFcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgICB7IGVycm9yOiBcIlRlbXBvcmFyeSBwcmV2aWV3IG5ldHdvcmsgZmFpbHVyZS5cIiB9LFxuICAgICAgICAgICAgNTAzLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5ib2R5LCAyMDAsIHtcbiAgICAgICAgICBcIkNvbnRlbnQtRGlzcG9zaXRpb25cIjogYGF0dGFjaG1lbnQ7IGZpbGVuYW1lPVwiJHtvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmlsZW5hbWV9XCJgLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LmFyY2hpdmVVcGxvYWQgJiYgcGF0aCA9PT0gXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIpIHtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcm91dGUucmVxdWVzdCgpLmhlYWRlcnMoKVtcImNvbnRlbnQtdHlwZVwiXSA/PyBcIlwiO1xuICAgICAgaWYgKCFjb250ZW50VHlwZS5zdGFydHNXaXRoKFwibXVsdGlwYXJ0L2Zvcm0tZGF0YTtcIikpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgbXVsdGlwYXJ0IGFyY2hpdmUgdXBsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBjb25zdCBib2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhQnVmZmVyKCk7XG4gICAgICBpZiAoIWJvZHk/LmluY2x1ZGVzKEJ1ZmZlci5mcm9tKFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIpKSkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJFeHBlY3RlZCB0aGUgam91cm5leSBhcmNoaXZlIHBheWxvYWQuXCIgfSwgNDAwKSxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAge1xuICAgICAgICAgICAgdXBsb2FkSWQ6IG92ZXJyaWRlcy5hcmNoaXZlVXBsb2FkLnVwbG9hZElkLFxuICAgICAgICAgICAgb3JpZ2luYWxOYW1lOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC5vcmlnaW5hbE5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAyMDEsXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIjogbmV3IFVSTChwYWdlLnVybCgpKS5vcmlnaW4sXG4gICAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5saXZlVGFzayAmJiBwYXRoID09PSBcIi9hcGkvdGFza3NcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IG92ZXJyaWRlcy5saXZlVGFzay5pZCxcbiAgICAgICAgICAgIHByb2plY3RJZDogb3ZlcnJpZGVzLmxpdmVUYXNrLnByb2plY3RJZCxcbiAgICAgICAgICAgIHRpdGxlOiBvdmVycmlkZXMubGl2ZVRhc2sudGl0bGUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBIHRhc2sgdXNlZCB0byB2ZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlcy5cIixcbiAgICAgICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgICAgICBwaGFzZTogXCJFeGVjdXRpb25cIixcbiAgICAgICAgICAgIHJlbGF0ZWRGaWxlczogW10sXG4gICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAxLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICBdKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiZcbiAgICAgIHBhdGggPT09IGAvYXBpL3Rhc2tzLyR7b3ZlcnJpZGVzLmxpdmVUYXNrLmlkfS9sb2dzYFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKG92ZXJyaWRlcy5saXZlVGFzay5pbml0aWFsTG9ncyA/PyBbXSkpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9ncy9zdHJlYW1gXG4gICAgKSB7XG4gICAgICBjb25zdCBzdHJlYW1SZXF1ZXN0cyA9IG92ZXJyaWRlcy5saXZlVGFzay5zdHJlYW1SZXF1ZXN0cztcbiAgICAgIHN0cmVhbVJlcXVlc3RzPy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICBpZiAoXG4gICAgICAgIChvdmVycmlkZXMubGl2ZVRhc2suZmFpbEZpcnN0U3RyZWFtICYmIHN0cmVhbVJlcXVlc3RzPy5sZW5ndGggPT09IDEpIHx8XG4gICAgICAgIChvdmVycmlkZXMubGl2ZVRhc2suZmFpbFN0cmVhbUF0dGVtcHRzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMgJiZcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cy5sZW5ndGggPD0gb3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cylcbiAgICAgICkge1xuICAgICAgICAvLyBFeGVyY2lzZSB0aGUgYnJvd3NlcidzIHJlY29ubmVjdCBwYXRoIHdpdGhvdXQgY2hhbmdpbmcgdGhlIHRhc2tcbiAgICAgICAgLy8gbGlmZWN5Y2xlIG9yIHN5bnRoZXNpemluZyBhIHN1Y2Nlc3NmdWwgcmVzcG9uc2UgZm9yIHRoZSBmaXJzdCB0cnkuXG4gICAgICAgIHJldHVybiByb3V0ZS5hYm9ydChcImNvbm5lY3Rpb25yZXNldFwiKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiLFxuICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIjogXCJ0cnVlXCIsXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IGBldmVudDogbG9nXFxuZGF0YTogJHtKU09OLnN0cmluZ2lmeShvdmVycmlkZXMubGl2ZVRhc2subG9nKX1cXG5cXG5gLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvcHJvamVjdHNcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXM/LnByb2plY3RzID8/IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICAgICAgbmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICAgICAgcXVhbGl0eVNjb3JlOiA5MixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChoYXNDb25maWd1cmVkQWlGaXh0dXJlICYmIHBhdGggPT09IFwiL2FwaS9haS9hY3RpdmUtcHJvdmlkZXJcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IHByb3ZpZGVyOiBcIm9wZW5yb3V0ZXJcIiwgY29uZmlndXJlZDogdHJ1ZSB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeSAmJlxuICAgICAgcGF0aCA9PT0gXCIvYXBpL2FpL2RlbGl2ZXJ5L3JlY292ZXJhYmxlXCJcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlcXVlc3RzLnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBvcGVyYXRpb25zOiBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5kZWxpdmVyeVJlY292ZXJ5Py5yZWNvdmVyeUFjdGlvbiAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZGVsaXZlcnkvJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5wcm9wb3NhbElkfS8ke292ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLmFjdGlvbn1gXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zKSB7XG4gICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5Lm9wZXJhdGlvbnMgPVxuICAgICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5yZXNwb25zZSxcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5zdGF0dXMgPz8gNDA5LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9ldmVudHNcIikge1xuICAgICAgY29uc3QgZXZlbnRzID0gb3ZlcnJpZGVzPy5ldmVudHMgPz8gZGFzaGJvYXJkRml4dHVyZS5yZWNlbnRFdmVudHM7XG4gICAgICBjb25zdCBzZWFyY2ggPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInNlYXJjaFwiKT8udG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGZpbHRlcmVkRXZlbnRzID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+IHtcbiAgICAgICAgY29uc3QgcHJvamVjdElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwcm9qZWN0SWRcIik7XG4gICAgICAgIGNvbnN0IHNldmVyaXR5ID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKTtcbiAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiY29ycmVsYXRpb25JZFwiKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAoIXByb2plY3RJZCB8fCBldmVudC5wcm9qZWN0SWQgPT09IHByb2plY3RJZCkgJiZcbiAgICAgICAgICAoIXNldmVyaXR5IHx8IGV2ZW50LnNldmVyaXR5ID09PSBzZXZlcml0eSkgJiZcbiAgICAgICAgICAoIWNvcnJlbGF0aW9uSWQgfHwgZXZlbnQuY29ycmVsYXRpb25JZCA9PT0gY29ycmVsYXRpb25JZCkgJiZcbiAgICAgICAgICAoIXNlYXJjaCB8fFxuICAgICAgICAgICAgW2V2ZW50Lm1lc3NhZ2UsIGV2ZW50LnR5cGUsIGV2ZW50LmNvcnJlbGF0aW9uSWRdXG4gICAgICAgICAgICAgIC5maWx0ZXIoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIilcbiAgICAgICAgICAgICAgLnNvbWUoKHZhbHVlKSA9PiB2YWx1ZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaCkpKVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgICBjb25zdCBsaW1pdCA9IE51bWJlcih1cmwuc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKSB8fCA1MDtcbiAgICAgIGNvbnN0IHBhZ2UgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKSB8fCAxO1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXZlbnRzOiBmaWx0ZXJlZEV2ZW50cy5zbGljZSgocGFnZSAtIDEpICogbGltaXQsIHBhZ2UgKiBsaW1pdCksXG4gICAgICAgICAgdG90YWw6IGZpbHRlcmVkRXZlbnRzLmxlbmd0aCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5leGVjdXRpb24pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke292ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH0vcmVzdW1lLWNhcGFiaWxpdHlgXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHtcbiAgICAgICAgICBleGVjdXRpb25JZDogb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgICAgcmVzdW1lVG9rZW46IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5yZWNvdmVyZWRUb2tlbixcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gYC9hcGkvYWkvZXhlY3V0aW9ucy8ke0VYRUNVVElPTl9JRH1gKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXM/LmF1ZGl0RXhwb3J0Py5leGVjdXRpb24gPz8gZXhlY3V0aW9uRml4dHVyZSksXG4gICAgICApO1xuICAgIGlmIChwYXRoID09PSBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLCBleGVjdXRpb25zOiBbXSB9KSxcbiAgICAgICk7XG5cbiAgICAvLyBBSSBpcyBkZWxpYmVyYXRlbHkgbm90IGV4ZWN1dGVkIGluIHRoaXMgc21va2Ugam91cm5leS4gVGhpcyByZXNwb25zZVxuICAgIC8vIHZlcmlmaWVzIHRoZSB1c2VyLXZpc2libGUgdW5hdmFpbGFibGUvZW1wdHkgc3RhdGUgd2l0aG91dCBhIHByb3ZpZGVyLlxuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoXCIvYXBpL2FpL1wiKSlcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJBSSBwcm92aWRlciBub3QgY29uZmlndXJlZFwiIH0sIDQyOCksXG4gICAgICApO1xuXG4gICAgcmV0dXJuIHJvdXRlLmNvbnRpbnVlKCk7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKFxuICBwYWdlOiBQYWdlLFxuICBvcHRpb25zPzoge1xuICAgIGJsb2NrZWQ/OiBib29sZWFuO1xuICAgIHNlc3Npb25JZD86IHN0cmluZztcbiAgICBxdWVzdGlvbj86IHN0cmluZztcbiAgICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIH0sXG4pIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gb3B0aW9ucz8uc2Vzc2lvbklkID8/IFwiZTJlLWFyYWJpYy1haS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLWFyYWJpYy1haS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL2V4ZWN1dGlvbi10b29scy50c1wiO1xuICBjb25zdCBibG9ja2VkID0gb3B0aW9ucz8uYmxvY2tlZCA9PT0gdHJ1ZTtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIG9wdGlvbnM/LnF1ZXN0aW9uID8/XG4gICAgXCLZhdin2LDYpyDZitit2K/YqyDYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipIHByb3ZpZGVyIHRpbWVvdXQg2K/Yp9iu2YQgZXhlY3V0aW9uLXRvb2xzLnRz2J9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIti52YbYryDYp9mG2KrZh9in2KEg2YXZh9mE2Kkg2YXYstmI2K8g2KfZhNiw2YPYp9ihINin2YTYp9i12LfZhtin2LnZitiMINmK2LnZitivINin2YTZhdiz2KfYsSDYqtmC2LHZitix2YvYpyDYrNiy2KbZitmL2Kcg2YXZhiDYp9mE2KPYr9mE2Kkg2KfZhNiq2Yog2KzZj9mF2LnYqiDYqNiv2YQg2KXYtdiv2KfYsSBGaW5kaW5nINi62YrYsSDZhdir2KjYqi5cIjtcbiAgY29uc3QgZXZpZGVuY2UgPSBbXG4gICAge1xuICAgICAgc291cmNlLFxuICAgICAgLi4uKGJsb2NrZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBleGNlcnB0OiBcInByb3ZpZGVyIHRpbWVvdXQgaXMgaGFuZGxlZCBoZXJlXCIsXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiBmYWxzZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiUkVBRF9DT05GSVJNRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkJMT0NLRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uUmVhc29uOiBcIk1JU1NJTkdfTElURVJBTF9NQVRDSFwiLFxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBleGNlcnB0OiAncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsXG4gICAgICAgICAgICBzb3VyY2VTcGFuOiB7IHN0YXJ0TGluZTogNDIsIGVuZExpbmU6IDQyIH0sXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiB0cnVlLFxuICAgICAgICAgICAgZXZpZGVuY2VDbGFzczogXCJCRUhBVklPUl9QUk9WRU5cIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkFDQ0VQVEVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJBQ0NFUFRFRF9TT1VSQ0VfU1BBTlwiLFxuICAgICAgICAgIH0pLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IHRvb2xUcmFjZSA9IFtcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9LFxuICBdO1xuICBjb25zdCB0YXNrUmVzdWx0ID0ge1xuICAgIGtpbmQ6IFwiQkVIQVZJT1JfQU5TV0VSX1JFU1VMVFwiLFxuICAgIGFuc3dlcjoge1xuICAgICAgYW5zd2VyLFxuICAgICAgZXZpZGVuY2UsXG4gICAgICBjb25maWRlbmNlOiAxLFxuICAgICAgc291cmNlU2NvcGU6IFtzb3VyY2VdLFxuICAgICAgY292ZXJhZ2U6IHtcbiAgICAgICAgcmVxdWVzdGVkRmllbGRzOiBbXCJ0aW1lb3V0IGJlaGF2aW9yXCJdLFxuICAgICAgICBhbnN3ZXJlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgbWlzc2luZ0ZpZWxkczogW10sXG4gICAgICAgIGNvbXBsZXRlOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYCR7YW5zd2VyfVxcblxcbiMjIDYpIEZpbmFsIEp1ZGdtZW50XFxuTk9UIFBST1ZFTmAsXG4gICAgb3BlcmF0aW9uTW9kZTogXCJGT1JFTlNJQ19BVURJVFwiLFxuICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBiZWhhdmlvckV2aWRlbmNlOiBldmlkZW5jZSxcbiAgICB0YXNrUmVzdWx0LFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkOiBcImUyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJidWlsZGluZy1jb250ZXh0XCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgICB0YXNrUmVzdWx0LFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBwcm9qZWN0SWQ6IG9wdGlvbnM/LnByb2plY3RJZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtdG9vbC1mYWlsdXJlLXNlc3Npb25cIjtcbiAgY29uc3QgbWVzc2FnZUlkID0gXCJlMmUtdG9vbC1mYWlsdXJlLW1lc3NhZ2VcIjtcbiAgY29uc3Qgc291cmNlID0gXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIldoaWNoIHNvdXJjZSBmaWxlIGlzIGF2YWlsYWJsZSBmb3IgdGhlIHJlbGVhc2UgY2hlY2s/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJBTkFMWVNJU19JTkNPTVBMRVRFOiBUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZSwgc28gbm8gdmVyaWZpZWQgcmVzdWx0IGlzIGF2YWlsYWJsZS5cIjtcbiAgY29uc3QgZGlhZ25vc3RpY0NvZGUgPSBcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0sXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInRvb2xfZmFpbHVyZVwiLFxuICAgICAgaXRlcmF0aW9uczogMSxcbiAgICAgIG1heEl0ZXJhdGlvbnM6IDgsXG4gICAgICB0b29sQ2FsbHM6IDEsXG4gICAgICBwcmVmZXRjaFRvb2xDYWxsczogMCxcbiAgICAgIGxvb3BUb29sQ2FsbHM6IDEsXG4gICAgICBzeW50aGVzaXNTdGFydGVkOiBmYWxzZSxcbiAgICAgIGRpYWdub3N0aWNDb2RlczogW2RpYWdub3N0aWNDb2RlXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtdG9vbC1mYWlsdXJlLWV4ZWN1dGlvblwiLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIHJlc3VsdEtpbmQ6IFwiZmFpbGVkXCIsXG4gICAgICBkaWFnbm9zdGljQ29kZSxcbiAgICAgIHJlc3VsdFN1bW1hcnk6IFwiVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2UsXG4gICAgc2Vzc2lvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSgpOiBBcmFiaWNBaUZpeHR1cmUge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWRpc2Nvbm5lY3RlZC1haS1leGVjdXRpb25cIjtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIFwiV2hhdCBoYXBwZW5zIHdoZW4gdGhlIG1vZGVsIGRpc2Nvbm5lY3RzIGFmdGVyIHN0YXJ0aW5nIGFuIGFuc3dlcj9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBtb2RlbCBzdGFydGVkIGFuIGFuc3dlciwgYnV0IHRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYmVmb3JlIGNvbXBsZXRpb24uXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJFWEVDVVRJT05fUFJPVklERVJfRkFJTFVSRVwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInByb3ZpZGVyX3RpbWVvdXRcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAwLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAwLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgICBkaWFnbm9zdGljRGV0YWlsczogW1xuICAgICAgICBcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYWZ0ZXIgdmlzaWJsZSByZXNwb25zZSB0ZXh0LlwiLFxuICAgICAgXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1kaXNjb25uZWN0ZWQtYWktbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgb3V0Y29tZTogXCJGQUlMRURcIixcbiAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgIGVycm9yTWVzc2FnZTogXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgLy8gVGhlIHJlYWwgcm91dGUgZW1pdHMgdGhpcyBhZnRlciBhIHByb3ZpZGVyIGRpc2Nvbm5lY3Qgc28gdGhlIGNsaWVudFxuICAgIC8vIGRyb3BzIHRoZSB0cmFuc2llbnQgYnViYmxlIGJlZm9yZSByZW5kZXJpbmcgdGhlIHBlcnNpc3RlZCByZXN1bHQuXG4gICAgc3NlKHsgdHlwZTogXCJzdHJlYW1fcmVzZXRcIiB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicHJvdmlkZXJcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLWV4ZWN1dGlvblwiO1xuICBjb25zdCByZXN1bWVUb2tlbiA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIlZlcmlmeSB0aGUgYW5hbHlzaXMgZXZpZGVuY2UgYWZ0ZXIgcmVjb25uZWN0LlwiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX1VOQVZBSUxBQkxFXCI7XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICByZXN1bWVUb2tlbixcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJlcnJvclwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBjb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICAgIG1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwic3JjL21pc3NpbmctYW5hbHlzaXMtdG9vbC50c1wiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2U6IHtcbiAgICAgIGlkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtbWVzc2FnZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIGVycm9yQ29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGZpeHR1cmUsXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJGQUlMRURcIixcbiAgICAgIGV2aWRlbmNlVmVyZGljdDogXCJJTkNPTVBMRVRFXCIsXG4gICAgICBwcm9vZlJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcInRvb2wtZXhlY3V0aW9uXCIsXG4gICAgICAgIGRldGFpbDogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgdG9vbCB3YXMgdW5hdmFpbGFibGUuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIGVycm9yOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLWV4ZWN1dGlvblwiO1xuICBjb25zdCBpbml0aWFsVG9rZW4gPSBcImUyZS1pbnRlcnJ1cHRlZC1pbml0aWFsLXRva2VuXCI7XG4gIGNvbnN0IHJlY292ZXJlZFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVjb3ZlcmVkLXRva2VuXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJDb250aW51ZSB0aGUgaW50ZXJydXB0ZWQgcmVsZWFzZSBleGVjdXRpb24uXCI7XG4gIGNvbnN0IHBhcnRpYWxBbnN3ZXIgPVxuICAgIFwiVGhlIHJlbGVhc2UgZXhlY3V0aW9uIHN0YXJ0ZWQgYmVmb3JlIHRoZSBicm93c2VyIGRpc2Nvbm5lY3RlZC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBvcmlnaW5hbCByZWxlYXNlIGV4ZWN1dGlvbiByZXN1bWVkIGFmdGVyIGNhcGFiaWxpdHkgcmVjb3ZlcnkuXCI7XG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgaWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1tZXNzYWdlXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIG91dGNvbWU6IFwiQ09NUExFVEVEXCIsXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZTogXCJyZWxlYXNlLXJlc3VtZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5OiBbXG4gICAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgICBzc2Uoe1xuICAgICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICAgIHJlc3VtZVRva2VuOiBpbml0aWFsVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogcGFydGlhbEFuc3dlciB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgbWVzc2FnZSxcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGluaXRpYWxUb2tlbixcbiAgICByZWNvdmVyZWRUb2tlbixcbiAgICByZXN1bWVkU3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcmVkVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwicmVzdW1pbmctY2hlY2twb2ludFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICAgIH0pLFxuICAgIF0uam9pbihcIlwiKSxcbiAgICBleGVjdXRpb246IHtcbiAgICAgIGlkOiBleGVjdXRpb25JZCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1vcGVyYXRpb25cIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHN0YXR1czogXCJwYXVzZWRcIixcbiAgICAgIGZsaWdodFN0YXRlOiBcIlBBVVNFRFwiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIixcbiAgICAgICAgZGV0YWlsOlxuICAgICAgICAgIFwiVGhlIGJyb3dzZXIgdHJhbnNwb3J0IGRpc2Nvbm5lY3RlZCBhZnRlciB0aGUgZXhlY3V0aW9uIHN0YXJ0ZWQuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgc2VjcmV0S2V5ID0gcHJvY2Vzcy5lbnYuQ0xFUktfU0VDUkVUX0tFWTtcbiAgaWYgKCFzZWNyZXRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkNMRVJLX1NFQ1JFVF9LRVkgaXMgcmVxdWlyZWQgZm9yIHRoZSByZWxlYXNlLW9ubHkgcHJvZ3JhbW1hdGljIENsZXJrIGhhbmRvZmYuXCIsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3NlY3JldEtleX1gLFxuICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICB9O1xuICBjb25zdCB1c2VyUmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QuZ2V0KFxuICAgIGBodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnM/ZW1haWxfYWRkcmVzcz0ke2VuY29kZVVSSUNvbXBvbmVudChURVNUX1VTRVIuZW1haWwpfWAsXG4gICAgeyBoZWFkZXJzIH0sXG4gICk7XG4gIGxldCB1c2VySWQgPSBwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlKGF3YWl0IHVzZXJSZXNwb25zZS5qc29uKCkpO1xuXG4gIGlmICghdXNlcklkKSB7XG4gICAgY29uc3QgY3JlYXRlZFJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgICBcImh0dHBzOi8vYXBpLmNsZXJrLmNvbS92MS91c2Vyc1wiLFxuICAgICAge1xuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgZW1haWxfYWRkcmVzczogW1RFU1RfVVNFUi5lbWFpbF0sXG4gICAgICAgICAgZmlyc3RfbmFtZTogVEVTVF9VU0VSLmZpcnN0TmFtZSxcbiAgICAgICAgICBsYXN0X25hbWU6IFRFU1RfVVNFUi5sYXN0TmFtZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX2NoZWNrczogdHJ1ZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuICAgIHVzZXJJZCA9IHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlKGF3YWl0IGNyZWF0ZWRSZXNwb25zZS5qc29uKCkpO1xuICB9XG5cbiAgaWYgKCF1c2VySWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIlRoZSBpc29sYXRlZCBDbGVyayByZWxlYXNlIHVzZXIgY291bGQgbm90IGJlIHByb3Zpc2lvbmVkLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCB0b2tlblJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvc2lnbl9pbl90b2tlbnNcIixcbiAgICB7IGhlYWRlcnMsIGRhdGE6IHsgdXNlcl9pZDogdXNlcklkIH0gfSxcbiAgKTtcbiAgY29uc3QgdG9rZW4gPSBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZShhd2FpdCB0b2tlblJlc3BvbnNlLmpzb24oKSk7XG5cbiAgcmV0dXJuIGAke25ldyBVUkwoREFTSEJPQVJEX1BBVEgsIHBhZ2UudXJsKCkpLnRvU3RyaW5nKCl9c2lnbi1pbj9fX2NsZXJrX3RpY2tldD0ke2VuY29kZVVSSUNvbXBvbmVudCh0b2tlbil9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2U6IFBhZ2UpIHtcbiAgYXdhaXQgcGFnZS5nb3RvKERBU0hCT0FSRF9QQVRIKTtcbiAgYXdhaXQgZXhwZWN0KFxuICAgIHBhZ2UuZ2V0QnlSb2xlKFwibGlua1wiLCB7IG5hbWU6IFwiU2lnbiBJblwiLCBleGFjdDogdHJ1ZSB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuXG4gIGNvbnN0IGhlbHBlciA9XG4gICAgZ2xvYmFsVGhpcy5zaWduSW5DbGVya1VzZXIgPz9cbiAgICBnbG9iYWxUaGlzLl9fRU5HSU5FRVJJTkdPU19TSUdOX0lOX0NMRVJLX1VTRVJfXztcbiAgaWYgKCFoZWxwZXIpIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuUlVOX0NPTlRST0xMRURfUkVMRUFTRV9WQUxJREFUSU9OICE9PSBcIjFcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkNsZXJrIGJyb3dzZXIgaGVscGVyIGlzIHVuYXZhaWxhYmxlLiBSdW4gdGhpcyBqb3VybmV5IGluIHRoZSBSZXBsaXQgYnJvd3NlciBydW5uZXIsIHdoaWNoIGluamVjdHMgc2lnbkluQ2xlcmtVc2VyLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgYXdhaXQgcGFnZS5nb3RvKGF3YWl0IGNyZWF0ZVJlbGVhc2VTaWduSW5VcmwocGFnZSkpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNpZ25JblVybCA9IGF3YWl0IGhlbHBlcih7XG4gICAgLi4uVEVTVF9VU0VSLFxuICAgIHR0bDogOTAwLFxuICAgIGJhc2VQYXRoOiBEQVNIQk9BUkRfUEFUSCxcbiAgfSk7XG4gIGF3YWl0IHBhZ2UuZ290byhzaWduSW5VcmwpO1xuICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5OYXZpZ2F0aW9uKHBhZ2U6IFBhZ2UsIGxhYmVsOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBsYWJlbCwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAke3BhdGgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCkpO1xufVxuXG5mdW5jdGlvbiBhcGlVcmwocGFnZTogUGFnZSwgcGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYXBpQmFzZVVybCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMO1xuICByZXR1cm4gbmV3IFVSTChwYXRoLCBhcGlCYXNlVXJsID8gYXBpQmFzZVVybCA6IHBhZ2UudXJsKCkpLnRvU3RyaW5nKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVSZXF1ZXN0KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiB7IG1ldGhvZD86IHN0cmluZzsgYm9keT86IHVua25vd247IHRpbWVvdXQ/OiBudW1iZXIgfSxcbik6IFByb21pc2U8eyBzdGF0dXM6IG51bWJlcjsgYm9keTogc3RyaW5nIH0+IHtcbiAgcmV0dXJuIHBhZ2UuZXZhbHVhdGUoXG4gICAgYXN5bmMgKHsgdXJsLCBtZXRob2QsIGJvZHksIHRpbWVvdXQgfSkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgIGhlYWRlcnM6XG4gICAgICAgICAgYm9keSA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgICAgOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGJvZHk6IGJvZHkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgICAgICBzaWduYWw6IHRpbWVvdXQgPyBBYm9ydFNpZ25hbC50aW1lb3V0KHRpbWVvdXQpIDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4geyBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cywgYm9keTogYXdhaXQgcmVzcG9uc2UudGV4dCgpIH07XG4gICAgfSxcbiAgICB7XG4gICAgICB1cmw6IGFwaVVybChwYWdlLCBwYXRoKSxcbiAgICAgIG1ldGhvZDogb3B0aW9ucz8ubWV0aG9kID8/IFwiR0VUXCIsXG4gICAgICBib2R5OiBvcHRpb25zPy5ib2R5LFxuICAgICAgdGltZW91dDogb3B0aW9ucz8udGltZW91dCxcbiAgICB9LFxuICApO1xufVxuXG50eXBlIE9yaWdpbkRpYWdub3N0aWMgPSB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICBwaGFzZTogXCJHRVRcIiB8IFwicHJlZmxpZ2h0XCIgfCBcIm11dGF0aW9uXCIgfCBcInJlamVjdGlvblwiO1xuICBzdGF0dXM/OiBudW1iZXI7XG4gIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBlcnJvcj86IHN0cmluZztcbn07XG5jb25zdCByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcblxuZnVuY3Rpb24gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfT1JJR0lOX0RJQUdOT1NUSUNTX1BBVEg7XG59XG5cbmZ1bmN0aW9uIHJlbGV2YW50T3JpZ2luSGVhZGVycyhcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMuZmxhdE1hcCgobmFtZSkgPT5cbiAgICAgIGhlYWRlcnNbbmFtZV0gPyBbW25hbWUsIGhlYWRlcnNbbmFtZV1dXSA6IFtdLFxuICAgICksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKSB7XG4gIGNvbnN0IG91dHB1dFBhdGggPSBvcmlnaW5EaWFnbm9zdGljUGF0aCgpO1xuICBpZiAoIW91dHB1dFBhdGgpIHJldHVybjtcbiAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShcbiAgICBvdXRwdXRQYXRoLFxuICAgIGAke0pTT04uc3RyaW5naWZ5KHsgZGlhZ25vc3RpY3M6IHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MgfSwgbnVsbCwgMil9XFxuYCxcbiAgICBcInV0ZjhcIixcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2U6IFBhZ2UsIG9yaWdpbjogc3RyaW5nKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJEQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCBpcyByZXF1aXJlZCBmb3Igb3JpZ2luIGNoZWNrcy5cIixcbiAgICApO1xuICB9XG4gIGNvbnN0IGhlYWx0aFVybCA9IG5ldyBVUkwoXCIvYXBpL2hlYWx0aHpcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGNvbW1vbkhlYWRlcnMgPSB7IE9yaWdpbjogb3JpZ2luIH07XG5cbiAgY29uc3QgZGlhZ25vc3RpY3M6IE9yaWdpbkRpYWdub3N0aWNbXSA9IFtdO1xuICBjb25zdCBjaGVjayA9IGFzeW5jIChcbiAgICBwaGFzZTogT3JpZ2luRGlhZ25vc3RpY1tcInBoYXNlXCJdLFxuICAgIHJlcXVlc3Q6ICgpID0+IFByb21pc2U8aW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZT4sXG4gICAgYXNzZXJ0aW9uOiAoXG4gICAgICByZXNwb25zZTogaW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZSxcbiAgICApID0+IFByb21pc2U8dm9pZD4sXG4gICkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3QoKTtcbiAgICAgIGRpYWdub3N0aWNzLnB1c2goe1xuICAgICAgICBvcmlnaW4sXG4gICAgICAgIHBoYXNlLFxuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cygpLFxuICAgICAgICBoZWFkZXJzOiByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKSxcbiAgICAgIH0pO1xuICAgICAgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcy5wdXNoKGRpYWdub3N0aWNzLmF0KC0xKSEpO1xuICAgICAgYXdhaXQgYXNzZXJ0aW9uKHJlc3BvbnNlKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgY3VycmVudCA9IGRpYWdub3N0aWNzLmF0KC0xKTtcbiAgICAgIGlmIChjdXJyZW50Py5waGFzZSAhPT0gcGhhc2UpIHtcbiAgICAgICAgZGlhZ25vc3RpY3MucHVzaCh7IG9yaWdpbiwgcGhhc2UgfSk7XG4gICAgICB9XG4gICAgICBkaWFnbm9zdGljcy5hdCgtMSkhLmVycm9yID0gXCJvcmlnaW4gY2hlY2sgZmFpbGVkXCI7XG4gICAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH07XG5cbiAgYXdhaXQgY2hlY2soXG4gICAgXCJHRVRcIixcbiAgICAoKSA9PiBwYWdlLnJlcXVlc3QuZ2V0KGhlYWx0aFVybCwgeyBoZWFkZXJzOiBjb21tb25IZWFkZXJzIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IGNyZWRlbnRpYWxlZCBHRVQgc3RhdHVzYCkudG9CZSgyMDApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgY2hlY2soXG4gICAgXCJwcmVmbGlnaHRcIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LmZldGNoKG11dGF0aW9uVXJsLCB7XG4gICAgICAgIG1ldGhvZDogXCJPUFRJT05TXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAuLi5jb21tb25IZWFkZXJzLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1NZXRob2RcIjogXCJQT1NUXCIsXG4gICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1SZXF1ZXN0LUhlYWRlcnNcIjogXCJjb250ZW50LXR5cGVcIixcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBzdGF0dXNgKS50b0JlKFxuICAgICAgICAyMDQsXG4gICAgICApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgY3JlZGVudGlhbHNgLFxuICAgICAgKS50b0JlKFwidHJ1ZVwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgobWV0aG9kKSA9PiBtZXRob2QudHJpbSgpLnRvVXBwZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBtZXRob2RzYCxcbiAgICAgICkudG9Db250YWluKFwiUE9TVFwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVyc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgoaGVhZGVyKSA9PiBoZWFkZXIudHJpbSgpLnRvTG93ZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBoZWFkZXJzYCxcbiAgICAgICkudG9Db250YWluKFwiY29udGVudC10eXBlXCIpO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwibXV0YXRpb25cIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LnBvc3QobXV0YXRpb25VcmwsIHtcbiAgICAgICAgaGVhZGVyczogeyAuLi5jb21tb25IZWFkZXJzLCBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwib3JpZ2luIGNvbnRyYWN0XCIgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgYCR7b3JpZ2lufSBzdGF0ZS1jaGFuZ2luZyByZXF1ZXN0IG11c3QgcGFzcyBvcmlnaW4gcHJvdGVjdGlvbmAsXG4gICAgICApLm5vdC50b0JlKDQwMyk7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlKG9yaWdpbik7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0pLnRvQmUoXG4gICAgICAgIFwidHJ1ZVwiLFxuICAgICAgKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKVxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IHVwbG9hZFVybCA9IG5ldyBVUkwoXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGxpdmVVcGRhdGVVcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBkaWFnbm9zdGljOiBPcmlnaW5EaWFnbm9zdGljID0ge1xuICAgIG9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgcGhhc2U6IFwicmVqZWN0aW9uXCIsXG4gIH07XG4gIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljKTtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIE9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgfSxcbiAgICAgIGRhdGE6IHsgbWVzc2FnZTogXCJob3N0aWxlIG9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgfSk7XG4gICAgZGlhZ25vc3RpYy5zdGF0dXMgPSByZXNwb25zZS5zdGF0dXMoKTtcbiAgICBkaWFnbm9zdGljLmhlYWRlcnMgPSByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKTtcbiAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KFxuICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlVXBsb2FkID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QodXBsb2FkVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7IE9yaWdpbjogSE9TVElMRV9PUklHSU4gfSxcbiAgICAgIG11bHRpcGFydDoge1xuICAgICAgICBhcmNoaXZlOiB7XG4gICAgICAgICAgbmFtZTogXCJob3N0aWxlLWRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgICAgIG1pbWVUeXBlOiBcImFwcGxpY2F0aW9uL3ppcFwiLFxuICAgICAgICAgIGJ1ZmZlcjogQnVmZmVyLmZyb20oXCJub3QgYW4gYXJjaGl2ZVwiKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVVcGxvYWQuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlVXBsb2FkLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSxcbiAgICApLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIGNvbnN0IGhvc3RpbGVMaXZlVXBkYXRlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QobGl2ZVVwZGF0ZVVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7fSxcbiAgICB9KTtcbiAgICBleHBlY3QoaG9zdGlsZUxpdmVVcGRhdGUuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlTGl2ZVVwZGF0ZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgZGlhZ25vc3RpYy5lcnJvciA9IFwib3JpZ2luIHJlamVjdGlvbiBjaGVjayBmYWlsZWRcIjtcbiAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNzZShib2R5OiBzdHJpbmcpOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4ge1xuICByZXR1cm4gYm9keS5zcGxpdCgvXFxuXFxuKy8pLmZsYXRNYXAoKGNodW5rKSA9PiB7XG4gICAgY29uc3QgZGF0YSA9IGNodW5rXG4gICAgICAuc3BsaXQoXCJcXG5cIilcbiAgICAgIC5maW5kKChsaW5lKSA9PiBsaW5lLnN0YXJ0c1dpdGgoXCJkYXRhOiBcIikpXG4gICAgICA/LnNsaWNlKFwiZGF0YTogXCIubGVuZ3RoKTtcbiAgICBpZiAoIWRhdGEpIHJldHVybiBbXTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKGRhdGEpIGFzIHVua25vd247XG4gICAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiXG4gICAgICAgID8gW3ZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XVxuICAgICAgICA6IFtdO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVKc29uKFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBwYXRoKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSkgYXMgUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGl2ZUFycmF5KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIFtdO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTGl2ZSBjb3JyZWxhdGlvbiByZXF1ZXN0IGZhaWxlZDogJHtwYXRofSAoJHtyZXNwb25zZS5zdGF0dXN9KWAsXG4gICAgKTtcbiAgfVxuICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVPcHRpb25hbFJlY29yZChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkPiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgID8gKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIGFueT4pXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbnRlc3QuZGVzY3JpYmUoXCJFbmdpbmVlcmluZ09TIGRhc2hib2FyZCBicm93c2VyIGpvdXJuZXlcIiwgKCkgPT4ge1xuICB0ZXN0KFwiZXhwb3J0cyBvbmUgcmVkYWN0ZWQgbGl2ZS1wcm92aWRlciBtaXNzaW9uIGNvcnJlbGF0aW9uIHJlcG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICAvLyBUaGUgUGxheXdyaWdodCBkZWFkbGluZSBtdXN0IGxlYXZlIHJvb20gZm9yIHRoZSBwcm92aWRlci1ib3VuZCByZXF1ZXN0XG4gICAgLy8gYW5kIHBvbGxpbmcgbG9vcCB0byBjb25zdW1lIHRoZWlyIGNvbXBsZXRlIGNvbmZpZ3VyZWQgYnVkZ2V0LlxuICAgIHRlc3Quc2V0VGltZW91dChsaXZlVGltZW91dE1zKCkgKyBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMpO1xuICAgIHRlc3Quc2tpcChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiAhPT0gXCIxXCIsXG4gICAgICBcIkxpdmUtcHJvdmlkZXIgcmVsZWFzZSBqb3VybmV5IGlzIG9wdC1pbi5cIixcbiAgICApO1xuICAgIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIGpvdXJuZXkgcmVxdWlyZXMgREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEU9MSBhbmQgYSBkaXNwb3NhYmxlIHByb2plY3QuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBjYW1wYWlnblNjZW5hcmlvID0gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTtcbiAgICBjb25zdCBwcm9qZWN0SWQgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRDtcbiAgICBpZiAoIXByb2plY3RJZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCBpcyByZXF1aXJlZCBmb3IgdGhlIGxpdmUtcHJvdmlkZXIgam91cm5leS5cIixcbiAgICAgICk7XG5cbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIHRpbWVvdXQ6IGxpdmVUaW1lb3V0TXMoKSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgcHJvamVjdElkLFxuICAgICAgICAgbWVzc2FnZTogbGl2ZVByb21wdCgpLFxuICAgICAgICBpZGVtcG90ZW5jeUtleTogYGRhc2hib2FyZC1saXZlLSR7RGF0ZS5ub3coKX1gLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBpZiAoc3RyZWFtUmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHN0cmVhbVJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiBmYWlsZWQgdG8gc3RhcnQgKCR7c3RyZWFtUmVzcG9uc2Uuc3RhdHVzfSkuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IHNzZUV2ZW50cyA9IHBhcnNlU3NlKHN0cmVhbVJlc3BvbnNlLmJvZHkpO1xuICAgIGNvbnN0IHN0YXJ0ZWQgPSBzc2VFdmVudHMuZmluZChcbiAgICAgIChldmVudCkgPT4gZXZlbnQudHlwZSA9PT0gXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICk7XG4gICAgY29uc3QgZXhlY3V0aW9uSWQgPVxuICAgICAgdHlwZW9mIHN0YXJ0ZWQ/LmV4ZWN1dGlvbklkID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gc3RhcnRlZC5leGVjdXRpb25JZFxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBpZiAoIWV4ZWN1dGlvbklkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTGl2ZS1wcm92aWRlciBzdHJlYW0gZGlkIG5vdCBlbWl0IGV4ZWN1dGlvbl9zdGFydGVkLlwiKTtcblxuICAgIGxldCBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyBsaXZlVGltZW91dE1zKCk7XG4gICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xuICAgICAgZXhlY3V0aW9uID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke2V4ZWN1dGlvbklkfWApO1xuICAgICAgaWYgKFxuICAgICAgICBbXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJjYW5jZWxsZWRcIl0uaW5jbHVkZXMoU3RyaW5nKGV4ZWN1dGlvbi5zdGF0dXMpKVxuICAgICAgKVxuICAgICAgICBicmVhaztcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDc1MCkpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICAhW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gZGlkIG5vdCByZWFjaCBhIHRlcm1pbmFsIHN0YXRlIHdpdGhpbiBpdHMgYm91bmQuXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHNlc3Npb25JZCA9IFN0cmluZyhleGVjdXRpb24uc2Vzc2lvbklkKTtcbiAgICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IGxpdmVBcnJheShcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9tZXNzYWdlc2AsXG4gICAgKTtcbiAgICBjb25zdCBldmVudHMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvZXZlbnRzP3Byb2plY3RJZD0ke2VuY29kZVVSSUNvbXBvbmVudChwcm9qZWN0SWQpfSZjb3JyZWxhdGlvbklkPSR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhleGVjdXRpb24ub3BlcmF0aW9uSWQgPz8gXCJcIikpfWAsXG4gICAgKTtcbiAgICBjb25zdCBwcm9wb3NhbCA9IGF3YWl0IGxpdmVPcHRpb25hbFJlY29yZChcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9wZW5kaW5nLXByb3Bvc2FsYCxcbiAgICApO1xuICAgIGNvbnN0IGdpdExvZyA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL3Byb2plY3RzLyR7cHJvamVjdElkfS9naXQvbG9nYCk7XG4gICAgY29uc3QgbWlzc2lvbkNvbnRyb2wgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpO1xuICAgIGNvbnN0IGRhc2hib2FyZFN0YXRlID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2Rhc2hib2FyZFwiKTtcbiAgICBjb25zdCBjaGVja3BvaW50ID1cbiAgICAgIGV4ZWN1dGlvbi5jaGVja3BvaW50ICYmIHR5cGVvZiBleGVjdXRpb24uY2hlY2twb2ludCA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IChleGVjdXRpb24uY2hlY2twb2ludCBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgICAgICA6IHt9O1xuICAgIGNvbnN0IHJlY2VudFN0ZXBzID0gQXJyYXkuaXNBcnJheShjaGVja3BvaW50LnJlY2VudFN0ZXBzKVxuICAgICAgPyBjaGVja3BvaW50LnJlY2VudFN0ZXBzXG4gICAgICA6IFtdO1xuICAgIGNvbnN0IHZhbGlkYXRpb24gPSByZWNlbnRTdGVwcy5maWx0ZXIoXG4gICAgICAoc3RlcCkgPT4gc3RlcD8ua2luZCA9PT0gXCJ2YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBjb25zdCBwcm9qZWN0UmV2aXNpb24gPVxuICAgICAgdHlwZW9mIGV4ZWN1dGlvbi5wcm9qZWN0UmV2aXNpb24gPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUhhc2ggPSB2YWxpZGF0aW9uXG4gICAgICAubWFwKChzdGVwKSA9PiBzdGVwPy52YWxpZGF0aW9uPy5jYW5kaWRhdGVIYXNoID8/IHN0ZXA/LmNhbmRpZGF0ZUhhc2gpXG4gICAgICAuZmluZCgodmFsdWUpOiB2YWx1ZSBpcyBzdHJpbmcgPT4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLmxlbmd0aCA+IDApO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUlkZW50aXR5ID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHkgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHlcbiAgICAgICAgOiBjYW5kaWRhdGVIYXNoXG4gICAgICAgICAgPyBgY2FuZGlkYXRlOiR7Y2FuZGlkYXRlSGFzaH1gXG4gICAgICAgICAgOiBgcmVhZC1vbmx5OiR7cHJvamVjdFJldmlzaW9uID8/IFwidW5rbm93blwifWA7XG4gICAgaWYgKCFwcm9qZWN0UmV2aXNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgbWlzc2lvbiBpcyBtaXNzaW5nIGl0cyBwcm9qZWN0IHJldmlzaW9uLlwiKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOID09PSBcIjFcIiAmJlxuICAgICAgKCFjYW5kaWRhdGVJZGVudGl0eSB8fCAhcHJvamVjdFJldmlzaW9uKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTGl2ZSBjYW1wYWlnbiByZXF1aXJlcyBvcGVyYXRpb24sIHJldmlzaW9uLCBhbmQgY2FuZGlkYXRlIGNvcnJlbGF0aW9uLlwiKTtcbiAgICB9XG4gICAgY29uc3QgZXZpZGVuY2VDb3VudCA9IHJlY2VudFN0ZXBzLnJlZHVjZShcbiAgICAgIChjb3VudCwgc3RlcCkgPT4gY291bnQgKyAoTnVtYmVyKHN0ZXA/LmFjY2VwdGVkRXZpZGVuY2VDb3VudCkgfHwgMCksXG4gICAgICAwLFxuICAgICk7XG4gICAgY29uc3QgdGVybWluYWxTdGF0ZSA9IFN0cmluZyhcbiAgICAgIGV4ZWN1dGlvbi5mbGlnaHRTdGF0ZSA/PyBleGVjdXRpb24uc3RhdHVzLFxuICAgICkudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBzdWNjZXNzU3RhdGVzID0gbmV3IFNldChbXG4gICAgICBcIkNPTVBMRVRFRFwiLFxuICAgICAgXCJSRUFEWV9GT1JfUkVWSUVXXCIsXG4gICAgICBcIkFQUExJRURcIixcbiAgICAgIFwiQ09NTUlUVEVEXCIsXG4gICAgICBcIlBVU0hFRFwiLFxuICAgIF0pO1xuICAgIGlmIChcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8gPT09IFwiZGVsaXZlcnktc3VjY2Vzc1wiICYmXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgIWNhbmRpZGF0ZUhhc2hcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgYSBjYW5kaWRhdGUtYm91bmQgdmFsaWRhdGlvbiBoYXNoLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgZGVsaXZlcnlTdGFnZXMgPSB7XG4gICAgICBhcHBsaWVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkFpQ2hhbmdlc0FwcGxpZWRcIiksXG4gICAgICBjb21taXR0ZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0Q29tbWl0Q3JlYXRlZFwiKSxcbiAgICAgIHB1c2hlZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJHaXRQdXNoZWRcIiksXG4gICAgfTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFPYmplY3QudmFsdWVzKGRlbGl2ZXJ5U3RhZ2VzKS5ldmVyeShCb29sZWFuKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkRlbGl2ZXJ5LXN1Y2Nlc3MgY2FtcGFpZ24gY2Fubm90IHBhc3Mgd2l0aG91dCBvcGVyYXRpb24tY29ycmVsYXRlZCBhcHBseSwgY29tbWl0LCBhbmQgcHVzaCBldmlkZW5jZS5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAoZXZpZGVuY2VDb3VudCA8IDEgfHwgdmFsaWRhdGlvbi5sZW5ndGggPCAxKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTGl2ZS1wcm92aWRlciBtaXNzaW9uIHJlcG9ydGVkICR7dGVybWluYWxTdGF0ZX0gd2l0aG91dCBhY2NlcHRlZCBldmlkZW5jZSBhbmQgdmFsaWRhdGlvbiBgICtcbiAgICAgICAgICBgKGV2aWRlbmNlPSR7ZXZpZGVuY2VDb3VudH0sIHZhbGlkYXRpb249JHt2YWxpZGF0aW9uLmxlbmd0aH0pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBjYXB0dXJlID0ge1xuICAgICAgcHJvamVjdElkLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgIHdvcmtzcGFjZVJldmlzaW9uOlxuICAgICAgICBnaXRMb2cuY29tbWl0cz8uWzBdPy5zaG9ydEhhc2ggPz9cbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uaGFzaD8uc2xpY2UoMCwgMTIpLFxuICAgICAgcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FuZGlkYXRlSWRlbnRpdHksXG4gICAgICBjYW5kaWRhdGVSZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyxcbiAgICAgIGRlbGl2ZXJ5U3RhZ2VzLFxuICAgICAgY3VycmVudE9wZXJhdGlvbjoge1xuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICByZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsU3RhdGUsXG4gICAgICB9LFxuICAgICAgcmV0YWluZWRSZXN1bHQ6XG4gICAgICAgIHRlcm1pbmFsU3RhdGUgPT09IFwiRkFJTEVEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJCTE9DS0VEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJJTkNPTVBMRVRFXCJcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgICAgICAgbGFiZWw6IFwicmV0YWluZWQgcmVzdWx0IGZyb20gdGhlIGN1cnJlbnQgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBleGVjdXRpb24uaWQsXG4gICAgICAgIHByb2plY3RJZDogZXhlY3V0aW9uLnByb2plY3RJZCxcbiAgICAgICAgc2Vzc2lvbklkOiBleGVjdXRpb24uc2Vzc2lvbklkLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIGZsaWdodFN0YXRlOiBleGVjdXRpb24uZmxpZ2h0U3RhdGUsXG4gICAgICB9LFxuICAgICAgbWVzc2FnZXM6IG1lc3NhZ2VzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSksXG4gICAgICApLFxuICAgICAgc3NlRXZlbnRzOiBzc2VFdmVudHMubWFwKFxuICAgICAgICAoe1xuICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IGV2ZW50RXhlY3V0aW9uLFxuICAgICAgICAgIHNlc3Npb25JZDogZXZlbnRTZXNzaW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgICAgY29kZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIGNoZWNrcG9pbnRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzZXF1ZW5jZTogY2hlY2twb2ludC5zZXF1ZW5jZSxcbiAgICAgICAgICBzdGFnZTogY2hlY2twb2ludC5zdGFnZSxcbiAgICAgICAgICB1cGRhdGVkQXQ6IGNoZWNrcG9pbnQudXBkYXRlZEF0LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGV2aWRlbmNlQ291bnQsXG4gICAgICBwcm9wb3NhbHM6IHByb3Bvc2FsXG4gICAgICAgID8gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogcHJvcG9zYWwuaWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9wb3NhbC5yZXZpc2lvbixcbiAgICAgICAgICAgICAgc3RhdHVzOiBwcm9wb3NhbC5zdGF0dXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF1cbiAgICAgICAgOiBbXSxcbiAgICAgIHZhbGlkYXRpb246IHZhbGlkYXRpb24ubWFwKChzdGVwKSA9PiAoe1xuICAgICAgICBzdGF0dXM6IHN0ZXAudmFsaWRhdGlvbj8uc3RhdHVzID8/IHN0ZXAuc3RhdHVzLFxuICAgICAgICBwcm9maWxlOiBzdGVwLnZhbGlkYXRpb24/LnByb2ZpbGUgPz8gc3RlcC52YWxpZGF0aW9uUHJvZmlsZSxcbiAgICAgIH0pKSxcbiAgICAgIGV2ZW50czogZXZlbnRzLm1hcCgoeyB0eXBlLCBzZXZlcml0eSwgY29ycmVsYXRpb25JZCB9KSA9PiAoe1xuICAgICAgICB0eXBlLFxuICAgICAgICBzZXZlcml0eSxcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIH0pKSxcbiAgICAgIGRhc2hib2FyZDogbWlzc2lvbkNvbnRyb2wsXG4gICAgICBkYXNoYm9hcmRTdGF0ZToge1xuICAgICAgICBwcm9qZWN0Q291bnQ6IGRhc2hib2FyZFN0YXRlLnByb2plY3RDb3VudCxcbiAgICAgICAgYWN0aXZlVGFza0NvdW50OiBkYXNoYm9hcmRTdGF0ZS5hY3RpdmVUYXNrQ291bnQsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgb3V0cHV0UGF0aCA9XG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUkVQT1JUX1BBVEggPz9cbiAgICAgIFwidGVzdC1yZXN1bHRzL2Rhc2hib2FyZC1qb3VybmV5L2xpdmUtbWlzc2lvbi1jb3JyZWxhdGlvbi5qc29uXCI7XG4gICAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgd3JpdGVGaWxlKFxuICAgICAgb3V0cHV0UGF0aCxcbiAgICAgIGAke0pTT04uc3RyaW5naWZ5KGNhcHR1cmUsIG51bGwsIDIpfVxcbmAsXG4gICAgICBcInV0ZjhcIixcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwic2lnbnMgaW4gYW5kIHRyYXZlcnNlcyB0aGUgYXV0aGVudGljYXRlZCBvcGVyYXRpb25hbCBzaGVsbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGZvciAoY29uc3Qgb3JpZ2luIG9mIGFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucygpKSB7XG4gICAgICBhd2FpdCBleHBlY3RPcmlnaW5DYW5Vc2VBcGkocGFnZSwgb3JpZ2luKTtcbiAgICB9XG4gICAgYXdhaXQgZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkKHBhZ2UpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiUHJvamVjdHNcIiwgYCR7REFTSEJPQVJEX1BBVEh9cHJvamVjdHNgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJQcm9qZWN0c1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiRXZlbnQgU3RyZWFtXCIsIGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRXZlbnQgU3RyZWFtXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJBSSBBc3Npc3RhbnRcIiwgYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkubm90LnRvSGF2ZVVSTCgvc2lnbi1pbi8pO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcbiAgICAgICAgICAvQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWR8Tm8gQUkga2V5IGNvbmZpZ3VyZWR8QUkgQXNzaXN0YW50L2ksXG4gICAgICAgIClcbiAgICAgICAgLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24oXG4gICAgICBwYWdlLFxuICAgICAgXCJNaXNzaW9uIENvbnRyb2xcIixcbiAgICAgIGAke0RBU0hCT0FSRF9QQVRIfW1pc3Npb24tY29udHJvbGAsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIk5vIGR1cmFibGUgcnVucyBpbiB0aGUgbGVkZ2VyXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWZsaWdodC1kZWNrP2V4ZWN1dGlvbklkPSR7RVhFQ1VUSU9OX0lEfWApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKFxuICAgICAgICBgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWZsaWdodC1kZWNrXFxcXD9leGVjdXRpb25JZD1gLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiQXVkaXQgLyBDaGF0IHJ1blwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkNvbnRyb2xsZWQgYnJvd3NlciBmaXh0dXJlIGNvbXBsZXRlZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJQUk9WRU5cIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG5cbiAgdGVzdChcIm9wZW5zIGZhaWxlZCB0YXNrIGFuZCB3b3JrZmxvdyBkZXRhaWxzIHdpdGggcmVkYWN0ZWQgcmVjb3ZlcnkgZ3VpZGFuY2VcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmF3RGlhZ25vc3RpYyA9IFwicHJvdmlkZXIgZGlhZ25vc3RpYzogdXBzdHJlYW0gcmV0dXJuZWQgcmF3IHJlc3BvbnNlXCI7XG4gICAgY29uc3QgcmF3Q3JlZGVudGlhbCA9IFwic2stZTJlLWJyb3dzZXItY3JlZGVudGlhbC1zZWNyZXRcIjtcbiAgICBjb25zdCBzdXBwb3J0UmVmZXJlbmNlcyA9IHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uX2ZhaWxlZDogXCJzdXBwb3J0LXRhc2stYXV0aC0zMlwiLFxuICAgICAgcXVvdGFfZXhoYXVzdGVkOiBcInN1cHBvcnQtdGFzay1xdW90YS0zMlwiLFxuICAgICAgcHJvdmlkZXJfb3V0YWdlOiBcInN1cHBvcnQtd29ya2Zsb3ctb3V0YWdlLTMyXCIsXG4gICAgfTtcbiAgICBjb25zdCByZWNvdmVyeVRhc2tzID0gW1xuICAgICAge1xuICAgICAgICBpZDogXCJlMmUtYXV0aC1mYWlsZWQtdGFza1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRoZSBwcm92aWRlciBhdXRoZW50aWNhdGlvbiB0ZXN0IHRhc2sgZmFpbGVkLlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL3Byb3ZpZGVyLnRzXCJdLFxuICAgICAgICByZXRyeUNvdW50OiAxLFxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICBhZ2VudFJlc3BvbnNlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAga2luZDogXCJBSV9UQVNLX0VYRUNVVElPTl9SRUNFSVBUXCIsXG4gICAgICAgICAgdGVybWluYWxTdGF0dXM6IFwiRkFJTEVEXCIsXG4gICAgICAgICAgYXZhaWxhYmlsaXR5U3RhdGU6IFwiYXV0aGVudGljYXRpb25fZmFpbGVkXCIsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogc3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkLFxuICAgICAgICAgIG9wZXJhdG9yQWN0aW9uOiBcIlJlcGxhY2UgdGhlIHByb3ZpZGVyIEFQSSBrZXkgd2l0aCBhIHZhbGlkIGtleSwgdGhlbiByZXRyeS5cIixcbiAgICAgICAgICBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsXG4gICAgICAgICAgbW9kZWw6IFwic2VjcmV0LW1vZGVsLW5hbWVcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICBvcGVyYXRpb25JZDogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgfSksXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiZTJlLXF1b3RhLWZhaWxlZC10YXNrXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVGhlIHByb3ZpZGVyIHF1b3RhIHRlc3QgdGFzayBmYWlsZWQuXCIsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgcHJpb3JpdHk6IFwicDFcIixcbiAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcInF1b3RhX2V4aGF1c3RlZFwiLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHN1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZCxcbiAgICAgICAgICBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsXG4gICAgICAgICAgbW9kZWw6IFwic2VjcmV0LW1vZGVsLW5hbWVcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICBvcGVyYXRpb25JZDogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgfSksXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICBdO1xuICAgIGNvbnN0IHdvcmtmbG93SWQgPSBcImUyZS1vdXRhZ2Utd29ya2Zsb3dcIjtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgcmVjb3ZlcnlUYXNrcyxcbiAgICAgIHJlY292ZXJ5V29ya2Zsb3dzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogd29ya2Zsb3dJZCxcbiAgICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICBuYW1lOiBcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIsXG4gICAgICAgICAgZGVzY3JpcHRpb246IFwiQSBwaXBlbGluZSB1c2VkIHRvIHZlcmlmeSBvdXRhZ2UgcmVjb3ZlcnkgZ3VpZGFuY2UuXCIsXG4gICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgIHBoYXNlczogW1xuICAgICAgICAgICAgeyBuYW1lOiBcImJ1aWxkXCIsIHN0ZXBzOiBbXCJjb21waWxlXCJdIH0sXG4gICAgICAgICAgICB7IG5hbWU6IFwidGVzdFwiLCBzdGVwczogW1widmVyaWZ5XCJdIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBjdXJyZW50UGhhc2U6IFwidGVzdFwiLFxuICAgICAgICAgIGV4ZWN1dGlvbkNvdW50OiAxLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnM6IHtcbiAgICAgICAgW3dvcmtmbG93SWRdOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IFwiZTJlLW91dGFnZS1leGVjdXRpb25cIixcbiAgICAgICAgICAgIHdvcmtmbG93SWQsXG4gICAgICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgICBjdXJyZW50UGhhc2U6IFwidGVzdFwiLFxuICAgICAgICAgICAgY29tcGxldGVkUGhhc2VzOiBbXCJidWlsZFwiXSxcbiAgICAgICAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICAgIGVycm9yTWVzc2FnZTogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICAgIHJlY292ZXJ5OiB7XG4gICAgICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcInByb3ZpZGVyX291dGFnZVwiLFxuICAgICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBzdXBwb3J0UmVmZXJlbmNlcy5wcm92aWRlcl9vdXRhZ2UsXG4gICAgICAgICAgICAgIG9wZXJhdG9yQWN0aW9uOlxuICAgICAgICAgICAgICAgIFwiUmV0cnkgaW4gYSBtb21lbnQ7IGNvbmZpZ3VyZSBhbm90aGVyIHByb3ZpZGVyIGlmIHRoZSBpc3N1ZSBwZXJzaXN0cy5cIixcbiAgICAgICAgICAgICAgZGlhZ25vc3RpYzogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIilcbiAgICAgIC5jbGljaygpO1xuICAgIGNvbnN0IHRhc2tEZXRhaWxzID0gcGFnZS5sb2NhdG9yKFwiI3Rhc2stZGV0YWlscy1lMmUtYXV0aC1mYWlsZWQtdGFza1wiKTtcbiAgICBhd2FpdCBleHBlY3QodGFza0RldGFpbHMpLnRvQ29udGFpblRleHQoXCJQcm92aWRlciBhdXRoZW50aWNhdGlvbiBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXBsYWNlIHRoZSBwcm92aWRlciBBUEkga2V5IHdpdGggYSB2YWxpZCBrZXksIHRoZW4gcmV0cnkuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QodGFza0RldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQcm92aWRlciBxdW90YSBpcyBleGhhdXN0ZWRcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZH1gKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZEF1dGhEZXRhaWxzID0gcGFnZS5sb2NhdG9yKFxuICAgICAgXCIjdGFzay1kZXRhaWxzLWUyZS1hdXRoLWZhaWxlZC10YXNrXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRBdXRoRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUHJvdmlkZXIgYXV0aGVudGljYXRpb24gZmFpbGVkXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRBdXRoRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUmVwbGFjZSB0aGUgcHJvdmlkZXIgQVBJIGtleSB3aXRoIGEgdmFsaWQga2V5LCB0aGVuIHJldHJ5LlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQcm92aWRlciBxdW90YSBpcyBleGhhdXN0ZWRcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZH1gKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVsb2FkZWRUYXNrVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b0NvbnRhaW4ocmF3Q3JlZGVudGlhbCk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3NlY3JldC1tb2RlbC1uYW1lfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiV29ya2Zsb3dzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXdvcmtmbG93c2ApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeGVjdXRpb24gaGlzdG9yeVwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZXhlY3V0aW9uID0gcGFnZVxuICAgICAgLmdldEJ5VGV4dChcImZhaWxlZCDCtyBubyBzdWNjZXNzZnVsIGNvbXBsZXRpb25cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVGhlIHByb3ZpZGVyIGlzIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoZXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXRyeSBpbiBhIG1vbWVudDsgY29uZmlndXJlIGFub3RoZXIgcHJvdmlkZXIgaWYgdGhlIGlzc3VlIHBlcnNpc3RzLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5wcm92aWRlcl9vdXRhZ2V9YCxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3ZlciBwcm92aWRlciBvdXRhZ2VcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkV4ZWN1dGlvbiBoaXN0b3J5XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZEV4ZWN1dGlvbiA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJmYWlsZWQgwrcgbm8gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZEV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVGhlIHByb3ZpZGVyIGlzIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlJldHJ5IGluIGEgbW9tZW50OyBjb25maWd1cmUgYW5vdGhlciBwcm92aWRlciBpZiB0aGUgaXNzdWUgcGVyc2lzdHMuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlfWAsXG4gICAgKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKHJhd0NyZWRlbnRpYWwpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvc2VjcmV0LW1vZGVsLW5hbWV8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwiY29udmVyZ2VzIHR3byBicm93c2VyIHNlc3Npb25zIGFjcm9zcyByZWxvYWQsIHJlY29ubmVjdCwgc3RhbGUgcmVzdWx0cywgYW5kIEFQSSByZXN0YXJ0XCIsIGFzeW5jICh7XG4gICAgYnJvd3NlcixcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgdGVzdC5za2lwKFxuICAgICAgIXByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQ09OVFJPTF9VUkwsXG4gICAgICBcIlRoZSBtdWx0aS1wcm9jZXNzIGNvbnZlcmdlbmNlIGNhbXBhaWduIHJ1bnMgb25seSB1bmRlciB0aGUgcmVsZWFzZSBydW5uZXIuXCIsXG4gICAgKTtcbiAgICB0ZXN0LnNldFRpbWVvdXQoOTBfMDAwKTtcblxuICAgIGNvbnN0IHNlY29uZENvbnRleHQgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoKTtcbiAgICBjb25zdCBzZWNvbmRQYWdlID0gYXdhaXQgc2Vjb25kQ29udGV4dC5uZXdQYWdlKCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSksIHByb2dyYW1tYXRpY1NpZ25JbihzZWNvbmRQYWdlKV0pO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICBwYWdlLmdvdG8oREFTSEJPQVJEX1BBVEgpLFxuICAgICAgICBzZWNvbmRQYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKSxcbiAgICAgIF0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3Qoc2Vjb25kUGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKSkudG9CZVZpc2libGUoKTtcblxuICAgICAgLy8gQSByZXNwb25zZSB0aGF0IGFycml2ZXMgYWZ0ZXIgYSBuZXdlciByZXF1ZXN0IG11c3Qgbm90IHJlcGxhY2UgdGhlXG4gICAgICAvLyB2aXNpYmxlIHJlYWR5IHN0YXRlIHdpdGggc3RhbGUgZGF0YS4gS2VlcCB0aGUgZGVsYXkgYm91bmRlZCBzbyBhXG4gICAgICAvLyBodW5nIHJlcXVlc3QgY2Fubm90IG1ha2UgdGhpcyBjYW1wYWlnbiBwYXNzIGluZGVmaW5pdGVseS5cbiAgICAgIGNvbnN0IGN1cnJlbnREYXNoYm9hcmRGaXh0dXJlID0ge1xuICAgICAgICAuLi5kYXNoYm9hcmRGaXh0dXJlLFxuICAgICAgICBmcmVzaG5lc3NSZXZpc2lvbjogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgICAgICAgcHJvamVjdFNjb3JlczogW3sgLi4uZGFzaGJvYXJkRml4dHVyZS5wcm9qZWN0U2NvcmVzWzBdLCBwcm9qZWN0TmFtZTogXCJDb25jdXJyZW50IFByb2plY3RcIiwgc2NvcmU6IDk3IH1dLFxuICAgICAgICBhY3RpdmVUYXNrQ291bnQ6IDEsXG4gICAgICAgIHRhc2tTdGF0dXNCcmVha2Rvd246IHsgcGVuZGluZzogMCwgcnVubmluZzogMSB9LFxuICAgICAgfTtcbiAgICAgIGxldCByZWZyZXNoQ291bnQgPSAwO1xuICAgICAgbGV0IHJlbGVhc2VTdGFsZVJlc3BvbnNlITogKCkgPT4gdm9pZDtcbiAgICAgIGNvbnN0IHN0YWxlUmVzcG9uc2VSZWxlYXNlZCA9IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgICAgIHJlbGVhc2VTdGFsZVJlc3BvbnNlID0gcmVzb2x2ZTtcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS9kYXNoYm9hcmRcIiwgYXN5bmMgKHJvdXRlKSA9PiB7XG4gICAgICAgIHJlZnJlc2hDb3VudCArPSAxO1xuICAgICAgICBpZiAocmVmcmVzaENvdW50ID09PSAxKSByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoY3VycmVudERhc2hib2FyZEZpeHR1cmUpKTtcbiAgICAgICAgYXdhaXQgc3RhbGVSZXNwb25zZVJlbGVhc2VkO1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoZGFzaGJvYXJkRml4dHVyZSkpO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCBzdGF0dXNcIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCI5N1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgY29uc3Qgc3RhbGVSZWZyZXNoID0gcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlZnJlc2ggc3RhdHVzXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHJlZnJlc2hDb3VudCkudG9CZSgyKTtcbiAgICAgIHJlbGVhc2VTdGFsZVJlc3BvbnNlKCk7XG4gICAgICBhd2FpdCBzdGFsZVJlZnJlc2g7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiOTdcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjFcIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgICAvLyBTaW11bGF0ZSBhIGRyb3BwZWQgY29ubmVjdGlvbiBpbiB0aGUgc2Vjb25kIGJyb3dzZXIgYW5kIGFzc2VydCB0aGVcbiAgICAgIC8vIHJlY292ZXJ5IGFjdGlvbiByZW5kZXJlZCBieSB0aGUgZGFzaGJvYXJkLCB0aGVuIGxldCB0aGUgbmV4dCByZXF1ZXN0XG4gICAgICAvLyByZWNvbm5lY3Qgbm9ybWFsbHkuXG4gICAgICBsZXQgcmVjb25uZWN0QXR0ZW1wdCA9IDA7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLmdvdG8oREFTSEJPQVJEX1BBVEgpO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkoc2Vjb25kUGFnZSk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICAgICAgcmVjb25uZWN0QXR0ZW1wdCArPSAxO1xuICAgICAgICAvLyB1c2VHZXREYXNoYm9hcmQgcmV0cmllcyBvbmNlOyBob2xkIGJvdGggYm91bmRlZCBhdHRlbXB0cyBzbyB0aGVcbiAgICAgICAgLy8gcmVuZGVyZWQgZXJyb3Igc3RhdGUgaXMgb2JzZXJ2YWJsZSBiZWZvcmUgdGhlIG9wZXJhdG9yIHJldHJpZXMuXG4gICAgICAgIGlmIChyZWNvbm5lY3RBdHRlbXB0IDw9IDIpIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcImNvbnRyb2xsZWQgcmVjb25uZWN0IGludGVycnVwdGlvblwiIH0sIDUwMyksXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcm91dGUuY29udGludWUoKTtcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS5yZWxvYWQoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgc2Vjb25kUGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJGYWlsZWQgdG8gbG9hZCBkYXNoYm9hcmRcIiB9KSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgc2Vjb25kUGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5lY3Rpb25cIiB9KSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UudW5yb3V0ZShcIioqL2FwaS9kYXNoYm9hcmRcIik7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcblxuICAgICAgYXdhaXQgcmVzdGFydEFwaUZvckNhbXBhaWduKHBhZ2UpO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW3BhZ2UucmVsb2FkKCksIHNlY29uZFBhZ2UucmVsb2FkKCldKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkoc2Vjb25kUGFnZSk7XG5cbiAgICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5lY3Rpb25cIiB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgc2Vjb25kQ29udGV4dC5jbG9zZSgpO1xuICAgIH1cbiAgfSk7XG5cbiAgdGVzdChcInByZXZpZXdzIGFuZCBkb3dubG9hZHMgdGhlIGNvbXBsZXRlZCBleGVjdXRpb24gYXVkaXQgd2l0aG91dCBkdXBsaWNhdGluZyBlZmZlY3RzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGF1ZGl0UmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgYXVkaXRCb2R5ID0ge1xuICAgICAgZm9ybWF0OiBcImVuZ2luZWVyaW5nb3MuZXhlY3V0aW9uLWF1ZGl0LnYxXCIsXG4gICAgICBleHBvcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBFWEVDVVRJT05fSUQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbkZpeHR1cmUub3BlcmF0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgdGVybWluYWxTdGF0ZTogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgcmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gICAgICAgIHByb29mOiB7IHJlcXVpcmVkOiBmYWxzZSwgdmVyZGljdDogXCJQUk9WRU5cIiB9LFxuICAgICAgfSxcbiAgICAgIHRpbWVsaW5lOiBbXSxcbiAgICAgIHZhbGlkYXRpb25zOiBbeyBzdGF0dXM6IFwicGFzc2VkXCIsIHByb2ZpbGU6IFwicmVsZWFzZS1zYWZlXCIgfV0sXG4gICAgICBhZmZlY3RlZEZpbGVzOiBbXCJzcmMvZmVhdHVyZS50c1wiXSxcbiAgICAgIHJlZGFjdGlvbjoge1xuICAgICAgICBleGNsdWRlZDogW1xuICAgICAgICAgIFwicHJvdmlkZXIgc2VjcmV0c1wiLFxuICAgICAgICAgIFwicmF3IG1vZGVsIG91dHB1dFwiLFxuICAgICAgICAgIFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGF1ZGl0RXhwb3J0OiB7XG4gICAgICAgIGJvZHk6IGF1ZGl0Qm9keSxcbiAgICAgICAgZmlsZW5hbWU6IFwic2VydmVyLXN1cHBsaWVkLWF1ZGl0LW5hbWUuanNvblwiLFxuICAgICAgICByZXF1ZXN0czogYXVkaXRSZXF1ZXN0cyxcbiAgICAgICAgZmFpbEZpcnN0UHJldmlldzogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xuICAgICAgY29uc3QgZXhlY3V0aW9uID0ge1xuICAgICAgICBpZDogXCJlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBtZXNzYWdlOiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgIH07XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfZTJlLXByb2plY3RcIixcbiAgICAgICAgXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgKTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fZTJlLXByb2plY3RfZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uKSxcbiAgICAgICk7XG4gICAgfSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBwcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KC9jb21wbGV0ZWQvaSk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcblxuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUHJldmlldyBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcHJldmlldyA9IHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJBdWRpdCBwcmV2aWV3IHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwic2FtZSBleGVjdXRpb24gYW5kIHJldmlzaW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcm92aWRlciBzZWNyZXRzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicmF3IG1vZGVsIG91dHB1dFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByaXZhdGUgcnVudGltZSBwYXRoc1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChFWEVDVVRJT05fSUQpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLW9wZXJhdGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgIGV4cGVjdChuZXcgVVJMKGF1ZGl0UmVxdWVzdHNbMF0pLnBhdGhuYW1lKS50b0JlKFxuICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke0VYRUNVVElPTl9JRH0vYXVkaXQtZXhwb3J0YCxcbiAgICApO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIGF1ZGl0IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0JlSGlkZGVuKCk7XG5cbiAgICBjb25zdCBkb3dubG9hZFByb21pc2UgPSBwYWdlLndhaXRGb3JFdmVudChcImRvd25sb2FkXCIpO1xuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRXhwb3J0IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBkb3dubG9hZCA9IGF3YWl0IGRvd25sb2FkUHJvbWlzZTtcbiAgICBleHBlY3QoZG93bmxvYWQuc3VnZ2VzdGVkRmlsZW5hbWUoKSkudG9CZShcInNlcnZlci1zdXBwbGllZC1hdWRpdC1uYW1lLmpzb25cIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRQcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dCgvY29tcGxldGVkL2kpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiRXhlY3V0aW9uIGUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKSxcbiAgICApLnRvQmVIaWRkZW4oKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIGNhbmNlbGxlZCBleGVjdXRpb24gYXVkaXQgaGFuZG9mZiByZWRhY3RlZCBhbmQgdGVybWluYWxcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYXVkaXRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBjYW5jZWxsZWRFeGVjdXRpb24gPSB7XG4gICAgICAuLi5leGVjdXRpb25GaXh0dXJlLFxuICAgICAgc3RhdHVzOiBcImNhbmNlbGxlZFwiLFxuICAgICAgZmxpZ2h0U3RhdGU6IFwiQ0FOQ0VMTEVEXCIsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICBkZXRhaWw6IFwiRXhlY3V0aW9uIGNhbmNlbGxlZCBiZWZvcmUgYW55IGNoYW5nZXMgd2VyZSBhcHBsaWVkLlwiLFxuICAgICAgfSxcbiAgICAgIHRlcm1pbmFsUmVhc29uOiBcImNhbmNlbF9yZXF1ZXN0ZWRcIixcbiAgICAgIGNvbXBsZXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MzAuMDAwWlwiLFxuICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MzAuMDAwWlwiLFxuICAgIH07XG4gICAgY29uc3QgYXVkaXRCb2R5ID0ge1xuICAgICAgZm9ybWF0OiBcImVuZ2luZWVyaW5nb3MuZXhlY3V0aW9uLWF1ZGl0LnYxXCIsXG4gICAgICBleHBvcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBFWEVDVVRJT05fSUQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbkZpeHR1cmUub3BlcmF0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgdGVybWluYWxTdGF0ZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgcmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gICAgICAgIHByb29mOiB7IHJlcXVpcmVkOiBmYWxzZSwgdmVyZGljdDogXCJOT1RfUkVDT1JERURcIiB9LFxuICAgICAgfSxcbiAgICAgIHRpbWVsaW5lOiBbXG4gICAgICAgIHsgdHlwZTogXCJjYW5jZWxsZWRcIiwgZGV0YWlsOiBcIkNhbmNlbGxhdGlvbiBhY2NlcHRlZCBieSB0aGUgc2VydmVyLlwiIH0sXG4gICAgICBdLFxuICAgICAgdmFsaWRhdGlvbnM6IFtdLFxuICAgICAgYWZmZWN0ZWRGaWxlczogW10sXG4gICAgICByZWRhY3Rpb246IHtcbiAgICAgICAgZXhjbHVkZWQ6IFtcbiAgICAgICAgICBcInByb3ZpZGVyIHNlY3JldHNcIixcbiAgICAgICAgICBcInJhdyBtb2RlbCBvdXRwdXRcIixcbiAgICAgICAgICBcInByaXZhdGUgcnVudGltZSBwYXRoc1wiLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhdWRpdEV4cG9ydDoge1xuICAgICAgICBib2R5OiBhdWRpdEJvZHksXG4gICAgICAgIGZpbGVuYW1lOiBcImNhbmNlbGxlZC1zZXJ2ZXItYXVkaXQuanNvblwiLFxuICAgICAgICByZXF1ZXN0czogYXVkaXRSZXF1ZXN0cyxcbiAgICAgICAgZXhlY3V0aW9uOiBjYW5jZWxsZWRFeGVjdXRpb24sXG4gICAgICAgIG1lc3NhZ2VPdXRjb21lOiBcIkNBTkNFTExFRFwiLFxuICAgICAgICBmYWlsRmlyc3RQcmV2aWV3OiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb24gPSB7XG4gICAgICAgIGlkOiBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiQ2FuY2VsbGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgfTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiLFxuICAgICAgICBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICApO1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShleGVjdXRpb24pLFxuICAgICAgKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiRXhlY3V0aW9uIGUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlRlcm1pbmFsIHJlYXNvbjogY2FuY2VsX3JlcXVlc3RlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDYW5jZWxcIiB9KSkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIgfSkpLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQXBwcm92ZSAmIGFwcGx5XCIgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiAvY29tbWl0IHZlcmlmaWVkIGNoYW5nZXMvaSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IC9wdXNoIGNvbW1pdHRlZCBjaGFuZ2VzL2kgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUHJldmlldyBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcHJldmlldyA9IHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJBdWRpdCBwcmV2aWV3IHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwic2FtZSBleGVjdXRpb24gYW5kIHJldmlzaW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJjYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoRVhFQ1VUSU9OX0lEKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1vcGVyYXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcm92aWRlciBzZWNyZXRzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicmF3IG1vZGVsIG91dHB1dFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByaXZhdGUgcnVudGltZSBwYXRoc1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJUZXJtaW5hbCByZWFzb246IGNhbmNlbF9yZXF1ZXN0ZWRcIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgyKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBhdWRpdCBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBkb3dubG9hZFByb21pc2UgPSBwYWdlLndhaXRGb3JFdmVudChcImRvd25sb2FkXCIpO1xuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRXhwb3J0IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBkb3dubG9hZCA9IGF3YWl0IGRvd25sb2FkUHJvbWlzZTtcbiAgICBleHBlY3QoZG93bmxvYWQuc3VnZ2VzdGVkRmlsZW5hbWUoKSkudG9CZShcImNhbmNlbGxlZC1zZXJ2ZXItYXVkaXQuanNvblwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiQ2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKSkudG9CZUhpZGRlbigpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG4gIH0pO1xuXG4gIHRlc3QoXCJ1cGxvYWRzIGFuIGFyY2hpdmUgYW5kIHJlbmRlcnMgYSBsaXZlIHRhc2sgdXBkYXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHRhc2tJZCA9IFwiZTJlLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtbGl2ZS1sb2dcIixcbiAgICAgIHRhc2tJZCxcbiAgICAgIGxldmVsOiBcImluZm9cIixcbiAgICAgIG1lc3NhZ2U6IFwiTGl2ZSB1cGRhdGUgcmVjZWl2ZWQgZnJvbSB0aGUgc2VydmVyXCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMi4wMDBaXCIsXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJjaGl2ZVVwbG9hZDoge1xuICAgICAgICB1cGxvYWRJZDogXCJlMmUtdXBsb2FkXCIsXG4gICAgICAgIG9yaWdpbmFsTmFtZTogXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgIH0sXG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJWZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICAvLyBUaGlzIGlzIGEgdmFsaWQsIGVtcHR5IFpJUCBhcmNoaXZlLiBLZWVwaW5nIGl0IGlubGluZSBtYWtlcyB0aGUgYnJvd3NlclxuICAgIC8vIHRlc3Qgc2VsZi1jb250YWluZWQgd2hpbGUgc3RpbGwgZXhlcmNpc2luZyBGb3JtRGF0YSBhbmQgbXVsdGlwYXJ0IGJ5dGVzLlxuICAgIGNvbnN0IHVwbG9hZFJlc3VsdCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoYXN5bmMgKGFwaUJhc2VVcmwpID0+IHtcbiAgICAgIGNvbnN0IGJ5dGVzID0gVWludDhBcnJheS5mcm9tKFxuICAgICAgICBhdG9iKFwiVUVzRkJnQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBPT1cIiksXG4gICAgICAgIChjaGFyYWN0ZXIpID0+IGNoYXJhY3Rlci5jaGFyQ29kZUF0KDApLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgIGJvZHkuYXBwZW5kKFxuICAgICAgICBcImFyY2hpdmVcIixcbiAgICAgICAgbmV3IEJsb2IoW2J5dGVzXSwgeyB0eXBlOiBcImFwcGxpY2F0aW9uL3ppcFwiIH0pLFxuICAgICAgICBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goXG4gICAgICAgIG5ldyBVUkwoXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCksXG4gICAgICAgIHsgbWV0aG9kOiBcIlBPU1RcIiwgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLCBib2R5IH0sXG4gICAgICApO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgIGJvZHk6IChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgfTtcbiAgICB9LCBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCA/PyBwYWdlLnVybCgpKTtcbiAgICBleHBlY3QodXBsb2FkUmVzdWx0LnN0YXR1cykudG9CZSgyMDEpO1xuICAgIGV4cGVjdCh1cGxvYWRSZXN1bHQuYm9keSkudG9FcXVhbCh7XG4gICAgICB1cGxvYWRJZDogXCJlMmUtdXBsb2FkXCIsXG4gICAgICBvcmlnaW5hbE5hbWU6IFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgfSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgY29uc3QgdGFza1JvdyA9IHBhZ2UuZ2V0QnlMYWJlbChcbiAgICAgIFwiRXhwYW5kIHRhc2sgVmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrUm93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHRhc2tSb3cuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJMaXZlIHVwZGF0ZSByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXJcIixcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwicmVjb3ZlcnMgYSBsaXZlIHRhc2sgdXBkYXRlIGFmdGVyIGEgdGVtcG9yYXJ5IHN0cmVhbSBmYWlsdXJlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHRhc2tJZCA9IFwiZTJlLXJlY29ubmVjdGluZy1saXZlLXRhc2tcIjtcbiAgICBjb25zdCBsaXZlTG9nID0ge1xuICAgICAgaWQ6IFwiZTJlLXJlY29ubmVjdGluZy1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJBdXRob3JpdGF0aXZlIHVwZGF0ZSByZWNlaXZlZCBhZnRlciByZWNvbm5lY3RcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvbm5lY3Rpbmctb3BlcmF0aW9uXCIsXG4gICAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAzLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIGxpdmUgdGFzayB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICAgIHN0cmVhbVJlcXVlc3RzLFxuICAgICAgICBmYWlsRmlyc3RTdHJlYW06IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBjb25zdCB0YXNrUm93ID0gcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBsaXZlIHRhc2sgdXBkYXRlc1wiKTtcbiAgICBhd2FpdCBleHBlY3QodGFza1JvdykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCB0YXNrUm93LmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7IG5hbWU6IFwiQWN0aXZpdHlcIiB9KTtcbiAgICBhd2FpdCBleHBlY3QoYWN0aXZpdHkpLnRvQ29udGFpblRleHQobGl2ZUxvZy5tZXNzYWdlKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCwge1xuICAgICAgICBtZXNzYWdlOiBcInRoZSB0YXNrIGxvZyBzdHJlYW0gc2hvdWxkIHJlY29ubmVjdCBleGFjdGx5IG9uY2VcIixcbiAgICAgIH0pXG4gICAgICAudG9CZSgyKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0pLnRvQmUoc3RyZWFtUmVxdWVzdHNbMV0pO1xuICAgIGV4cGVjdChuZXcgVVJMKHN0cmVhbVJlcXVlc3RzWzFdKS5wYXRobmFtZSkudG9CZShcbiAgICAgIGAvYXBpL3Rhc2tzLyR7dGFza0lkfS9sb2dzL3N0cmVhbWAsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBhY3Rpdml0eS5sb2NhdG9yKFwic3VtbWFyeVwiKS5maWx0ZXIoeyBoYXNUZXh0OiBsaXZlTG9nLm1lc3NhZ2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgxKTtcbiAgfSk7XG5cbiAgdGVzdChcInNob3dzIGFuIGFjdGlvbmFibGUgdGVybWluYWwgc3RhdGUgd2hlbiBsaXZlIHRhc2sgcmVjb25uZWN0cyBhcmUgZXhoYXVzdGVkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHRhc2tJZCA9IFwiZTJlLWV4aGF1c3RlZC1saXZlLXRhc2tcIjtcbiAgICBjb25zdCBvcGVyYXRpb25JZCA9IFwiZTJlLWV4aGF1c3RlZC1vcGVyYXRpb25cIjtcbiAgICBjb25zdCBsaXZlTG9nID0ge1xuICAgICAgaWQ6IFwiZTJlLWV4aGF1c3RlZC1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJUaGUgb25seSBjb25maXJtZWQgdGFzayB1cGRhdGVcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICAgIG1ldGFkYXRhOiB7IG9wZXJhdGlvbklkIH0sXG4gICAgfTtcbiAgICBjb25zdCBzdHJlYW1SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBub25TdHJlYW1SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBwYWdlLm9uKFwicmVxdWVzdFwiLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKCFyZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2FwaS90YXNrcy9cIikpIHJldHVybjtcbiAgICAgIGlmICghcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9sb2dzL3N0cmVhbVwiKSkgbm9uU3RyZWFtUmVxdWVzdHMucHVzaChyZXF1ZXN0Lm1ldGhvZCgpKTtcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgbGl2ZVRhc2s6IHtcbiAgICAgICAgaWQ6IHRhc2tJZCxcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBleGhhdXN0ZWQgbGl2ZSB0YXNrIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgICAgaW5pdGlhbExvZ3M6IFtsaXZlTG9nXSxcbiAgICAgICAgc3RyZWFtUmVxdWVzdHMsXG4gICAgICAgIGZhaWxTdHJlYW1BdHRlbXB0czogNixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgZXhoYXVzdGVkIGxpdmUgdGFzayB1cGRhdGVzXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7IG5hbWU6IFwiQWN0aXZpdHlcIiB9KTtcbiAgICBhd2FpdCBleHBlY3QoYWN0aXZpdHkpLnRvQ29udGFpblRleHQobGl2ZUxvZy5tZXNzYWdlKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJUZW1wb3Jhcnkgc3RyZWFtIGZhaWx1cmUuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoLCB7XG4gICAgICAgIG1lc3NhZ2U6IFwidGhlIHRhc2sgbG9nIHN0cmVhbSBzaG91bGQgZXhoYXVzdCBpdHMgYm91bmRlZCByZWNvbm5lY3QgYnVkZ2V0XCIsXG4gICAgICAgIHRpbWVvdXQ6IDM1XzAwMCxcbiAgICAgIH0pXG4gICAgICAudG9CZSg2KTtcbiAgICBjb25zdCBleGhhdXN0ZWQgPSBwYWdlLmdldEJ5Um9sZShcImFsZXJ0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJMaXZlIHRhc2sgdXBkYXRlcyBjb3VsZCBub3QgcmVjb25uZWN0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJSZWNvbm5lY3QgYXR0ZW1wdHMgYXJlIGV4aGF1c3RlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KG9wZXJhdGlvbklkKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KFwidGFzayBoYXMgbm90IGJlZW4gbWFya2VkIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgbGl2ZSB1cGRhdGVzXCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlZnJlc2ggdGFzayBsb2dzXCIgfSkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBsaXZlIHVwZGF0ZXNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChcIlRoZSBvbmx5IGNvbmZpcm1lZCB0YXNrIHVwZGF0ZVwiKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoNyk7XG4gICAgZXhwZWN0KG5ldyBTZXQoc3RyZWFtUmVxdWVzdHMpLnNpemUpLnRvQmUoMSk7XG4gICAgZXhwZWN0KG5vblN0cmVhbVJlcXVlc3RzKS5ub3QudG9Db250YWluKFwiUE9TVFwiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBhY3Rpdml0eS5sb2NhdG9yKFwic3VtbWFyeVwiKS5maWx0ZXIoeyBoYXNUZXh0OiBsaXZlTG9nLm1lc3NhZ2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgxKTtcbiAgfSk7XG5cbiAgdGVzdChcInBhZ2VzIGFuZCByZWxvYWRzIHRoZSBmaWx0ZXJlZCBldmVudCBzdHJlYW0gd2l0aG91dCBsb3NpbmcgaXRzIHdpbmRvd1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBldmVudHMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiA1MSB9LCAoXywgaW5kZXgpID0+ICh7XG4gICAgICBpZDogYGUyZS1ldmVudC0ke2luZGV4fWAsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIHR5cGU6IFwiQXVkaXRFdmVudFwiLFxuICAgICAgc2V2ZXJpdHk6IGluZGV4IDwgMiA/IFwic3VjY2Vzc1wiIDogXCJpbmZvXCIsXG4gICAgICBjb3JyZWxhdGlvbklkOiBpbmRleCA8IDIgPyBcInJlbGVhc2UtNDJcIiA6IG51bGwsXG4gICAgICBtZXNzYWdlOlxuICAgICAgICBpbmRleCA8IDIgPyBgRmlsdGVyZWQgcmVsZWFzZSBldmVudCAke2luZGV4fWAgOiBgT2xkZXIgZXZlbnQgJHtpbmRleH1gLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZShEYXRlLlVUQygyMDI2LCAwLCAxLCAwLCAwLCA1MSAtIGluZGV4KSkudG9JU09TdHJpbmcoKSxcbiAgICB9KSk7XG4gICAgY29uc3QgZXZlbnRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBwYWdlLm9uKFwicmVxdWVzdFwiLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKG5ldyBVUkwocmVxdWVzdC51cmwoKSkucGF0aG5hbWUuZW5kc1dpdGgoXCIvYXBpL2V2ZW50c1wiKSlcbiAgICAgICAgZXZlbnRSZXF1ZXN0cy5wdXNoKHJlcXVlc3QudXJsKCkpO1xuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBldmVudHMsXG4gICAgICBwcm9qZWN0czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICBuYW1lOiBcIlNtb2tlIFByb2plY3RcIixcbiAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImFjdGl2ZVwiLFxuICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Ntb2tlXCIsXG4gICAgICAgICAgcXVhbGl0eVNjb3JlOiA5MixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNDlcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA1MFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgZmlyc3RSZXF1ZXN0ID0gbmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpO1xuICAgIGV4cGVjdChmaXJzdFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKS50b0JlKFwiNTBcIik7XG4gICAgZXhwZWN0KGZpcnN0UmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjFcIik7XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBwYWdlLndhaXRGb3JSZXF1ZXN0KChyZXF1ZXN0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwoKSk7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgdXJsLnBhdGhuYW1lLmVuZHNXaXRoKFwiL2FwaS9ldmVudHNcIikgJiZcbiAgICAgICAgICB1cmwuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikgPT09IFwiMlwiXG4gICAgICAgICk7XG4gICAgICB9KSxcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPbGRlclwiIH0pLmNsaWNrKCksXG4gICAgXSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUGFnZSAyLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDUwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBleHBlY3QobmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMlwiKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTmV3ZXJcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlBhZ2UgMS5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5UGxhY2Vob2xkZXIoXCJTZWFyY2ggbG9ncy4uLlwiKS5maWxsKFwiRmlsdGVyZWQgcmVsZWFzZVwiKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiVG9nZ2xlIGV2ZW50IGZpbHRlcnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UubG9jYXRvcihcInNlbGVjdFwiKS5udGgoMSkuc2VsZWN0T3B0aW9uKFwic3VjY2Vzc1wiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDFcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NlYXJjaD1GaWx0ZXJlZFxcK3JlbGVhc2UvKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKC9zZXZlcml0eT1zdWNjZXNzLyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgMVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlQbGFjZWhvbGRlcihcIlNlYXJjaCBsb2dzLi4uXCIpKS50b0hhdmVWYWx1ZShcbiAgICAgIFwiRmlsdGVyZWQgcmVsZWFzZVwiLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlRvZ2dsZSBldmVudCBmaWx0ZXJzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwic2VsZWN0XCIpLm50aCgxKSkudG9IYXZlVmFsdWUoXCJzdWNjZXNzXCIpO1xuICAgIGNvbnN0IGZpbHRlcmVkUmVxdWVzdCA9IG5ldyBVUkwoZXZlbnRSZXF1ZXN0cy5hdCgtMSkhKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkudG9CZShcIjUwXCIpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIxXCIpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInNlYXJjaFwiKSkudG9CZShcIkZpbHRlcmVkIHJlbGVhc2VcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwic2V2ZXJpdHlcIikpLnRvQmUoXCJzdWNjZXNzXCIpO1xuICB9KTtcblxuICB0ZXN0KFwicmVuZGVycyBhbiBBcmFiaWMgc291cmNlLWJhY2tlZCBBSSBhbnN3ZXIgd2l0aG91dCBpbnRlcm5hbCBkaWFnbm9zdGljc1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgZXhwZWN0KGNvbXBvc2VyKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgY29uc3Qgc2VuZEJ1dHRvbiA9IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHNlbmRCdXR0b24pLnRvQmVFbmFibGVkKCk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2VQcm9taXNlID0gcGFnZS53YWl0Rm9yUmVzcG9uc2UoKHJlc3BvbnNlKSA9PlxuICAgICAgcmVzcG9uc2UudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpLFxuICAgICk7XG4gICAgYXdhaXQgc2VuZEJ1dHRvbi5jbGljaygpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlID0gYXdhaXQgc3RyZWFtUmVzcG9uc2VQcm9taXNlO1xuICAgIGV4cGVjdChzdHJlYW1SZXNwb25zZS5zdGF0dXMoKSkudG9CZSgyMDApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5xdWVzdGlvbiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBZ2VudCBhY3Rpdml0eVwiLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5sb2NhdG9yKFwic3VtbWFyeVwiKS5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlJlYWRpbmcgc291cmNlXCIsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLnNvdXJjZSwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KC9CZWhhdmlvciBldmlkZW5jZSDCtyAxIGV4Y2VycHQvaSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoJ3JldHVybiBwYXJ0aWFsRnJvbUNvbGxlY3RlZEV2aWRlbmNlKFwicHJvdmlkZXIgdGltZW91dFwiKTsnLCB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIkNPTVBMRVRFRFwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiTk9UIFBST1ZFTlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBBSSBzZXNzaW9uIGRyYXdlciBvdmVybGFpZCBvbiBhIHBob25lIHZpZXdwb3J0IHdpdGggYWNjZXB0ZWQgZXZpZGVuY2VcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMzkwLCBoZWlnaHQ6IDg0NCB9KTtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChgJHtmaXh0dXJlLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoZml4dHVyZS5zb3VyY2UpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIGFjcm9zcyBicm93c2VyIGJhY2sgYW5kIGZvcndhcmQgbmF2aWdhdGlvbiB3aXRoIGJsb2NrZWQgZXZpZGVuY2VcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1hY2NlcHRlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2LPZhNmI2YMg2YXZh9mE2KkgcHJvdmlkZXIg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBjb25zdCBibG9ja2VkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBibG9ja2VkOiB0cnVlLFxuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWJsb2NrZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINin2YTYr9mE2YrZhCDYp9mE2YXYrdis2YjYqCDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogYWNjZXB0ZWQsXG4gICAgICBhbHRlcm5hdGVBaTogYmxvY2tlZCxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChibG9ja2VkLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChibG9ja2VkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSB3aGVuIHN3aXRjaGluZyBwcm9qZWN0c1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgICAgcHJvamVjdHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0LW9uZVwiLFxuICAgICAgICAgIG5hbWU6IFwiQ2l0YXRpb24gUHJvamVjdCBPbmVcIixcbiAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImFjdGl2ZVwiLFxuICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Byb2plY3Qtb25lXCIsXG4gICAgICAgICAgcXVhbGl0eVNjb3JlOiA5MixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0LXR3b1wiLFxuICAgICAgICAgIG5hbWU6IFwiQ2l0YXRpb24gUHJvamVjdCBUd29cIixcbiAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImFjdGl2ZVwiLFxuICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Byb2plY3QtdHdvXCIsXG4gICAgICAgICAgcXVhbGl0eVNjb3JlOiA4OCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiY29tYm9ib3hcIikuc2VsZWN0T3B0aW9uKFwiZTJlLXByb2plY3QtdHdvXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUNvdW50KFxuICAgICAgMCxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2Jsb2NrZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiY29tYm9ib3hcIikuc2VsZWN0T3B0aW9uKFwiZTJlLXByb2plY3Qtb25lXCIpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgYWNyb3NzIHJlcGVhdGVkIG5hdmlnYXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1hY2NlcHRlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2LPZhNmI2YMg2YXZh9mE2KkgcHJvdmlkZXIg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBjb25zdCBibG9ja2VkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBibG9ja2VkOiB0cnVlLFxuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWJsb2NrZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINin2YTYr9mE2YrZhCDYp9mE2YXYrdis2YjYqCDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogYWNjZXB0ZWQsXG4gICAgICBhbHRlcm5hdGVBaTogYmxvY2tlZCxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlXG4gICAgICAgICAgLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KVxuICAgICAgICAgIC5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICB9O1xuICAgIGNvbnN0IGFzc2VydEJsb2NrZWRDaXRhdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZVxuICAgICAgICAgIC5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YmxvY2tlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgfTtcbiAgICBjb25zdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgICAgL01JU1NJTkdfTElURVJBTF9NQVRDSHxyYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICAgICk7XG4gICAgfTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiUHJvamVjdHNcIiwgYCR7REFTSEJPQVJEX1BBVEh9cHJvamVjdHNgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG4gICAgYXdhaXQgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscygpO1xuXG4gICAgYXdhaXQgcGFnZS5nb0ZvcndhcmQoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfXByb2plY3RzJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiRXZlbnQgU3RyZWFtXCIsIGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QmxvY2tlZENpdGF0aW9uKCk7XG4gICAgYXdhaXQgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscygpO1xuXG4gICAgYXdhaXQgcGFnZS5nb0ZvcndhcmQoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWV2ZW50cyRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QmxvY2tlZENpdGF0aW9uKCk7XG4gICAgYXdhaXQgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscygpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgb25seSB0aGUgc2FmZSBibG9ja2VkIGNpdGF0aW9uIHJlYXNvbiBhZnRlciBjaGF0IHJlbG9hZFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBmaXh0dXJlID0gaW5zdGFsbFRvb2xGYWlsdXJlRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBkaWQgbm90IGNvbXBsZXRlIOKAlCBCTE9DS0VEL0lOQ09NUExFVEVcIiwge1xuICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVG9vbCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIik7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIkNPTVBMRVRFRFwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZS5cIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgZmFpbGVkIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMzkwLCBoZWlnaHQ6IDg0NCB9KTtcbiAgICBjb25zdCBmaXh0dXJlID0gaW5zdGFsbFRvb2xGYWlsdXJlRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBkaWQgbm90IGNvbXBsZXRlIOKAlCBCTE9DS0VEL0lOQ09NUExFVEVcIiwge1xuICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVG9vbCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIik7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3IGV4Y2VwdGlvbnxzdGFjayB0cmFjZXxcXC9ob21lXFwvcnVubmVyfHNlY3JldHxmaXh0dXJlIGRpYWdub3N0aWMvaSxcbiAgICApO1xuXG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJwcmVzZXJ2ZXMgb25lIHBhcnRpYWwgYW5zd2VyIGFmdGVyIGEgcHJvdmlkZXIgZGlzY29ubmVjdCBhbmQgbWFya3MgaXQgaW5jb21wbGV0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBmaXh0dXJlID0gaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRpc2Nvbm5lY3RBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhbnN3ZXIgPSBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KTtcbiAgICBhd2FpdCBleHBlY3QoYW5zd2VyLmxhc3QoKSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJJTkNPTVBMRVRFOlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcInByb3ZpZGVyIGZhaWx1cmVcIiwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcInN0b3BwZWQ6IHByb3ZpZGVyIHRpbWVvdXRcIiwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYWZ0ZXIgdmlzaWJsZSByZXNwb25zZSB0ZXh0LlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogZml4dHVyZS5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJJTkNPTVBMRVRFOlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcInByb3ZpZGVyIGZhaWx1cmVcIiwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcInN0b3BwZWQ6IHByb3ZpZGVyIHRpbWVvdXRcIiwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYWZ0ZXIgdmlzaWJsZSByZXNwb25zZSB0ZXh0LlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICB9KTtcblxuICB0ZXN0KFwicmVzdW1lcyBhIGZhaWxlZCBhbmFseXNpcyBhbmQga2VlcHMgdGhlIGV4ZWN1dGlvbiBpbmNvbXBsZXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHsgZml4dHVyZSwgZXhlY3V0aW9uIH0gPSBpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGZpeHR1cmUsXG4gICAgICByZXN1bWVGYWlsdXJlOiB7IGZpeHR1cmUsIGV4ZWN1dGlvbiB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoXG4gICAgICAoeyBzZXNzaW9uSWQsIGV4ZWN1dGlvbklkLCBwcm9qZWN0SWQsIHJlc3VtZVRva2VuLCBtZXNzYWdlIH0pID0+IHtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgICAgYGVvc19haV9leGVjdXRpb25fY3VycmVudF8ke3Byb2plY3RJZH1gLFxuICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgKTtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgICAgYGVvc19haV9leGVjdXRpb25fJHtwcm9qZWN0SWR9XyR7c2Vzc2lvbklkfWAsXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgaWQ6IGV4ZWN1dGlvbklkLFxuICAgICAgICAgICAgcHJvamVjdElkLFxuICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgcmVzdW1lVG9rZW4sXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgc2Vzc2lvbklkOiBmaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQ6IGZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICByZXN1bWVUb2tlbjogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLXRva2VuLW9wYXF1ZVwiLFxuICAgICAgICBtZXNzYWdlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHJlc3VtZVJlcXVlc3QgPSBwYWdlLndhaXRGb3JSZXF1ZXN0KFxuICAgICAgKHJlcXVlc3QpID0+XG4gICAgICAgIHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpICYmXG4gICAgICAgIHJlcXVlc3QubWV0aG9kKCkgPT09IFwiUE9TVFwiLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIilcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZVwiLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgY29uc3QgcmVxdWVzdEJvZHkgPSBKU09OLnBhcnNlKFxuICAgICAgKGF3YWl0IHJlc3VtZVJlcXVlc3QpLnBvc3REYXRhKCkgPz8gXCJ7fVwiLFxuICAgICkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZXhwZWN0KHJlcXVlc3RCb2R5KS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBmaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQ6IGZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgIHJlc3VtZVRva2VuOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCIsXG4gICAgICAgIG1lc3NhZ2U6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGYWlsZWQgdG8gc2VuZCBtZXNzYWdlXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQSBzYXZlZCBBSSBleGVjdXRpb24gaXMgcmVhZHkgdG8gcmVzdW1lXCIpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZWNvdmVycyBhIG1pc3NpbmcgdG9rZW4gYWZ0ZXIgYSByZWFsIHN0cmVhbSBhYm9ydCBhbmQgcmVzdW1lcyBvbmUgZXhlY3V0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0gaW5zdGFsbEludGVycnVwdGVkUmVzdW1lRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGludGVycnVwdGVkUmVzdW1lOiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwYWdlLmFkZEluaXRTY3JpcHQoKCkgPT4ge1xuICAgICAgY29uc3QgbmF0aXZlRmV0Y2ggPSB3aW5kb3cuZmV0Y2guYmluZCh3aW5kb3cpO1xuICAgICAgd2luZG93LmZldGNoID0gYXN5bmMgKGlucHV0LCBpbml0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVybCA9XG4gICAgICAgICAgdHlwZW9mIGlucHV0ID09PSBcInN0cmluZ1wiXG4gICAgICAgICAgICA/IGlucHV0XG4gICAgICAgICAgICA6IGlucHV0IGluc3RhbmNlb2YgUmVxdWVzdFxuICAgICAgICAgICAgICA/IGlucHV0LnVybFxuICAgICAgICAgICAgICA6IFN0cmluZyhpbnB1dCk7XG4gICAgICAgIGNvbnN0IGJvZHkgPSB0eXBlb2YgaW5pdD8uYm9keSA9PT0gXCJzdHJpbmdcIiA/IGluaXQuYm9keSA6IFwiXCI7XG4gICAgICAgIGlmIChcbiAgICAgICAgICAhdXJsLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSB8fFxuICAgICAgICAgIGJvZHkuaW5jbHVkZXMoJ1wiZXhlY3V0aW9uSWRcIicpXG4gICAgICAgICkge1xuICAgICAgICAgIHJldHVybiBuYXRpdmVGZXRjaChpbnB1dCwgaW5pdCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IG5hdGl2ZUZldGNoKGlucHV0LCBpbml0KTtcbiAgICAgICAgaWYgKCFyZXNwb25zZS5ib2R5KSByZXR1cm4gcmVzcG9uc2U7XG4gICAgICAgIGNvbnN0IHJlYWRlciA9IHJlc3BvbnNlLmJvZHkuZ2V0UmVhZGVyKCk7XG4gICAgICAgIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKTtcbiAgICAgICAgY29uc3Qgc3RyZWFtID0gbmV3IFJlYWRhYmxlU3RyZWFtKHtcbiAgICAgICAgICBhc3luYyBzdGFydChjb250cm9sbGVyKSB7XG4gICAgICAgICAgICBsZXQgYnVmZmVyZWQgPSBcIlwiO1xuICAgICAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICAgICAgY29uc3QgeyBkb25lLCB2YWx1ZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgICAgICAgICAgaWYgKGRvbmUpIHtcbiAgICAgICAgICAgICAgICBpZiAoYnVmZmVyZWQpIGNvbnRyb2xsZXIuZW5xdWV1ZShlbmNvZGVyLmVuY29kZShidWZmZXJlZCkpO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuY2xvc2UoKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnVmZmVyZWQgKz0gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHZhbHVlLCB7IHN0cmVhbTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgY29uc3QgbWFya2VyID0gYnVmZmVyZWQuaW5kZXhPZignXCJ0eXBlXCI6XCJleGVjdXRpb25fc3RhcnRlZFwiJyk7XG4gICAgICAgICAgICAgIGNvbnN0IGZyYW1lRW5kID1cbiAgICAgICAgICAgICAgICBtYXJrZXIgPCAwID8gLTEgOiBidWZmZXJlZC5pbmRleE9mKFwiXFxuXFxuXCIsIG1hcmtlcik7XG4gICAgICAgICAgICAgIGlmIChmcmFtZUVuZCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKFxuICAgICAgICAgICAgICAgICAgZW5jb2Rlci5lbmNvZGUoYnVmZmVyZWQuc2xpY2UoMCwgZnJhbWVFbmQgKyAyKSksXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVycm9yKG5ldyBUeXBlRXJyb3IoXCJuZXR3b3JrIGNvbm5lY3Rpb24gcmVzZXRcIikpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKHN0cmVhbSwge1xuICAgICAgICAgIHN0YXR1czogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICAgIHN0YXR1c1RleHQ6IHJlc3BvbnNlLnN0YXR1c1RleHQsXG4gICAgICAgICAgaGVhZGVyczogcmVzcG9uc2UuaGVhZGVycyxcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4gPSBbXTtcbiAgICBwYWdlLm9uKFwicmVxdWVzdFwiLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKFxuICAgICAgICByZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSAmJlxuICAgICAgICByZXF1ZXN0Lm1ldGhvZCgpID09PSBcIlBPU1RcIlxuICAgICAgKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMucHVzaChcbiAgICAgICAgICAgIHJlcXVlc3QucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gSWdub3JlIHJlcXVlc3RzIHdpdGhvdXQgYSBKU09OIGJvZHk7IHRoZSBhc3NlcnRpb25zIGJlbG93IHJlcXVpcmVcbiAgICAgICAgICAvLyBib3RoIGpvdXJuZXkgcmVxdWVzdHMgdG8gaGF2ZSBhIHZhbGlkIHJlcXVlc3QgZW52ZWxvcGUuXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIkV4ZWN1dGlvbiBwYXVzZWQg4oCUIHJlYWR5IHRvIHJlc3VtZSBmcm9tIGl0cyBkdXJhYmxlIGNoZWNrcG9pbnRcIixcbiAgICAgICAge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCBzdG9yYWdlS2V5ID1cbiAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtaW50ZXJydXB0ZWQtcmVzdW1lLXNlc3Npb25cIjtcbiAgICBjb25zdCBwb2ludGVyS2V5ID0gXCJlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfZTJlLXByb2plY3RcIjtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHBhZ2UuZXZhbHVhdGUoKGtleSkgPT4gbG9jYWxTdG9yYWdlLmdldEl0ZW0oa2V5KSwgc3RvcmFnZUtleSkpXG4gICAgICAudG9Db250YWluKHJlY292ZXJ5LmluaXRpYWxUb2tlbik7XG5cbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKFxuICAgICAgKHsgc3RvcmFnZUtleSwgcG9pbnRlcktleSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IHNhdmVkID0gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShzdG9yYWdlS2V5KSA/PyBcInt9XCIpO1xuICAgICAgICBkZWxldGUgc2F2ZWQucmVzdW1lVG9rZW47XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKHN0b3JhZ2VLZXksIEpTT04uc3RyaW5naWZ5KHNhdmVkKSk7XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKHBvaW50ZXJLZXksIFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCIpO1xuICAgICAgfSxcbiAgICAgIHsgc3RvcmFnZUtleSwgcG9pbnRlcktleSB9LFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQSBzYXZlZCBBSSBleGVjdXRpb24gaXMgcmVhZHkgdG8gcmVzdW1lXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PlxuICAgICAgICBwYWdlLmV2YWx1YXRlKChrZXkpID0+IHtcbiAgICAgICAgICBjb25zdCBzYXZlZCA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oa2V5KSA/PyBcInt9XCIpO1xuICAgICAgICAgIHJldHVybiBzYXZlZC5yZXN1bWVUb2tlbjtcbiAgICAgICAgfSwgc3RvcmFnZUtleSksXG4gICAgICApXG4gICAgICAudG9CZShyZWNvdmVyeS5yZWNvdmVyZWRUb2tlbik7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQocmVjb3ZlcnkuZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCkudG9CZSgyKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0pLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBtZXNzYWdlOiByZWNvdmVyeS5maXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSksXG4gICAgKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0/LmV4ZWN1dGlvbklkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdPy5zZXNzaW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMV0pLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IHJlY292ZXJ5LmZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogcmVjb3ZlcnkuZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcmVzdW1lVG9rZW46IHJlY292ZXJ5LnJlY292ZXJlZFRva2VuLFxuICAgICAgICBtZXNzYWdlOiByZWNvdmVyeS5maXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSksXG4gICAgKTtcbiAgICBleHBlY3QoXG4gICAgICBzdHJlYW1SZXF1ZXN0cy5tYXAoKHJlcXVlc3QpID0+IHJlcXVlc3QuZXhlY3V0aW9uSWQpLmZpbHRlcihCb29sZWFuKSxcbiAgICApLnRvRXF1YWwoW3JlY292ZXJ5LmZpeHR1cmUuZXhlY3V0aW9uSWRdKTtcbiAgfSk7XG5cbiAgdGVzdChcInByb2plY3RzIGRlbGl2ZXJ5IHJlY292ZXJ5IHN0YXRlcyBzYWZlbHkgYWZ0ZXIgcmVsb2FkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB2YWxpZGF0aW9uIG5lZWRzIHRvIGJlIHJ1biBhZ2Fpbi5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJSZXN1bWUgdmFsaWRhdGlvbiB0byByZS1jaGVjayB0aGUgc2F2ZWQgY2hhbmdlcywgb3IgZGlzY2FyZCB0aGlzIHJlY292ZXJ5IGlmIGl0IGlzIG5vIGxvbmdlciBuZWVkZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBbeyBwcm9maWxlOiBcIndvcmtzcGFjZS10eXBlY2hlY2tcIiwgc3RhdHVzOiBcImZhaWxlZFwiIH1dLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogdHJ1ZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LW1pc3NpbmctcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LW1pc3Npbmctc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJhYmFuZG9uZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcIm1pc3Npbmdfd29ya3NwYWNlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIHNhdmVkIGRlbGl2ZXJ5IHdvcmtzcGFjZSBpcyBubyBsb25nZXIgYXZhaWxhYmxlLCBzbyByZWNvdmVyeSBjYW5ub3QgY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiU3RhcnQgYSBuZXcgZGVsaXZlcnkgZnJvbSB0aGUgY3VycmVudCBwcm9qZWN0IHJhdGhlciB0aGFuIHJldHJ5aW5nIHRoaXMgcmVjb3ZlcnkuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IFwiV29ya3NwYWNlIGV4cGlyZWQgYWZ0ZXIgdGhlIHJ1bm5lciB3YXMgcmVjeWNsZWQuXCIsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBudWxsLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInJlamVjdGVkXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOiBcIk5vIGFjdGlvbiBpcyByZXF1aXJlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogXCJJbnRlcm5hbCBkaWFnbm9zdGljOiBzaG91bGQgbmV2ZXIgYmUgcmVuZGVyZWRcIixcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVnaW9uKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWdpb24uZ2V0QnlUZXh0KFwiUmVjb3ZlcmFibGVcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFwiV29ya3NwYWNlIHVuYXZhaWxhYmxlXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJBbHJlYWR5IGRpc2NhcmRlZFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoZSBzYXZlZCBkZWxpdmVyeSB3b3Jrc3BhY2UgaXMgbm8gbG9uZ2VyIGF2YWlsYWJsZSwgc28gcmVjb3ZlcnkgY2Fubm90IGNvbnRpbnVlLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcbiAgICAgICAgXCJSZXRhaW5lZCByZWFzb246IFdvcmtzcGFjZSBleHBpcmVkIGFmdGVyIHRoZSBydW5uZXIgd2FzIHJlY3ljbGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IGF2YWlsYWJsZSA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGNvbnN0IG1pc3NpbmcgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktbWlzc2luZy1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgY29uc3QgZGlzY2FyZGVkID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZSkudG9IYXZlQXR0cmlidXRlKFxuICAgICAgXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsXG4gICAgICBcInJlY292ZXJhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QobWlzc2luZykudG9IYXZlQXR0cmlidXRlKFxuICAgICAgXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsXG4gICAgICBcIm1pc3Npbmdfd29ya3NwYWNlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwiZGlzY2FyZGVkXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QobWlzc2luZy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRGlzYWJsZWQoKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL1xcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvfFxcL3dvcmtzcGFjZVxcL3xpbnRlcm5hbCBkaWFnbm9zdGljL2ksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRSZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRSZWdpb24pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVsb2FkZWRSZWdpb25cbiAgICAgICAgLmxvY2F0b3IoJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiXScpXG4gICAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSksXG4gICAgKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZFJlZ2lvblxuICAgICAgICAubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1vcGVyYXRpb25cIl0nKVxuICAgICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pLFxuICAgICkudG9CZURpc2FibGVkKCk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICBleHBlY3QocmVjb3ZlcnkucmVxdWVzdHMuZXZlcnkoKHVybCkgPT4gdXJsLmluY2x1ZGVzKFwicHJvamVjdElkPWUyZS1wcm9qZWN0XCIpKSkudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgdGVzdChcImV4cGxhaW5zIHdoZW4gZGVsaXZlcnkgcmVjb3ZlcnkgbG9zZXMgYSByYWNlIGFuZCByZWZyZXNoZXMgc3RhdGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBhY3Rpb25SZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDQ6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHRoZSByZXRhaW5lZCBjaGFuZ2VzIG5lZWQgcmV2aWV3IGJlZm9yZSB2YWxpZGF0aW9uIGNhbiBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJSZXN1bWUgdmFsaWRhdGlvbiB0byByZS1jaGVjayB0aGUgc2F2ZWQgY2hhbmdlcywgb3IgZGlzY2FyZCB0aGlzIHJlY292ZXJ5IGlmIGl0IGlzIG5vIGxvbmdlciBuZWVkZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBbeyBwcm9maWxlOiBcIndvcmtzcGFjZS10eXBlY2hlY2tcIiwgc3RhdHVzOiBcImZhaWxlZFwiIH1dLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogdHJ1ZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZWNvdmVyeUFjdGlvbjoge1xuICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsXCIsXG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIGFzIGNvbnN0LFxuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIGVycm9yOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgIGNvZGU6IFwiREVMSVZFUllfQUxSRUFEWV9ESVNDQVJERURcIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICBuZXh0QWN0aW9uOiBcIk5vIGFjdGlvbiBpcyByZXF1aXJlZC5cIixcbiAgICAgICAgICBkaWFnbm9zdGljOiBcIkRvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsLlwiLFxuICAgICAgICB9LFxuICAgICAgICBuZXh0T3BlcmF0aW9uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXNlc3Npb25cIixcbiAgICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICAgIHN0YXR1czogXCJyZWplY3RlZFwiLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDQ6MDAuMDAwWlwiLFxuICAgICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgICBuZXh0QWN0aW9uOiBcIk5vIGFjdGlvbiBpcyByZXF1aXJlZC5cIixcbiAgICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBudWxsLFxuICAgICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXJ5IHN0YXRlIGNoYW5nZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGlzIHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC4gVGhlIHJlY292ZXJ5IGxpc3Qgd2FzIHJlZnJlc2hlZC5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiByZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpXG4gICAgICAudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uKS50b0hhdmVBdHRyaWJ1dGUoXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsIFwiZGlzY2FyZGVkXCIpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0c1swXSkudG9Db250YWluKFxuICAgICAgXCIvYXBpL2FpL2RlbGl2ZXJ5L2UyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsL3Jlc3VtZS12YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBleHBlY3QoYXdhaXQgcmVnaW9uLmxvY2F0b3IoJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiXScpLmNvdW50KCkpLnRvQmUoMSk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goL0RvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2kpO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwiZXhwbGFpbnMgd2hlbiBhbiBvbGQgcmVjb3ZlcnkgbGluayBwb2ludHMgdG8gYSBkZWxldGVkIG9wZXJhdGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIGFjdGlvblJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNTowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdGhlIHJldGFpbmVkIGNoYW5nZXMgbmVlZCByZXZpZXcgYmVmb3JlIHZhbGlkYXRpb24gY2FuIGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5QWN0aW9uOiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWxcIixcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgIHN0YXR1czogNDA0LFxuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIGVycm9yOiBcIkRlbGl2ZXJ5IG9wZXJhdGlvbiBub3QgZm91bmRcIixcbiAgICAgICAgICBjb2RlOiBcIkRFTElWRVJZX05PVF9GT1VORFwiLFxuICAgICAgICAgIGRpYWdub3N0aWM6IFwiRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWwuXCIsXG4gICAgICAgIH0sXG4gICAgICAgIG5leHRPcGVyYXRpb25zOiBbXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgb3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3ZlcnkgbGluayBleHBpcmVkXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhpcyByZWNvdmVyeSBvcGVyYXRpb24gbm8gbG9uZ2VyIGV4aXN0cy4gVGhlIHJlY292ZXJ5IGxpc3Qgd2FzIHJlZnJlc2hlZC5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHJlZ2lvbi5jb3VudCgpKS50b0JlKDApO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5hY3Rpb25SZXF1ZXN0c1swXSkudG9Db250YWluKFxuICAgICAgXCIvYXBpL2FpL2RlbGl2ZXJ5L2UyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsL3Jlc3VtZS12YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9EZWxpdmVyeSBvcGVyYXRpb24gbm90IGZvdW5kfERvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSByZXN1bWVkIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMzkwLCBoZWlnaHQ6IDg0NCB9KTtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgZXhwZWN0KGNvbXBvc2VyKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGJlZm9yZU9wZW4gPSBhd2FpdCBjb21wb3Nlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChiZWZvcmVPcGVuPy53aWR0aCkudG9CZUdyZWF0ZXJUaGFuKDI1MCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT3BlbiBzZXNzaW9uc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiU2Vzc2lvbnNcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBkcmF3ZXIgPSBwYWdlXG4gICAgICAuZ2V0QnlUZXh0KFwiU2Vzc2lvbnNcIiwgeyBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKTtcbiAgICBjb25zdCBkcmF3ZXJCb3ggPSBhd2FpdCBkcmF3ZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoZHJhd2VyQm94Py53aWR0aCkudG9CZUxlc3NUaGFuT3JFcXVhbCgzOTApO1xuICAgIGNvbnN0IGR1cmluZ09wZW4gPSBhd2FpdCBjb21wb3Nlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChkdXJpbmdPcGVuPy53aWR0aCkudG9CZUdyZWF0ZXJUaGFuKDI1MCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2Ugc2lkZWJhclwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9wZW4gc2Vzc2lvbnNcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZW5kZXJzIGEgdXNlci12aXNpYmxlIEFQSSBmYWlsdXJlIHN0YXRlXCIsIGFzeW5jICh7IHBhZ2UgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIChyb3V0ZSkgPT5cbiAgICAgIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcImNvbnRyb2xsZWQgZGFzaGJvYXJkIG91dGFnZVwiIH0sIDUwMyksXG4gICAgICApLFxuICAgICk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRmFpbGVkIHRvIGxvYWQgZGFzaGJvYXJkXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICB9KTtcbn0pO1xuIl0sIm1hcHBpbmdzIjoiO0FBQUEsU0FBU0EsTUFBTSxFQUFFQyxJQUFJLFFBQW1CLGtCQUFrQjtBQUMxRCxTQUFTQyxLQUFLLEVBQUVDLFNBQVMsUUFBUSxrQkFBa0I7QUFDbkQsU0FB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